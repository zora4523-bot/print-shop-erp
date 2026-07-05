import { PassThrough } from 'node:stream';
import OSS from 'ali-oss';
import { ZipArchive } from 'archiver';
import { readOssConfig } from '../oss/config';

// CDR 汇总下载（SPEC §3.6）的"打包到 OSS"步骤。
//
//   - prod / OSS 已配齐（readOssConfig.configured=true）+ 默认非 mock
//     → 真打包：流式从 OSS 拉每个 CDR 文件 → archiver 边收边压 →
//        流式 PUT 到 `bundles/<bundleId>.zip` → 生成 24h 预签 GET URL。
//   - dev / OSS 未配齐 OR `CDR_BUNDLE_MOCK_MODE=true`
//     → 写"mock 占位"到 DesignBundle.zipFileUrl（`mock://bundle/<id>.zip`），
//        让 UI / E2E 流程跑通；下载路由 `/api/cdr/bundles/<id>` 在 mock
//        路径返 503。
//
// 凭证模型（DECISIONS 2026-07-05）：服务端打包用 RAM 子账号**长期凭证**
// 直连，不走 STS——预签 URL 的寿命受签发凭证寿命限制，STS 临时凭证
// 最长 1h，签不出 24h 链接。因此 RAM 子账号必须直接挂对象读写策略
// （design/* 读 + bundles/* 读写），而不仅是 AssumeRole。

export type ZipUploadResult = {
  // 24h 预签 GET URL（真实路径）或 mock 占位 URL；写到 DesignBundle.zipFileUrl
  zipFileUrl: string;
  // 24 小时后过期；写到 DesignBundle.expiresAt
  expiresAt: Date;
  // mock-mode=true 时 UI 显示"OSS 未配置"告警条
  isMock: boolean;
};

export type ZipUploadInput = {
  // 要打的 CDR 文件 OSS URL 列表（从 OrderItemDesign.fileUrl 取）
  files: ReadonlyArray<{ orderNo: string; fileName: string; fileUrl: string }>;
  // 用于对象 key：bundles/<bundleId>.zip
  bundleId: string;
};

export class CdrZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CdrZipError';
  }
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SIGNED_URL_EXPIRES_SECONDS = 24 * 60 * 60;

export function isMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CDR_BUNDLE_MOCK_MODE === 'true') return true;
  if (env.CDR_BUNDLE_MOCK_MODE === 'false') return false;
  // OSS 未配齐 → 强制 mock；不能真打包
  const cfg = readOssConfig(env);
  return !cfg.configured;
}

// 从存储的 fileUrl 反推 OSS 对象 key。fileUrl 由 sign.ts 以
// `${publicBaseUrl}/${objectKey}` 生成；bucket 私有，直接 fetch 该
// URL 是 403，必须用凭证走 getStream(objectKey)。
function deriveObjectKey(fileUrl: string): string {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    throw new CdrZipError(`设计文件 URL 非法：${fileUrl}`);
  }
  const key = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  // 只允许 design/ 前缀——防止历史数据/脏数据把打包器指向任意对象。
  if (!key.startsWith('design/')) {
    throw new CdrZipError(`设计文件不在 design/ 前缀内：${key}`);
  }
  return key;
}

async function generateRealZip(
  input: ZipUploadInput,
  now: Date,
  env: NodeJS.ProcessEnv,
): Promise<ZipUploadResult> {
  const cfgResult = readOssConfig(env);
  if (!cfgResult.configured) {
    throw new CdrZipError(
      `OSS 未配置（缺 ${cfgResult.missing.join(', ')}），无法真实打包`,
    );
  }
  const cfg = cfgResult.cfg;

  // 先做纯校验（全部 key 可反推），任何一个不合法都在发起网络 IO 前失败。
  const entries = input.files.map((f) => ({
    ...f,
    objectKey: deriveObjectKey(f.fileUrl),
  }));

  const client = new OSS({
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    bucket: cfg.bucket,
    region: cfg.region,
    secure: true,
  });

  const zipObjectKey = `bundles/${input.bundleId}.zip`;
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const out = new PassThrough();
  let archiveError: Error | null = null;
  archive.on('error', (err) => {
    archiveError = err;
    // 让下游 putStream 立刻失败，而不是挂在半截 ZIP 上等超时。
    out.destroy(err);
  });
  archive.pipe(out);

  // putStream 与 append 并发：archiver 边压边写，整包不落内存/磁盘。
  const putPromise = client.putStream(zipObjectKey, out);

  try {
    // ZIP 内按工单号分目录；同名文件追加序号，避免静默覆盖。
    const usedNames = new Map<string, number>();
    for (const entry of entries) {
      const result = await client.getStream(entry.objectKey);
      const baseName = `${entry.orderNo}/${entry.fileName}`;
      const seen = usedNames.get(baseName) ?? 0;
      usedNames.set(baseName, seen + 1);
      const name =
        seen === 0
          ? baseName
          : `${entry.orderNo}/(${seen + 1}) ${entry.fileName}`;
      archive.append(result.stream, { name });
    }
    await archive.finalize();
    await putPromise;
  } catch (err) {
    // 半途失败：终止 archiver 并确保 putPromise 不产生 unhandled
    // rejection（对象可能已写入半截，OSS 端以 PUT 完成与否为准）。
    archive.abort();
    out.destroy();
    await putPromise.catch(() => {});
    throw err;
  }
  if (archiveError) throw archiveError;

  // 预签 24h GET URL。下载路由拿 zipFileUrl 直接 302；链接寿命与
  // DesignBundle.expiresAt 一致。
  const zipFileUrl = client.signatureUrl(zipObjectKey, {
    expires: SIGNED_URL_EXPIRES_SECONDS,
    method: 'GET',
  });

  return {
    zipFileUrl,
    expiresAt: new Date(now.getTime() + TWENTY_FOUR_HOURS_MS),
    isMock: false,
  };
}

/**
 * 唯一公开入口：dispatch 到 mock 或真实路径。
 * mock 路径不真发 HTTP，立刻返 mock 占位。
 */
export async function uploadBundleZip(
  input: ZipUploadInput,
  opts: { mockMode?: boolean; now?: Date; env?: NodeJS.ProcessEnv } = {},
): Promise<ZipUploadResult> {
  const now = opts.now ?? new Date();
  const mock = opts.mockMode ?? isMockMode(opts.env ?? process.env);
  if (mock) {
    return {
      zipFileUrl: `mock://bundle/${input.bundleId}.zip`,
      expiresAt: new Date(now.getTime() + TWENTY_FOUR_HOURS_MS),
      isMock: true,
    };
  }
  return generateRealZip(input, now, opts.env ?? process.env);
}
