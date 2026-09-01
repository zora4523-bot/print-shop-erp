import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { chmodMock, mkdirMock, openMock, readdirMock, statMock, unlinkMock } = vi.hoisted(
  () => ({
    chmodMock: vi.fn(),
    mkdirMock: vi.fn(),
    openMock: vi.fn(),
    readdirMock: vi.fn(),
    statMock: vi.fn(),
    unlinkMock: vi.fn(),
  }),
);

vi.mock('node:fs/promises', () => ({
  chmod: chmodMock,
  mkdir: mkdirMock,
  open: openMock,
  readdir: readdirMock,
  stat: statMock,
  unlink: unlinkMock,
}));

import {
  cleanupUntrackedOrderExportArtifacts,
  deleteOrderExportArtifact,
  InvalidOrderExportArtifactError,
  openOrderExportArtifact,
} from '../export-artifact';

const originalArtifactDirectory = process.env.ORDER_EXPORT_ARTIFACT_DIR;

function fileSystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  process.env.ORDER_EXPORT_ARTIFACT_DIR = '/private/order-exports';
  chmodMock.mockReset();
  mkdirMock.mockReset();
  openMock.mockReset();
  readdirMock.mockReset();
  statMock.mockReset();
  unlinkMock.mockReset();
});

afterAll(() => {
  if (originalArtifactDirectory === undefined) {
    delete process.env.ORDER_EXPORT_ARTIFACT_DIR;
  } else {
    process.env.ORDER_EXPORT_ARTIFACT_DIR = originalArtifactDirectory;
  }
});

describe('order export artifact filesystem errors', () => {
  it('treats an already-missing artifact as successfully deleted', async () => {
    unlinkMock.mockRejectedValue(fileSystemError('ENOENT'));

    await expect(deleteOrderExportArtifact('export-1.xlsx')).resolves.toBe(
      undefined,
    );
    expect(unlinkMock).toHaveBeenCalledExactlyOnceWith(
      '/private/order-exports/export-1.xlsx',
    );
  });

  it('surfaces a permission failure while deleting an artifact', async () => {
    const error = fileSystemError('EACCES');
    unlinkMock.mockRejectedValue(error);

    await expect(deleteOrderExportArtifact('export-1.xlsx')).rejects.toBe(
      error,
    );
  });

  it('treats a missing artifact directory as empty but surfaces other read failures', async () => {
    readdirMock.mockRejectedValueOnce(fileSystemError('ENOENT'));

    await expect(
      cleanupUntrackedOrderExportArtifacts({
        keep: new Set(),
        olderThan: new Date('2026-08-07T00:00:00.000Z'),
      }),
    ).resolves.toBe(0);

    const permissionError = fileSystemError('EACCES');
    readdirMock.mockRejectedValueOnce(permissionError);
    await expect(
      cleanupUntrackedOrderExportArtifacts({
        keep: new Set(),
        olderThan: new Date('2026-08-07T00:00:00.000Z'),
      }),
    ).rejects.toBe(permissionError);
  });

  it('surfaces stat failures other than a concurrent disappearance', async () => {
    const error = fileSystemError('EIO');
    readdirMock.mockResolvedValue(['stale.xlsx']);
    statMock.mockRejectedValue(error);

    await expect(
      cleanupUntrackedOrderExportArtifacts({
        keep: new Set(),
        olderThan: new Date('2026-08-07T00:00:00.000Z'),
      }),
    ).rejects.toBe(error);
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('closes the opened descriptor when the artifact is not a regular file', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    openMock.mockResolvedValue({
      stat: vi.fn().mockResolvedValue({ isFile: () => false }),
      createReadStream: vi.fn(),
      close,
    });

    await expect(openOrderExportArtifact('export-1.xlsx')).rejects.toBeInstanceOf(
      InvalidOrderExportArtifactError,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the opened descriptor when stream creation fails', async () => {
    const streamFailure = fileSystemError('EMFILE');
    const close = vi.fn().mockResolvedValue(undefined);
    openMock.mockResolvedValue({
      stat: vi.fn().mockResolvedValue({ isFile: () => true, size: 100 }),
      createReadStream: vi.fn(() => {
        throw streamFailure;
      }),
      close,
    });

    await expect(openOrderExportArtifact('export-1.xlsx')).rejects.toBe(
      streamFailure,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not count a file another cleanup removed, and surfaces unlink failures', async () => {
    readdirMock.mockResolvedValue(['stale.xlsx']);
    statMock.mockResolvedValue({
      isFile: () => true,
      mtime: new Date('2026-08-01T00:00:00.000Z'),
    });
    unlinkMock.mockRejectedValueOnce(fileSystemError('ENOENT'));

    await expect(
      cleanupUntrackedOrderExportArtifacts({
        keep: new Set(),
        olderThan: new Date('2026-08-07T00:00:00.000Z'),
      }),
    ).resolves.toBe(0);

    const permissionError = fileSystemError('EACCES');
    unlinkMock.mockRejectedValueOnce(permissionError);
    await expect(
      cleanupUntrackedOrderExportArtifacts({
        keep: new Set(),
        olderThan: new Date('2026-08-07T00:00:00.000Z'),
      }),
    ).rejects.toBe(permissionError);
  });
});
