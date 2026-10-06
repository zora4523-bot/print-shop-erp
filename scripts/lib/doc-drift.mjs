import path from 'node:path';

const HISTORY_DOCUMENTS = new Set(['DECISIONS.md', 'HANDOFF.md', 'PROGRESS.md']);
const REPOSITORY_DIRECTORIES = new Set([
  'app', 'actions', 'components', 'lib', 'scripts', 'prisma', 'deploy',
  'tests', 'docs', 'config', 'hooks', 'public', 'patches', '.github', '.agents',
]);
const PNPM_COMMANDS = new Set([
  'add', 'approve-builds', 'audit', 'bin', 'build', 'cache', 'config', 'create',
  'dedupe', 'deploy', 'dlx', 'doctor', 'env', 'exec', 'fetch', 'help', 'i',
  'import', 'init', 'install', 'licenses', 'link', 'list', 'ls', 'outdated',
  'pack', 'patch', 'patch-commit', 'patch-remove', 'prune', 'publish', 'rebuild',
  'recursive', 'remove', 'rm', 'root', 'run', 'server', 'setup', 'start',
  'store', 'test', 'uninstall', 'unlink', 'update', 'up', 'why',
]);
const VALUE_OPTIONS = new Set(['--dir', '-C', '--filter', '--filter-prod', '-F', '--workspace-concurrency', '--reporter']);
const ISSUE_TYPES = new Set(['link', 'path', 'command']);

function unescapeMarkdown(value) {
  return value.replace(/\\([\\`*{}[\]()#+.!_<>-])/gu, '$1');
}

function decodePath(reference) {
  // Split before decoding: an encoded # is part of the filename, not an anchor.
  const withoutAnchor = reference.split('#', 1)[0].replace(/:\d+(?::\d+|[-–]\d+)?$/u, '');
  try {
    return decodeURIComponent(unescapeMarkdown(withoutAnchor)).replace(/:\d+(?::\d+|[-–]\d+)?$/u, '');
  } catch {
    // Malformed percent escapes remain a missing path, not a crashed scanner.
    return unescapeMarkdown(withoutAnchor);
  }
}

function isGenerated(target) {
  return /^(?:generated|node_modules|\.next(?:-[^/]+)?|\.review|coverage|test-results[^/]*|playwright-report[^/]*)(?:\/|$)/u.test(target);
}

function hasPlaceholder(value) {
  // Next.js dynamic/catch-all segments are literal directory names, not globs.
  const withoutDynamicSegments = value.replace(/\[\[?\.\.\.[\w-]+\]\]?/gu, '').replace(/\[[\w-]+\]/gu, '');
  return /[*?<>…{}$\[\]]|\.{3}/u.test(withoutDynamicSegments);
}

export function repositoryPath(reference) {
  const target = decodePath(reference).replace(/^\.\//u, '');
  if (!target || /\s/u.test(reference) || /[;,=|]/u.test(target) || hasPlaceholder(target) || isGenerated(target)) return null;
  const first = target.split('/')[0];
  // Limit bare filenames to source/document/config extensions. Dotted symbols
  // (Order.id, console.log), CSS classes and version numbers are not paths.
  const bareFile = !target.includes('/') && /^\.?[\w\p{L}][\w.\-\p{L}]*\.(?:[cm]?[jt]sx?|jsonc?|md|ya?ml|css|scss|html|sql|sh|conf|toml|xml|lock|txt|example|prisma)$/u.test(target);
  if (!REPOSITORY_DIRECTORIES.has(first) && !bareFile) return null;
  const normalized = path.posix.normalize(target);
  return isGenerated(normalized) ? null : normalized;
}

function inlineCodeSpans(line) {
  const spans = [];
  const ticks = /`+/gu;
  let opening;
  while ((opening = ticks.exec(line))) {
    let closing;
    while ((closing = ticks.exec(line))) {
      if (closing[0].length !== opening[0].length) continue;
      spans.push({ start: opening.index, end: ticks.lastIndex, content: line.slice(opening.index + opening[0].length, closing.index).trim() });
      break;
    }
    // An unmatched delimiter is literal text; later, shorter spans still count.
    if (!closing) ticks.lastIndex = opening.index + opening[0].length;
  }
  return spans;
}

// Read a Markdown destination with escaped or balanced parentheses, or <...>.
// Link titles are deliberately not part of the destination.
function linkDestination(text, start) {
  let cursor = start;
  while (/\s/u.test(text[cursor] ?? '') && cursor < text.length) cursor++;
  if (text[cursor] === '<') {
    const end = text.indexOf('>', cursor + 1);
    return end < 0 ? null : text.slice(cursor + 1, end);
  }
  const begin = cursor;
  let depth = 0;
  for (; cursor < text.length; cursor++) {
    const char = text[cursor];
    if (char === '\\') { cursor++; continue; }
    if (char === '(') depth++;
    if (char === ')') {
      if (depth === 0) break;
      depth--;
    }
    if (/\s/u.test(char) && depth === 0) break;
  }
  return text.slice(begin, cursor) || null;
}

export function markdownLinks(text) {
  const links = [];
  for (const match of text.matchAll(/(?<!\\)\]\(/gu)) {
    if (!text.slice(0, match.index).includes('[')) continue;
    const destination = linkDestination(text, match.index + 2);
    if (destination) links.push(destination);
  }
  const definition = /^\s{0,3}\[[^\]]+\]:\s*(.+)$/u.exec(text);
  if (definition) {
    const destination = linkDestination(definition[1], 0);
    if (destination) links.push(destination);
  }
  return links;
}

export function pnpmReferences(code) {
  const references = [];
  for (const match of code.matchAll(/(?<![\w./-])pnpm(?=\s)/gu)) {
    const invocation = code.slice(match.index + 4).split(/[\n;&|]/u, 1)[0];
    const tokens = invocation.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/gu) ?? [];
    let cursor = 0;
    const skipOptions = () => {
      while (tokens[cursor]?.startsWith('-')) {
        const option = tokens[cursor++];
        if (VALUE_OPTIONS.has(option)) cursor++;
        if (option === '--') break;
      }
    };
    skipOptions();
    const command = tokens[cursor++];
    if (!command || hasPlaceholder(command)) continue;
    if (command === 'run') {
      skipOptions();
      const name = tokens[cursor]?.replace(/^(['"])(.*)\1$/u, '$2');
      if (name && /^[\w:@./-]+$/u.test(name)) references.push({ name, explicitRun: true, reference: `pnpm run ${name}` });
    } else if (/^[\w:@./-]+$/u.test(command)) {
      references.push({ name: command, explicitRun: false, reference: `pnpm ${command}` });
    }
  }
  return references;
}

/** Pure checks: repository path and basename lookups are supplied by the caller. */
export function checkDocument({ file, content, scripts = {}, pathKind, basenameExists }) {
  const issues = [];
  const history = HISTORY_DOCUMENTS.has(file);
  let fence = null;
  const report = (line, type, reference) => issues.push({ file, line, type, reference });
  const checkPath = (line, type, reference, target, directory) => {
    const kind = pathKind(target);
    if (!kind || (directory && kind !== 'directory')) report(line, type, reference);
  };
  const checkCommands = (line, code) => {
    for (const { name, explicitRun, reference } of pnpmReferences(code)) {
      if (!Object.hasOwn(scripts, name) && (explicitRun || !PNPM_COMMANDS.has(name))) report(line, 'command', reference);
    }
  };
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    // Accommodate fences nested in block quotes and list indentation too.
    const marker = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && marker[2].trim() === '') fence = null;
      else if (!history) checkCommands(lineNumber, line);
      continue;
    }
    if (marker) { fence = { char: marker[1][0], length: marker[1].length }; continue; }
    const spans = inlineCodeSpans(line);
    let prose = line;
    for (const span of [...spans].reverse()) prose = prose.slice(0, span.start) + ' '.repeat(span.end - span.start) + prose.slice(span.end);
    for (const reference of markdownLinks(prose)) {
      const decoded = decodePath(reference);
      if (!decoded || /^(?:[a-z][a-z\d+.-]*:|\/)/iu.test(decoded)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), decoded));
      checkPath(lineNumber, 'link', reference, target, decoded.endsWith('/'));
    }
    if (history) continue;
    for (const { content: code } of spans) {
      const target = repositoryPath(code);
      if (target) {
        const decoded = decodePath(code);
        if (decoded.includes('/') || REPOSITORY_DIRECTORIES.has(target)) {
          checkPath(lineNumber, 'path', code, target, decoded.endsWith('/'));
        } else if (target.startsWith('.')) {
          // Dot-prefixed examples are suffix patterns unless a root file exists.
          if (pathKind(target) === 'file') checkPath(lineNumber, 'path', code, target, false);
        } else if (!basenameExists(target)) {
          report(lineNumber, 'path', code);
        }
      }
      checkCommands(lineNumber, code);
    }
  }
  return issues;
}

function entryId({ file, type, reference }) {
  return JSON.stringify([file, type, reference]);
}

function validateDocDriftBaseline(baseline) {
  if (baseline?.schemaVersion !== 1 || !Array.isArray(baseline.entries) || baseline.entries.some((entry) =>
    !entry || typeof entry.file !== 'string' || !entry.file || !ISSUE_TYPES.has(entry.type) || typeof entry.reference !== 'string' || !entry.reference ||
    (Object.hasOwn(entry, 'reason') && typeof entry.reason !== 'string') ||
    Object.keys(entry).some((key) => !['file', 'type', 'reference', 'reason'].includes(key))) ||
    new Set(baseline.entries.map(entryId)).size !== baseline.entries.length) {
    throw new Error('Invalid doc-drift baseline');
  }
}

export function createDocDriftBaseline(issues, previousBaseline) {
  if (previousBaseline !== undefined) validateDocDriftBaseline(previousBaseline);
  const previous = new Map((previousBaseline?.entries ?? []).map((entry) => [entryId(entry), entry]));
  const entries = new Map();
  for (const { file, type, reference, reason } of issues) {
    const entry = { file, type, reference };
    const id = entryId(entry);
    const retainedReason = previous.get(id)?.reason ?? reason ?? entries.get(id)?.reason;
    if (retainedReason !== undefined) {
      if (typeof retainedReason !== 'string') throw new Error('Invalid doc-drift baseline');
      entry.reason = retainedReason;
    }
    entries.set(id, entry);
  }
  return { schemaVersion: 1, entries: [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, entry]) => entry) };
}

export function compareDocDriftBaseline(issues, baseline) {
  validateDocDriftBaseline(baseline);
  const currentEntries = createDocDriftBaseline(issues).entries;
  const previousEntries = createDocDriftBaseline(baseline.entries).entries;
  const current = new Set(currentEntries.map(entryId));
  const previous = new Set(previousEntries.map(entryId));
  return {
    added: currentEntries.filter((entry) => !previous.has(entryId(entry))),
    resolved: previousEntries.filter((entry) => !current.has(entryId(entry))),
  };
}
