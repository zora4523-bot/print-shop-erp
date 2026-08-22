import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignFileType } from '@/generated/prisma/enums';

const { signDesignUploadAction, recordDesignUploadAction } = vi.hoisted(() => ({
  signDesignUploadAction: vi.fn(),
  recordDesignUploadAction: vi.fn(),
}));

vi.mock('@/actions/design-upload', () => ({
  signDesignUploadAction,
  recordDesignUploadAction,
}));

import {
  prepareDesignFile,
  uploadOrderItemDesignFile,
} from '../design-upload-client';

beforeEach(() => {
  signDesignUploadAction.mockReset();
  recordDesignUploadAction.mockReset();
  vi.unstubAllGlobals();
});

describe('prepareDesignFile', () => {
  it('normalizes an unnamed clipboard PNG to an extension-bound file name', () => {
    const clipboardFile = new File(['png'], '', { type: 'image/png' });
    const result = prepareDesignFile(clipboardFile, {
      imagesOnly: true,
      fallbackStem: 'pasted-design-test',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.file.name).toBe('pasted-design-test.png');
    expect(result.value.fileType).toBe(DesignFileType.IMAGE);
    expect(result.value.mimeType).toBe('image/png');
  });

  it('rejects GIF clipboard content because the server allowlist does not accept it', () => {
    const result = prepareDesignFile(
      new File(['gif'], 'clipboard.gif', { type: 'image/gif' }),
      { imagesOnly: true },
    );

    expect(result).toEqual({
      ok: false,
      message: '仅支持 JPG、PNG、WEBP 图片',
    });
  });

  it('rejects CDR in the pre-create image queue', () => {
    const result = prepareDesignFile(
      new File(['cdr'], 'source.cdr', { type: 'application/octet-stream' }),
      { imagesOnly: true },
    );

    expect(result).toEqual({
      ok: false,
      message: '新建工单时仅支持图片；CDR 请在草稿详情页上传',
    });
  });

  it('uses canonical JPEG MIME when the browser reports an empty type', () => {
    const result = prepareDesignFile(new File(['jpeg'], 'artwork.jpeg'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mimeType).toBe('image/jpeg');
  });
});

describe('uploadOrderItemDesignFile', () => {
  it('signs, PUTs with the signed MIME, and records the uploaded object', async () => {
    signDesignUploadAction.mockResolvedValue({
      status: 'ok',
      putUrl: 'https://oss.example.test/signed-put',
      objectKey: 'design/order-1/item-1/image-1.jpg',
    });
    recordDesignUploadAction.mockResolvedValue({ ok: true });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const prepared = prepareDesignFile(
      new File(['jpeg'], 'design.jpg', { type: 'image/jpeg' }),
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const result = await uploadOrderItemDesignFile({
      orderId: 'order-1',
      orderItemId: 'item-1',
      prepared: prepared.value,
    });

    expect(result).toEqual({ ok: true });
    expect(signDesignUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        orderItemId: 'item-1',
        fileType: DesignFileType.IMAGE,
        fileName: 'design.jpg',
        mimeType: 'image/jpeg',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oss.example.test/signed-put',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );
    expect(recordDesignUploadAction).toHaveBeenCalledWith({
      orderId: 'order-1',
      orderItemId: 'item-1',
      objectKey: 'design/order-1/item-1/image-1.jpg',
      fileType: DesignFileType.IMAGE,
      fileName: 'design.jpg',
    });
  });

  it('does not attempt PUT when credential signing fails', async () => {
    signDesignUploadAction.mockResolvedValue({
      status: 'error',
      message: '上传凭证签发失败',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const prepared = prepareDesignFile(
      new File(['png'], 'design.png', { type: 'image/png' }),
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const result = await uploadOrderItemDesignFile({
      orderId: 'order-1',
      orderItemId: 'item-1',
      prepared: prepared.value,
    });

    expect(result).toEqual({ ok: false, message: '上传凭证签发失败' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordDesignUploadAction).not.toHaveBeenCalled();
  });
});
