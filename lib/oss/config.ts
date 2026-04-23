// OSS connection + credential config, read from env.
//
// The owner has asked for a "scaffold now, wire real STS when keys arrive"
// posture. This module is the single place that reads and validates env
// vars, so every caller gets a uniform `{ configured: true, cfg }` /
// `{ configured: false, missing }` decision.
//
// Required env:
//   OSS_ACCESS_KEY_ID          account AK (for STS AssumeRole)
//   OSS_ACCESS_KEY_SECRET      account SK (for STS AssumeRole)
//   OSS_STS_ROLE_ARN           RAM role the server assumes when signing
//   OSS_BUCKET                 target bucket name
//   OSS_REGION                 e.g. oss-cn-shenzhen
// Optional:
//   OSS_ENDPOINT               override endpoint (otherwise derived from region)
//   OSS_PUBLIC_BASE_URL        CDN / custom domain; falls back to the OSS host

export type OssConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  stsRoleArn: string;
  bucket: string;
  region: string;
  endpoint: string;
  publicBaseUrl: string;
};

export type OssConfigResult =
  | { configured: true; cfg: OssConfig }
  | { configured: false; missing: string[] };

const REQUIRED_KEYS = [
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_STS_ROLE_ARN',
  'OSS_BUCKET',
  'OSS_REGION',
] as const;

function isBlank(v: string | undefined): boolean {
  return v === undefined || v.trim() === '';
}

export function readOssConfig(env: NodeJS.ProcessEnv = process.env): OssConfigResult {
  const missing = REQUIRED_KEYS.filter((k) => isBlank(env[k]));
  if (missing.length > 0) {
    return { configured: false, missing: [...missing] };
  }
  const region = env.OSS_REGION!.trim();
  const bucket = env.OSS_BUCKET!.trim();
  // Derive the conventional public endpoint when OSS_ENDPOINT isn't pinned.
  const endpoint = isBlank(env.OSS_ENDPOINT)
    ? `https://${region}.aliyuncs.com`
    : env.OSS_ENDPOINT!.trim();
  const publicBaseUrl = isBlank(env.OSS_PUBLIC_BASE_URL)
    ? `https://${bucket}.${region}.aliyuncs.com`
    : env.OSS_PUBLIC_BASE_URL!.trim();

  return {
    configured: true,
    cfg: {
      accessKeyId: env.OSS_ACCESS_KEY_ID!.trim(),
      accessKeySecret: env.OSS_ACCESS_KEY_SECRET!.trim(),
      stsRoleArn: env.OSS_STS_ROLE_ARN!.trim(),
      bucket,
      region,
      endpoint,
      publicBaseUrl,
    },
  };
}
