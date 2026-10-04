import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeJsonAtomically } from './dead-code-scan.mjs';
import { checkDocument, compareDocDriftBaseline, createDocDriftBaseline } from './lib/doc-drift.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function excludedFromBasenames(file) {
  return /^(?:docs\/(?:archive|audits)|public\/load-test)(?:\/|$)/u.test(file) ||
    /(?:^|\/)(?:\.git|node_modules|generated|\.next(?:-[^/]+)?|\.review|coverage|test-results[^/]*|playwright-report[^/]*|blob-report|\.vitest-attachments|__screenshots__|\.vercel|\.turbo|build|dist|out|output)(?:\/|$)/u.test(file) ||
    /(?:^|\/)next-env\.d\.ts$/u.test(file) || /\.tsbuildinfo$/u.test(file);
}

async function repositoryFiles(rootDir) {
  try {
    // NUL separators preserve spaces, Unicode and newlines in tracked filenames.
    return execFileSync('git', ['ls-files', '--cached', '-z'], {
      cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024,
    }).split('\0').filter((file) => file && !excludedFromBasenames(file));
  } catch {
    // Source archives and environments without Git still get the same exclusions.
    const files = [];
    const visit = async (directory) => {
      for (const entry of await directoryEntries(path.join(rootDir, directory))) {
        const relative = path.posix.join(directory, entry.name);
        if (excludedFromBasenames(relative)) continue;
        if (entry.isDirectory()) await visit(relative);
        else if (entry.isFile() || entry.isSymbolicLink()) files.push(relative);
      }
    };
    await visit('');
    return files;
  }
}

export async function documentFiles(rootDir) {
  const files = [];
  for (const entry of await directoryEntries(rootDir)) {
    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'CHANGELOG.md') files.push(entry.name);
  }
  // Nested docs are maintained too; archive/ and audits/ are frozen records.
  const visitDocs = async (directory) => {
    for (const entry of await directoryEntries(path.join(rootDir, directory))) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['docs/archive', 'docs/audits'].includes(relative) && entry.name !== 'node_modules') await visitDocs(relative);
      } else if (entry.isFile() && entry.name.endsWith('.md')) files.push(relative);
    }
  };
  await visitDocs('docs');
  const visitSkills = async (directory) => {
    for (const entry of await directoryEntries(path.join(rootDir, directory))) {
      if (entry.name === 'node_modules') continue;
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) await visitSkills(relative);
      else if (entry.isFile() && entry.name === 'SKILL.md') files.push(relative);
    }
  };
  await visitSkills('.agents/skills');
  return files.sort();
}

export async function collectDocDrift({ rootDir = PROJECT_ROOT } = {}) {
  const { scripts = {} } = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
  const cache = new Map();
  const pathKind = (relative) => {
    if (!cache.has(relative)) {
      try {
        const stat = statSync(path.resolve(rootDir, relative));
        cache.set(relative, stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : undefined);
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        cache.set(relative, undefined);
      }
    }
    return cache.get(relative);
  };
  const basenames = new Set((await repositoryFiles(rootDir))
    .filter((file) => pathKind(file) === 'file')
    .map((file) => path.posix.basename(file)));
  const basenameExists = (name) => basenames.has(name);
  const files = await documentFiles(rootDir);
  const reports = await Promise.all(files.map(async (file) => checkDocument({
    file, content: await readFile(path.join(rootDir, file), 'utf8'), scripts, pathKind, basenameExists,
  })));
  return reports.flat();
}

export async function runDocDrift({ rootDir = PROJECT_ROOT, check = false, writeBaseline = false } = {}) {
  if (check && writeBaseline) throw new Error('Use either --check or --write-baseline, not both.');
  const issues = await collectDocDrift({ rootDir });
  const baselinePath = path.join(rootDir, 'config/doc-drift-baseline.json');
  if (writeBaseline) {
    let previousBaseline;
    try {
      previousBaseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await writeJsonAtomically(baselinePath, createDocDriftBaseline(issues, previousBaseline));
  }
  if (check) {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    const { added, resolved } = compareDocDriftBaseline(issues, baseline);
    if (added.length || resolved.length) {
      const format = (entry) => `${entry.file} ${entry.type} ${entry.reference}`;
      throw new Error([
        'Doc-drift baseline differs; review references before running --write-baseline.',
        ...added.map((entry) => `NEW ${format(entry)}`),
        ...resolved.map((entry) => `RESOLVED (remove from baseline / 收紧基线) ${format(entry)}`),
      ].join('\n'));
    }
  }
  return issues;
}

const isMain = process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !['--check', '--write-baseline'].includes(arg));
  const run = async () => {
    if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(' ')}`);
    const issues = await runDocDrift({ check: args.includes('--check'), writeBaseline: args.includes('--write-baseline') });
    if (!args.includes('--check')) {
      for (const issue of issues) console.log(`${issue.file}:${issue.line} ${issue.type} ${issue.reference}`);
    }
    const count = createDocDriftBaseline(issues).entries.length;
    console.log(`doc-drift: ${issues.length} occurrences, ${count} unique entries${args.includes('--check') ? ' (baseline matches)' : args.includes('--write-baseline') ? ' (baseline written)' : ''}`);
  };
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
