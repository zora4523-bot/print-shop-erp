import {
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const DEFAULT_SOURCE_ROOTS = [
  'app',
  'actions',
  'components',
  'lib',
  'scripts',
] as const;
const DEFAULT_LONG_FUNCTION_THRESHOLD = 300;
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/u;
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;
const EXCLUDED_DIRECTORIES = new Set([
  '.next',
  '__tests__',
  'generated',
  'node_modules',
  'test',
  'tests',
]);

export type ArchitectureEdge = {
  source: string;
  target: string;
};

export type ReverseEdge = ArchitectureEdge & {
  id: string;
  rule: 'actions-to-app' | 'lib-to-app' | 'lib-to-components';
};

export type FunctionMeasurement = {
  id: string;
  file: string;
  lines: number;
};

export type ArchitectureAnalysis = {
  rootDir: string;
  longFunctionThreshold: number;
  modules: string[];
  edges: ArchitectureEdge[];
  cycles: string[][];
  reverseEdges: ReverseEdge[];
  longFunctions: FunctionMeasurement[];
};

export type ArchitectureDebt = {
  version: 1;
  longFunctionThreshold: number;
  allowedReverseEdges: string[];
  longFunctions: Array<{
    id: string;
    maxLines: number;
  }>;
};

export type ArchitectureViolation = {
  kind:
    | 'cycle'
    | 'long-function-growth'
    | 'new-long-function'
    | 'reverse-edge';
  message: string;
};

export type AnalyzeArchitectureOptions = {
  rootDir: string;
  sourceRoots?: readonly string[];
  longFunctionThreshold?: number;
};

export function analyzeArchitecture({
  rootDir,
  sourceRoots = DEFAULT_SOURCE_ROOTS,
  longFunctionThreshold = DEFAULT_LONG_FUNCTION_THRESHOLD,
}: AnalyzeArchitectureOptions): ArchitectureAnalysis {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteFiles = collectProductionFiles(absoluteRoot, sourceRoots);
  const moduleByAbsolutePath = new Map(
    absoluteFiles.map((file) => [canonicalPath(file), relativeModule(absoluteRoot, file)]),
  );
  const compilerOptions = readCompilerOptions(absoluteRoot);
  const edges = collectEdges(
    absoluteRoot,
    absoluteFiles,
    moduleByAbsolutePath,
    compilerOptions,
  );
  const functions = collectFunctions(absoluteRoot, absoluteFiles);
  const longFunctions = functions
    .filter((fn) => fn.lines > longFunctionThreshold)
    .sort(compareFunctionMeasurements);

  return {
    rootDir: absoluteRoot,
    longFunctionThreshold,
    modules: [...moduleByAbsolutePath.values()].sort(),
    edges,
    cycles: findCycles([...moduleByAbsolutePath.values()], edges),
    reverseEdges: findReverseEdges(edges),
    longFunctions,
  };
}

export function createArchitectureDebt(
  analysis: ArchitectureAnalysis,
): ArchitectureDebt {
  return {
    version: 1,
    longFunctionThreshold: analysis.longFunctionThreshold,
    allowedReverseEdges: analysis.reverseEdges.map((edge) => edge.id).sort(),
    longFunctions: analysis.longFunctions.map((fn) => ({
      id: fn.id,
      maxLines: fn.lines,
    })),
  };
}

export function findArchitectureViolations(
  analysis: ArchitectureAnalysis,
  debt: ArchitectureDebt,
): ArchitectureViolation[] {
  validateDebt(debt);
  if (analysis.longFunctionThreshold !== debt.longFunctionThreshold) {
    throw new Error(
      `扫描阈值 ${analysis.longFunctionThreshold} 与债务基线 ${debt.longFunctionThreshold} 不一致`,
    );
  }

  const violations: ArchitectureViolation[] = [];
  for (const cycle of analysis.cycles) {
    violations.push({
      kind: 'cycle',
      message: `新的模块循环：${cycle.join(' -> ')} -> ${cycle[0]}`,
    });
  }

  const allowedReverseEdges = new Set(debt.allowedReverseEdges);
  for (const edge of analysis.reverseEdges) {
    if (!allowedReverseEdges.has(edge.id)) {
      violations.push({
        kind: 'reverse-edge',
        message: `新的反向依赖（${edge.rule}）：${edge.id}`,
      });
    }
  }

  const longFunctionCaps = new Map(
    debt.longFunctions.map((entry) => [entry.id, entry.maxLines]),
  );
  for (const fn of analysis.longFunctions) {
    const cap = longFunctionCaps.get(fn.id);
    if (cap === undefined) {
      violations.push({
        kind: 'new-long-function',
        message: `新的超长函数：${fn.id} 当前 ${fn.lines} 行（阈值 ${debt.longFunctionThreshold}）`,
      });
    } else if (fn.lines > cap) {
      violations.push({
        kind: 'long-function-growth',
        message: `超长函数继续增长：${fn.id} 当前 ${fn.lines} 行，上限 ${cap}`,
      });
    }
  }

  return violations.sort((left, right) =>
    `${left.kind}:${left.message}`.localeCompare(
      `${right.kind}:${right.message}`,
    ),
  );
}

export function readArchitectureDebt(filePath: string): ArchitectureDebt {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  validateDebt(parsed);
  return parsed;
}

export function checkArchitecture(options: {
  rootDir: string;
  debt: ArchitectureDebt;
  sourceRoots?: readonly string[];
}): {
  analysis: ArchitectureAnalysis;
  violations: ArchitectureViolation[];
} {
  const analysis = analyzeArchitecture({
    rootDir: options.rootDir,
    sourceRoots: options.sourceRoots,
    longFunctionThreshold: options.debt.longFunctionThreshold,
  });
  return {
    analysis,
    violations: findArchitectureViolations(analysis, options.debt),
  };
}

function collectProductionFiles(
  rootDir: string,
  sourceRoots: readonly string[],
): string[] {
  const files: string[] = [];
  for (const sourceRoot of sourceRoots) {
    const absoluteSourceRoot = path.resolve(rootDir, sourceRoot);
    walkDirectory(absoluteSourceRoot, files);
  }
  return [...new Set(files.map((file) => path.resolve(file)))].sort();
}

function walkDirectory(directory: string, files: string[]): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        walkDirectory(absolutePath, files);
      }
      continue;
    }
    if (
      entry.isFile() &&
      SOURCE_EXTENSION.test(entry.name) &&
      !entry.name.endsWith('.d.ts') &&
      !TEST_FILE.test(entry.name)
    ) {
      files.push(absolutePath);
    }
  }
}

function collectEdges(
  rootDir: string,
  absoluteFiles: readonly string[],
  moduleByAbsolutePath: ReadonlyMap<string, string>,
  compilerOptions: ts.CompilerOptions,
): ArchitectureEdge[] {
  const edgeIds = new Set<string>();
  const edges: ArchitectureEdge[] = [];

  for (const absoluteFile of absoluteFiles) {
    const source = relativeModule(rootDir, absoluteFile);
    const sourceFile = createSourceFile(absoluteFile);
    for (const specifier of collectModuleSpecifiers(sourceFile)) {
      const resolved = resolveInternalModule(
        rootDir,
        absoluteFile,
        specifier,
        moduleByAbsolutePath,
        compilerOptions,
      );
      if (!resolved) continue;
      const id = `${source}\u0000${resolved}`;
      if (!edgeIds.has(id)) {
        edgeIds.add(id);
        edges.push({ source, target: resolved });
      }
    }
  }

  return edges.sort((left, right) =>
    `${left.source}:${left.target}`.localeCompare(
      `${right.source}:${right.target}`,
    ),
  );
}

function collectModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers = new Set<string>();
  const addStringLiteral = (node: ts.Expression | undefined) => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      specifiers.add(node.text);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addStringLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      ) {
        addStringLiteral(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifiers].sort();
}

function resolveInternalModule(
  rootDir: string,
  containingFile: string,
  specifier: string,
  moduleByAbsolutePath: ReadonlyMap<string, string>,
  compilerOptions: ts.CompilerOptions,
): string | null {
  const resolved = ts.resolveModuleName(
    specifier,
    containingFile,
    compilerOptions,
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (resolved) {
    const internal = moduleByAbsolutePath.get(canonicalPath(resolved));
    if (internal) return internal;
  }

  const unresolvedBase = specifier.startsWith('@/')
    ? path.resolve(rootDir, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(containingFile), specifier)
      : null;
  if (!unresolvedBase) return null;

  for (const candidate of resolutionCandidates(unresolvedBase)) {
    const internal = moduleByAbsolutePath.get(canonicalPath(candidate));
    if (internal) return internal;
  }
  return null;
}

function resolutionCandidates(basePath: string): string[] {
  const candidates = [basePath];
  const extension = path.extname(basePath);
  const extensionless = /\.[cm]?[jt]sx?$/u.test(extension)
    ? basePath.slice(0, -extension.length)
    : basePath;
  for (const sourceExtension of [
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
  ]) {
    candidates.push(`${extensionless}${sourceExtension}`);
    candidates.push(path.join(basePath, `index${sourceExtension}`));
  }
  return candidates;
}

function collectFunctions(
  rootDir: string,
  absoluteFiles: readonly string[],
): FunctionMeasurement[] {
  const measurements: FunctionMeasurement[] = [];
  for (const absoluteFile of absoluteFiles) {
    const sourceFile = createSourceFile(absoluteFile);
    const relativeFile = relativeModule(rootDir, absoluteFile);
    const candidates: Array<{
      baseId: string;
      lines: number;
    }> = [];

    const visit = (node: ts.Node): void => {
      if (isFunctionWithBody(node)) {
        const startLine = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line;
        const endLine = sourceFile.getLineAndCharacterOfPosition(
          Math.max(node.getEnd() - 1, node.getStart(sourceFile)),
        ).line;
        candidates.push({
          baseId: functionIdentity(relativeFile, node, sourceFile),
          lines: endLine - startLine + 1,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const totals = countBy(candidates.map((candidate) => candidate.baseId));
    const occurrences = new Map<string, number>();
    for (const candidate of candidates) {
      const occurrence = (occurrences.get(candidate.baseId) ?? 0) + 1;
      occurrences.set(candidate.baseId, occurrence);
      measurements.push({
        id:
          totals.get(candidate.baseId) === 1
            ? candidate.baseId
            : `${candidate.baseId}#${occurrence}`,
        file: relativeFile,
        lines: candidate.lines,
      });
    }
  }
  return measurements;
}

type FunctionWithBody =
  | (ts.FunctionDeclaration & { body: ts.FunctionBody })
  | (ts.FunctionExpression & { body: ts.FunctionBody })
  | ts.ArrowFunction
  | (ts.MethodDeclaration & { body: ts.FunctionBody })
  | (ts.ConstructorDeclaration & { body: ts.FunctionBody })
  | (ts.GetAccessorDeclaration & { body: ts.FunctionBody })
  | (ts.SetAccessorDeclaration & { body: ts.FunctionBody });

function isFunctionWithBody(node: ts.Node): node is FunctionWithBody {
  return (
    (ts.isFunctionDeclaration(node) && Boolean(node.body)) ||
    (ts.isFunctionExpression(node) && Boolean(node.body)) ||
    ts.isArrowFunction(node) ||
    (ts.isMethodDeclaration(node) && Boolean(node.body)) ||
    (ts.isConstructorDeclaration(node) && Boolean(node.body)) ||
    (ts.isGetAccessorDeclaration(node) && Boolean(node.body)) ||
    (ts.isSetAccessorDeclaration(node) && Boolean(node.body))
  );
}

function functionIdentity(
  relativeFile: string,
  node: FunctionWithBody,
  sourceFile: ts.SourceFile,
): string {
  const contexts: string[] = [];
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (isFunctionWithBody(parent)) {
      contexts.unshift(directFunctionLabel(parent, sourceFile));
    } else if (ts.isClassLike(parent)) {
      contexts.unshift(`class:${parent.name?.getText(sourceFile) ?? 'anonymous'}`);
    } else if (ts.isModuleDeclaration(parent)) {
      contexts.unshift(`namespace:${parent.name.getText(sourceFile)}`);
    }
    parent = parent.parent;
  }
  contexts.push(directFunctionLabel(node, sourceFile));
  return `${relativeFile}::${contexts.join('/')}`;
}

function directFunctionLabel(
  node: FunctionWithBody,
  sourceFile: ts.SourceFile,
): string {
  if (ts.isFunctionDeclaration(node)) {
    return `function:${node.name?.getText(sourceFile) ?? 'default'}`;
  }
  if (ts.isMethodDeclaration(node)) {
    return `method:${node.name.getText(sourceFile)}`;
  }
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isGetAccessorDeclaration(node)) {
    return `getter:${node.name.getText(sourceFile)}`;
  }
  if (ts.isSetAccessorDeclaration(node)) {
    return `setter:${node.name.getText(sourceFile)}`;
  }
  if (node.name) return `function:${node.name.getText(sourceFile)}`;

  const parent = node.parent;
  if (ts.isVariableDeclaration(parent)) {
    return `variable:${parent.name.getText(sourceFile)}`;
  }
  if (ts.isPropertyAssignment(parent)) {
    return `property:${parent.name.getText(sourceFile)}`;
  }
  if (ts.isPropertyDeclaration(parent)) {
    return `property:${parent.name.getText(sourceFile)}`;
  }
  if (ts.isExportAssignment(parent)) return 'default-export';
  if (ts.isBinaryExpression(parent) && parent.right === node) {
    return `assignment:${compactNodeText(parent.left, sourceFile)}`;
  }
  if (ts.isCallExpression(parent)) {
    const argumentIndex = parent.arguments.findIndex((argument) => argument === node);
    return `callback:${compactNodeText(parent.expression, sourceFile)}[${argumentIndex}]`;
  }
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
    return `jsx:${parent.parent.name.getText(sourceFile)}`;
  }
  return `anonymous:${ts.SyntaxKind[node.kind]}`;
}

function compactNodeText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/gu, '').slice(0, 120);
}

function findReverseEdges(edges: readonly ArchitectureEdge[]): ReverseEdge[] {
  const reverseEdges: ReverseEdge[] = [];
  for (const edge of edges) {
    const sourceRoot = moduleRoot(edge.source);
    const targetRoot = moduleRoot(edge.target);
    let rule: ReverseEdge['rule'] | null = null;
    if (sourceRoot === 'lib' && targetRoot === 'components') {
      rule = 'lib-to-components';
    } else if (sourceRoot === 'lib' && targetRoot === 'app') {
      rule = 'lib-to-app';
    } else if (sourceRoot === 'actions' && targetRoot === 'app') {
      rule = 'actions-to-app';
    }
    if (rule) {
      reverseEdges.push({
        ...edge,
        id: `${edge.source} -> ${edge.target}`,
        rule,
      });
    }
  }
  return reverseEdges.sort((left, right) => left.id.localeCompare(right.id));
}

function findCycles(
  modules: readonly string[],
  edges: readonly ArchitectureEdge[],
): string[][] {
  const adjacency = new Map(modules.map((module) => [module, [] as string[]]));
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }
  for (const targets of adjacency.values()) targets.sort();

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const connect = (moduleName: string): void => {
    indices.set(moduleName, nextIndex);
    lowLinks.set(moduleName, nextIndex);
    nextIndex += 1;
    stack.push(moduleName);
    onStack.add(moduleName);

    for (const target of adjacency.get(moduleName) ?? []) {
      if (!indices.has(target)) {
        connect(target);
        lowLinks.set(
          moduleName,
          Math.min(lowLinks.get(moduleName)!, lowLinks.get(target)!),
        );
      } else if (onStack.has(target)) {
        lowLinks.set(
          moduleName,
          Math.min(lowLinks.get(moduleName)!, indices.get(target)!),
        );
      }
    }

    if (lowLinks.get(moduleName) !== indices.get(moduleName)) return;
    const component: string[] = [];
    let popped: string;
    do {
      popped = stack.pop()!;
      onStack.delete(popped);
      component.push(popped);
    } while (popped !== moduleName);

    const selfCycle =
      component.length === 1 &&
      (adjacency.get(component[0]!) ?? []).includes(component[0]!);
    if (component.length > 1 || selfCycle) cycles.push(component.sort());
  };

  for (const moduleName of [...modules].sort()) {
    if (!indices.has(moduleName)) connect(moduleName);
  }
  return cycles.sort((left, right) => left.join(':').localeCompare(right.join(':')));
}

function readCompilerOptions(rootDir: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    return {
      allowJs: true,
      baseUrl: rootDir,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: { '@/*': ['*'] },
    };
  }
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) {
    throw new Error(formatTypescriptDiagnostic(loaded.error));
  }
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(configPath),
    { allowJs: true, noEmit: true },
    configPath,
  );
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(formatTypescriptDiagnostic).join('\n'));
  }
  return parsed.options;
}

function validateDebt(value: unknown): asserts value is ArchitectureDebt {
  if (!value || typeof value !== 'object') {
    throw new Error('架构债务基线必须是 JSON 对象');
  }
  const debt = value as Partial<ArchitectureDebt>;
  const threshold = debt.longFunctionThreshold;
  if (
    debt.version !== 1 ||
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    !Array.isArray(debt.allowedReverseEdges) ||
    !debt.allowedReverseEdges.every((entry) => typeof entry === 'string') ||
    !Array.isArray(debt.longFunctions)
  ) {
    throw new Error('架构债务基线格式无效');
  }
  const ids = new Set<string>();
  for (const entry of debt.longFunctions) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !Number.isInteger(entry.maxLines) ||
      entry.maxLines <= threshold ||
      ids.has(entry.id)
    ) {
      throw new Error('架构债务基线的超长函数条目无效或重复');
    }
    ids.add(entry.id);
  }
}

function formatTypescriptDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

function createSourceFile(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(filePath),
  );
}

function scriptKindForFile(filePath: string): ts.ScriptKind {
  if (/\.tsx$/u.test(filePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/u.test(filePath)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/u.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function relativeModule(rootDir: string, filePath: string): string {
  return normalizePath(path.relative(rootDir, filePath));
}

function canonicalPath(filePath: string): string {
  return normalizePath(path.resolve(filePath));
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function moduleRoot(modulePath: string): string {
  return modulePath.split('/')[0] ?? '';
}

function compareFunctionMeasurements(
  left: FunctionMeasurement,
  right: FunctionMeasurement,
): number {
  return left.id.localeCompare(right.id);
}

function countBy(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

type CliOptions = {
  mode: 'check' | 'print-baseline';
  rootDir: string;
  debtPath: string;
};

function parseCliOptions(argv: readonly string[]): CliOptions {
  let mode: CliOptions['mode'] = 'check';
  let rootDir = process.cwd();
  let debtPath: string | null = null;
  for (const argument of argv) {
    if (argument === '--check') mode = 'check';
    else if (argument === '--print-baseline') mode = 'print-baseline';
    else if (argument.startsWith('--root=')) rootDir = argument.slice('--root='.length);
    else if (argument.startsWith('--debt=')) debtPath = argument.slice('--debt='.length);
    else throw new Error(`未知参数：${argument}`);
  }
  const absoluteRoot = path.resolve(rootDir);
  return {
    mode,
    rootDir: absoluteRoot,
    debtPath: path.resolve(
      absoluteRoot,
      debtPath ?? 'config/architecture-debt.json',
    ),
  };
}

export function runArchitectureCli(argv: readonly string[]): number {
  const options = parseCliOptions(argv);
  if (options.mode === 'print-baseline') {
    const analysis = analyzeArchitecture({ rootDir: options.rootDir });
    process.stdout.write(`${JSON.stringify(createArchitectureDebt(analysis), null, 2)}\n`);
    return 0;
  }

  const debt = readArchitectureDebt(options.debtPath);
  const { analysis, violations } = checkArchitecture({
    rootDir: options.rootDir,
    debt,
  });
  if (violations.length > 0) {
    process.stderr.write(
      `架构门禁失败（${violations.length} 项）：\n${violations
        .map((violation) => `- ${violation.message}`)
        .join('\n')}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `架构门禁通过：${analysis.modules.length} 个模块，${analysis.edges.length} 条内部依赖，${analysis.longFunctions.length} 项超长函数债务。\n`,
  );
  return 0;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  try {
    process.exitCode = runArchitectureCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
