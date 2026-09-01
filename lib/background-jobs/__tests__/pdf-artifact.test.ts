import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fsMock } = vi.hoisted(() => ({
  fsMock: {
    mkdir: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => fsMock);
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/order/print-view', () => ({ getOrderForPrint: vi.fn() }));
vi.mock('@/lib/order/print-html', () => ({ buildPrintHtml: vi.fn() }));
vi.mock('@/lib/pdf/render', () => ({ renderHtmlToPdf: vi.fn() }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn() }));
vi.mock('../repository', () => ({ enqueueBackgroundJob: vi.fn() }));

import { writePdfArtifact } from '../pdf';

const originalArtifactDir = process.env.PDF_ARTIFACT_DIR;

beforeEach(() => {
  process.env.PDF_ARTIFACT_DIR = '/var/tmp/pdf-artifact-test';
  for (const mock of Object.values(fsMock)) mock.mockReset();
  fsMock.mkdir.mockResolvedValue(undefined);
  fsMock.writeFile.mockResolvedValue(undefined);
  fsMock.rename.mockResolvedValue(undefined);
  fsMock.unlink.mockResolvedValue(undefined);
});

afterEach(() => {
  if (originalArtifactDir === undefined) {
    delete process.env.PDF_ARTIFACT_DIR;
  } else {
    process.env.PDF_ARTIFACT_DIR = originalArtifactDir;
  }
});

describe('writePdfArtifact', () => {
  it('atomically renames a private temporary file', async () => {
    await writePdfArtifact('job-1.pdf', Buffer.from('pdf'));

    const target = '/var/tmp/pdf-artifact-test/job-1.pdf';
    const temporary = `${target}.${process.pid}.tmp`;
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      temporary,
      Buffer.from('pdf'),
      { mode: 0o600 },
    );
    expect(fsMock.rename).toHaveBeenCalledWith(temporary, target);
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it('removes the temporary file and preserves a rename failure', async () => {
    const renameFailure = Object.assign(new Error('rename failed'), {
      code: 'EACCES',
    });
    fsMock.rename.mockRejectedValue(renameFailure);

    await expect(
      writePdfArtifact('job-2.pdf', Buffer.from('pdf')),
    ).rejects.toBe(renameFailure);

    expect(fsMock.unlink).toHaveBeenCalledWith(
      `/var/tmp/pdf-artifact-test/job-2.pdf.${process.pid}.tmp`,
    );
  });

  it('preserves a write failure even if temporary cleanup also fails', async () => {
    const writeFailure = Object.assign(new Error('disk full'), {
      code: 'ENOSPC',
    });
    fsMock.writeFile.mockRejectedValue(writeFailure);
    fsMock.unlink.mockRejectedValue(
      Object.assign(new Error('cleanup failed'), { code: 'EACCES' }),
    );

    await expect(
      writePdfArtifact('job-3.pdf', Buffer.from('pdf')),
    ).rejects.toBe(writeFailure);
    expect(fsMock.rename).not.toHaveBeenCalled();
  });
});
