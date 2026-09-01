import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  agentMonthlyBillExportArtifactPath,
  cleanupUntrackedAgentMonthlyBillExportArtifacts,
  ensureAgentMonthlyBillExportArtifactDir,
  InvalidAgentMonthlyBillExportArtifactError,
  openAgentMonthlyBillExportArtifact,
} from '../export-artifact';

const originalDirectory = process.env.AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalDirectory === undefined) {
    delete process.env.AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR;
  } else {
    process.env.AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR = originalDirectory;
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('agent monthly bill export artifact isolation', () => {
  it('requires an absolute configured directory and a safe basename', () => {
    process.env.AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR = 'relative/path';
    expect(() => agentMonthlyBillExportArtifactPath('export.xlsx')).toThrow(
      InvalidAgentMonthlyBillExportArtifactError,
    );

    process.env.AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR = '/tmp/bill-exports';
    expect(() => agentMonthlyBillExportArtifactPath('../export.xlsx')).toThrow(
      InvalidAgentMonthlyBillExportArtifactError,
    );
  });

  it('uses a private directory and opens only the named regular file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-bill-export-test-'));
    temporaryDirectories.push(directory);
    process.env.AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR = directory;
    await ensureAgentMonthlyBillExportArtifactDir();
    const mode = (await stat(directory)).mode & 0o777;
    expect(mode).toBe(0o700);

    const path = agentMonthlyBillExportArtifactPath('safe.xlsx');
    await writeFile(path, Buffer.from('xlsx'), { mode: 0o600 });
    const artifact = await openAgentMonthlyBillExportArtifact('safe.xlsx');
    expect(artifact.byteLength).toBe(4);
    artifact.stream.destroy();
  });

  it('reclaims only old untracked monthly-bill artifacts and manifests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-bill-cleanup-test-'));
    temporaryDirectories.push(directory);
    process.env.AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR = directory;
    const keep = 'keep.xlsx';
    const orphan = 'orphan.xlsx';
    const manifest = 'orphan.xlsx.123e4567-e89b-42d3-a456-426614174000.bills';
    await Promise.all([
      writeFile(join(directory, keep), 'keep'),
      writeFile(join(directory, orphan), 'orphan'),
      writeFile(join(directory, manifest), 'manifest'),
      writeFile(join(directory, 'unrelated.txt'), 'leave me'),
    ]);

    await expect(
      cleanupUntrackedAgentMonthlyBillExportArtifacts({
        keep: new Set([keep]),
        olderThan: new Date(Date.now() + 1_000),
      }),
    ).resolves.toBe(2);
    await expect(stat(join(directory, keep))).resolves.toBeDefined();
    await expect(stat(join(directory, 'unrelated.txt'))).resolves.toBeDefined();
    await expect(stat(join(directory, orphan))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(stat(join(directory, manifest))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
