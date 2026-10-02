import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createOssClient } from '../oss/client';
import { readOssConfig } from '../oss/config';

export const PDF_ARTIFACT_TTL_MS = 60 * 60_000;
const PREFIX = 'private/order-pdf/';

function storage(): 'filesystem' | 'oss' {
  const value = process.env.PDF_ARTIFACT_STORAGE || 'filesystem';
  if (value !== 'filesystem' && value !== 'oss') throw new Error('PDF_STORAGE_INVALID');
  return value;
}
function checkedName(name: string): string {
  if (!/^[A-Za-z0-9_-]+\.pdf$/.test(name)) throw new Error('PDF_ARTIFACT_INVALID');
  return name;
}
function directory(): string {
  const configured = process.env.PDF_ARTIFACT_DIR;
  if (configured && isAbsolute(configured)) return configured;
  if (configured || process.env.NODE_ENV === 'production') throw new Error('PDF_DIRECTORY_REQUIRED');
  return join(tmpdir(), 'print-shop-erp-pdf-artifacts');
}
function client() {
  const config = readOssConfig();
  if (!config.configured) throw new Error('PDF_STORAGE_UNCONFIGURED');
  return createOssClient(config.cfg);
}
function assertFresh(modified: number) {
  if (!Number.isFinite(modified) || modified <= Date.now() - PDF_ARTIFACT_TTL_MS) {
    throw new Error('PDF_ARTIFACT_EXPIRED');
  }
}

/** Keep bytes for retry/repeated downloads; the authenticated route owns ACLs. */
export async function readPdfArtifact(name: string): Promise<Buffer> {
  checkedName(name);
  if (storage() === 'oss') {
    const result = await client().get(PREFIX + name);
    const modified = 'last-modified' in result.res.headers ? result.res.headers['last-modified'] : undefined;
    assertFresh(Date.parse(String(modified ?? '')));
    return Buffer.from(result.content);
  }
  const path = join(directory(), name);
  assertFresh((await stat(path)).mtimeMs);
  return readFile(path);
}

export async function writePdfArtifact(name: string, pdf: Buffer): Promise<void> {
  checkedName(name);
  if (storage() === 'oss') {
    await client().put(PREFIX + name, pdf, {
      headers: { 'x-oss-object-acl': 'private', 'Cache-Control': 'private, no-store', 'Content-Type': 'application/pdf' },
    });
    return;
  }
  const dir = directory();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, name);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, pdf, { mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function cleanupOldPdfArtifacts(): Promise<void> {
  // OSS lifecycle (prefix private/order-pdf/, one day) owns physical deletion.
  // The one-hour read limit above is enforced even before lifecycle collection.
  if (storage() === 'oss') return;
  const dir = directory();
  // Runtime artifacts are not application assets to trace into the build.
  const entries = await readdir(/* turbopackIgnore: true */ dir);
  await Promise.all(entries.filter((name) => /^[A-Za-z0-9_-]+\.pdf(?:\.[A-Za-z0-9_-]+\.tmp)?$/.test(name)).map(async (name) => {
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info && info.mtimeMs <= Date.now() - PDF_ARTIFACT_TTL_MS) await unlink(path).catch(() => undefined);
  }));
}

/** Probe only its own unique private artifact; never removes business output. */
export async function checkPdfArtifactStorage(pdf: Buffer): Promise<{ probeRemoved: boolean }> {
  const name = `probe-${randomUUID()}.pdf`;
  let primaryFailure: { error: unknown } | undefined;
  let probeRemoved = true;
  try {
    await writePdfArtifact(name, pdf);
    if (!(await readPdfArtifact(name)).equals(pdf)) throw new Error('PDF_ARTIFACT_MISMATCH');
  } catch (error) { primaryFailure = { error }; }
  try {
    if (storage() === 'oss') await client().delete(PREFIX + name);
    else await unlink(join(directory(), name)).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    });
  } catch (error) {
    probeRemoved = false;
    if (storage() === 'oss') console.warn('[pdf-probe] cleanup-failed');
    else if (!primaryFailure) primaryFailure = { error };
  }
  if (primaryFailure) throw primaryFailure.error;
  return { probeRemoved };
}

export class PdfArtifactStorageError extends Error {
  constructor() { super('PDF artifact storage unavailable'); this.name = 'PdfArtifactStorageError'; }
}
