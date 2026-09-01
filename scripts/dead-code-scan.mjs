import { spawn } from 'node:child_process';
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, '.review', 'dead.json');
const TS_PRUNE_OUTPUT_IGNORE_PATTERN = String.raw`(?:^|/)(?:\.next|generated|prisma/migrations|__tests__|tests|scripts|deploy)(?:/|$)|\.(?:test|spec)\.[cm]?[jt]sx?:|(?:^|/)app/(?:.*/)?(?:page|layout|loading|error|global-error|not-found|default|template|route|sitemap|robots|manifest)\.[cm]?[jt]sx?:|(?:^|/)(?:instrumentation|proxy|[^/]+\.config)\.[cm]?[jt]sx?:|\.d\.ts:`;
const MADGE_EXCLUDE_PATTERN =
  String.raw`(?:^|/)(?:generated|prisma/migrations|__tests__|tests)(?:/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$`;

function localBinary(rootDir, name) {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  return path.join(rootDir, 'node_modules', '.bin', `${name}${suffix}`);
}

export function executeTool({
  rootDir,
  name,
  args,
  acceptedExitCodes = [0],
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(localBinary(rootDir, name), args, {
      cwd: rootDir,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (acceptedExitCodes.includes(code)) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `signal ${signal ?? 'none'}`;
      reject(new Error(`${name} failed with exit code ${code}: ${detail}`));
    });
  });
}

function parseJson(tool, stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${tool} returned invalid JSON`, { cause: error });
  }
}

function compareJson(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right), 'en');
}

function normalizeKnipIssues(issues) {
  return issues
    .map((issue) =>
      Object.fromEntries(
        Object.entries(issue).map(([key, value]) => [
          key,
          Array.isArray(value) ? [...value].sort(compareJson) : value,
        ]),
      ),
    )
    .sort((left, right) =>
      String(left.file ?? '').localeCompare(String(right.file ?? ''), 'en'),
    );
}

async function installedVersions(rootDir) {
  const packageJson = JSON.parse(
    await readFile(path.join(rootDir, 'package.json'), 'utf8'),
  );
  return Object.fromEntries(
    ['knip', 'ts-prune', 'madge'].map((name) => [
      name,
      packageJson.devDependencies?.[name] ?? null,
    ]),
  );
}

export async function collectDeadCodeReport({
  rootDir = PROJECT_ROOT,
  execute = executeTool,
} = {}) {
  const [knipResult, tsPruneResult, madgeResult, versions] = await Promise.all([
    execute({
      rootDir,
      name: 'knip',
      args: [
        '--config',
        'knip.jsonc',
        '--reporter',
        'json',
        '--no-progress',
        '--no-exit-code',
      ],
    }),
    execute({
      rootDir,
      name: 'ts-prune',
      args: [
        '--project',
        'tsconfig.json',
        '--ignore',
        TS_PRUNE_OUTPUT_IGNORE_PATTERN,
      ],
    }),
    execute({
      rootDir,
      name: 'madge',
      // madge uses exit 1 to report that --circular found cycles while still
      // writing valid JSON. Other non-zero exits remain scanner failures.
      acceptedExitCodes: [0, 1],
      args: [
        '--circular',
        '--json',
        '--no-spinner',
        '--extensions',
        'ts,tsx,js,mjs,cjs',
        '--ts-config',
        'tsconfig.json',
        '--exclude',
        MADGE_EXCLUDE_PATTERN,
        'actions',
        'app',
        'components',
        'hooks',
        'lib',
        'scripts',
        'instrumentation.ts',
        'proxy.ts',
      ],
    }),
    installedVersions(rootDir),
  ]);

  const knip = parseJson('knip', knipResult.stdout);
  const circular = parseJson('madge', madgeResult.stdout);
  const tsPruneOutputIgnore = new RegExp(
    TS_PRUNE_OUTPUT_IGNORE_PATTERN,
    'u',
  );
  const tsPruneCandidates = tsPruneResult.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !tsPruneOutputIgnore.test(line))
    .sort();

  return {
    schemaVersion: 1,
    tools: {
      knip: {
        version: versions.knip,
        issues: normalizeKnipIssues(knip.issues ?? []),
      },
      tsPrune: { version: versions['ts-prune'], candidates: tsPruneCandidates },
      madge: {
        version: versions.madge,
        circular: [...circular].sort(compareJson),
      },
    },
  };
}

export async function writeJsonAtomically(outputPath, report) {
  const outputDirectory = path.dirname(outputPath);
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await mkdir(outputDirectory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function runDeadCodeScan({
  rootDir = PROJECT_ROOT,
  outputPath = DEFAULT_OUTPUT,
  execute = executeTool,
} = {}) {
  const report = await collectDeadCodeReport({ rootDir, execute });
  await writeJsonAtomically(outputPath, report);
  return report;
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runDeadCodeScan().then(
    (report) => {
      const knipCount = report.tools.knip.issues.length;
      const pruneCount = report.tools.tsPrune.candidates.length;
      const cycleCount = report.tools.madge.circular.length;
      console.log(
        `dead-code scan wrote .review/dead.json (${knipCount} knip issue groups, ${pruneCount} ts-prune candidates, ${cycleCount} cycles)`,
      );
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
