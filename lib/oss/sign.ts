import { randomUUID } from 'node:crypto';
import OSS from 'ali-oss';
import { readOssConfig, type OssConfig } from './config';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME,
  FILE_SIZE_LIMITS,
  type SignUploadParams,
  type SignUploadResult,
  type StsCredentials,
} from './types';

// Strict allowlist for characters that can appear in path-sensitive ids.
// Prisma cuids match [A-Za-z0-9]+, cuid2 adds `_-`; this accepts either
// and rejects `/`, `..`, control chars, URL-significant characters.
// If a caller sends garbage here, it's a bug or attack, not a user typo.
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

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

// STS 凭证有效期：1 小时。浏览器拿到 token 后立即开始 PUT，正常
// 上传（含 100 MiB CDR 的分片重试）远小于此窗口；不设更长以缩小
// 泄漏影响面。
const STS_DURATION_SECONDS = 3600;

// Real STS AssumeRole via ali-oss. The session policy narrows the
// temporary credential to exactly ONE object key — even narrower than
// the RAM role's own policy (design/* + bundles/*). A leaked token can
// only PUT the single path it was minted for.
async function signViaSts(
  cfg: OssConfig,
  objectKey: string,
): Promise<StsCredentials> {
  const sts = new OSS.STS({
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
  });
  const sessionPolicy = {
    Version: '1',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['oss:PutObject', 'oss:AbortMultipartUpload', 'oss:ListParts'],
        Resource: [`acs:oss:*:*:${cfg.bucket}/${objectKey}`],
      },
    ],
  };
  const result = await sts.assumeRole(
    cfg.stsRoleArn,
    sessionPolicy,
    STS_DURATION_SECONDS,
    'erp-design-upload',
  );
  return {
    accessKeyId: result.credentials.AccessKeyId,
    accessKeySecret: result.credentials.AccessKeySecret,
    securityToken: result.credentials.SecurityToken,
    expiration: new Date(result.credentials.Expiration),
  };
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

  let credentials: StsCredentials;
  try {
    credentials = await signViaSts(cfg, objectKey);
  } catch (err) {
    // AssumeRole 失败（AK 错、角色信任策略不含本子账号、网络等）。
    // 原始错误进服务端日志给 ops；给 UI 的 message 不回显 SDK 错误
    // 文本，避免把 ARN / RequestId 之类内部细节带到浏览器。
    console.error(
      '[oss] STS assumeRole failed:',
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
    return {
      status: 'error',
      message:
        '上传凭证签发失败，请稍后重试；若持续失败请联系管理员检查 OSS / RAM 配置。',
    };
  }

  return {
    status: 'ok',
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
