import { createReadStream, type ReadStream } from 'node:fs';
import { chmod, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

const EXPORT_ARTIFACT_PATTERN = /^[A-Za-z0-9_-]+\.xlsx$/;
const EXPORT_MANIFEST_PATTERN =
  /^[A-Za-z0-9_-]+\.xlsx\.[0-9a-f-]{36}\.orders$/i;
const EXPORT_TEMP_PATTERN =
  /^\.[A-Za-z0-9_-]+\.xlsx\.\d+\.[0-9a-f-]{36}\.tmp$/i;

export function orderExportArtifactDir(): string {
  const configured = process.env.ORDER_EXPORT_ARTIFACT_DIR;
  if (configured) {
    if (!isAbsolute(configured)) throw new InvalidOrderExportArtifactError();
    return configured;
  }
  return join(tmpdir(), 'print-shop-erp-order-exports');
}

export function orderExportArtifactPath(name: string): string {
  if (basename(name) !== name || !EXPORT_ARTIFACT_PATTERN.test(name)) {
    throw new InvalidOrderExportArtifactError();
  }
  return join(orderExportArtifactDir(), name);
}

export async function ensureOrderExportArtifactDir(): Promise<void> {
  const directory = orderExportArtifactDir();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

export async function openOrderExportArtifact(name: string): Promise<{
  stream: ReadStream;
  byteLength: number;
}> {
  const path = orderExportArtifactPath(name);
  const info = await stat(path);
  if (!info.isFile()) throw new InvalidOrderExportArtifactError();
  return { stream: createReadStream(path), byteLength: info.size };
}

export async function deleteOrderExportArtifact(name: string): Promise<void> {
  try {
    await unlink(orderExportArtifactPath(name));
  } catch (error) {
    if (!isFileSystemError(error, 'ENOENT')) throw error;
  }
}

export async function cleanupUntrackedOrderExportArtifacts(input: {
  keep: ReadonlySet<string>;
  olderThan: Date;
}): Promise<number> {
  const directory = orderExportArtifactDir();
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (!isFileSystemError(error, 'ENOENT')) throw error;
    entries = [];
  }
  let deleted = 0;
  for (const name of entries) {
    const isArtifact = EXPORT_ARTIFACT_PATTERN.test(name);
    const isAuxiliary =
      EXPORT_MANIFEST_PATTERN.test(name) || EXPORT_TEMP_PATTERN.test(name);
    if ((!isArtifact && !isAuxiliary) || (isArtifact && input.keep.has(name))) {
      continue;
    }
    const path = isArtifact
      ? orderExportArtifactPath(name)
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
      // A concurrent cleanup may win between stat and unlink. That is already
      // clean, but permission / I/O failures must remain observable so the
      // scheduled maintenance job retries instead of reporting false success.
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

export class InvalidOrderExportArtifactError extends Error {
  constructor() {
    super('工单导出产物路径不合法');
    this.name = 'InvalidOrderExportArtifactError';
  }
}
