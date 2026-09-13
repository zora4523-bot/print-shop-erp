import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
const oss = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock('../../oss/client', () => ({ createOssClient: () => oss }));
vi.mock('../../oss/config', () => ({ readOssConfig: () => ({ configured: true, cfg: {} }) }));
import { cleanupOldPdfArtifacts, PDF_ARTIFACT_TTL_MS, readPdfArtifact, writePdfArtifact } from '../artifacts';
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erp-pdf-storage-test-'));
  vi.stubEnv('PDF_ARTIFACT_DIR', dir);
  vi.stubEnv('PDF_ARTIFACT_STORAGE', 'filesystem');
  vi.clearAllMocks();
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
});
