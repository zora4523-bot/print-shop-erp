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
  // OSS service endpoint — used by the STS / metadata APIs. Not the
  // upload target. Defaults to `https://${region}.aliyuncs.com`.
  endpoint: string;
  // Virtual-hosted bucket URL — this is where browser PUT uploads go.
  // ALWAYS derived from bucket + region, never from OSS_PUBLIC_BASE_URL
  // (which can legitimately be a read-only CDN / custom domain that
  // won't accept writes).
  bucketUrl: string;
  // Public read URL base. CDN / custom domain if configured, else same
  // as bucketUrl. Only used for building `publicUrl` on stored designs.
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

function deriveBucketUrl(endpoint: string, bucket: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(
      `OSS_ENDPOINT 不是合法 URL：${endpoint}（形如 https://oss-cn-shenzhen.aliyuncs.com）`,
    );
  }
  // Reject shapes we can't safely virtual-host into `<bucket>.<host>`:
  //   - path / query / fragment — OSS endpoints are host-only; carrying a
  //     path into `bucketUrl` would silently drop it and produce a
  //     mismatched upload target
  //   - IPv6 literals — `url.hostname` returns the address without its
  //     surrounding brackets; you can't prepend a subdomain to an IP
  //   - already virtual-hosted host (`<bucket>.…`) — otherwise we'd
  //     double-prefix into `my-bucket.my-bucket.…`
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error(
      `OSS_ENDPOINT 不能包含路径 / 查询 / 片段：${endpoint}（形如 https://oss-cn-shenzhen.aliyuncs.com）`,
    );
  }
  if (url.hostname.startsWith('[') || /:/.test(url.hostname)) {
    throw new Error(
      `OSS_ENDPOINT 暂不支持 IPv6 字面量：${endpoint}（请使用 DNS 主机名）`,
    );
  }
  const bucketPrefix = `${bucket}.`;
  if (url.hostname.toLowerCase().startsWith(bucketPrefix.toLowerCase())) {
    throw new Error(
      `OSS_ENDPOINT 不应已经包含 bucket（${bucket}）前缀：${endpoint}（请使用服务主机，而非虚拟主机格式的 bucket URL，如 https://oss-cn-shenzhen.aliyuncs.com）`,
    );
  }
  // Virtual-hosted: `<bucket>.<host>`. Keeps the protocol + port that
  // the endpoint uses, so VPC / HTTP-only / custom-port setups are all
  // covered without extra env surface.
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${bucket}.${url.hostname}${port}`;
}

export function readOssConfig(env: NodeJS.ProcessEnv = process.env): OssConfigResult {
  const missing = REQUIRED_KEYS.filter((k) => isBlank(env[k]));
  if (missing.length > 0) {
    return { configured: false, missing: [...missing] };
  }
  const region = env.OSS_REGION!.trim();
  const bucket = env.OSS_BUCKET!.trim();
  // Service endpoint for STS / metadata. Derived when not pinned.
  const endpoint = isBlank(env.OSS_ENDPOINT)
    ? `https://${region}.aliyuncs.com`
    : env.OSS_ENDPOINT!.trim();
  // Upload target — virtual-hosted bucket URL. Prepend `${bucket}.` to
  // the SAME host as `endpoint` so a pinned OSS_ENDPOINT (VPC /
  // internal / OSS-compatible alt host) is respected instead of
  // silently sending uploads to the default public host (round 31).
  // Intentionally ignores OSS_PUBLIC_BASE_URL since a CDN can't accept
  // PUTs.
  const bucketUrl = deriveBucketUrl(endpoint, bucket);
  // Public-read URL base. CDN / custom domain if provided, else same as
  // bucketUrl (direct OSS public access).
  const publicBaseUrl = isBlank(env.OSS_PUBLIC_BASE_URL)
    ? bucketUrl
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
      bucketUrl,
      publicBaseUrl,
    },
  };
}
