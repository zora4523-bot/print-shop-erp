import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
const oss = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), delete: vi.fn(), head: vi.fn() }));
vi.mock('../../oss/client', () => ({ createOssClient: () => oss }));
vi.mock('../../oss/config', () => ({ readOssConfig: () => ({ configured: true, cfg: {} }) }));
import { assertPdfArtifactAvailable, checkPdfArtifactStorage, cleanupOldPdfArtifacts, PDF_ARTIFACT_TTL_MS, readPdfArtifact, writePdfArtifact } from '../artifacts';
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erp-pdf-storage-test-'));
  vi.stubEnv('PDF_ARTIFACT_DIR', dir);
  vi.stubEnv('PDF_ARTIFACT_STORAGE', 'filesystem');
  vi.resetAllMocks();
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
describe('PDF artifact persistence', () => {
  it('preserves identical bytes for concurrent downloads and after reader restart', async () => {
    const bytes = Buffer.from('%PDF-portable');
    await writePdfArtifact('job-1.pdf', bytes);
    expect(await Promise.all([readPdfArtifact('job-1.pdf'), readPdfArtifact('job-1.pdf')])).toEqual([bytes, bytes]);
    vi.resetModules();
    const restarted = await import('../artifacts');
    expect(await restarted.readPdfArtifact('job-1.pdf')).toEqual(bytes);
    const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `import artifacts from './lib/pdf/artifacts.ts'; const { readPdfArtifact } = artifacts; process.stdout.write((await readPdfArtifact('job-1.pdf')).toString('base64'));`,
    ], { env: { ...process.env, PDF_ARTIFACT_DIR: dir, PDF_ARTIFACT_STORAGE: 'filesystem' } });
    expect(Buffer.from(child.stdout, 'base64')).toEqual(bytes);
  });
  it('rejects expiry before collection and removes expired artifacts', async () => {
    await writePdfArtifact('old.pdf', Buffer.from('pdf'));
    const past = new Date(Date.now() - PDF_ARTIFACT_TTL_MS - 1000);
    await utimes(join(dir, 'old.pdf'), past, past);
    await expect(readPdfArtifact('old.pdf')).rejects.toThrow('PDF_ARTIFACT_EXPIRED');
    await cleanupOldPdfArtifacts();
    await expect(readPdfArtifact('old.pdf')).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['../a.pdf', '/a.pdf', 'a.txt'])('rejects invalid artifact names: %s', async (name) => {
    await expect(writePdfArtifact(name, Buffer.from('pdf'))).rejects.toThrow('PDF_ARTIFACT_INVALID');
    await expect(readPdfArtifact(name)).rejects.toThrow('PDF_ARTIFACT_INVALID');
  });
  it('requires explicit persistent storage in production', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PDF_ARTIFACT_DIR', '');
    await expect(writePdfArtifact('job.pdf', Buffer.from('pdf'))).rejects.toThrow('PDF_DIRECTORY_REQUIRED');
  });
  it('writes private OSS objects and reads without deleting for multiple web instances', async () => {
    vi.stubEnv('PDF_ARTIFACT_STORAGE', 'oss');
    const content = Buffer.from('%PDF-oss');
    oss.get.mockResolvedValue({ content, res: { headers: { 'last-modified': new Date().toUTCString() } } });
    await writePdfArtifact('job.pdf', content);
    expect(oss.put).toHaveBeenCalledWith('private/order-pdf/job.pdf', content, expect.objectContaining({ headers: expect.objectContaining({ 'x-oss-object-acl': 'private' }) }));
    expect(await readPdfArtifact('job.pdf')).toEqual(content);
    expect(await readPdfArtifact('job.pdf')).toEqual(content);
    oss.get.mockResolvedValue({ content, res: { headers: { 'last-modified': new Date(Date.now() - PDF_ARTIFACT_TTL_MS - 1000).toUTCString() } } });
    await expect(readPdfArtifact('job.pdf')).rejects.toThrow('PDF_ARTIFACT_EXPIRED');
  });
  // 批量打印记录前只核对文件仍可交付，不读内容（业主 2026-10-02 点打印即记已打印）。
  it('checks availability without reading content, in both stores', async () => {
    await writePdfArtifact('fresh.pdf', Buffer.from('pdf'));
    await expect(assertPdfArtifactAvailable('fresh.pdf')).resolves.toBeUndefined();
    await expect(assertPdfArtifactAvailable('missing.pdf')).rejects.toMatchObject({ code: 'ENOENT' });
    const past = new Date(Date.now() - PDF_ARTIFACT_TTL_MS - 1000);
    await utimes(join(dir, 'fresh.pdf'), past, past);
    await expect(assertPdfArtifactAvailable('fresh.pdf')).rejects.toThrow('PDF_ARTIFACT_EXPIRED');
    vi.stubEnv('PDF_ARTIFACT_STORAGE', 'oss');
    oss.head.mockResolvedValueOnce({ res: { headers: { 'last-modified': new Date().toUTCString() } } });
    await expect(assertPdfArtifactAvailable('job.pdf')).resolves.toBeUndefined();
    expect(oss.head).toHaveBeenCalledWith('private/order-pdf/job.pdf', { timeout: 10_000 });
    expect(oss.get).not.toHaveBeenCalled();
    oss.head.mockResolvedValueOnce({ res: { headers: { 'last-modified': past.toUTCString() } } });
    await expect(assertPdfArtifactAvailable('job.pdf')).rejects.toThrow('PDF_ARTIFACT_EXPIRED');
    await expect(assertPdfArtifactAvailable('../x.pdf')).rejects.toThrow('PDF_ARTIFACT_INVALID');
  });
});

it('probes storage with real bytes and cleans only its own artifact', async () => {
  await writePdfArtifact('business.pdf', Buffer.from('business'));
  await checkPdfArtifactStorage(Buffer.from('%PDF-probe'));
  expect(await readdir(dir)).toEqual(['business.pdf']);
  expect((await readPdfArtifact('business.pdf')).toString()).toBe('business');
});

it('keeps OSS read/write capability when cleanup fails and preserves primary errors', async () => {
  vi.stubEnv('PDF_ARTIFACT_STORAGE', 'oss');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const content = Buffer.from('%PDF-probe');
    oss.get.mockResolvedValue({ content, res: { headers: { 'last-modified': new Date().toUTCString() } } });
    oss.delete.mockRejectedValue(new Error('private credential diagnostics'));
    await expect(checkPdfArtifactStorage(content)).resolves.toEqual({ probeRemoved: false });
    expect(oss.delete).toHaveBeenCalledWith(oss.put.mock.calls[0][0]);
    expect(warn).toHaveBeenCalledWith('[pdf-probe] cleanup-failed');
    const failure = new Error('put failed');
    oss.put.mockRejectedValueOnce(failure);
    await expect(checkPdfArtifactStorage(content)).rejects.toBe(failure);
    oss.get.mockResolvedValueOnce({ content: Buffer.from('wrong'), res: { headers: { 'last-modified': new Date().toUTCString() } } });
    await expect(checkPdfArtifactStorage(content)).rejects.toThrow('PDF_ARTIFACT_MISMATCH');
  } finally { warn.mockRestore(); }
});
