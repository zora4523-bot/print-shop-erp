import { randomUUID } from 'node:crypto';
import { readOssConfig, type OssConfig } from './config';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME,
  FILE_SIZE_LIMITS,
  type SignUploadParams,
  type SignUploadResult,
} from './types';

// Strict allowlist for characters that can appear in path-sensitive ids.
// Prisma cuids match [A-Za-z0-9]+, cuid2 adds `_-`; this accepts either
// and rejects `/`, `..`, control chars, URL-significant characters.
// If a caller sends garbage here, it's a bug or attack, not a user typo.
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

// Thrown when OSS is fully configured per env, but the actual STS signing
// library (ali-oss / @alicloud/sts20150401) hasn't been plumbed in yet.
// A loud runtime error so we catch missed wiring fast — NOT silently
// faking success, per the owner's guidance.
export class OssNotWiredError extends Error {
  constructor() {
    super(
      'OSS 环境变量已配齐，但 STS 签发代码尚未接入。请安装 `ali-oss` 或 `@alicloud/sts20150401` 并在 lib/oss/sign.ts 中替换 `signViaSts` 的占位实现。',
    );
    this.name = 'OssNotWiredError';
  }
}

function buildObjectKey(params: SignUploadParams): string {
  // Extension is derived from the DECLARED fileType, not the untrusted
  // client extension. Even if a user renames a .jpg to .cdr, the stored
  // object uses the canonical extension for its declared type.
  const ext = ALLOWED_EXTENSIONS[params.fileType][0];
  const id = randomUUID();
  // Path layout: design/<orderId>/<orderItemId>/<fileType>-<uuid>.<ext>
  // orderId / orderItemId are whitelisted to SAFE_ID_RE (see validate),
  // so there's no way to escape the design/ prefix via `..` or `/`.
  return `design/${params.orderId}/${params.orderItemId}/${params.fileType.toLowerCase()}-${id}.${ext}`;
}

function extractExtension(fileName: string): string | null {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0 || idx === fileName.length - 1) return null;
  return fileName.slice(idx + 1).toLowerCase();
}

function validate(params: SignUploadParams): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {};

  // Path-sensitive identifiers must be plain (cuid-shaped). Anything that
  // could contain `/`, `..`, or control chars gets rejected before we
  // touch the object key.
  if (!SAFE_ID_RE.test(params.orderId)) {
    (errors.orderId ??= []).push('orderId 格式非法');
  }
  if (!SAFE_ID_RE.test(params.orderItemId)) {
    (errors.orderItemId ??= []).push('orderItemId 格式非法');
  }

  const sizeLimit = FILE_SIZE_LIMITS[params.fileType];
  if (params.fileSize <= 0) {
    (errors.fileSize ??= []).push('文件大小无效');
  } else if (params.fileSize > sizeLimit) {
    (errors.fileSize ??= []).push(
      `文件过大（${params.fileType} 上限 ${Math.round(sizeLimit / (1024 * 1024))} MiB）`,
    );
  }

  const allowedMime = ALLOWED_MIME[params.fileType];
  if (!allowedMime.includes(params.mimeType)) {
    (errors.mimeType ??= []).push(`MIME 类型不被允许：${params.mimeType}`);
  }

  // Extension must match the declared fileType. Defends against the
  // `application/octet-stream` CDR loophole — a caller can't rename a
  // JPEG to .cdr and pass it off with octet-stream.
  if (!params.fileName || params.fileName.trim() === '') {
    (errors.fileName ??= []).push('文件名不能为空');
  } else {
    const ext = extractExtension(params.fileName);
    const allowedExts = ALLOWED_EXTENSIONS[params.fileType];
    if (!ext || !allowedExts.includes(ext)) {
      (errors.fileName ??= []).push(
        `文件扩展名与类型不匹配（${params.fileType} 期望：${allowedExts.join(', ')}）`,
      );
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

// Concrete STS implementation — deliberately a throw stub so the call
// site is forced to plug in the real SDK when creds arrive. Unit tests
// cover everything ABOVE this line without executing the stub.
//
// When you plug in the real implementation, the signature takes the
// config (bucket/region/STS role) and the object key to scope the token
// policy to exactly that path. That's why both params are reserved even
// though the stub doesn't use them.
/* c8 ignore next 6 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function signViaSts(cfg: OssConfig, objectKey: string): never {
  throw new OssNotWiredError();
}

export async function signDesignUpload(
  params: SignUploadParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SignUploadResult> {
  const result = readOssConfig(env);
  if (!result.configured) {
    return {
      status: 'not-configured',
      message:
        '上传功能尚未配置 OSS 凭证，暂不可用。请联系管理员在服务端环境变量中配置完整后重试。',
      missing: result.missing,
    };
  }

  const fieldErrors = validate(params);
  if (fieldErrors) return { status: 'invalid', fieldErrors };

  const objectKey = buildObjectKey(params);
  const cfg = result.cfg;

  // When the real SDK is wired, `signViaSts` returns StsCredentials with
  // an expiration ~60 minutes out; for now it throws OssNotWiredError.
  // We keep the interface here stable so the UI call site doesn't change.
  const credentials = signViaSts(cfg, objectKey);

  return {
    status: 'ok',
    // Unreachable until signViaSts is wired — the `never` return of
    // signViaSts keeps TypeScript honest about the remaining branches.
    credentials,
    bucket: cfg.bucket,
    region: cfg.region,
    objectKey,
    // Upload target is the virtual-hosted bucket URL — the one that
    // actually accepts PUTs. We deliberately do NOT use publicBaseUrl
    // here: that value can be a read-only CDN / custom domain (round
    // 30). Stored designs still read from publicBaseUrl.
    uploadUrl: `${cfg.bucketUrl}/${objectKey}`,
    publicUrl: `${cfg.publicBaseUrl}/${objectKey}`,
  };
}
