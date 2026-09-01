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
