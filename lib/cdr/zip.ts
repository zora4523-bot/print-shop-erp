import { createHash } from 'node:crypto';
import { finished, PassThrough, type Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { readOssConfig, type OssConfig } from '../oss/config';
import { createOssClient } from '../oss/client';
import { stripUnsafeFileNameChars } from '../oss/design-file-name';
import { objectKeyFromReadUrl } from '../oss/object-key';
import { SETTING_DEFINITIONS } from '../settings/definitions';

// CDR 汇总下载（SPEC §3.5）的"打包到 OSS"步骤。
//
//   - prod / OSS 已配齐（readOssConfig.configured=true）+ 默认非 mock
//     → 真打包：流式从 OSS 拉每个 CDR 文件 → archiver 边收边压 →
//        流式 PUT 到 `bundles/<bundleId>.zip` → 保存对象 key，下载时签发 60 秒 GET URL。
//   - dev / OSS 未配齐 OR `CDR_BUNDLE_MOCK_MODE=true`
//     → 写"mock 占位"到 DesignBundle.zipFileUrl（`mock://bundle/<id>.zip`），
//        让 UI / E2E 流程跑通；下载路由 `/api/cdr/bundles/<access-token>` 在 mock
//        路径返 503。
//
// 凭证模型（DECISIONS 2026-07-05）：服务端打包用 RAM 子账号**长期凭证**
// 直连，不走 STS。下载凭证由应用 token 控制，OSS 只在路由校验通过后
// 签发 60 秒 GET URL，因此不再把长期签名 URL 写入数据库。

export type ZipUploadResult = {
  // OSS 预签 URL（真实路径）或 mock 占位；历史字段名保留。
  zipFileUrl: string;
  zipObjectKey: string | null;
  // 过期时间写到 DesignBundle.expiresAt；真实下载 URL 在 token 校验后临时签发
  expiresAt: Date;
  // mock-mode=true 时 UI 显示"OSS 未配置"告警条
  isMock: boolean;
};

export type ZipUploadInput = {
  // 要打的 CDR 文件 OSS URL 列表（从 OrderItemDesign.fileUrl 取）
  files: ReadonlyArray<{ orderNo: string; fileName: string; fileUrl: string; folders?: readonly string[] }>;
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

// 兜底时长。这个模块是 OSS 适配层，**不读库**——阈值由调用方
// （lib/cdr/bundle.ts，本来就在事务里）从 Setting 取好传进来，
// 这样 zip.ts 的测试不需要 DATABASE_URL。默认值和 lib/settings 的
// fallback 是同一个来源，避免又出现两份对不上的常量。
const DEFAULT_EXPIRE_HOURS = SETTING_DEFINITIONS.cdr_link_expire_hours.fallback.hours;

export function isMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CDR_BUNDLE_MOCK_MODE === 'true') return true;
  if (env.CDR_BUNDLE_MOCK_MODE === 'false') return false;
  // 缺少或错误的配置沿用页面降级提示；显式模式仍由调用方决定。
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

// 从存储的 fileUrl 反推 OSS 对象 key。fileUrl 登记时以
// `${publicBaseUrl}/${objectKey}` 生成；bucket 私有，直接 fetch 该
// URL 是 403，必须用凭证走 getStream(objectKey)。按读取域剥掉
// OSS_PUBLIC_BASE_URL 的路径前缀；读取域都不匹配（例如登记后换过 CDN
// 域名的历史数据）时沿用整段 pathname。
function deriveObjectKey(fileUrl: string, cfg: OssConfig): string {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    throw new CdrZipError(`设计文件 URL 非法：${fileUrl}`);
  }
  const key =
    objectKeyFromReadUrl(url, cfg) ??
    decodeURIComponent(url.pathname).replace(/^\/+/, '');
  // 只允许 design/ 前缀——防止历史数据/脏数据把打包器指向任意对象。
  if (!key.startsWith('design/')) {
    throw new CdrZipError(`设计文件不在 design/ 前缀内：${key}`);
  }
  return key;
}

/** 校验设计文件地址，使用打包器的 object key 规则。 */
export function isBundleSourceAddressValid(fileUrl: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const url = new URL(fileUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const config = readOssConfig(env);
    if (config.configured) { deriveObjectKey(fileUrl, config.cfg); return true; }
    return decodeURIComponent(url.pathname).replace(/^\/+/, '').startsWith('design/');
  } catch { return false; }
}

// 目录和文件名分别限制长度。
export function safeArchiveFolder(value: string, maxBytes = 50): string {
  let cleaned = stripUnsafeFileNameChars(value.replace(/[/\\<>:"|?*]/g, '_'))
    .replace(/^[. ]+|[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) cleaned = `_${cleaned}`;
  if (Buffer.byteLength(cleaned, 'utf8') > maxBytes) {
    const suffix = createHash('sha256').update(cleaned).digest('hex').slice(0, 8);
    const chars = Array.from(cleaned);
    while (Buffer.byteLength(chars.join(''), 'utf8') > maxBytes - 10) chars.pop();
    cleaned = `${chars.join('')}_${suffix}`;
  }
  return cleaned || '未命名';
}

function safeEntryFileName(fileName: string): string {
  const lastSegment = fileName.split(/[/\\]/).pop() ?? '';
  const cleaned = stripUnsafeFileNameChars(lastSegment).trim();
  const named = cleaned === '' || cleaned === '.' || cleaned === '..' ? 'design' : cleaned;
  return /\.cdr$/i.test(named) ? named : `${named}.cdr`;
}

// ali-oss 默认 timeout=60s，且 urllib 的响应计时器从建连起算、收到响应才取消：
// 流式 PUT 的响应要等整包传完，默认值等于"压缩 + 上传必须在 60 秒内完成"。
// 这里按 [建连超时, 响应超时] 显式放宽；urllib 会同步把 socket 空闲超时抬到
// 响应超时 + 0.5s，所以响应超时同时也是连接停滞多久算失败。
const OSS_CONNECT_TIMEOUT_MS = 60 * 1000;
// PUT：覆盖整段压缩 + 上传。
const BUNDLE_PUT_TIMEOUT: [number, number] = [OSS_CONNECT_TIMEOUT_MS, 2 * MS_PER_HOUR];
// GET：流式响应收到响应头即取消响应计时；之后只剩 socket 空闲超时，源流
// 只会因 PUT 背压短暂暂停，停滞 10 分钟即视为失败。
const DESIGN_GET_TIMEOUT: [number, number] = [OSS_CONNECT_TIMEOUT_MS, 10 * 60 * 1000];

// ali-oss 的类型把 timeout 声明成 number（且 mime/meta/callback 必填），
// 运行时实际透传给 urllib，支持 [connect, response] 二元组。
type OssStreamClient = {
  getStream(name: string, options: { timeout: [number, number] }): Promise<{ stream?: unknown }>;
  putStream(name: string, stream: Readable, options: { timeout: [number, number] }): Promise<unknown>;
};

type BundleUpload = {
  // 等一个外部异步步骤（如 GET 响应头）；等待期间流水线失败立即 reject，
  // 迟到的结果交给 discard 释放（ali-oss 的请求不接受 AbortSignal）。
  guard<T>(pending: Promise<T>, discard: (late: T) => void): Promise<T>;
  // 追加一个条目，等 archiver 把它处理完再返回；任一环节失败立即 reject。
  append(source: Readable, name: string): Promise<void>;
  // finalize 与 PUT 都完成才 resolve；任一失败立即 reject。
  finish(): Promise<void>;
  // 终止整条流水线（archiver、当前源流、上传），之后所有等待都以 err reject。
  abort(err: Error): void;
};

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

// archiver 的 finalize() 只在内部 zip 模块 end/error 时 settle：输出被销毁或
// 源流中途关闭时它会被背压永远卡住（abort() 也解不开）。所以不能只 await
// finalize，而要让每一次等待都和"任一环节失败"赛跑。
function startBundleUpload(client: OssStreamClient, zipObjectKey: string): BundleUpload {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const out = new PassThrough();
  let failure: Error | null = null;
  let current: Readable | null = null;
  let rejectFailed: (err: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    rejectFailed = reject;
  });
  // 成功路径不会 await failed；先挂空处理，避免 unhandled rejection。
  failed.catch(() => {});

  const abort = (err: Error) => {
    if (failure) return;
    failure = err;
    rejectFailed(err);
    archive.abort();
    current?.destroy();
    // destroy 让 ali-oss 的 pump 拆掉请求，PUT 随之失败，不会留下半截对象。
    out.destroy(err);
  };

  // destroy(err) 会在 out 上 emit 'error'；错误本体已经走 failed 传递。
  out.on('error', () => {});
  archive.on('error', (err) => abort(err));
  archive.pipe(out);
  // PUT 与 append 并发：archiver 边压边写，整包不落内存/磁盘。
  const put = client
    .putStream(zipObjectKey, out, { timeout: BUNDLE_PUT_TIMEOUT })
    .then(
      () => undefined,
      (err: unknown) => abort(toError(err)),
    );

  const guard = <T>(pending: Promise<T>, discard: (late: T) => void): Promise<T> => {
    pending.then(
      (value) => {
        if (failure) discard(value);
      },
      () => {},
    );
    return Promise.race([failed, pending]);
  };

  const append = (source: Readable, name: string): Promise<void> => {
    if (failure) {
      source.destroy();
      return Promise.reject(failure);
    }
    current = source;
    const processed = new Promise<void>((resolve) => {
      archive.once('entry', () => resolve());
    });
    // archiver 只监听它自己套的 PassThrough：源流报错或没读完就 close
    // 时它永远等不到 end，必须由这里把整条流水线判失败。
    finished(source, { writable: false }, (err) => {
      if (err) {
        abort(new CdrZipError(`设计文件读取中断：${name}（${err.message}）`));
      }
    });
    archive.append(source, { name });
    return Promise.race([failed, processed]);
  };

  const finish = async (): Promise<void> => {
    if (failure) throw failure;
    current = null;
    await Promise.race([failed, Promise.all([archive.finalize(), put])]);
    // put 的失败分支只调 abort 不抛错，这里再确认一次。
    if (failure) throw failure;
  };

  return { guard, append, finish, abort };
}

async function generateRealZip(
  input: ZipUploadInput,
  nowFn: () => Date,
  env: NodeJS.ProcessEnv,
  expireHours: number,
  context: {
    signal?: AbortSignal;
    assertLease?: () => Promise<void>;
  },
): Promise<ZipUploadResult> {
  await context.assertLease?.();
  context.signal?.throwIfAborted();
  const cfgResult = readOssConfig(env);
  if (!cfgResult.configured) {
    throw new CdrZipError('CDR 打包暂不可用，请联系管理员');
  }
  const cfg = cfgResult.cfg;

  // 先做纯校验（全部 key 可反推），任何一个不合法都在发起网络 IO 前失败。
  const entries = input.files.map((f) => ({
    ...f,
    objectKey: deriveObjectKey(f.fileUrl, cfg),
  }));

  // endpoint 用 config 已校验的值（支持 OSS_ENDPOINT 覆盖：VPC 内网、
  // 自定义端口等），不能只凭 region 拼默认公网域名。
  const client = createOssClient(cfg) as unknown as OssStreamClient;

  const zipObjectKey = `bundles/${input.bundleId}.zip`;
  const upload = startBundleUpload(client, zipObjectKey);
  const abortUpload = () => {
    upload.abort(
      context.signal?.reason instanceof Error
        ? context.signal.reason
        : new Error('CDR bundle lease lost'),
    );
  };
  context.signal?.addEventListener('abort', abortUpload, { once: true });

  try {
    // ZIP 内按工单号分目录；同名文件追加序号，避免静默覆盖。
    const usedNames = new Set<string>();
    for (const entry of entries) {
      await context.assertLease?.();
      context.signal?.throwIfAborted();
      // 逐个打开：上一个条目处理完才发起下一个 GET，排队中的响应不会因
      // 长时间空闲被 agentkeepalive 销毁。
      const result = await upload.guard(
        client.getStream(entry.objectKey, { timeout: DESIGN_GET_TIMEOUT }),
        (late) => (late.stream as Readable | undefined)?.destroy(),
      );
      const safeName = safeArchiveFolder(safeEntryFileName(entry.fileName), 240);
      const fileName = /\.cdr$/i.test(safeName) ? safeName : `${safeName}.cdr`;
      const folder = (entry.folders ?? [entry.orderNo]).map((part) => safeArchiveFolder(part)).join('/');
      const baseName = `${folder}/${fileName}`;
      let name = baseName;
      let suffix = 2;
      while (usedNames.has(name.normalize('NFC').toLocaleLowerCase('en-US'))) name = `${folder}/(${suffix++}) ${fileName}`;
      usedNames.add(name.normalize('NFC').toLocaleLowerCase('en-US'));
      await upload.append(result.stream as Readable, name);
    }
    await upload.finish();
    await context.assertLease?.();
    context.signal?.throwIfAborted();

    // 有效期从打包完成时起算；不生成可绕过停用检查的长时 OSS 链接。
    const signedAt = nowFn();
    const zipFileUrl = zipObjectKey;

    return {
      zipFileUrl,
      zipObjectKey,
      expiresAt: new Date(signedAt.getTime() + expireHours * MS_PER_HOUR),
      isMock: false,
    };
  } catch (err) {
    // 半途失败：拆掉 archiver、源流与上传；重复 abort 是空操作。
    upload.abort(toError(err));
    throw err;
  } finally {
    context.signal?.removeEventListener('abort', abortUpload);
  }
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
    signal?: AbortSignal;
    assertLease?: () => Promise<void>;
  } = {},
): Promise<ZipUploadResult> {
  const expireHours = opts.expireHours ?? DEFAULT_EXPIRE_HOURS;
  const mock = opts.mockMode ?? isMockMode(opts.env ?? process.env);
  if (mock) {
    const now = opts.now ?? new Date();
    return {
      zipFileUrl: `mock://bundle/${input.bundleId}.zip`,
      zipObjectKey: null,
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
    {
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.assertLease ? { assertLease: opts.assertLease } : {}),
    },
  );
}
