'use client';

import {
  recordDesignUploadAction,
  signDesignUploadAction,
} from '@/actions/design-upload';
import { DesignFileType } from '@/generated/prisma/enums';
import { FILE_SIZE_LIMITS } from '@/lib/oss/types';

type DesignFileDescriptor = {
  fileType: typeof DesignFileType.IMAGE | typeof DesignFileType.CDR;
  mimeType: string;
};

const EXTENSION_MAP: Record<string, DesignFileDescriptor> = {
  jpg: { fileType: DesignFileType.IMAGE, mimeType: 'image/jpeg' },
  jpeg: { fileType: DesignFileType.IMAGE, mimeType: 'image/jpeg' },
  png: { fileType: DesignFileType.IMAGE, mimeType: 'image/png' },
  webp: { fileType: DesignFileType.IMAGE, mimeType: 'image/webp' },
  cdr: {
    fileType: DesignFileType.CDR,
    mimeType: 'application/octet-stream',
  },
};

const IMAGE_MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type PreparedDesignFile = {
  file: File;
  fileType: typeof DesignFileType.IMAGE | typeof DesignFileType.CDR;
  mimeType: string;
};

export type PrepareDesignFileResult =
  | { ok: true; value: PreparedDesignFile }
  | { ok: false; message: string };

export type DesignUploadResult =
  | { ok: true }
  | { ok: false; message: string };

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

function compactFileName(fileName: string, extension: string): string {
  const suffix = `.${extension}`;
  const stem = fileName
    .slice(0, Math.max(0, fileName.length - suffix.length))
    .trim()
    .slice(0, 256 - suffix.length);
  return `${stem || 'design'}${suffix}`;
}

/**
 * Clipboard image files commonly arrive as `image.png`, an empty name, or a
 * name without an extension. Normalize those names before asking the server to
 * sign an extension-bound upload URL.
 */
export function prepareDesignFile(
  input: File,
  options: { imagesOnly?: boolean; fallbackStem?: string } = {},
): PrepareDesignFileResult {
  let file = input;
  let extension = extensionOf(file.name);
  let descriptor = EXTENSION_MAP[extension];

  if (!descriptor) {
    const mimeExtension = IMAGE_MIME_EXTENSION[file.type.toLowerCase()];
    if (!mimeExtension) {
      return {
        ok: false,
        message: options.imagesOnly
          ? '仅支持 JPG、PNG、WEBP 图片'
          : '仅支持 JPG、PNG、WEBP 图片或 CDR 源文件',
      };
    }

    extension = mimeExtension;
    const stem =
      options.fallbackStem ??
      `pasted-design-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
    const normalizedName = compactFileName(`${stem}.${extension}`, extension);
    file = new File([file], normalizedName, {
      type: file.type,
      lastModified: file.lastModified,
    });
    descriptor = EXTENSION_MAP[extension];
  }

  if (options.imagesOnly && descriptor.fileType !== DesignFileType.IMAGE) {
    return { ok: false, message: '新建工单时仅支持图片；CDR 请在草稿详情页上传' };
  }

  const sizeLimit = FILE_SIZE_LIMITS[descriptor.fileType];
  if (file.size <= 0) {
    return { ok: false, message: '图片内容为空，无法上传' };
  }
  if (file.size > sizeLimit) {
    return {
      ok: false,
      message: `文件过大，上限 ${Math.round(sizeLimit / (1024 * 1024))} MiB`,
    };
  }

  const normalizedName = compactFileName(file.name, extension);
  if (normalizedName !== file.name) {
    file = new File([file], normalizedName, {
      type: file.type,
      lastModified: file.lastModified,
    });
  }

  return {
    ok: true,
    value: {
      file,
      fileType: descriptor.fileType,
      // Do not trust a blank / platform-specific browser MIME. The server and
      // OSS signature deliberately use the canonical extension mapping.
      mimeType: descriptor.mimeType,
    },
  };
}

export async function uploadOrderItemDesignFile({
  orderId,
  orderItemId,
  prepared,
}: {
  orderId: string;
  orderItemId: string;
  prepared: PreparedDesignFile;
}): Promise<DesignUploadResult> {
  try {
    const signed = await signDesignUploadAction({
      orderId,
      orderItemId,
      fileType: prepared.fileType,
      fileName: prepared.file.name,
      fileSize: prepared.file.size,
      mimeType: prepared.mimeType,
    });

    if (signed.status === 'not-configured' || signed.status === 'error') {
      return { ok: false, message: signed.message };
    }
    if (signed.status === 'invalid') {
      return {
        ok: false,
        message: Object.values(signed.fieldErrors).flat().join('；'),
      };
    }

    const response = await fetch(signed.putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': prepared.mimeType },
      body: prepared.file,
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `上传失败（OSS ${response.status}），请重试`,
      };
    }

    const recorded = await recordDesignUploadAction({
      orderId,
      orderItemId,
      objectKey: signed.objectKey,
      fileType: prepared.fileType,
      fileName: prepared.file.name,
    });
    return recorded.ok ? { ok: true } : recorded;
  } catch {
    return { ok: false, message: '上传过程中断（网络错误），请重试' };
  }
}
