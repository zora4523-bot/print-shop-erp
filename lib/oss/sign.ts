import { randomUUID } from 'node:crypto';
import { readOssConfig, type OssConfig } from './config';
import {
  ALLOWED_MIME,
  FILE_SIZE_LIMITS,
  type SignUploadParams,
  type SignUploadResult,
} from './types';

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
  const ext = extractExtension(params.fileName) || (params.fileType === 'IMAGE' ? 'jpg' : 'cdr');
  const id = randomUUID();
  // Path layout: design/<orderId>/<orderItemId>/<fileType>-<uuid>.<ext>
  // Keeps per-order files co-located for future bulk download (CDR汇总).
  return `design/${params.orderId}/${params.orderItemId}/${params.fileType.toLowerCase()}-${id}.${ext}`;
}

function extractExtension(fileName: string): string | null {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0 || idx === fileName.length - 1) return null;
  return fileName.slice(idx + 1).toLowerCase();
}

function validate(params: SignUploadParams): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {};
  const sizeLimit = FILE_SIZE_LIMITS[params.fileType];
  if (params.fileSize <= 0) {
    (errors.fileSize ??= []).push('文件大小无效');
  } else if (params.fileSize > sizeLimit) {
    (errors.fileSize ??= []).push(
      `文件过大（${params.fileType} 上限 ${Math.round(sizeLimit / (1024 * 1024))} MiB）`,
    );
  }
  const allowed = ALLOWED_MIME[params.fileType];
  if (!allowed.includes(params.mimeType)) {
    (errors.mimeType ??= []).push(`MIME 类型不被允许：${params.mimeType}`);
  }
  if (!params.fileName || params.fileName.trim() === '') {
    (errors.fileName ??= []).push('文件名不能为空');
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
    uploadUrl: `${cfg.endpoint}/${cfg.bucket}/${objectKey}`,
    publicUrl: `${cfg.publicBaseUrl}/${objectKey}`,
  };
}
