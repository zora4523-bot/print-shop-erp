import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  InvalidOrderExportArtifactError,
  cleanupUntrackedOrderExportArtifacts,
  ensureOrderExportArtifactDir,
  openOrderExportArtifact,
  orderExportArtifactDir,
  orderExportArtifactPath,
} from '../export-artifact';

const originalArtifactDir = process.env.ORDER_EXPORT_ARTIFACT_DIR;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalArtifactDir === undefined) {
    delete process.env.ORDER_EXPORT_ARTIFACT_DIR;
  } else {
    process.env.ORDER_EXPORT_ARTIFACT_DIR = originalArtifactDir;
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('order export artifacts', () => {
  it('requires a configured artifact directory to be absolute', () => {
    process.env.ORDER_EXPORT_ARTIFACT_DIR = 'relative/order-exports';

    expect(() => orderExportArtifactDir()).toThrow(
      InvalidOrderExportArtifactError,
    );
  });

  it('uses an absolute private temporary directory when no directory is configured', () => {
    delete process.env.ORDER_EXPORT_ARTIFACT_DIR;

    const directory = orderExportArtifactDir();

    expect(isAbsolute(directory)).toBe(true);
    expect(directory).toBe(join(tmpdir(), 'print-shop-erp-order-exports'));
  });

  it.each([
    '../outside.xlsx',
    'nested/export.xlsx',
    '/tmp/export.xlsx',
    'export.xls',
    'export.xlsx.bak',
    'export%2Foutside.xlsx',
  ])('rejects an unsafe artifact name: %s', (name) => {
    process.env.ORDER_EXPORT_ARTIFACT_DIR = join(tmpdir(), 'order-exports');

    expect(() => orderExportArtifactPath(name)).toThrow(
      InvalidOrderExportArtifactError,
    );
  });

  it('opens a valid artifact from the configured directory with its exact length', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'print-shop-erp-export-artifact-test-'),
    );
    temporaryDirectories.push(directory);
    process.env.ORDER_EXPORT_ARTIFACT_DIR = directory;
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);

    await ensureOrderExportArtifactDir();
    await writeFile(orderExportArtifactPath('export_01-safe.xlsx'), bytes);
    const artifact = await openOrderExportArtifact('export_01-safe.xlsx');
    const chunks: Buffer[] = [];
    for await (const chunk of artifact.stream) chunks.push(Buffer.from(chunk));

    expect(artifact.byteLength).toBe(bytes.byteLength);
    expect(Buffer.concat(chunks)).toEqual(bytes);
  });

  it('cleans stale artifacts and crash leftovers without deleting retained or unrelated files', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'print-shop-erp-export-cleanup-test-'),
    );
    temporaryDirectories.push(directory);
    process.env.ORDER_EXPORT_ARTIFACT_DIR = directory;
    const kept = 'kept.xlsx';
    const stale = 'stale.xlsx';
    const manifest =
      'stale.xlsx.00000000-0000-4000-8000-000000000001.orders';
    const temporary =
      '.stale.xlsx.123.00000000-0000-4000-8000-000000000002.tmp';
    const unrelated = 'notes.txt';
    const old = new Date('2026-08-01T00:00:00.000Z');
    for (const name of [kept, stale, manifest, temporary, unrelated]) {
      await writeFile(join(directory, name), name);
      await utimes(join(directory, name), old, old);
    }

    await expect(
      cleanupUntrackedOrderExportArtifacts({
        keep: new Set([kept]),
        olderThan: new Date('2026-08-02T00:00:00.000Z'),
      }),
    ).resolves.toBe(3);
    await expect(readdir(directory).then((names) => names.sort())).resolves.toEqual(
      [kept, unrelated].sort(),
    );
  });
});
