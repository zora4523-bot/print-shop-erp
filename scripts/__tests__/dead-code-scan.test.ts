import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';

import {
  executeTool,
  runDeadCodeScan,
  writeJsonAtomically,
} from '../dead-code-scan.mjs';
import { compareDeadCodeBaseline, deadCodeCandidateIds } from '../lib/dead-code-baseline.mjs';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'dead-code-scan-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('dead-code report writer', () => {
  it('fails check for new debt and retired allowances without rewriting the baseline', async () => {
    const rootDir = await temporaryDirectory();
    const outputPath = path.join(rootDir, 'dead.json');
    await writeFile(path.join(rootDir, 'package.json'), '{}');
    await mkdir(path.join(rootDir, 'config'));
    const baselinePath = path.join(rootDir, 'config/dead-code-baseline.json');
    const baseline = JSON.stringify({ schemaVersion: 1, candidates: [] });
    await writeFile(baselinePath, baseline);
    const execute = async ({ name }: { name: string }) => ({
      stdout: name === 'knip' ? '{"issues":[]}' : name === 'madge' ? '[]' : 'lib/old.ts:12 - obsolete',
      stderr: '',
    });
    await expect(runDeadCodeScan({ rootDir, outputPath, execute, check: true })).rejects.toThrow('NEW');
    expect(await readFile(baselinePath, 'utf8')).toBe(baseline);
    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    await writeFile(baselinePath, JSON.stringify({ schemaVersion: 1, candidates: deadCodeCandidateIds(report) }));
    await expect(runDeadCodeScan({ rootDir, outputPath, execute, check: true })).resolves.toEqual(report);
    const noDebt = async ({ name }: { name: string }) => ({
      stdout: name === 'knip' ? '{"issues":[]}' : name === 'madge' ? '[]' : '', stderr: '',
    });
    await expect(runDeadCodeScan({ rootDir, outputPath, execute: noDebt, check: true })).rejects.toThrow('RESOLVED');
  });

  it.runIf(process.platform !== 'win32')(
    'accepts only madge cycle exit code 1 and still rejects real failures',
    async () => {
      const rootDir = await temporaryDirectory();
      const binaryDirectory = path.join(rootDir, 'node_modules', '.bin');
      const binaryPath = path.join(binaryDirectory, 'madge');
      await mkdir(binaryDirectory, { recursive: true });
      await writeFile(
        binaryPath,
        '#!/usr/bin/env node\nprocess.stdout.write(\'[\"a.ts\",\"b.ts\"]\');\nprocess.exit(1);\n',
      );
      await chmod(binaryPath, 0o755);

      await expect(
        executeTool({
          rootDir,
          name: 'madge',
          args: [],
          acceptedExitCodes: [0, 1],
        }),
      ).resolves.toMatchObject({ stdout: '["a.ts","b.ts"]' });

      await writeFile(
        binaryPath,
        '#!/usr/bin/env node\nprocess.stderr.write(\'broken\');\nprocess.exit(2);\n',
      );
      await expect(
        executeTool({
          rootDir,
          name: 'madge',
          args: [],
          acceptedExitCodes: [0, 1],
        }),
      ).rejects.toThrow(/madge failed with exit code 2: broken/u);
    },
  );

  it('replaces the report without leaving temporary files', async () => {
    const rootDir = await temporaryDirectory();
    const outputPath = path.join(rootDir, '.review', 'dead.json');

    await writeJsonAtomically(outputPath, { schemaVersion: 1, value: 'new' });

    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      value: 'new',
    });
    expect(await readdir(path.dirname(outputPath))).toEqual(['dead.json']);
  });

  it('preserves the previous report when any scanner fails', async () => {
    const rootDir = await temporaryDirectory();
    const outputPath = path.join(rootDir, 'dead.json');
    await writeFile(
      path.join(rootDir, 'package.json'),
      JSON.stringify({
        devDependencies: { knip: '1', 'ts-prune': '2', madge: '3' },
      }),
    );
    await writeFile(outputPath, '{"previous":true}\n');

    const execute = async ({ name }: { name: string }) => {
      if (name === 'ts-prune') throw new Error('synthetic failure');
      return { stdout: name === 'madge' ? '[]' : '{"issues":[]}', stderr: '' };
    };

    await expect(
      runDeadCodeScan({ rootDir, outputPath, execute }),
    ).rejects.toThrow('synthetic failure');
    expect(await readFile(outputPath, 'utf8')).toBe('{"previous":true}\n');
  });

  it('writes one normalized report from all three scanners', async () => {
    const rootDir = await temporaryDirectory();
    const outputPath = path.join(rootDir, 'dead.json');
    await writeFile(
      path.join(rootDir, 'package.json'),
      JSON.stringify({
        devDependencies: {
          knip: '6.33.0',
          'ts-prune': '0.10.3',
          madge: '8.0.0',
        },
      }),
    );

    const invocations: Array<{
      name: string;
      acceptedExitCodes?: number[];
    }> = [];
    const execute = async (args: {
      name: string;
      acceptedExitCodes?: number[];
    }) => {
      invocations.push(args);
      return {
        stdout:
          args.name === 'knip'
            ? '{"issues":[{"file":"z.ts"},{"file":"unused.ts"}]}'
            : args.name === 'madge'
              ? '[["a.ts","b.ts"]]'
              : [
                  'z.ts:2 - zed',
                  'a.ts:1 - alpha',
                  'generated/prisma/client.ts:1 - generated',
                  'tests/helper.ts:1 - testHelper',
                  'app/orders/page.tsx:1 - default',
                  'app/layout.tsx:1 - default',
                ].join('\n'),
        stderr: '',
      };
    };

    const report = await runDeadCodeScan({ rootDir, outputPath, execute });

    expect(report).toEqual({
      schemaVersion: 1,
      tools: {
        knip: {
          version: '6.33.0',
          issues: [{ file: 'unused.ts' }, { file: 'z.ts' }],
        },
        tsPrune: {
          version: '0.10.3',
          candidates: ['a.ts:1 - alpha', 'z.ts:2 - zed'],
        },
        madge: { version: '8.0.0', circular: [['a.ts', 'b.ts']] },
      },
    });
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(report);
    expect(
      invocations.find((invocation) => invocation.name === 'madge'),
    ).toMatchObject({ acceptedExitCodes: [0, 1] });
  });
});

describe('dead-code candidate ledger', () => {
  const report = (line = 1) => ({
    schemaVersion: 1,
    tools: {
      knip: { issues: [{ file: 'lib/old.ts', exports: [{ name: 'old', line, col: line, pos: line }], duplicates: [[{ name: 'alias' }, { name: 'old' }]] }] },
      tsPrune: { candidates: [`lib/old.ts:${line} - old (used in module)`] },
      madge: { circular: [['a.ts', 'b.ts', 'c.ts']] },
    },
  });

  it('ignores position shifts and equivalent cycle rotations', () => {
    const baseline = { schemaVersion: 1, candidates: deadCodeCandidateIds(report()) };
    const moved = report(100);
    moved.tools.madge.circular = [['b.ts', 'c.ts', 'a.ts']];
    moved.tools.tsPrune.candidates = ['lib/old.ts:100 - old'];
    expect(compareDeadCodeBaseline(moved, baseline)).toEqual({ added: [], resolved: [] });
  });

  it('detects new names and reverse cycle edges even when counts are unchanged', () => {
    const baseline = { schemaVersion: 1, candidates: deadCodeCandidateIds(report()) };
    const changed = report();
    changed.tools.knip.issues[0].exports[0].name = 'new';
    changed.tools.madge.circular = [['a.ts', 'c.ts', 'b.ts']];
    const result = compareDeadCodeBaseline(changed, baseline);
    expect(result.added).toHaveLength(2);
    expect(result.resolved).toHaveLength(2);
  });

  it('rejects malformed or duplicate baseline entries', () => {
    for (const baseline of [null, {}, { schemaVersion: 2, candidates: [] }, { schemaVersion: 1, candidates: [1] }, { schemaVersion: 1, candidates: ['x', 'x'] }]) {
      expect(() => compareDeadCodeBaseline(report(), baseline)).toThrow('Invalid dead-code baseline');
    }
  });

  it('does not silently skip unknown scanner output formats', () => {
    const changed = report();
    changed.tools.tsPrune.candidates = ['unexpected output'];
    expect(() => deadCodeCandidateIds(changed)).toThrow('Invalid ts-prune');
    expect(() => deadCodeCandidateIds({ ...report(), schemaVersion: 2 })).toThrow('Unsupported');
  });
});

describe('platform-specific scanner identities', () => {
  const candidate = JSON.stringify(['ts-prune', 'component.tsx', 'Props']);
  const makeReport = (candidates: string[]) => ({ schemaVersion: 1, tools: {
    knip: { issues: [] }, tsPrune: { candidates }, madge: { circular: [] },
  } });
  const baseline = { schemaVersion: 1, candidates: [candidate], platformOmissions: { linux: [candidate] } };

  it('compares exact platform inventories without allowing new or stale entries', () => {
    const present = makeReport(['component.tsx:1 - Props']);
    const absent = makeReport([]);
    expect(compareDeadCodeBaseline(absent, baseline, 'linux')).toEqual({ added: [], resolved: [] });
    expect(compareDeadCodeBaseline(present, baseline, 'darwin')).toEqual({ added: [], resolved: [] });
    expect(compareDeadCodeBaseline(present, baseline, 'linux').added).toEqual([candidate]);
    expect(compareDeadCodeBaseline(absent, baseline, 'darwin').resolved).toEqual([candidate]);
    expect(compareDeadCodeBaseline(makeReport(['new.ts:1 - newExport']), baseline, 'linux').added).toHaveLength(1);
  });

  it('rejects unknown identities and malformed platform inventories', () => {
    for (const omissions of [['unknown'], [candidate, candidate], 'all']) {
      expect(() => compareDeadCodeBaseline(makeReport([]), {
        ...baseline, platformOmissions: { linux: omissions },
      }, 'linux')).toThrow('Invalid dead-code platform baseline');
    }
  });
});
