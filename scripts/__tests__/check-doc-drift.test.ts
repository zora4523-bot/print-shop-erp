import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectDocDrift, runDocDrift } from '../check-doc-drift.mjs';
import {
  checkDocument,
  compareDocDriftBaseline,
  createDocDriftBaseline,
} from '../lib/doc-drift.mjs';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, execFileSync: vi.fn(original.execFileSync) };
});

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'doc-drift-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFixture(rootDir: string, file: string, content: string) {
  const destination = path.join(rootDir, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const existingPaths = new Map<string, 'file' | 'directory'>([
  ['README.md', 'file'],
  ['package.json', 'file'],
  ['.env.example', 'file'],
  ['docs/开发 指南.md', 'file'],
  ['docs/编码规范.md', 'file'],
  ['lib/live.ts', 'file'],
  ['scripts/', 'directory'],
  ['scripts', 'directory'],
  ['app/orders/[id]/page.tsx', 'file'],
  ['app/orders/[id]', 'directory'],
  ['app/orders/[id]/', 'directory'],
  ['app/(admin)/page.tsx', 'file'],
  ['app/docs/[...slug]/page.tsx', 'file'],
  ['app/docs/[[...slug]]/page.tsx', 'file'],
]);

function documentIssues(content: string, file = 'README.md') {
  return checkDocument({
    file,
    content,
    scripts: { lint: 'eslint .', 'check:docs': 'node scripts/check-doc-drift.mjs' },
    pathKind: (repositoryPath: string) => existingPaths.get(repositoryPath),
    basenameExists: (name: string) => [...existingPaths].some(
      ([file, kind]) => kind === 'file' && path.posix.basename(file) === name,
    ),
  });
}

describe('Markdown relative links', () => {
  it('reports a missing target with its source line and original reference', () => {
    expect(documentIssues('# Title\n\n[missing](./missing.md#details)')).toEqual([
      { file: 'README.md', line: 3, type: 'link', reference: './missing.md#details' },
    ]);
    expect(documentIssues('[missing](missing.md:42#details)')).toEqual([
      { file: 'README.md', line: 1, type: 'link', reference: 'missing.md:42#details' },
    ]);
  });

  it('resolves links relative to the document and strips anchors and line numbers', () => {
    expect(documentIssues([
      '[root](../README.md#intro)',
      '[source](../lib/live.ts:42)',
      '[source with heading](../lib/live.ts:42#example)',
      '[same file](#heading)',
      '[external](https://example.com/missing.md)',
      '[external](http://example.com/missing.md)',
      '[mail](mailto:hello@example.com)',
    ].join('\n'), 'docs/guide.md')).toEqual([]);
  });

  it('handles Chinese paths, URL encoding and angle-bracket destinations', () => {
    expect(documentIssues([
      '[中文](./docs/编码规范.md)',
      '[encoded](./docs/%E7%BC%96%E7%A0%81%E8%A7%84%E8%8C%83.md#section)',
      '[encoded with source line](./docs/%E7%BC%96%E7%A0%81%E8%A7%84%E8%8C%83.md:12:3#section)',
      '[space](./docs/%E5%BC%80%E5%8F%91%20%E6%8C%87%E5%8D%97.md)',
      '[angle](<./docs/开发 指南.md>)',
    ].join('\n'))).toEqual([]);
    expect(documentIssues('[missing](./docs/%E4%B8%8D%E5%AD%98%E5%9C%A8.md)')).toMatchObject([
      { type: 'link', reference: './docs/%E4%B8%8D%E5%AD%98%E5%9C%A8.md' },
    ]);
  });

  it('keeps balanced parentheses in Next route-group link targets', () => {
    expect(documentIssues('[admin](./app/(admin)/page.tsx#section)')).toEqual([]);
    expect(documentIssues('[admin](./app/\\(admin\\)/page.tsx:12#section)')).toEqual([]);
    expect(documentIssues('[missing](./app/(admin)/missing.tsx)')).toEqual([
      { file: 'README.md', line: 1, type: 'link', reference: './app/(admin)/missing.tsx' },
    ]);
  });
});

describe('inline repository paths', () => {
  it('checks known top-level prefixes and bare filenames with extensions', () => {
    const missing = [
      'app/missing.tsx', 'actions/missing.ts', 'components/missing.tsx',
      'lib/missing.ts', 'scripts/missing.mjs', 'prisma/missing.sql',
      'deploy/missing.sh', 'tests/missing.test.ts', 'docs/missing.md',
      'config/missing.json', 'hooks/missing.ts', '.github/missing.yml',
      '.agents/missing.md', 'missing.config.ts',
    ];
    expect(documentIssues(missing.map((reference) => `\`${reference}\``).join('\n'))).toEqual(
      missing.map((reference, index) => ({
        file: 'README.md', line: index + 1, type: 'path', reference,
      })),
    );
    expect(documentIssues('`lib/live.ts` `package.json` `.env.example` `scripts/` `scripts`')).toEqual([]);
  });

  it('accepts bare filenames found elsewhere but still requires explicit paths to exist', () => {
    expect(documentIssues('`page.tsx` `live.ts:12`', 'docs/guide.md')).toEqual([]);
    expect(documentIssues('`./page.tsx` `lib/page.tsx` [page](page.tsx)')).toEqual([
      { file: 'README.md', line: 1, type: 'link', reference: 'page.tsx' },
      { file: 'README.md', line: 1, type: 'path', reference: './page.tsx' },
      { file: 'README.md', line: 1, type: 'path', reference: 'lib/page.tsx' },
    ]);
  });

  it('reports bare filenames absent everywhere in the repository', () => {
    expect(documentIssues('`seed-data.ts` `CsPayrollPaymentForm.tsx`')).toEqual([
      { file: 'README.md', line: 1, type: 'path', reference: 'seed-data.ts' },
      { file: 'README.md', line: 1, type: 'path', reference: 'CsPayrollPaymentForm.tsx' },
    ]);
  });

  it('skips dot-prefixed suffix patterns without a same-named root file', () => {
    expect(documentIssues('`.browser.spec.tsx` `.spec.ts` `.dc.html` `.env.missing.example`')).toEqual([]);
  });

  it('checks root dotfiles by path and preserves missing explicit dotfile references', () => {
    const pathKind = vi.fn((file: string) => existingPaths.get(file));
    const basenameExists = vi.fn(() => false);
    expect(checkDocument({
      file: 'README.md', content: '`.env.example` `./.env.example`', pathKind, basenameExists,
    })).toEqual([]);
    expect(pathKind).toHaveBeenCalledWith('.env.example');
    expect(basenameExists).not.toHaveBeenCalled();
    expect(documentIssues('`./.env.missing.example`')).toEqual([
      { file: 'README.md', line: 1, type: 'path', reference: './.env.missing.example' },
    ]);
  });

  it('resolves inline repository paths from the root even in nested documents', () => {
    expect(documentIssues('`lib/live.ts:12` `docs/编码规范.md`', '.agents/skills/example/SKILL.md')).toEqual([]);
  });

  it('checks literal and encoded Chinese inline paths', () => {
    expect(documentIssues('`docs/编码规范.md` `docs/%E7%BC%96%E7%A0%81%E8%A7%84%E8%8C%83.md`')).toEqual([]);
    expect(documentIssues('`docs/不存在.md`')).toEqual([
      { file: 'README.md', line: 1, type: 'path', reference: 'docs/不存在.md' },
    ]);
  });

  it('treats Next dynamic segments literally rather than as placeholders', () => {
    expect(documentIssues('`app/orders/[id]/page.tsx` `app/orders/[id]/`')).toEqual([]);
    expect(documentIssues('`app/missing/[id]/page.tsx`')).toEqual([
      { file: 'README.md', line: 1, type: 'path', reference: 'app/missing/[id]/page.tsx' },
    ]);
  });

  it('treats required and optional catch-all segments as literal directories', () => {
    expect(documentIssues('`app/docs/[...slug]/page.tsx` `app/docs/[[...slug]]/page.tsx`')).toEqual([]);
    expect(documentIssues('`app/missing/[...slug]/page.tsx` `app/missing/[[...slug]]/page.tsx`')).toEqual([
      { file: 'README.md', line: 1, type: 'path', reference: 'app/missing/[...slug]/page.tsx' },
      { file: 'README.md', line: 1, type: 'path', reference: 'app/missing/[[...slug]]/page.tsx' },
    ]);
  });

  it('requires a directory for paths ending in a slash', () => {
    expect(documentIssues('`lib/live.ts/`')).toMatchObject([
      { type: 'path', reference: 'lib/live.ts/' },
    ]);
  });

  it('skips wildcard, placeholder, generated and non-path code expressions', () => {
    expect(documentIssues([
      '`lib/*.ts`', '`lib/<domain>/file.ts`', '`lib/…/file.ts`',
      '`lib/.../file.ts`', '`lib/{old,new}/file.ts`',
      '`generated/prisma/client.ts`', '`.next/types/routes.ts`',
      '`.review/doc-drift.json`', '`node_modules/next/package.json`',
      '`docs/../generated/prisma/client.ts`',
      '`lib/old.ts + lib/new.ts`', '`somethingElse`', '`https://example.com/file.ts`',
    ].join('\n'))).toEqual([]);
  });

  it('does not confuse dotted symbols, CSS classes and versions with root filenames', () => {
    expect(documentIssues('`console.log` `Order.id` `window.alert` `0.1` `.dark`')).toEqual([]);
  });

  it('ignores an unmatched backtick and continues scanning later lines', () => {
    expect(documentIssues('An unfinished `lib/old.ts\n`lib/missing.ts`')).toEqual([
      { file: 'README.md', line: 2, type: 'path', reference: 'lib/missing.ts' },
    ]);
  });

  it('supports longer code delimiters without losing spans after an unmatched delimiter', () => {
    expect(documentIssues('``lib/missing.ts``')).toEqual([
      { file: 'README.md', line: 1, type: 'path', reference: 'lib/missing.ts' },
    ]);
    expect(documentIssues('Unclosed ``text and `lib/missing.ts`')).toEqual([
      { file: 'README.md', line: 1, type: 'path', reference: 'lib/missing.ts' },
    ]);
    expect(documentIssues('Unclosed ``text and `pnpm missing`')).toEqual([
      { file: 'README.md', line: 1, type: 'command', reference: 'pnpm missing' },
    ]);
  });

  it('skips paths inside fenced blocks and resumes checking after the closing fence', () => {
    expect(documentIssues([
      '```typescript',
      '`lib/missing.ts`',
      'const path = "docs/missing.md";',
      '```',
      '`lib/missing.ts`',
    ].join('\n'))).toEqual([
      { file: 'README.md', line: 5, type: 'path', reference: 'lib/missing.ts' },
    ]);
  });
});

describe('pnpm commands', () => {
  it('checks inline commands and commands inside code fences', () => {
    expect(documentIssues([
      '`pnpm missing --flag`',
      '```bash',
      'pnpm another-missing',
      'pnpm run missing-script --arg',
      '```',
    ].join('\n'))).toEqual([
      { file: 'README.md', line: 1, type: 'command', reference: 'pnpm missing' },
      { file: 'README.md', line: 3, type: 'command', reference: 'pnpm another-missing' },
      { file: 'README.md', line: 4, type: 'command', reference: 'pnpm run missing-script' },
    ]);
  });

  it('allows scripts, builtins and arbitrary exec or dlx executables', () => {
    expect(documentIssues([
      '`pnpm lint`', '`pnpm check:docs`', '`pnpm run lint`',
      '`pnpm install`', '`pnpm add example`', '`pnpm remove example`',
      '`pnpm test run`', '`pnpm build`', '`pnpm exec no-local-binary --flag`',
      '`pnpm dlx no-local-binary`',
      '```bash',
      'pnpm exec prisma generate',
      'pnpm run check:docs',
      '```',
    ].join('\n'))).toEqual([]);
  });

  it('requires an actual script after pnpm run even when its name is a builtin', () => {
    expect(documentIssues('`pnpm run build`')).toEqual([
      { file: 'README.md', line: 1, type: 'command', reference: 'pnpm run build' },
    ]);
  });

  it('checks multiple invocations on one line independently', () => {
    expect(documentIssues('`pnpm missing-one && pnpm lint && pnpm run missing-two`')).toEqual([
      { file: 'README.md', line: 1, type: 'command', reference: 'pnpm missing-one' },
      { file: 'README.md', line: 1, type: 'command', reference: 'pnpm run missing-two' },
    ]);
  });

  it('handles option values before run and preserves the exec exemption', () => {
    expect(documentIssues([
      '`pnpm --filter workspace --reporter silent run --silent missing`',
      '`pnpm -C "dir with space" --filter=workspace exec missing-binary`',
      '`pnpm run -- lint`',
    ].join('\n'))).toEqual([
      { file: 'README.md', line: 1, type: 'command', reference: 'pnpm run missing' },
    ]);
  });

  it('does not scan ordinary prose as a command invocation', () => {
    expect(documentIssues('The old command was pnpm missing.')).toEqual([]);
  });
});

describe('historical documents', () => {
  it.each(['DECISIONS.md', 'HANDOFF.md', 'PROGRESS.md'])(
    'checks only relative links in %s',
    (file) => {
      expect(documentIssues([
        '[missing](./missing.md)',
        '`lib/missing.ts`',
        '`pnpm missing`',
        '```bash',
        'pnpm another-missing',
        '```',
      ].join('\n'), file)).toEqual([
        { file, line: 1, type: 'link', reference: './missing.md' },
      ]);
    },
  );
});

describe('doc-drift baseline', () => {
  const first = { file: 'README.md', line: 1, type: 'path', reference: 'lib/old.ts' };
  const second = { file: 'docs/guide.md', line: 2, type: 'command', reference: 'pnpm old' };

  it('sorts and deduplicates entries without retaining line numbers', () => {
    expect(createDocDriftBaseline([second, first, { ...first, line: 100 }])).toEqual({
      schemaVersion: 1,
      entries: [
        { file: 'README.md', type: 'path', reference: 'lib/old.ts' },
        { file: 'docs/guide.md', type: 'command', reference: 'pnpm old' },
      ],
    });
  });

  it('ignores line shifts but detects added and resolved references with unchanged counts', () => {
    const baseline = createDocDriftBaseline([first, second]);
    expect(compareDocDriftBaseline([{ ...first, line: 100 }, second], baseline)).toEqual({
      added: [], resolved: [],
    });
    expect(compareDocDriftBaseline([first, { ...second, reference: 'pnpm new' }], baseline)).toEqual({
      added: [{ file: second.file, type: 'command', reference: 'pnpm new' }],
      resolved: [{ file: second.file, type: 'command', reference: 'pnpm old' }],
    });
  });

  it('preserves reasons when normalizing entries and refreshing matching issues', () => {
    const reason = 'Naming example, not a repository file';
    const baseline = createDocDriftBaseline([{ ...first, reason }, second, { ...first, line: 100 }]);
    expect(baseline.entries[0]).toEqual({ file: first.file, type: first.type, reference: first.reference, reason });
    expect(createDocDriftBaseline([second, { ...first, line: 200 }], baseline)).toEqual(baseline);
    expect(compareDocDriftBaseline([first, second], baseline)).toEqual({ added: [], resolved: [] });
    expect(compareDocDriftBaseline([], baseline).resolved).toEqual(baseline.entries);
  });

  it('drops resolved reasons and never transfers them across file, type or reference changes', () => {
    const baseline = createDocDriftBaseline([{ ...first, reason: 'Historical reference' }]);
    const replacements = [
      { ...first, file: 'docs/guide.md' },
      { ...first, type: 'link' },
      { ...first, reference: 'lib/new.ts' },
    ];
    expect(createDocDriftBaseline(replacements, baseline)).toEqual(createDocDriftBaseline(replacements));
    expect(createDocDriftBaseline([], baseline)).toEqual({ schemaVersion: 1, entries: [] });
  });

  it.each([null, 123, false, [], {}, undefined])('rejects an explicitly non-string reason: %j', (reason) => {
    const baseline = {
      schemaVersion: 1,
      entries: [{ file: first.file, type: first.type, reference: first.reference, reason }],
    };
    expect(() => compareDocDriftBaseline([first], baseline)).toThrow('Invalid doc-drift baseline');
    expect(() => createDocDriftBaseline([first], baseline)).toThrow('Invalid doc-drift baseline');
  });

  it('rejects malformed and duplicate baseline entries', () => {
    const entry = { file: first.file, type: first.type, reference: first.reference };
    for (const baseline of [
      null, {}, { schemaVersion: 2, entries: [] },
      { schemaVersion: 1, entries: [1] },
      { schemaVersion: 1, entries: [{ ...entry, type: 'unknown' }] },
      { schemaVersion: 1, entries: [{ ...entry, unexpected: 'field' }] },
      { schemaVersion: 1, entries: [entry, entry] },
      { schemaVersion: 1, entries: [{ ...entry, reason: 'One' }, { ...entry, reason: 'Two' }] },
    ]) {
      expect(() => compareDocDriftBaseline([first], baseline)).toThrow('Invalid doc-drift baseline');
    }
  });
});

describe('repository scanner', () => {
  it('uses the Git tracked file list, ignoring untracked and deleted files', async () => {
    const rootDir = await temporaryDirectory();
    await writeFixture(rootDir, 'package.json', '{}');
    await writeFixture(rootDir, 'app/含 空格\n目录/page.tsx', '');
    await writeFixture(rootDir, 'lib/untracked.ts', '');
    await writeFixture(rootDir, 'README.md', '`page.tsx` `untracked.ts` `deleted.ts`');
    vi.mocked(execFileSync).mockReturnValueOnce('package.json\0README.md\0app/含 空格\n目录/page.tsx\0lib/deleted.ts\0');
    expect(await collectDocDrift({ rootDir })).toEqual([
      { file: 'README.md', line: 1, type: 'path', reference: 'untracked.ts' },
      { file: 'README.md', line: 1, type: 'path', reference: 'deleted.ts' },
    ]);
    expect(execFileSync).toHaveBeenCalledWith('git', ['ls-files', '--cached', '-z'], expect.objectContaining({ cwd: rootDir }));
  });

  it.each(['git', 'filesystem'])('excludes historical documents, dependencies and generated files in the %s inventory', async (inventory) => {
    const rootDir = await temporaryDirectory();
    const excluded = [
      'docs/archive/archive.ts', 'docs/audits/audit.ts',
      'node_modules/package/dependency.ts', 'tools/node_modules/package/nested-dependency.ts',
      'generated/prisma/generated.ts', '.next/types/next.ts', '.next-release/types/release.ts',
      '.review/review.json', 'coverage/coverage.json', 'test-results-durable/result.ts',
      'playwright-report/report.ts', 'build/build.ts', 'dist/dist.ts', 'out/out.ts',
      'output/output.ts', 'blob-report/blob.json', '.vitest-attachments/attachment.ts',
      'components/__tests__/__screenshots__/screenshot.ts', 'public/load-test/load.ts',
      '.git/internal.ts', 'next-env.d.ts',
    ];
    await writeFixture(rootDir, 'package.json', '{}');
    await writeFixture(rootDir, 'app/orders/page.tsx', '');
    for (const file of excluded) await writeFixture(rootDir, file, '');
    const missing = excluded.map((file) => path.posix.basename(file));
    await writeFixture(rootDir, 'README.md', ['page.tsx', ...missing].map((file) => `\`${file}\``).join(' '));
    if (inventory === 'git') {
      vi.mocked(execFileSync).mockReturnValueOnce(['package.json', 'README.md', 'app/orders/page.tsx', ...excluded].join('\0'));
    } else {
      vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('Git unavailable'); });
    }
    expect(await collectDocDrift({ rootDir })).toEqual(missing.map((reference) => ({
      file: 'README.md', line: 1, type: 'path', reference,
    })));
  });

  it('scans root Markdown, immediate docs and recursive agent skills only', async () => {
    const rootDir = await temporaryDirectory();
    await writeFixture(rootDir, 'package.json', JSON.stringify({ scripts: {} }));
    const scanned = ['README.md', 'docs/guide.md', '.agents/skills/one/SKILL.md', '.agents/skills/group/two/SKILL.md'];
    const excluded = [
      'CHANGELOG.md', 'docs/archive/old.md', 'docs/audits/old.md',
      'docs/nested/guide.md', 'node_modules/package/README.md',
      '.agents/skills/one/README.md', 'scripts/README.md',
    ];
    for (const file of [...scanned, ...excluded]) {
      await writeFixture(rootDir, file, '`lib/missing.ts`');
    }
    const issues = await collectDocDrift({ rootDir });
    expect(issues.map((issue: { file: string }) => issue.file).sort()).toEqual(scanned.sort());
    expect(issues).toHaveLength(scanned.length);
  });

  it('uses real files and directories, including encoded Chinese and dynamic paths', async () => {
    const rootDir = await temporaryDirectory();
    await writeFixture(rootDir, 'package.json', JSON.stringify({ scripts: { lint: 'eslint .' } }));
    await writeFixture(rootDir, 'docs/编码规范.md', '# 文档');
    await writeFixture(rootDir, 'app/orders/[id]/page.tsx', '');
    await writeFixture(rootDir, 'README.md', [
      '[中文](./docs/%E7%BC%96%E7%A0%81%E8%A7%84%E8%8C%83.md#heading)',
      '`app/orders/[id]/page.tsx`', '`app/orders/[id]/`', '`pnpm lint`',
    ].join('\n'));
    expect(await collectDocDrift({ rootDir })).toEqual([]);
  });

  it('fails check for new debt and stale allowances without rewriting the baseline', async () => {
    const rootDir = await temporaryDirectory();
    await writeFixture(rootDir, 'package.json', JSON.stringify({ scripts: {} }));
    await writeFixture(rootDir, 'README.md', '`lib/old.ts`');
    const baselinePath = path.join(rootDir, 'config/doc-drift-baseline.json');
    const emptyBaseline = JSON.stringify({ schemaVersion: 1, entries: [] });
    await writeFixture(rootDir, 'config/doc-drift-baseline.json', emptyBaseline);

    await expect(runDocDrift({ rootDir })).resolves.toMatchObject([
      { file: 'README.md', type: 'path', reference: 'lib/old.ts' },
    ]);
    await expect(runDocDrift({ rootDir, check: true })).rejects.toThrow('NEW README.md path lib/old.ts');
    expect(await readFile(baselinePath, 'utf8')).toBe(emptyBaseline);

    const issues = await runDocDrift({ rootDir, writeBaseline: true });
    const baselineText = await readFile(baselinePath, 'utf8');
    expect(JSON.parse(baselineText)).toEqual(createDocDriftBaseline(issues));
    await expect(runDocDrift({ rootDir, check: true })).resolves.toEqual(issues);

    await writeFixture(rootDir, 'README.md', '# No missing references');
    await expect(runDocDrift({ rootDir, check: true })).rejects.toThrow('RESOLVED (remove from baseline / 收紧基线) README.md path lib/old.ts');
    expect(await readFile(baselinePath, 'utf8')).toBe(baselineText);
    expect(await runDocDrift({ rootDir })).toEqual([]);

    await runDocDrift({ rootDir, writeBaseline: true });
    await expect(runDocDrift({ rootDir, check: true })).resolves.toEqual([]);
  });

  it('round-trips CLI write-baseline reasons while dropping resolved entries and adding unannotated issues', async () => {
    const rootDir = await temporaryDirectory();
    await writeFixture(rootDir, 'package.json', '{}');
    await writeFixture(rootDir, 'README.md', '`Example.tsx` `lib/old.ts`');
    await mkdir(path.join(rootDir, 'scripts'));
    for (const file of ['check-doc-drift.mjs', 'dead-code-scan.mjs', 'lib']) {
      await symlink(path.resolve(import.meta.dirname, '..', file), path.join(rootDir, 'scripts', file));
    }
    // Preserve only the entrypoint symlink so PROJECT_ROOT is the fixture, while
    // imported helpers still resolve normally without copying repository code.
    const runCli = (flag: string) => execFileSync(process.execPath, [
      '--preserve-symlinks-main', path.join(rootDir, 'scripts/check-doc-drift.mjs'), flag,
    ], { cwd: rootDir, encoding: 'utf8' });
    const baselinePath = path.join(rootDir, 'config/doc-drift-baseline.json');
    expect(runCli('--write-baseline')).toContain('(baseline written)');
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    for (const entry of baseline.entries) entry.reason = `Retained: ${entry.reference}`;
    await writeFile(baselinePath, JSON.stringify(baseline));

    expect(runCli('--write-baseline')).toContain('(baseline written)');
    expect(JSON.parse(await readFile(baselinePath, 'utf8'))).toEqual(baseline);
    expect(runCli('--check')).toContain('2 unique entries (baseline matches)');

    await writeFixture(rootDir, 'README.md', '\n\n`Example.tsx` `lib/new.ts`');
    expect(runCli('--write-baseline')).toContain('(baseline written)');
    expect(JSON.parse(await readFile(baselinePath, 'utf8'))).toEqual({
      schemaVersion: 1,
      entries: [
        { file: 'README.md', type: 'path', reference: 'Example.tsx', reason: 'Retained: Example.tsx' },
        { file: 'README.md', type: 'path', reference: 'lib/new.ts' },
      ],
    });
    expect(runCli('--check')).toContain('2 unique entries (baseline matches)');
  });

  it('refuses to overwrite a baseline with an invalid reason', async () => {
    const rootDir = await temporaryDirectory();
    await writeFixture(rootDir, 'package.json', '{}');
    await writeFixture(rootDir, 'README.md', '`Example.tsx`');
    const baselineText = JSON.stringify({
      schemaVersion: 1,
      entries: [{ file: 'README.md', type: 'path', reference: 'Example.tsx', reason: 42 }],
    });
    await writeFixture(rootDir, 'config/doc-drift-baseline.json', baselineText);
    await expect(runDocDrift({ rootDir, writeBaseline: true })).rejects.toThrow('Invalid doc-drift baseline');
    expect(await readFile(path.join(rootDir, 'config/doc-drift-baseline.json'), 'utf8')).toBe(baselineText);
  });
});
