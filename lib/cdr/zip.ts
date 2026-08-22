import { PassThrough } from 'node:stream';
import { ZipArchive } from 'archiver';
import { readOssConfig } from '../oss/config';
import { createOssClient } from '../oss/client';
import { SETTING_DEFINITIONS } from '../settings/definitions';

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

const MS_PER_HOUR = 60 * 60 * 1000;
const SECONDS_PER_HOUR = 60 * 60;

// 兜底时长。这个模块是 OSS 适配层，**不读库**——阈值由调用方
// （lib/cdr/bundle.ts，本来就在事务里）从 Setting 取好传进来，
// 这样 zip.ts 的测试不需要 DATABASE_URL。默认值和 lib/settings 的
// fallback 是同一个来源，避免又出现两份对不上的常量。
const DEFAULT_EXPIRE_HOURS = SETTING_DEFINITIONS.cdr_link_expire_hours.fallback.hours;

export function isMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CDR_BUNDLE_MOCK_MODE === 'true') return true;
  if (env.CDR_BUNDLE_MOCK_MODE === 'false') return false;
  // OSS 未配齐 → 强制 mock；不能真打包。malformed OSS_ENDPOINT 会让
  // readOssConfig throw——视同未配齐，页面（/foreman/cdr 渲染时调本
  // 函数）降级到 mock 告警条而不是 500。
  let cfg: ReturnType<typeof readOssConfig>;
  try {
    cfg = readOssConfig(env);
  } catch {
    return true;
  }
  if (!cfg.configured) return true;
  // 留空 + 已配齐：非生产默认 mock——dev/E2E 会自动触发打包流程，
  // 不能因为 .env 里有真实凭证就往生产 bucket 写测试包
  // （同 NOTIFICATION_MOCK_MODE 的 dev 默认语义）。
  return env.NODE_ENV !== 'production';
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
  nowFn: () => Date,
  env: NodeJS.ProcessEnv,
  expireHours: number,
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

  // endpoint 用 config 已校验的值（支持 OSS_ENDPOINT 覆盖：VPC 内网、
  // 自定义端口等），不能只凭 region 拼默认公网域名。
  const client = createOssClient(cfg);

  const zipObjectKey = `bundles/${input.bundleId}.zip`;
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const out = new PassThrough();
  // destroy(err) 会在流上 emit 'error'；没有监听器时 Node 视为
  // uncaught exception 直接崩进程。错误本体已经通过 putSettled /
  // archiveError 传递，这里只需吞掉事件。
  out.on('error', () => {});
  let archiveError: Error | null = null;
  archive.on('error', (err) => {
    archiveError = err;
    // 让下游 putStream 立刻失败，而不是挂在半截 ZIP 上等超时。
    out.destroy(err);
  });
  archive.pipe(out);

  // putStream 与 append 并发：archiver 边压边写，整包不落内存/磁盘。
  // 立刻折叠成 settled 对象（永不 reject）：PUT 在 append 循环期间早期
  // 失败（403 / DNS / socket）时不会成为 unhandled rejection，同时
  // destroy 输出流释放 archiver 背压，让 finalize 尽快失败而不是挂死。
  const putSettled: Promise<
    { ok: true } | { ok: false; err: Error }
  > = client.putStream(zipObjectKey, out).then(
    () => ({ ok: true as const }),
    (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      out.destroy(e);
      return { ok: false as const, err: e };
    },
  );

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
  } catch (err) {
    // 半途失败：终止 archiver；putSettled 永不 reject，等它收尾即可。
    archive.abort();
    out.destroy();
    await putSettled;
    throw err;
  }
  const putResult = await putSettled;
  if (!putResult.ok) throw putResult.err;
  if (archiveError) throw archiveError;

  // 预签 GET URL。**上传完成后**取当前时间——URL 的寿命从签发起算，
  // DB 的 expiresAt 必须与之对齐；用打包开始时间会让慢任务白白缩短
  // 外协的下载窗口。两处都用同一个 expireHours，不能各写各的。
  const signedAt = nowFn();
  const zipFileUrl = client.signatureUrl(zipObjectKey, {
    expires: expireHours * SECONDS_PER_HOUR,
    method: 'GET',
  });

  return {
    zipFileUrl,
    expiresAt: new Date(signedAt.getTime() + expireHours * MS_PER_HOUR),
    isMock: false,
  };
}

/**
 * 唯一公开入口：dispatch 到 mock 或真实路径。
 * mock 路径不真发 HTTP，立刻返 mock 占位。
 */
export async function uploadBundleZip(
  input: ZipUploadInput,
  opts: {
    mockMode?: boolean;
    now?: Date;
    env?: NodeJS.ProcessEnv;
    // 由调用方从 Setting 的 cdr_link_expire_hours 读好传入；省略走兜底。
    expireHours?: number;
  } = {},
): Promise<ZipUploadResult> {
  const expireHours = opts.expireHours ?? DEFAULT_EXPIRE_HOURS;
  const mock = opts.mockMode ?? isMockMode(opts.env ?? process.env);
  if (mock) {
    const now = opts.now ?? new Date();
    return {
      zipFileUrl: `mock://bundle/${input.bundleId}.zip`,
      // mock 路径也用同一个时长，否则本地/测试环境算出来的过期时间和
      // 生产不一致，过期相关的逻辑就没法在 mock 下验证。
      expiresAt: new Date(now.getTime() + expireHours * MS_PER_HOUR),
      isMock: true,
    };
  }
  // 真实路径的时间在预签 URL 时才取（对齐 URL 寿命）；opts.now 仅供
  // 测试注入确定性时钟。
  return generateRealZip(
    input,
    () => opts.now ?? new Date(),
    opts.env ?? process.env,
    expireHours,
  );
}
