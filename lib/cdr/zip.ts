import { OssNotWiredError } from '../oss/sign';
import { readOssConfig } from '../oss/config';

// CDR 汇总下载（SPEC §3.6）的"打包到 OSS"步骤。
//
// MVP 状态：OSS STS SDK 还没接入（`signViaSts` 是个抛 OssNotWiredError
// 的桩；P1 待办）。这里跟 notify 的 dev mock-mode 同款：
//
//   - prod / OSS 已配齐（readOssConfig.configured=true）+ 默认非 mock
//     → 真打包：流式从 OSS 拉每个 CDR 文件 → archiver 边收边压 →
//        流式 PUT 到 OSS → 生成预签 GET URL（24h 有效）。**当前未实现**，
//        STS SDK 接进来后替换 generateRealZip 一处。
//   - dev / OSS 未配齐 OR `CDR_BUNDLE_MOCK_MODE=true`
//     → 写&ldquo;mock 占位&rdquo;到 DesignBundle.zipFileUrl（`mock://bundle/<id>.zip`），
//        让 UI / E2E 流程跑通；下载路由 `/api/cdr/bundles/<id>` 在 mock
//        路径返 503（OSS 未配齐时本来就不该真下载）。
//
// 一致性：和 NOTIFICATION_MOCK_MODE / OssNotWiredError 同款&ldquo;契约清晰
// 但 MVP 期不强制配 OSS 也能跑&rdquo;。

export type ZipUploadResult = {
  // OSS 对象 key 或 mock 占位 URL；写到 DesignBundle.zipFileUrl
  zipFileUrl: string;
  // 24 小时后过期；写到 DesignBundle.expiresAt
  expiresAt: Date;
  // mock-mode=true 时 UI 显示&ldquo;OSS 未配置&rdquo;告警条
  isMock: boolean;
};

export type ZipUploadInput = {
  // 要打的 CDR 文件 OSS URL 列表（从 OrderItemDesign.fileUrl 取）
  files: ReadonlyArray<{ orderNo: string; fileName: string; fileUrl: string }>;
  // 用于内部命名 ZIP（YYYYMMDD-HHmm-<bundleId 前 6 字符>.zip）
  bundleId: string;
};

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function isMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CDR_BUNDLE_MOCK_MODE === 'true') return true;
  if (env.CDR_BUNDLE_MOCK_MODE === 'false') return false;
  // OSS 未配齐 → 强制 mock；不能真打包
  const cfg = readOssConfig(env);
  return !cfg.configured;
}

/**
 * 上传 ZIP 到 OSS 并返回 24h 预签 URL。**当前 throw OssNotWiredError**——
 * STS SDK 接入后实现：
 *   1. archiver.create('zip')
 *   2. 对 input.files 每个：fetch(fileUrl) → archiver.append(stream)
 *   3. archiver.pipe(ossPutStream(`bundles/<bundleId>.zip`))
 *   4. ossSignGetUrl(`bundles/<bundleId>.zip`, 24h) → expiresAt
 *
 * 形参签名预留 ZipUploadInput，让 STS 接入时不用动 caller。
 */
function generateRealZip(input: ZipUploadInput): never {
  void input;
  throw new OssNotWiredError();
}

/**
 * 唯一公开入口：dispatch 到 mock 或真实路径。
 * mock 路径不真发 HTTP，立刻返 mock 占位；真路径走 generateRealZip
 * （未实现 → throw）。
 */
export async function uploadBundleZip(
  input: ZipUploadInput,
  opts: { mockMode?: boolean; now?: Date } = {},
): Promise<ZipUploadResult> {
  const now = opts.now ?? new Date();
  const mock = opts.mockMode ?? isMockMode();
  if (mock) {
    return {
      zipFileUrl: `mock://bundle/${input.bundleId}.zip`,
      expiresAt: new Date(now.getTime() + TWENTY_FOUR_HOURS_MS),
      isMock: true,
    };
  }
  // Real path — currently throws OssNotWiredError. Caller (createBundle)
  // catches and surfaces to UI.
  generateRealZip(input);
}
