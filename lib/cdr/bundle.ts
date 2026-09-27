import { db } from '../db';
import { createBundleAccessToken, decryptBundleDownloadUrl, encryptBundleDownloadUrl, hashBundleAccessToken, isBundleAccessToken } from './access-token';
import { uploadBundleZip, type ZipUploadResult } from './zip';
import { getSetting } from '../settings';
import { parseStrictYmd } from '../auth/schemas';
import {
  BackgroundJobQueue,
  DesignBundleStatus,
} from '../../generated/prisma/enums';
import { enqueueBackgroundJob } from '../background-jobs/repository';
import { BACKGROUND_JOB_TYPES } from '../background-jobs/types';
import {
  ORDER_EXTERNAL_SALES_SELECT,
  orderExternalSalesName,
} from '../order/external-sales-name';

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
  // 候选表按“工单名称 · 外部销售”指认工单（客户名称/简称已于 2026-09-27 停用）。
  customName: string | null;
  externalSalesName: string | null;
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
      customName: true,
      ...ORDER_EXTERNAL_SALES_SELECT,
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
    customName: r.customName,
    externalSalesName: orderExternalSalesName(r),
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
  // /api/cdr/bundles/<access-token>——E2E / 同源测试用
  relativePath: string;
  expiresAt: Date;
  fileCount: number;
  isMock: boolean;
};

export type EnqueueBundleResult = {
  bundleId: string;
  jobId: string;
  downloadUrl: string;
  relativePath: string;
  fileCount: number;
};

type CollectedBundle = {
  start: Date;
  end: Date;
  orderIds: string[];
  designIds: string[];
  files: Array<{
    id: string;
    orderNo: string;
    fileName: string;
    fileUrl: string;
  }>;
};

async function collectBundle(input: CreateBundleInput): Promise<CollectedBundle> {
  if (input.orderIds.length === 0) {
    throw new CdrBundleError('至少勾选 1 个工单');
  }

  const { start } = shanghaiDayBoundary(input.from);
  const { end } = shanghaiDayBoundary(input.to ?? input.from);
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
            select: { id: true, fileName: true, fileUrl: true },
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

  const files: CollectedBundle['files'] = [];
  const designIds: string[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      for (const design of item.designs) {
        files.push({ ...design, orderNo: order.orderNo });
        designIds.push(design.id);
      }
    }
  }
  if (files.length === 0) {
    throw new CdrBundleError('所选工单没有 CDR 设计文件');
  }

  return {
    start,
    end,
    orderIds: orders.map((order) => order.id),
    designIds,
    files,
  };
}

export async function createBundle(
  input: CreateBundleInput,
  actor: { id: string },
): Promise<CreateBundleResult> {
  const collected = await collectBundle(input);
  const accessToken = createBundleAccessToken();
  const { hours: expireHours } = await getSetting('cdr_link_expire_hours');

  // 先创建 DesignBundle 拿对象 key 所需 id；公开凭证为独立随机 token。
  // zipFileUrl + downloadUrl + expiresAt 占位，下面 ZIP 步骤后 update。
  // 不在 tx 内 wait OSS，因为 OSS 调用是 minutes-level 的网络 IO，挂
  // 在 PG tx 里会 hold lock。
  const bundle = await db.designBundle.create({
    data: {
      createdById: actor.id,
      dateRangeFrom: collected.start,
      dateRangeTo: collected.end,
      orderIds: collected.orderIds,
      designIds: collected.designIds,
      zipFileUrl: '',
      zipObjectKey: null,
      downloadUrl: '',
      accessTokenHash: hashBundleAccessToken(accessToken),
      // tentative expiry——下面 OSS 步骤会覆写。用同一个阈值，免得打包
      // 失败留下的占位行带着一个和配置无关的过期时间。
      expiresAt: new Date(Date.now() + expireHours * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  let upload: ZipUploadResult;
  try {
    upload = await uploadBundleZip(
      {
        files: collected.files.map(({ orderNo, fileName, fileUrl }) => ({
          orderNo,
          fileName,
          fileUrl,
        })),
        bundleId: bundle.id,
      },
      { expireHours },
    );
  } catch (err) {
    // OSS 打包失败（凭证 403 / 网络 / 对象缺失）：删掉占位 row 让 UI
    // 看到清晰失败状态，并把原因翻译成 CdrBundleError 给表单展示。
    await db.designBundle.delete({ where: { id: bundle.id } }).catch(() => {});
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[cdr] bundle zip upload failed:', detail);
    throw new CdrBundleError(`CDR 打包上传失败：${detail}`);
  }

  // 公开链接仅返回给已授权管理员，数据库只存 token hash。
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const downloadUrl = `${baseUrl}/api/cdr/bundles/${accessToken}`;

  await db.designBundle.update({
    where: { id: bundle.id },
    data: {
      zipFileUrl: upload.zipFileUrl,
      zipObjectKey: upload.zipObjectKey ?? null,
      // Keep the recipient URL encrypted for durable admin history; raw token
      // is never persisted in plaintext.
      downloadUrl: '',
      downloadUrlCiphertext: encryptBundleDownloadUrl(downloadUrl),
      expiresAt: upload.expiresAt,
      status: DesignBundleStatus.READY,
      lastErrorCode: null,
    },
  });

  return {
    bundleId: bundle.id,
    zipFileUrl: upload.zipFileUrl,
    downloadUrl,
    relativePath: `/api/cdr/bundles/${accessToken}`,
    expiresAt: upload.expiresAt,
    fileCount: collected.files.length,
    isMock: upload.isMock,
  };
}

/**
 * Production path: validate and persist the bundle + HEAVY job in one DB
 * transaction. No OSS download or compression happens in the web process.
 */
export async function enqueueBundle(
  input: CreateBundleInput,
  actor: { id: string },
): Promise<EnqueueBundleResult> {
  const collected = await collectBundle(input);
  const accessToken = createBundleAccessToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const baseUrl = input.baseUrl.replace(/\/+$/, '');

  return db.$transaction(async (tx) => {
    const bundle = await tx.designBundle.create({
      data: {
        createdById: actor.id,
        dateRangeFrom: collected.start,
        dateRangeTo: collected.end,
        orderIds: collected.orderIds,
        designIds: collected.designIds,
        zipFileUrl: '',
        zipObjectKey: null,
        downloadUrl: '',
        accessTokenHash: hashBundleAccessToken(accessToken),
        downloadUrlCiphertext: encryptBundleDownloadUrl(`${baseUrl}/api/cdr/bundles/${accessToken}`),
        expiresAt,
        status: DesignBundleStatus.PENDING,
      },
      select: { id: true },
    });
    const downloadUrl = `${baseUrl}/api/cdr/bundles/${accessToken}`;
    const { job } = await enqueueBackgroundJob(
      {
        type: BACKGROUND_JOB_TYPES.CDR_BUNDLE,
        queue: BackgroundJobQueue.HEAVY,
        dedupeKey: `cdr-bundle:${bundle.id}`,
        payload: { bundleId: bundle.id },
        priority: 100,
        maxAttempts: 3,
      },
      tx,
    );
    await tx.designBundle.update({
      where: { id: bundle.id },
      data: { backgroundJobId: job.id },
    });
    return {
      bundleId: bundle.id,
      jobId: job.id,
      downloadUrl,
      relativePath: `/api/cdr/bundles/${accessToken}`,
      fileCount: collected.files.length,
    };
  });
}

export async function processQueuedBundle(
  bundleId: string,
  context: {
    signal?: AbortSignal;
    assertLease?: () => Promise<void>;
  } = {},
): Promise<{
  bundleId: string;
  fileCount: number;
  isMock: boolean;
}> {
  const bundle = await db.designBundle.findUnique({
    where: { id: bundleId },
    select: { id: true, designIds: true, downloadUrl: true, status: true },
  });
  if (!bundle) throw new CdrBundleError('CDR 下载包不存在');
  if (bundle.status === DesignBundleStatus.FAILED) throw new CdrBundleError('下载包已失败，请重新生成');
  if (bundle.status === DesignBundleStatus.READY) {
    return { bundleId, fileCount: bundle.designIds.length, isMock: false };
  }

  const designs = await db.orderItemDesign.findMany({
    where: { id: { in: bundle.designIds } },
    select: {
      id: true,
      fileName: true,
      fileUrl: true,
      orderItem: { select: { order: { select: { orderNo: true } } } },
    },
  });
  if (designs.length !== bundle.designIds.length) {
    throw new CdrBundleError('CDR 设计文件已变更，请重新生成下载包');
  }

  const { hours: expireHours } = await getSetting('cdr_link_expire_hours');
  await context.assertLease?.();
  context.signal?.throwIfAborted();
  const upload = await uploadBundleZip(
    {
      bundleId,
      files: designs.map((design) => ({
        orderNo: design.orderItem.order.orderNo,
        fileName: design.fileName,
        fileUrl: design.fileUrl,
      })),
    },
    {
      expireHours,
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.assertLease ? { assertLease: context.assertLease } : {}),
    },
  );
  await context.assertLease?.();
  context.signal?.throwIfAborted();
  const changed = await db.designBundle.updateMany({
    where: { id: bundleId, status: DesignBundleStatus.PENDING },
    data: {
      zipFileUrl: upload.zipFileUrl,
      zipObjectKey: upload.zipObjectKey ?? null,
      expiresAt: upload.expiresAt,
      status: DesignBundleStatus.READY,
      lastErrorCode: null,
    },
  });
  if (changed.count !== 1) throw new CdrBundleError('下载包状态已变更');
  return { bundleId, fileCount: designs.length, isMock: upload.isMock };
}

// ─── 3. 下载查询（route 用）───

export type BundleAccessRow = {
  id: string;
  zipFileUrl: string;
  zipObjectKey: string | null;
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
export class BundleNotReadyError extends Error {
  constructor(public readonly status: DesignBundleStatus) {
    super('下载包尚未就绪');
    this.name = 'BundleNotReadyError';
  }
}

/**
 * 按 token hash 读取并校验停用、有效期及状态，返回受控对象 key。
 */
export async function consumeBundle(
  accessToken: string,
  now: Date = new Date(),
): Promise<BundleAccessRow> {
  if (!isBundleAccessToken(accessToken)) throw new BundleNotFoundError();
  const row = await db.designBundle.findUnique({
    where: { accessTokenHash: hashBundleAccessToken(accessToken) },
    select: {
      id: true,
      zipFileUrl: true,
      zipObjectKey: true,
      expiresAt: true,
      downloadCount: true,
      status: true,
      revokedAt: true,
    },
  });
  if (!row || row.revokedAt) throw new BundleNotFoundError();
  if (row.status !== DesignBundleStatus.READY) {
    throw new BundleNotReadyError(row.status);
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    throw new BundleExpiredError(row.expiresAt);
  }
  // 增 1（best-effort，失败不阻下载）
  await db.designBundle
    .update({
      where: { id: row.id },
      data: { downloadCount: { increment: 1 } },
    })
    .catch(() => {});
  return row;
}

/** Immediately invalidate an issued CDR bearer token while retaining its audit row. */
export async function revokeBundleAccess(bundleId: string): Promise<void> {
  const result = await db.designBundle.updateMany({
    where: {
      id: bundleId,
      accessTokenHash: { not: null },
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  if (result.count !== 1) {
    throw new CdrBundleError('下载链接不存在或已经撤销');
  }
}

// ─── 4. 列表（owner / foreman 复看） ───

export type RecentBundleRow = {
  id: string;
  dateRangeFrom: Date;
  dateRangeTo: Date;
  /** 保留原始选择，供过期下载包按完全相同条件重新生成。 */
  orderIds: string[];
  orderCount: number;
  fileCount: number;
  zipFileUrl: string;
  downloadUrl: string;
  expiresAt: Date;
  /** 已撤销的链接不再回显明文，页面改为「已撤销」+ 重新生成。 */
  revokedAt: Date | null;
  downloadCount: number;
  createdById: string;
  createdByName: string;
  createdAt: Date;
  status: DesignBundleStatus;
  lastErrorCode: string | null;
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
      downloadUrlCiphertext: true,
      expiresAt: true,
      revokedAt: true,
      downloadCount: true,
      createdById: true,
      createdAt: true,
      status: true,
      lastErrorCode: true,
      createdBy: { select: { displayName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    dateRangeFrom: r.dateRangeFrom,
    dateRangeTo: r.dateRangeTo,
    orderIds: [...r.orderIds],
    orderCount: r.orderIds.length,
    fileCount: r.designIds.length,
    zipFileUrl: r.zipFileUrl,
    downloadUrl:
      r.downloadUrlCiphertext && !r.revokedAt
        ? (decryptBundleDownloadUrl(r.downloadUrlCiphertext) ?? '')
        : '',
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    downloadCount: r.downloadCount,
    createdById: r.createdById,
    createdByName: r.createdBy.displayName,
    createdAt: r.createdAt,
    status: r.status,
    lastErrorCode: r.lastErrorCode,
  }));
}
