import { DesignFileType } from '../../generated/prisma/enums';

// Shared OSS contract types. The SignUploadResult discriminated union is
// the stable surface the UI layer calls into; its shape MUST NOT change
// when real STS signing lands (swap implementation in lib/oss/sign.ts,
// not this file).

export { DesignFileType };

// Limits are enforced at the sign layer so a misbehaving client can't get
// a token for an outsized file. The UI layer mirrors them as an early
// client-side block.
export const FILE_SIZE_LIMITS: Record<DesignFileType, number> = {
  [DesignFileType.IMAGE]: 10 * 1024 * 1024, // 10 MiB for JPG/PNG
  [DesignFileType.CDR]: 100 * 1024 * 1024, // 100 MiB for CDR source files
};

export const ALLOWED_MIME: Record<DesignFileType, readonly string[]> = {
  [DesignFileType.IMAGE]: [
    'image/jpeg',
    'image/png',
    'image/webp',
  ] as const,
  // CorelDraw: no universally agreed-upon MIME; accept the octet-stream
  // fallback the browser picks when it doesn't recognize .cdr.
  [DesignFileType.CDR]: [
    'application/x-cdr',
    'application/vnd.corel-draw',
    'application/octet-stream',
  ] as const,
};

// Extensions the server will accept for each fileType. The client-supplied
// MIME alone isn't enough — `application/octet-stream` is legitimate for
// CDR but any file can be re-labeled as octet-stream, so we also check
// the extension matches the declared fileType.
export const ALLOWED_EXTENSIONS: Record<DesignFileType, readonly string[]> = {
  [DesignFileType.IMAGE]: ['jpg', 'jpeg', 'png', 'webp'] as const,
  [DesignFileType.CDR]: ['cdr'] as const,
};

export type SignUploadParams = {
  userId: string;
  orderId: string;
  orderItemId: string;
  fileType: DesignFileType;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

export type StsCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
  expiration: Date;
};

// Terminal outcomes for sign attempts. UI must pattern-match on `status`.
// `not-configured` is the explicit "OSS isn't wired yet" signal — the UI
// should show a disabled upload state and the operator message, NOT proceed
// and claim success.
export type SignUploadResult =
  | {
      status: 'ok';
      credentials: StsCredentials;
      bucket: string;
      region: string;
      // Object key in the bucket where the client must PUT the file.
      objectKey: string;
      // Absolute URL the client should PUT to (region endpoint + bucket).
      uploadUrl: string;
      // 预签 PUT URL（用 STS 临时凭证签，1h 有效，绑定 Content-Type）。
      // 浏览器直接 `fetch(putUrl, { method: 'PUT', body: file })` 即可，
      // 不需要在前端打包 ali-oss SDK。credentials 仍保留给未来需要
      // 分片/断点续传的大文件场景。
      putUrl: string;
      // After successful upload, the server records this as
      // OrderItemDesign.fileUrl for subsequent reads.
      publicUrl: string;
    }
  | {
      status: 'not-configured';
      message: string;
      missing: readonly string[];
    }
  | {
      status: 'invalid';
      fieldErrors: Record<string, string[]>;
    }
  | {
      status: 'error';
      message: string;
    };
