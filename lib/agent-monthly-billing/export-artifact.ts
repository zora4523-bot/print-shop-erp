import type { ReadStream } from 'node:fs';
import { chmod, mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

const ARTIFACT_PATTERN = /^[A-Za-z0-9_-]+\.xlsx$/;
const MANIFEST_PATTERN =
  /^[A-Za-z0-9_-]+\.xlsx\.[0-9a-f-]{36}\.bills$/i;
const TEMP_PATTERN = /^\.[A-Za-z0-9_-]+\.xlsx\.\d+\.[0-9a-f-]{36}\.tmp$/i;

export function agentMonthlyBillExportArtifactDir(): string {
  const configured = process.env.AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR;
  if (configured) {
    if (!isAbsolute(configured)) throw new InvalidAgentMonthlyBillExportArtifactError();
    return configured;
  }
  return join(tmpdir(), 'print-shop-erp-agent-monthly-bill-exports');
}

export function agentMonthlyBillExportArtifactPath(name: string): string {
  if (basename(name) !== name || !ARTIFACT_PATTERN.test(name)) {
    throw new InvalidAgentMonthlyBillExportArtifactError();
  }
  return join(agentMonthlyBillExportArtifactDir(), name);
}

export async function ensureAgentMonthlyBillExportArtifactDir(): Promise<void> {
  const directory = agentMonthlyBillExportArtifactDir();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

export async function openAgentMonthlyBillExportArtifact(name: string): Promise<{
  stream: ReadStream;
  byteLength: number;
}> {
  const handle = await open(agentMonthlyBillExportArtifactPath(name), 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new InvalidAgentMonthlyBillExportArtifactError();
    return {
      stream: handle.createReadStream({ autoClose: true }),
      byteLength: info.size,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function deleteAgentMonthlyBillExportArtifact(
  name: string,
): Promise<void> {
  try {
    await unlink(agentMonthlyBillExportArtifactPath(name));
  } catch (error) {
    if (!isFileSystemError(error, 'ENOENT')) throw error;
  }
}

export async function cleanupUntrackedAgentMonthlyBillExportArtifacts(input: {
  keep: ReadonlySet<string>;
  olderThan: Date;
}): Promise<number> {
  const directory = agentMonthlyBillExportArtifactDir();
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (!isFileSystemError(error, 'ENOENT')) throw error;
    entries = [];
  }

  let deleted = 0;
  for (const name of entries) {
    const isArtifact = ARTIFACT_PATTERN.test(name);
    const isManifest = MANIFEST_PATTERN.test(name);
    const isTemporary = TEMP_PATTERN.test(name);
    if (
      (!isArtifact && !isManifest && !isTemporary) ||
      (isArtifact && input.keep.has(name))
    ) {
      continue;
    }
    const path = isArtifact
      ? agentMonthlyBillExportArtifactPath(name)
      : join(directory, name);
    let info: Awaited<ReturnType<typeof stat>> | null;
    try {
      info = await stat(path);
    } catch (error) {
      if (!isFileSystemError(error, 'ENOENT')) throw error;
      info = null;
    }
    if (!info?.isFile() || info.mtime >= input.olderThan) continue;
    try {
      await unlink(path);
      deleted += 1;
    } catch (error) {
      if (!isFileSystemError(error, 'ENOENT')) throw error;
    }
  }
  return deleted;
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export class InvalidAgentMonthlyBillExportArtifactError extends Error {
  constructor() {
    super('月账单导出产物路径不合法');
    this.name = 'InvalidAgentMonthlyBillExportArtifactError';
  }
}
