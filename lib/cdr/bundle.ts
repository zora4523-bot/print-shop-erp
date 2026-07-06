import { db } from '../db';
import { uploadBundleZip, type ZipUploadResult } from './zip';
import { parseStrictYmd } from '../auth/schemas';

// CDR 汇总下载（SPEC §3.5 / §3.6）业务层。
//
// 流程：
//   1. listEligibleOrders(filter) — 给 foreman UI 看&ldquo;可勾选&rdquo;的工单
//      （在日期窗口内 + 至少有 1 个 CDR 设计文件）
//   2. createBundle({ orderIds, dateRange }) —
//        a. 收集所有勾选工单的 CDR OrderItemDesign
//        b. 调 zip.uploadBundleZip 拿 zipFileUrl + expiresAt
//        c. 写 DesignBundle 行
//        d. 返回 bundle.id（UI 跳到 detail 页 / 复制下载链接）
//   3. getBundle(id) — 下载路由用，校验 expiresAt + 增 downloadCount
//
// 时间窗口：dateRangeFrom / To 走 `Order.submittedAt`（业务上&ldquo;某天提交
// 的工单的 CDR&rdquo;最直观；和 dashboard 业绩归属保持同一口径——DECISIONS
// 2026-04-26）。

export class CdrBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CdrBundleError';
  }
}

const SHANGHAI_OFFSET_HOURS = 8;

function shanghaiDayBoundary(ymd: string): { start: Date; end: Date } {
  const utcMidnight = parseStrictYmd(ymd);
  if (!utcMidnight) {
    throw new CdrBundleError(`非法 YYYY-MM-DD：${ymd}`);
  }
  const start = new Date(
    utcMidnight.getTime() - SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000,
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// ─── 1. 列出可选工单 ───

export type EligibleOrderRow = {
  id: string;
  orderNo: string;
  customerRef: string | null;
  submittedAt: Date;
  cdrCount: number;
};

/**
 * 在 [from, to] 半开区间内提交的工单，且至少有 1 个 fileType=CDR 的
 * OrderItemDesign。orderBy submittedAt asc。
 *
 * UI 端：foreman 输入起 / 止日期，看到候选清单 + 各工单 CDR 数；勾
 * 选后 createBundle。
 */
export async function listEligibleOrders(input: {
  // YYYY-MM-DD（Asia/Shanghai 日历日，闭区间）。to 不传则 = from。
  from: string;
  to?: string;
}): Promise<EligibleOrderRow[]> {
  const { start } = shanghaiDayBoundary(input.from);
  const { end } = shanghaiDayBoundary(input.to ?? input.from);
  const rows = await db.order.findMany({
    where: {
      submittedAt: { gte: start, lt: end },
      // 至少有 1 个 CDR design
      items: { some: { designs: { some: { fileType: 'CDR' } } } },
    },
    select: {
      id: true,
      orderNo: true,
      customerRef: true,
      submittedAt: true,
      items: {
        select: {
          designs: {
            where: { fileType: 'CDR' },
            select: { id: true },
          },
        },
      },
    },
    orderBy: { submittedAt: 'asc' },
  });

  return rows.map((r) => ({
    id: r.id,
    orderNo: r.orderNo,
    customerRef: r.customerRef,
    submittedAt: r.submittedAt as Date,
    cdrCount: r.items.reduce((acc, it) => acc + it.designs.length, 0),
  }));
}

// ─── 2. 创建 bundle ───

export type CreateBundleInput = {
  // 必传：foreman 在 UI 勾选的工单 ID 子集
  orderIds: readonly string[];
  // 写到 DesignBundle.dateRangeFrom / To 字段（审计 + UI 显示），
  // 与 listEligibleOrders 的 input 保持一致即可。
  from: string;
  to?: string;
  // 拼绝对 URL 用 base（含 protocol，无尾斜线，如
  // 'https://erp.example.com'）。action 层从请求 headers 推导
  // （host + x-forwarded-proto），保证 split-origin 部署也得到对的
  // 公网域。
  // / ngrok) 拿到 localhost:3000 死链。
  baseUrl: string;
};

export type CreateBundleResult = {
  bundleId: string;
  zipFileUrl: string;
  // 绝对 URL，外协方可直接复制粘贴（base 来自 APP_PUBLIC_URL / AUTH_URL）
  downloadUrl: string;
  // /api/cdr/bundles/<id>——E2E / 同源测试用
  relativePath: string;
  expiresAt: Date;
  fileCount: number;
  isMock: boolean;
};

export async function createBundle(
  input: CreateBundleInput,
  actor: { id: string },
): Promise<CreateBundleResult> {
  if (input.orderIds.length === 0) {
    throw new CdrBundleError('至少勾选 1 个工单');
  }

  const { start } = shanghaiDayBoundary(input.from);
  const { end } = shanghaiDayBoundary(input.to ?? input.from);

  // 先收集所有 CDR design：仅取勾选的工单 + 在日期窗口内（防 owner
  // 传入的 orderIds 不在窗口里——比如旧 bundle 的 orderId 被复用作
  // payload 攻击）。
  const orders = await db.order.findMany({
    where: {
      id: { in: [...input.orderIds] },
      submittedAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      orderNo: true,
      items: {
        select: {
          designs: {
            where: { fileType: 'CDR' },
            select: {
              id: true,
              fileName: true,
              fileUrl: true,
            },
          },
        },
      },
    },
  });
  if (orders.length !== input.orderIds.length) {
    throw new CdrBundleError(
      `${input.orderIds.length - orders.length} 个工单不在所选日期窗口内或不存在`,
    );
  }

  const files: Array<{ id: string; orderNo: string; fileName: string; fileUrl: string }> = [];
  const designIds: string[] = [];
  for (const o of orders) {
    for (const item of o.items) {
      for (const d of item.designs) {
        files.push({
          id: d.id,
          orderNo: o.orderNo,
          fileName: d.fileName,
          fileUrl: d.fileUrl,
        });
        designIds.push(d.id);
      }
    }
  }
  if (files.length === 0) {
    throw new CdrBundleError('所选工单没有 CDR 设计文件');
  }

  // 先创建 DesignBundle 拿 id（即作为 token / object key 的一部分）。
  // zipFileUrl + downloadUrl + expiresAt 占位，下面 ZIP 步骤后 update。
  // 不在 tx 内 wait OSS，因为 OSS 调用是 minutes-level 的网络 IO，挂
  // 在 PG tx 里会 hold lock。
  const bundle = await db.designBundle.create({
    data: {
      createdById: actor.id,
      dateRangeFrom: start,
      dateRangeTo: end,
      orderIds: orders.map((o) => o.id),
      designIds,
      zipFileUrl: '',
      downloadUrl: '',
      // tentative expiry——下面 OSS 步骤会覆写。
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  let upload: ZipUploadResult;
  try {
    upload = await uploadBundleZip({
      files: files.map(({ orderNo, fileName, fileUrl }) => ({
        orderNo,
        fileName,
        fileUrl,
      })),
      bundleId: bundle.id,
    });
  } catch (err) {
    // OSS 打包失败（凭证 403 / 网络 / 对象缺失）：删掉占位 row 让 UI
    // 看到清晰失败状态，并把原因翻译成 CdrBundleError 给表单展示。
    await db.designBundle.delete({ where: { id: bundle.id } }).catch(() => {});
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[cdr] bundle zip upload failed:', detail);
    throw new CdrBundleError(`CDR 打包上传失败：${detail}`);
  }

  // 下载链接走我们自己的 token-route，不直接暴露 OSS 对象 URL：
  // 下载时再签 OSS GET URL（TODO: STS 接进来后实现 ossSignGetUrl）。
  // 当前 mock-mode 下，route 看到 `mock://...` 直接 503。
  //
  // **绝对 URL**——SPEC §3.5 是&ldquo;复制链接发外协&rdquo;的语义，外协在
  // WeChat / 邮件里点链接得直接打开。
  // baseUrl 由 action 层从 request headers 推导（host + x-forwarded-
  // proto / x-forwarded-host），保证 dev (127.0.0.1 / ngrok) 也得对的
  // 域而不是回到 localhost。
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const downloadUrl = `${baseUrl}/api/cdr/bundles/${bundle.id}`;

  await db.designBundle.update({
    where: { id: bundle.id },
    data: {
      zipFileUrl: upload.zipFileUrl,
      downloadUrl,
      expiresAt: upload.expiresAt,
    },
  });

  return {
    bundleId: bundle.id,
    zipFileUrl: upload.zipFileUrl,
    downloadUrl,
    relativePath: `/api/cdr/bundles/${bundle.id}`,
    expiresAt: upload.expiresAt,
    fileCount: files.length,
    isMock: upload.isMock,
  };
}

// ─── 3. 下载查询（route 用）───

export type BundleAccessRow = {
  id: string;
  zipFileUrl: string;
  expiresAt: Date;
  downloadCount: number;
};

export class BundleNotFoundError extends Error {
  constructor() {
    super('链接已失效或不存在');
    this.name = 'BundleNotFoundError';
  }
}
export class BundleExpiredError extends Error {
  constructor(public readonly expiredAt: Date) {
    super('链接已过期');
    this.name = 'BundleExpiredError';
  }
}

/**
 * 路由用：按 id 取 bundle，校验未过期，自增 downloadCount。
 * 返 zipFileUrl（mock-mode 是 `mock://...`，prod 是 OSS object key 或
 * 已 sign 的 GET URL，由 STS 接入决定）。
 */
export async function consumeBundle(
  bundleId: string,
  now: Date = new Date(),
): Promise<BundleAccessRow> {
  const row = await db.designBundle.findUnique({
    where: { id: bundleId },
    select: {
      id: true,
      zipFileUrl: true,
      expiresAt: true,
      downloadCount: true,
    },
  });
  if (!row) throw new BundleNotFoundError();
  if (row.expiresAt.getTime() < now.getTime()) {
    throw new BundleExpiredError(row.expiresAt);
  }
  // 增 1（best-effort，失败不阻下载）
  await db.designBundle
    .update({
      where: { id: bundleId },
      data: { downloadCount: { increment: 1 } },
    })
    .catch(() => {});
  return row;
}

// ─── 4. 列表（owner / foreman 复看） ───

export type RecentBundleRow = {
  id: string;
  dateRangeFrom: Date;
  dateRangeTo: Date;
  orderCount: number;
  fileCount: number;
  zipFileUrl: string;
  downloadUrl: string;
  expiresAt: Date;
  downloadCount: number;
  createdById: string;
  createdByName: string;
  createdAt: Date;
};

export async function listRecentBundles(
  limit = 20,
): Promise<RecentBundleRow[]> {
  const rows = await db.designBundle.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      dateRangeFrom: true,
      dateRangeTo: true,
      orderIds: true,
      designIds: true,
      zipFileUrl: true,
      downloadUrl: true,
      expiresAt: true,
      downloadCount: true,
      createdById: true,
      createdAt: true,
      createdBy: { select: { displayName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    dateRangeFrom: r.dateRangeFrom,
    dateRangeTo: r.dateRangeTo,
    orderCount: r.orderIds.length,
    fileCount: r.designIds.length,
    zipFileUrl: r.zipFileUrl,
    downloadUrl: r.downloadUrl,
    expiresAt: r.expiresAt,
    downloadCount: r.downloadCount,
    createdById: r.createdById,
    createdByName: r.createdBy.displayName,
    createdAt: r.createdAt,
  }));
}
