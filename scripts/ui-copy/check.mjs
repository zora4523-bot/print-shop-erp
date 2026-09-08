import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const policy = JSON.parse(fs.readFileSync(path.join(here, 'policy.json'), 'utf8'));
const visibleProps = new Set(['title', 'subtitle', 'description', 'notice', 'label', 'hint', 'placeholder', 'children', 'message', 'error', 'reason', 'action', 'changes', 'consequences', 'impactItems', 'confirmText', 'confirmLabel', 'cancelLabel', 'aria-label', 'aria-description', 'alt', 'emptyMessage', 'loadingText', 'basis', 'ariaLabel', 'pendingLabel']);
const feedbackCalls = /^(?:toast|alert|confirm|setError|setMessage|setNotice|setFeedback|setErrorMessage|setCopyNotice|setStatusMessage)$/;

/** Trace local values used by JSX and feedback sinks, not arbitrary code strings. */
export function inspectUiCopy(source, file, config = policy, context = {}) {
  const sf = context.sourceFile ?? ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const definitions = new Map();
  const scopeOf = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isFunctionLike(parent)) return parent;
    }
    return sf;
  };
  const bind = (name, node, initializer) => {
    const scope = scopeOf(node);
    const entries = definitions.get(scope) ?? new Map();
    entries.set(name, initializer);
    definitions.set(scope, entries);
  };
  const resolve = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      const match = definitions.get(parent)?.get(node.text);
      if (match) return match;
    }
    return context.resolve?.(node);
  };
  const collect = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) bind(n.name.text, n, n.initializer);
    if (ts.isFunctionDeclaration(n) && n.name && n.body) bind(n.name.text, n, n.body);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const found = new Map();
  const visited = new Set();
  const record = (node, text) => {
    const words = config.banned.filter(word => new RegExp(word === 'null' ? '\\bnull\\b' : word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(text));
    if (!words.length) return;
    const origin = node.getSourceFile();
    const originFile = context.root ? path.relative(context.root, origin.fileName).split(path.sep).join('/') : file;
    if (originFile.startsWith('node_modules/') || originFile.startsWith('generated/')) return;
    if (config.exemptions.some(e => e.file === originFile && e.text === text && e.reason?.trim())) return;
    const line = origin.getLineAndCharacterOfPosition(node.getStart(origin)).line + 1;
    found.set(`${originFile}:${node.pos}`, { file: originFile, line, text, words });
  };
  const value = (node) => {
    if (!node || visited.has(node)) return;
    visited.add(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) return record(node, node.text.trim());
    if (ts.isIdentifier(node)) return value(resolve(node));
    if (ts.isTemplateExpression(node)) { record(node.head, node.head.text); for (const s of node.templateSpans) { value(s.expression); record(s.literal, s.literal.text); } return; }
    if (ts.isConditionalExpression(node)) { value(node.whenTrue); value(node.whenFalse); return; }
    if (ts.isBinaryExpression(node)) {
      if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) { value(node.left); value(node.right); }
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      if (['href', 'id', 'value', 'key', 'type', 'status', 'role', 'code', 'slug', 'formId', 'command', 'intent', 'route'].includes(node.name.getText().replace(/["']/g, ''))) return;
      return value(node.initializer);
    }
    if (ts.isPropertyAccessExpression(node)) return value(node.expression);
    if (ts.isElementAccessExpression(node)) return value(node.expression);
    if (ts.isCallExpression(node)) {
      value(node.expression); for (const arg of node.arguments) if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) value(arg.body);
      return;
    }
    if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      for (const statement of node.statements) {
        if (ts.isReturnStatement(statement)) value(statement.expression);
        else if (ts.isIfStatement(statement)) { value(statement.thenStatement); value(statement.elseStatement); }
        else if (ts.isSwitchStatement(statement)) for (const clause of statement.caseBlock.clauses) value(clause);
        else if (ts.isTryStatement(statement)) { value(statement.tryBlock); value(statement.catchClause?.block); value(statement.finallyBlock); }
      }
      return;
    }
    if (ts.isJsxAttribute(node)) return;
    ts.forEachChild(node, value);
  };
  const visit = (n) => {
    if (ts.isJsxText(n)) value(n);
    if (ts.isJsxExpression(n) && !ts.isJsxAttribute(n.parent)) value(n.expression);
    if (ts.isJsxAttribute(n)) {
      const name = n.name.getText(sf);
      const tag = n.parent.parent;
      const textInput = /^(?:input|Input|ReadOnlyInput|textarea|Textarea)$/.test(tag.tagName?.getText(sf) ?? '');
      const hidden = n.parent.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(sf) === 'type' && p.initializer && ts.isStringLiteral(p.initializer) && ['hidden', 'checkbox', 'radio'].includes(p.initializer.text));
      if (visibleProps.has(name) || (textInput && !hidden && ['value', 'defaultValue'].includes(name))) value(n.initializer);
    }
    if (ts.isCallExpression(n)) {
      const name = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.expression.getText(sf) : '';
      if (feedbackCalls.test(name) || /(?:warnings|errors)$/.test(name)) for (const argument of n.arguments) value(argument);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...found.values()];
}

export function scan(root, config = policy) {
  const results = [];
  const files = [];
  const exemptions = new Set();
  for (const entry of config.exemptions) {
    const key = `${entry.file}:${entry.text}`;
    const full = path.resolve(root, entry.file);
    if (!entry.reason?.trim() || !entry.text?.trim() || /[*?]/.test(entry.file) || !full.startsWith(`${path.resolve(root)}${path.sep}`)) {
      throw new Error(`Invalid UI copy exemption: ${key}`);
    }
    if (exemptions.has(key)) throw new Error(`Duplicate UI copy exemption: ${key}`);
    exemptions.add(key);
    if (!fs.existsSync(full) || !fs.readFileSync(full, 'utf8').includes(entry.text)) {
      throw new Error(`Stale UI copy exemption: ${key}`);
    }
  }
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (/^(?:__tests__|__screenshots__|node_modules)$/.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(full);
    }
  };
  for (const dir of ['app', 'components', 'lib/ui']) walk(path.join(root, dir));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext, allowJs: true, skipLibCheck: true,
    baseUrl: root, paths: { '@/*': ['./*'] },
  });
  const checker = program.getTypeChecker();
  const resolve = (node) => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (!declaration) return undefined;
    const relative = path.relative(root, declaration.getSourceFile().fileName);
    if (relative.startsWith('..') || relative.startsWith('node_modules') || relative.startsWith('generated')) return undefined;
    if (ts.isVariableDeclaration(declaration)) return declaration.initializer;
    if (ts.isFunctionDeclaration(declaration)) return declaration.body;
    return undefined;
  };
  for (const file of files) results.push(...inspectUiCopy(
    fs.readFileSync(file, 'utf8'), path.relative(root, file).split(path.sep).join('/'), config,
    { root, sourceFile: program.getSourceFile(file), resolve },
  ));
  return [...new Map(results.map(row => [`${row.file}:${row.line}:${row.text}`, row])).values()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = scan(process.cwd());
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(errors, null, 2));
  else for (const e of errors) console.error(`${e.file}:${e.line} [${e.words.join(', ')}] ${e.text}`);
  if (!process.argv.includes('--json')) { console.log(`UI 文案检查：${errors.length} 处未豁免命中`); process.exitCode = errors.length ? 1 : 0; }
}
