import { foilColorLabel } from '@/lib/order/foil-colors';
import { paperDisplayLabel } from '@/lib/rules/paper-label';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import {
  BackgroundJobAttemptStatus,
  BackgroundJobQueue,
  BackgroundJobStatus,
  DesignFileType,
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderCostCategory,
  OrderExportStatus,
  OrderKind,
  OrderSettlementType,
  OutsourceStatus,
  Prisma,
  ReworkCause,
  Role,
  ShipmentStatus,
  TaskStatus,
} from '../../generated/prisma/client';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import {
  billStatusLabel,
  machineTypeLabel,
  productCategoryLabel,
  roleLabel,
  workerTypeLabel,
} from '../auth/role-labels';
import { BACKGROUND_JOB_TYPES } from '../background-jobs/types';
import { enqueueBackgroundJob } from '../background-jobs/repository';
import { db } from '../db';
import { writeXlsxFile, xlsxDecimal, type XlsxRow, type XlsxSheet } from '../export/xlsx';
import { formatDateShanghai, formatDateTimeShanghai } from '../format/dates';
import { actionLabel, formatOrderLogChanges, orderStatusZh } from './log-format';
import { ORDER_SETTLEMENT_LABELS } from './settlement';
import {
  buildOrderWhere,
  parseOrderListQuery,
  serializeOrderListQuery,
  type OrderListQuery,
} from './list-query';
import {
  adminOrderExportParamsFromQuery,
  isAdminOrderWorkspaceExportParams,
  parseAdminOrderWorkspaceQuery,
} from './admin-workspace-query';
import {
  cleanupUntrackedOrderExportArtifacts,
  deleteOrderExportArtifact,
  ensureOrderExportArtifactDir,
  openOrderExportArtifact,
  orderExportArtifactPath,
} from './export-artifact';

const EXPORT_SCHEMA_VERSION = 3;
const EXPORT_TTL_MS = 24 * 60 * 60 * 1_000;
const EXPORT_BATCH_SIZE = 500;
const EXPORT_CLEANUP_BATCH_SIZE = 100;
const EXPORT_CLEANUP_MAX_ROWS = 500;
export const ORDER_EXPORT_PARAMS_MAX_JSON_LENGTH = 10_000;
const REQUEST_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OrderExportScope = 'all' | 'filtered' | 'selected';
export type OrderExportParams = Record<string, string>;
export const ORDER_EXPORT_SELECTED_MAX = 5_000;

export type OrderExportSummary = {
  id: string;
  status: OrderExportStatus;
  scope: OrderExportScope;
  fileName: string;
  matchedOrderCount: number;
  byteSize: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  lastErrorCode: string | null;
};

type StoredExportFilter = {
  scope: OrderExportScope;
  params: OrderExportParams;
  filterHash: string;
};

type StoredExportFilterReceipt = Pick<StoredExportFilter, 'scope'>;

type MembershipKey = { id: string; orderNo: string };
type RowCounts = Record<string, number>;

export function orderExportParamsFromQuery(query: OrderListQuery): OrderExportParams {
  const serialized = serializeOrderListQuery({
    ...query,
    page: 1,
  });
  const ignored = new Set(['page', 'pageSize', 'sort', 'dir']);
  return Object.fromEntries(
    Object.entries(serialized)
      .filter(([key, value]) => !ignored.has(key) && value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)]),
  );
}

export async function requestOrderExport(input: {
  actor: AuditActor;
  requestKey: string;
  scope: OrderExportScope;
  params: OrderExportParams;
  selectedOrderIds?: readonly string[];
  durable: boolean;
  now?: Date;
}): Promise<OrderExportSummary> {
  if (!REQUEST_KEY_PATTERN.test(input.requestKey)) {
    throw new InvalidOrderExportRequestError('请求标识不合法');
  }
  if (input.actor.role !== Role.ADMIN) {
    throw new InvalidOrderExportRequestError('仅管理员可导出全部工单');
  }

  const stored = normalizeStoredFilter(input.scope, input.params);
  const selectedOrderIds =
    input.scope === 'selected'
      ? normalizeSelectedOrderIds(input.selectedOrderIds ?? [])
      : [];
  const existing = await db.orderExport.findUnique({
    where: { requestKey: input.requestKey },
  });
  if (existing) {
    const summary = ownedSummary(existing, input.actor.id);
    if (stored.scope === 'selected') {
      await assertSelectedExportReplay(
        existing.id,
        existing.filters,
        selectedOrderIds,
      );
    }
    return summary;
  }

  const now = input.now ?? new Date();
  const fileName = buildExportFileName(now, input.requestKey);
  try {
    const created = await db.$transaction(async (tx) => {
      const orderExport = await tx.orderExport.create({
        data: {
          requestKey: input.requestKey,
          createdById: input.actor.id,
          filters: stored as Prisma.InputJsonValue,
          snapshotAt: now,
          schemaVersion: EXPORT_SCHEMA_VERSION,
          fileName,
          expiresAt: new Date(now.getTime() + EXPORT_TTL_MS),
        },
      });

      if (stored.scope === 'selected') {
        const authorized = await tx.order.findMany({
          where: { id: { in: selectedOrderIds } },
          select: { id: true },
        });
        const authorizedIds = new Set(authorized.map((order) => order.id));
        if (
          authorizedIds.size !== selectedOrderIds.length ||
          selectedOrderIds.some((orderId) => !authorizedIds.has(orderId))
        ) {
          throw new InvalidOrderExportRequestError(
            '所选工单已变更或无权导出，请刷新后重试',
          );
        }
        await tx.orderExportSelection.createMany({
          data: selectedOrderIds.map((orderId, sequence) => ({
            exportId: orderExport.id,
            orderId,
            sequence,
          })),
        });
      }

      let backgroundJobId: string | null = null;
      if (input.durable) {
        const { job } = await enqueueBackgroundJob(
          {
            type: BACKGROUND_JOB_TYPES.ORDER_EXPORT,
            queue: BackgroundJobQueue.HEAVY,
            dedupeKey: `order-export:${orderExport.id}`,
            payload: { exportId: orderExport.id },
            priority: 90,
            maxAttempts: 3,
          },
          tx,
        );
        backgroundJobId = job.id;
        await tx.orderExport.update({
          where: { id: orderExport.id },
          data: { backgroundJobId },
        });
      }

      await writeAuditLogInTx(tx, {
        actor: input.actor,
        action: 'ORDER_EXPORT_REQUESTED',
        entityType: 'OrderExport',
        entityId: orderExport.id,
        after: {
          scope: stored.scope,
          ...(stored.scope === 'selected'
            ? { selectedOrderCount: selectedOrderIds.length }
            : {}),
          schemaVersion: EXPORT_SCHEMA_VERSION,
          backgroundJobId: backgroundJobId ? '[QUEUED]' : null,
        },
      });
      return { ...orderExport, backgroundJobId };
    });
    return ownedSummary(created, input.actor.id);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const duplicate = await db.orderExport.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (!duplicate) throw error;
    const summary = ownedSummary(duplicate, input.actor.id);
    if (stored.scope === 'selected') {
      await assertSelectedExportReplay(
        duplicate.id,
        duplicate.filters,
        selectedOrderIds,
      );
    }
    return summary;
  }
}

export async function processQueuedOrderExport(
  exportId: string,
  context: {
    signal?: AbortSignal;
    assertLease?: () => Promise<void>;
  } = {},
): Promise<Prisma.InputJsonValue> {
  const orderExport = await db.orderExport.findUnique({
    where: { id: exportId },
    include: {
      createdBy: {
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          isActive: true,
        },
      },
      selections: {
        orderBy: { sequence: 'asc' },
        select: {
          orderId: true,
          order: { select: { id: true, orderNo: true, createdAt: true } },
        },
      },
    },
  });
  if (!orderExport) throw new OrderExportNotFoundError();
  if (orderExport.status === OrderExportStatus.READY) {
    return exportResult(orderExport);
  }
  if (orderExport.status !== OrderExportStatus.PENDING) {
    throw new OrderExportNotPendingError(orderExport.status);
  }
  const startedAt = new Date();
  if (orderExport.expiresAt <= startedAt) {
    await transitionOrderExportToExpired(orderExport, startedAt);
    throw new OrderExportExpiredError();
  }
  if (!orderExport.createdBy.isActive || orderExport.createdBy.role !== Role.ADMIN) {
    throw new OrderExportActorInvalidError();
  }
  if (orderExport.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new OrderExportSchemaVersionError();
  }

  const stored = parseStoredFilter(orderExport.filters);
  const actor = { id: orderExport.createdById, role: Role.ADMIN } as const;
  let snapshotWhere: Prisma.OrderWhereInput | null = null;
  if (stored.scope !== 'selected') {
    let resultWhere: Prisma.OrderWhereInput;
    if (
      stored.scope === 'filtered' &&
      isAdminOrderWorkspaceExportParams(stored.params)
    ) {
      const parsed = parseAdminOrderWorkspaceQuery(stored.params);
      if (parsed.issues.length > 0) {
        throw new InvalidOrderExportStoredFilterError();
      }
      const { resolveAdminWorkspaceResultWhere } = await import(
        './admin-workspace-filters'
      );
      resultWhere = await resolveAdminWorkspaceResultWhere(
        actor,
        parsed.query,
        orderExport.snapshotAt,
      );
    } else {
      const { query, issues } = parseOrderListQuery(stored.params);
      if (issues.length > 0) throw new InvalidOrderExportStoredFilterError();
      resultWhere = buildOrderWhere(
        actor,
        stored.scope === 'all'
          ? parseOrderListQuery({}).query.filters
          : query.filters,
      );
    }
    snapshotWhere = {
      AND: [resultWhere, { createdAt: { lte: orderExport.snapshotAt } }],
    };
  }
  // A lease reclaim can briefly leave two workers finishing the same export.
  // Each attempt must own its file so the worker that loses the READY CAS can
  // delete only its own artifact, never the winner's published workbook.
  const artifactName = `${orderExport.id}-${randomUUID()}.xlsx`;
  const artifactPath = orderExportArtifactPath(artifactName);
  // Every retry gets a fresh manifest. A worker killed between open and
  // finally must not poison the next attempt with an EEXIST file.
  const membershipPath = `${artifactPath}.${randomUUID()}.orders`;
  const rowCounts: RowCounts = {};

  await context.assertLease?.();
  context.signal?.throwIfAborted();
  await ensureOrderExportArtifactDir();
  let matchedOrderCount = 0;
  try {
    const result = await db.$transaction(async (tx) => {
      if (stored.scope === 'selected') {
        const membership = orderExport.selections.map(({ order }) => order);
        if (
          membership.length === 0 ||
          membership.some((order) => order.createdAt > orderExport.snapshotAt)
        ) {
          throw new InvalidOrderExportStoredFilterError();
        }
        matchedOrderCount = await writeSelectedMembershipManifest(
          membershipPath,
          membership,
        );
      } else {
        matchedOrderCount = await writeMembershipManifest(
          membershipPath,
          snapshotWhere!,
          tx,
        );
      }
      const sheets = buildWorkbookSheets(membershipPath, rowCounts, tx);
      return writeXlsxFile({ filePath: artifactPath, sheets });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 10 * 60_000 });
    await context.assertLease?.();
    context.signal?.throwIfAborted();
    const actor: AuditActor = {
      id: orderExport.createdBy.id,
      username: orderExport.createdBy.username,
      displayName: orderExport.createdBy.displayName,
      role: orderExport.createdBy.role,
    };
    const completedAt = new Date();
    if (orderExport.expiresAt <= completedAt) {
      await transitionOrderExportToExpired(orderExport, completedAt);
      throw new OrderExportExpiredError();
    }
    const updated = await (async () => {
      try {
        return await db.$transaction(async (tx) => {
          const changed = await tx.orderExport.updateMany({
            where: {
              id: orderExport.id,
              status: OrderExportStatus.PENDING,
              expiresAt: { gt: completedAt },
            },
            data: {
              status: OrderExportStatus.READY,
              matchedOrderCount,
              rowCounts,
              artifactName,
              filters: storedFilterReceipt(stored) as Prisma.InputJsonValue,
              byteSize: BigInt(result.byteLength),
              expiresAt: new Date(completedAt.getTime() + EXPORT_TTL_MS),
              completedAt,
              lastErrorCode: null,
            },
          });
          if (changed.count !== 1) throw new OrderExportNotPendingError('CHANGED');
          await writeAuditLogInTx(tx, {
            actor,
            action: 'ORDER_EXPORT_READY',
            entityType: 'OrderExport',
            entityId: orderExport.id,
            after: {
              matchedOrderCount,
              rowCounts,
              byteSize: String(result.byteLength),
              schemaVersion: EXPORT_SCHEMA_VERSION,
            },
          });
          return tx.orderExport.findUniqueOrThrow({ where: { id: orderExport.id } });
        });
      } catch (publishError) {
        // The database may commit READY and then lose the response. Re-read the
        // authoritative row before deleting this attempt's file; otherwise an
        // ambiguous commit would leave a READY ledger pointing at a removed XLSX.
        const published = await db.orderExport.findUnique({
          where: { id: orderExport.id },
        });
        if (
          published?.status === OrderExportStatus.READY &&
          published.artifactName === artifactName
        ) {
          return published;
        }
        throw publishError;
      }
    })();
    // Cleanup is maintenance, not part of the completed export's durability
    // contract. A transient cleanup failure must not delete a READY artifact.
    await cleanupExpiredOrderExports().catch(() => undefined);
    return exportResult(updated);
  } catch (error) {
    await deleteOrderExportArtifact(artifactName);
    throw error;
  } finally {
    await unlink(membershipPath).catch(() => undefined);
  }
}

export async function processOrderExportInline(exportId: string): Promise<void> {
  try {
    await processQueuedOrderExport(exportId);
  } catch (error) {
    const pending = await db.orderExport.findUnique({ where: { id: exportId } });
    await db.orderExport.updateMany({
      where: { id: exportId, status: OrderExportStatus.PENDING },
      data: {
        status: OrderExportStatus.FAILED,
        lastErrorCode: orderExportErrorCode(error),
        ...(pending ? { filters: storedFilterReceiptFromValue(pending.filters) } : {}),
      },
    });
    throw error;
  }
}

export async function listRecentOrderExports(
  actorId: string,
  limit = 5,
): Promise<OrderExportSummary[]> {
  const now = new Date();
  const rows = await db.orderExport.findMany({
    where: { createdById: actorId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(20, Math.max(1, limit)),
  });
  return rows.map((row) => {
    const summary = ownedSummary(row, actorId);
    return summary.status === OrderExportStatus.READY && summary.expiresAt <= now
      ? { ...summary, status: OrderExportStatus.EXPIRED }
      : summary;
  });
}

export async function prepareOrderExportDownload(
  exportId: string,
  actor: AuditActor,
  now = new Date(),
) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(exportId) || actor.role !== Role.ADMIN) {
    throw new OrderExportNotFoundError();
  }
  const row = await db.orderExport.findUnique({ where: { id: exportId } });
  if (!row || row.createdById !== actor.id) throw new OrderExportNotFoundError();
  if (row.expiresAt <= now || row.status === OrderExportStatus.EXPIRED) {
    await db.orderExport.updateMany({
      where: { id: row.id, status: OrderExportStatus.READY },
      data: {
        status: OrderExportStatus.EXPIRED,
        filters: storedFilterReceiptFromValue(row.filters),
      },
    });
    if (row.artifactName) {
      await deleteOrderExportArtifact(row.artifactName);
      await clearDeletedOrderExportArtifact(row.id, row.artifactName);
    }
    throw new OrderExportNotFoundError();
  }
  if (row.status === OrderExportStatus.PENDING) {
    throw new OrderExportNotReadyError();
  }
  if (row.status === OrderExportStatus.FAILED) {
    throw new OrderExportFailedError();
  }
  if (row.status !== OrderExportStatus.READY || !row.artifactName) {
    throw new OrderExportFailedError();
  }

  let artifact: Awaited<ReturnType<typeof openOrderExportArtifact>>;
  try {
    artifact = await openOrderExportArtifact(row.artifactName);
  } catch {
    await db.orderExport.updateMany({
      where: { id: row.id, status: OrderExportStatus.READY },
      data: {
        status: OrderExportStatus.FAILED,
        lastErrorCode: 'OrderExportArtifactMissingError',
        filters: storedFilterReceiptFromValue(row.filters),
      },
    });
    throw new OrderExportFailedError();
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.orderExport.update({
        where: { id: row.id },
        data: { downloadCount: { increment: 1 } },
      });
      await writeAuditLogInTx(tx, {
        actor,
        action: 'ORDER_EXPORT_DOWNLOADED',
        entityType: 'OrderExport',
        entityId: row.id,
        after: {
          fileName: row.fileName,
          byteSize: String(artifact.byteLength),
          matchedOrderCount: row.matchedOrderCount,
        },
      });
    });
  } catch (error) {
    artifact.stream.destroy();
    throw error;
  }
  return {
    stream: artifact.stream,
    byteLength: artifact.byteLength,
    fileName: row.fileName,
  };
}

export async function cleanupExpiredOrderExports(now = new Date()): Promise<number> {
  let expiredCount = 0;
  let examinedCount = 0;
  while (examinedCount < EXPORT_CLEANUP_MAX_ROWS) {
    const take = Math.min(
      EXPORT_CLEANUP_BATCH_SIZE,
      EXPORT_CLEANUP_MAX_ROWS - examinedCount,
    );
    const expired = await findExpiredOrderExportBatch(now, take);
    if (expired.length === 0) break;
    examinedCount += expired.length;

    for (const row of expired) {
      if (row.status === OrderExportStatus.EXPIRED) {
        if (row.artifactName) {
          await deleteOrderExportArtifact(row.artifactName);
          await clearDeletedOrderExportArtifact(row.id, row.artifactName);
        }
        continue;
      }
      const transitioned = await transitionOrderExportToExpired(row, now);
      if (!transitioned) continue;
      expiredCount += 1;
      if (row.artifactName) {
        await deleteOrderExportArtifact(row.artifactName);
        await clearDeletedOrderExportArtifact(row.id, row.artifactName);
      }
    }
    if (expired.length < take) break;
  }

  const retained = await db.orderExport.findMany({
    where: {
      status: OrderExportStatus.READY,
      expiresAt: { gt: now },
      artifactName: { not: null },
    },
    select: { artifactName: true },
  });
  await cleanupUntrackedOrderExportArtifacts({
    keep: new Set(retained.flatMap((row) => (row.artifactName ? [row.artifactName] : []))),
    olderThan: new Date(now.getTime() - 2 * EXPORT_TTL_MS),
  });
  return expiredCount;
}

async function findExpiredOrderExportBatch(now: Date, take: number) {
  return db.orderExport.findMany({
    where: {
      OR: [
        {
          status: { in: [OrderExportStatus.READY, OrderExportStatus.PENDING] },
          expiresAt: { lte: now },
        },
        {
          status: OrderExportStatus.EXPIRED,
          artifactName: { not: null },
        },
      ],
    },
    select: {
      id: true,
      status: true,
      artifactName: true,
      filters: true,
      backgroundJobId: true,
      expiresAt: true,
    },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take,
  });
}

async function transitionOrderExportToExpired(
  row: {
    id: string;
    status: OrderExportStatus;
    filters: Prisma.JsonValue;
    backgroundJobId: string | null;
    expiresAt: Date;
  },
  now: Date,
): Promise<boolean> {
  if (
    row.status !== OrderExportStatus.PENDING &&
    row.status !== OrderExportStatus.READY
  ) {
    return false;
  }
  return db.$transaction(async (tx) => {
    const changed = await tx.orderExport.updateMany({
      where: {
        id: row.id,
        status: row.status,
        expiresAt: { lte: now },
      },
      data: {
        status: OrderExportStatus.EXPIRED,
        filters: storedFilterReceiptFromValue(row.filters),
        ...(row.status === OrderExportStatus.PENDING
          ? { lastErrorCode: 'OrderExportExpiredBeforeProcessing' }
          : {}),
      },
    });
    if (changed.count !== 1) return false;

    if (row.status === OrderExportStatus.PENDING && row.backgroundJobId) {
      await tx.backgroundJob.updateMany({
        where: {
          id: row.backgroundJobId,
          type: BACKGROUND_JOB_TYPES.ORDER_EXPORT,
          status: {
            in: [BackgroundJobStatus.PENDING, BackgroundJobStatus.RUNNING],
          },
        },
        data: {
          status: BackgroundJobStatus.CANCELLED,
          finishedAt: now,
          lockedBy: null,
          lockedAt: null,
          heartbeatAt: null,
          lastErrorCode: 'OrderExportExpired',
        },
      });
      await tx.backgroundJobAttempt.updateMany({
        where: {
          jobId: row.backgroundJobId,
          status: BackgroundJobAttemptStatus.RUNNING,
        },
        data: {
          status: BackgroundJobAttemptStatus.ABANDONED,
          errorCode: 'OrderExportExpired',
          finishedAt: now,
        },
      });
    }
    return true;
  });
}

async function clearDeletedOrderExportArtifact(
  exportId: string,
  artifactName: string,
): Promise<void> {
  await db.orderExport.updateMany({
    where: {
      id: exportId,
      status: OrderExportStatus.EXPIRED,
      artifactName,
    },
    data: { artifactName: null },
  });
}

function buildWorkbookSheets(membershipPath: string, rowCounts: RowCounts, tx: Prisma.TransactionClient): XlsxSheet[] {
  return [
    trackedSheet('工单', orderRows(membershipPath, tx), rowCounts, [18, 22, 12, 12, 12, 18, 12, 12, 12, 18, 18, 18, 18, 18, 18, 18, 18, 14, 12, 14, 18, 22, 20, 20, 20, 20, 20, 20]),
    trackedSheet('款式', itemRows(membershipPath, tx), rowCounts, [18, 8, 20, 16, 16, 14, 16, 14, 12, 24, 20, 10, 10, 14, 14, 14, 28, 20]),
    trackedSheet('包装组及组成', packagingGroupRows(membershipPath, tx), rowCounts),
    trackedSheet('制版明细', plateDetailRows(membershipPath, tx), rowCounts),
    trackedSheet('对客收费', customerChargeRows(membershipPath, tx), rowCounts),
    trackedSheet('价格修订', pricingRevisionRows(membershipPath, tx), rowCounts),
    trackedSheet('生产任务', taskRows(membershipPath, tx), rowCounts),
    trackedSheet('收货地址', shipmentRows(membershipPath, tx), rowCounts),
    trackedSheet('地址款式分配', shipmentLineRows(membershipPath, tx), rowCounts),
    trackedSheet('外协', outsourceRows(membershipPath, tx), rowCounts),
    trackedSheet('成本明细', costRows(membershipPath, tx), rowCounts),
    trackedSheet('修改申请', changeRequestRows(membershipPath, tx), rowCounts),
    trackedSheet('操作记录', logRows(membershipPath, tx), rowCounts),
    trackedSheet('设计文件', designRows(membershipPath, tx), rowCounts),
    trackedSheet('账单关联', billRows(membershipPath, tx), rowCounts),
  ];
}

function trackedSheet(
  name: string,
  source: AsyncIterable<XlsxRow>,
  rowCounts: RowCounts,
  columnWidths?: readonly number[],
): XlsxSheet {
  async function* rows(): AsyncGenerator<XlsxRow> {
    let count = 0;
    for await (const row of source) {
      if (count > 0) rowCounts[name] = (rowCounts[name] ?? 0) + 1;
      count += 1;
      yield row;
    }
    rowCounts[name] ??= 0;
  }
  return { name, rows: rows(), columnWidths };
}

async function* orderRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield [
    '工单号', '工单名称', '状态', '类型', '计费方式', '结算路径', '来源重做单', '重做原因',
    '重做说明', '需外协', '急单', '顺丰到付', '客户名称/简称', '主收件人', '收件电话',
    '主收货地址', '快递代码', '快递单号', '工单总额', '数据修订版本', '工单版本', '承诺交期', '包装要求',
    '工单备注', '提交人', '提交人角色', '代建人', '代建人角色', '提交时间', '排产时间', '完工时间', '发货时间',
    '结束时间', '创建时间', '更新时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    // 显式 select：只取本表头 yield 的列。别退回 include —— 那会连
    // searchPinyin / searchPinyinInitials / processingAmount 一起拖回来。
    const rows = await tx.order.findMany({
      where: { id: { in: keys.map((key) => key.id) } },
      select: {
        id: true,
        orderNo: true,
        customName: true,
        status: true,
        kind: true,
        billingMode: true,
        settlementType: true,
        reworkCause: true,
        reworkReason: true,
        requiresOutsource: true,
        isUrgent: true,
        isSfCollect: true,
        customerRef: true,
        receiverName: true,
        receiverPhone: true,
        receiverAddress: true,
        expressCode: true,
        trackingNo: true,
        totalAmount: true,
        revision: true,
        workOrderVersion: true,
        promisedDate: true,
        packageRequirement: true,
        remark: true,
        submitterRole: true,
        submittedAt: true,
        scheduledAt: true,
        completedAt: true,
        shippedAt: true,
        finishedAt: true,
        createdAt: true,
        updatedAt: true,
        submitter: { select: { displayName: true } },
        createdBy: { select: { displayName: true, role: true } },
        sourceOrder: { select: { orderNo: true } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const key of keys) {
      const row = byId.get(key.id);
      if (!row) continue;
      yield [
        row.orderNo,
        row.customName,
        orderStatusZh(row.status),
        ORDER_KIND_LABELS[row.kind],
        BILLING_MODE_LABELS[row.billingMode],
        ORDER_SETTLEMENT_LABELS[
          row.settlementType as OrderSettlementType
        ],
        row.sourceOrder?.orderNo,
        row.reworkCause ? REWORK_CAUSE_LABELS[row.reworkCause] : null,
        row.reworkReason,
        yesNo(row.requiresOutsource),
        yesNo(row.isUrgent),
        yesNo(row.isSfCollect),
        row.customerRef,
        row.receiverName,
        row.receiverPhone,
        row.receiverAddress,
        row.expressCode,
        row.trackingNo,
        decimal(row.totalAmount, 2),
        row.revision,
        row.workOrderVersion,
        date(row.promisedDate),
        row.packageRequirement,
        row.remark,
        row.submitter.displayName,
        roleLabel(row.submitterRole),
        row.createdBy.displayName,
        roleLabel(row.createdBy.role),
        dateTime(row.submittedAt),
        dateTime(row.scheduledAt),
        dateTime(row.completedAt),
        dateTime(row.shippedAt),
        dateTime(row.finishedAt),
        dateTime(row.createdAt),
        dateTime(row.updatedAt),
      ];
    }
  }
}

async function* itemRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield [
    '工单号', '款式序号', '款式名称', '产品编码', '产品名称', '产品分类', '规格',
    '纸张', '数量', '工艺', '烫金颜色', '双面', '双色', '成交单价', '一次性费用', '成交小计', '系统建议小计',
    '人工改价说明', '款式备注', '创建时间',
  ];
  const crafts = await tx.craft.findMany({ select: { id: true, name: true } });
  const craftNames = new Map(crafts.map((craft) => [craft.id, craft.name]));
  for await (const keys of membershipBatches(membershipPath)) {
    // pricingSnapshot 是每款一份的报价规则大 JSON，导出一列都不用。
    // 这里必须是 select 而不是 include，否则 15 万款式会把它整表拉回来。
    const rows = await tx.orderItem.findMany({
      where: { orderId: { in: keys.map((key) => key.id) } },
      select: {
        orderId: true,
        sequence: true,
        name: true,
        specification: true,
        paperType: true,
        quantity: true,
        crafts: true,
        foilColors: true,
        isDoubleSided: true,
        isDoubleColor: true,
        unitPrice: true,
        fixedFee: true,
        subtotal: true,
        suggestedSubtotal: true,
        priceOverrideReason: true,
        remark: true,
        createdAt: true,
        product: { select: { code: true, name: true, category: true } },
      },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    });
    const grouped = groupBy(rows, (row) => row.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.sequence,
          row.name,
          row.product?.code,
          row.product?.name,
          row.product ? productCategoryLabel(row.product.category) : null,
          row.specification,
          row.paperType ? paperDisplayLabel(row.paperType) : row.paperType,
          row.quantity,
          row.crafts.map((id) => craftNames.get(id) ?? '已删除工艺').join('、'),
          row.foilColors.map(foilColorLabel).join('、'),
          yesNo(row.isDoubleSided),
          yesNo(row.isDoubleColor),
          decimal(row.unitPrice, 4),
          row.fixedFee ? decimal(row.fixedFee, 2) : xlsxDecimal('0.00'),
          decimal(row.subtotal, 2),
          row.suggestedSubtotal ? decimal(row.suggestedSubtotal, 2) : null,
          row.priceOverrideReason,
          row.remark,
          dateTime(row.createdAt),
        ];
      }
    }
  }
}

async function* packagingGroupRows(
  membershipPath: string,
  tx: Prisma.TransactionClient,
): AsyncGenerator<XlsxRow> {
  yield [
    '工单号',
    '包装组序号',
    '包装组名称',
    '组模式',
    '实际包装数量',
    '每袋/盒单价',
    '小计',
    '每袋/盒各款组成',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    const rows = await tx.orderPackagingGroup.findMany({
      where: { orderId: { in: keys.map((key) => key.id) } },
      select: {
        orderId: true,
        sequence: true,
        name: true,
        mode: true,
        actualBagCount: true,
        unitPrice: true,
        subtotal: true,
        lines: {
          select: {
            unitsPerBag: true,
            orderItem: { select: { sequence: true, name: true } },
          },
          orderBy: [{ orderItem: { sequence: 'asc' } }, { id: 'asc' }],
        },
      },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    });
    const grouped = groupBy(rows, (row) => row.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.sequence,
          row.name,
          PACKAGING_MODE_LABELS[row.mode] ?? row.mode,
          row.actualBagCount,
          decimal(row.unitPrice, 4),
          decimal(row.subtotal, 2),
          row.lines
            .map(
              (line) =>
                `#${line.orderItem.sequence} ${line.orderItem.name} × ${line.unitsPerBag}`,
            )
            .join('；'),
        ];
      }
    }
  }
}

async function* plateDetailRows(
  membershipPath: string,
  tx: Prisma.TransactionClient,
): AsyncGenerator<XlsxRow> {
  yield [
    '工单号',
    '款式序号',
    '款式名称',
    '制版序号',
    '制版名称',
    '版组 ID',
    '规格',
    '数量',
    '单价',
    '金额',
    '状态',
    '备注',
    '记录人',
    '移除人',
    '移除时间',
    '创建时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    const rows = await tx.orderItemPlateDetail.findMany({
      where: {
        orderItem: { orderId: { in: keys.map((key) => key.id) } },
      },
      select: {
        sequence: true,
        name: true,
        plateGroupId: true,
        specification: true,
        quantity: true,
        unitPrice: true,
        amount: true,
        isActive: true,
        remark: true,
        removedAt: true,
        createdAt: true,
        createdBy: { select: { displayName: true } },
        removedBy: { select: { displayName: true } },
        orderItem: {
          select: { orderId: true, sequence: true, name: true },
        },
      },
      orderBy: [
        { orderItem: { sequence: 'asc' } },
        { sequence: 'asc' },
        { id: 'asc' },
      ],
    });
    const grouped = groupBy(rows, (row) => row.orderItem.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.orderItem.sequence,
          row.orderItem.name,
          row.sequence,
          row.name,
          row.plateGroupId,
          row.specification,
          row.quantity,
          decimal(row.unitPrice, 2),
          decimal(row.amount, 2),
          row.isActive ? '有效' : '已移除（保留历史）',
          row.remark,
          row.createdBy.displayName,
          row.removedBy?.displayName,
          dateTime(row.removedAt),
          dateTime(row.createdAt),
        ];
      }
    }
  }
}

async function* customerChargeRows(
  membershipPath: string,
  tx: Prisma.TransactionClient,
): AsyncGenerator<XlsxRow> {
  yield [
    '工单号',
    '收费类别',
    '收费类别编码',
    '业务键',
    '发货地址序号',
    '说明',
    '数量',
    '单位',
    '单价',
    '建议金额',
    '终价',
    '状态',
    '是否调整',
    '覆盖原因',
    '审批依据',
    '价目簿版本',
    '价目簿来源',
    '规则来源',
    '创建人',
    '创建时间',
    '终审人',
    '终审时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    const rows = await tx.orderCustomerCharge.findMany({
      where: { orderId: { in: keys.map((key) => key.id) } },
      select: {
        orderId: true,
        businessKey: true,
        status: true,
        description: true,
        quantity: true,
        unit: true,
        unitPrice: true,
        suggestedAmount: true,
        amount: true,
        isAdjustment: true,
        overrideReason: true,
        approvalReference: true,
        finalizedAt: true,
        createdAt: true,
        category: { select: { code: true, name: true } },
        shipment: { select: { sequence: true } },
        priceBook: {
          select: {
            code: true,
            name: true,
            version: true,
            currency: true,
            sourceName: true,
          },
        },
        sourceRule: {
          select: {
            code: true,
            name: true,
            sourceName: true,
            sourceSheet: true,
            sourceRange: true,
          },
        },
        createdBy: { select: { displayName: true } },
        finalizedBy: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const grouped = groupBy(rows, (row) => row.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.category.name,
          String(row.category.code),
          String(row.businessKey),
          row.shipment?.sequence,
          row.description,
          row.quantity ? decimal(row.quantity, 3) : null,
          row.unit,
          row.unitPrice ? decimal(row.unitPrice, 4) : null,
          row.suggestedAmount ? decimal(row.suggestedAmount, 2) : null,
          row.amount === null ? null : decimal(row.amount, 2),
          CUSTOMER_CHARGE_STATUS_LABELS[row.status] ?? row.status,
          yesNo(row.isAdjustment),
          row.overrideReason,
          row.approvalReference,
          row.priceBook
            ? `${row.priceBook.name}（${String(row.priceBook.code)} v${row.priceBook.version}，${row.priceBook.currency}）`
            : null,
          row.priceBook?.sourceName,
          formatCustomerChargeRuleSource(row.sourceRule),
          row.createdBy.displayName,
          dateTime(row.createdAt),
          row.finalizedBy?.displayName,
          dateTime(row.finalizedAt),
        ];
      }
    }
  }
}

async function* pricingRevisionRows(
  membershipPath: string,
  tx: Prisma.TransactionClient,
): AsyncGenerator<XlsxRow> {
  yield [
    '工单号',
    '修订号',
    '价格状态',
    '修订来源',
    '价格标识',
    '加工费',
    '入袋费',
    '工单总额',
    '规则版本摘要',
    '创建人',
    '创建时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    const rows = await tx.orderPricingRevision.findMany({
      where: { orderId: { in: keys.map((key) => key.id) } },
      select: {
        orderId: true,
        revision: true,
        status: true,
        source: true,
        snapshot: true,
        createdAt: true,
        createdBy: { select: { displayName: true } },
      },
      orderBy: [{ revision: 'asc' }, { id: 'asc' }],
    });
    const grouped = groupBy(rows, (row) => row.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        const summary = summarizePricingRevisionSnapshot(row.snapshot);
        yield [
          key.orderNo,
          row.revision,
          PRICING_STATUS_LABELS[row.status] ?? row.status,
          row.source,
          pricingRevisionKind(row.status, row.source),
          summary.processingAmount,
          summary.packagingAmount,
          summary.totalAmount,
          summary.ruleVersions,
          row.createdBy?.displayName,
          dateTime(row.createdAt),
        ];
      }
    }
  }
}

async function* taskRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield [
    '工单号', '款式序号', '款式名称', '工艺', '师傅', '师傅工种', '机型', '任务状态',
    '计划数量', '板数', '下数', '完成数量', '次品数', '重做数', '计件金额', '开始时间',
    '完成时间', '任务备注',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    // salaryRuleSnapshot 是完工时锁定的计件规则大 JSON，导出不用。
    // worker 只需要 displayName —— 工种列读的是 row.workerType 快照，不是账号当前 role。
    const rows = await tx.productionTask.findMany({
      where: { orderItem: { orderId: { in: keys.map((key) => key.id) } } },
      select: {
        workerType: true,
        machineType: true,
        status: true,
        plannedQty: true,
        boardCount: true,
        pressCount: true,
        completedQty: true,
        defectQty: true,
        reworkQty: true,
        pieceworkAmount: true,
        startedAt: true,
        completedAt: true,
        remark: true,
        orderItem: { select: { orderId: true, sequence: true, name: true } },
        craft: { select: { name: true } },
        worker: { select: { displayName: true } },
      },
      orderBy: { id: 'asc' },
    });
    const grouped = groupBy(rows, (row) => row.orderItem.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.orderItem.sequence,
          row.orderItem.name,
          row.craft.name,
          row.worker?.displayName,
          row.workerType ? workerTypeLabel(row.workerType) : null,
          row.machineType ? machineTypeLabel(row.machineType) : null,
          TASK_STATUS_LABELS[row.status],
          row.plannedQty,
          row.boardCount,
          row.pressCount,
          row.completedQty,
          row.defectQty,
          row.reworkQty,
          decimal(row.pieceworkAmount, 2),
          dateTime(row.startedAt),
          dateTime(row.completedAt),
          row.remark,
        ];
      }
    }
  }
}

async function* shipmentRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield [
    '工单号', '地址序号', '收件人', '收件电话', '收货地址', '快递代码', '快递单号',
    '重量(kg)', '发货状态', '发货时间', '创建时间', '更新时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    const rows = await tx.orderShipment.findMany({
      where: { orderId: { in: keys.map((key) => key.id) } },
      select: {
        orderId: true,
        sequence: true,
        receiverName: true,
        receiverPhone: true,
        receiverAddress: true,
        expressCode: true,
        trackingNo: true,
        weightKg: true,
        status: true,
        shippedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    });
    const grouped = groupBy(rows, (row) => row.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.sequence,
          row.receiverName,
          row.receiverPhone,
          row.receiverAddress,
          row.expressCode,
          row.trackingNo,
          row.weightKg ? decimal(row.weightKg, 3) : null,
          SHIPMENT_STATUS_LABELS[row.status],
          dateTime(row.shippedAt),
          dateTime(row.createdAt),
          dateTime(row.updatedAt),
        ];
      }
    }
  }
}

async function* shipmentLineRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield ['工单号', '地址序号', '款式序号', '款式名称', '分配数量'];
  for await (const keys of membershipBatches(membershipPath)) {
    const rows = await tx.orderShipmentLine.findMany({
      where: { shipment: { orderId: { in: keys.map((key) => key.id) } } },
      select: {
        quantity: true,
        shipment: { select: { orderId: true, sequence: true } },
        orderItem: { select: { sequence: true, name: true } },
      },
      orderBy: { id: 'asc' },
    });
    const grouped = groupBy(rows, (row) => row.shipment.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.shipment.sequence,
          row.orderItem.sequence,
          row.orderItem.name,
          row.quantity,
        ];
      }
    }
  }
}

async function* outsourceRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield [
    '工单号', '供应商', '供应商联系方式', '工艺说明', '特殊要求', '关联款式',
    '总数量', '预计日期', '实际日期', '外协金额', '状态', '备注', '创建人', '创建时间',
    '更新时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    const orderIds = keys.map((key) => key.id);
    const [rows, items] = await Promise.all([
      tx.outsourceOrder.findMany({
        where: { orderId: { in: orderIds } },
        select: {
          orderId: true,
          supplierName: true,
          supplierContact: true,
          craftDescription: true,
          specialRequirement: true,
          orderItemIds: true,
          totalQty: true,
          expectedDate: true,
          actualDate: true,
          amount: true,
          status: true,
          remark: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { displayName: true } },
        },
        orderBy: { id: 'asc' },
      }),
      tx.orderItem.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true, sequence: true, name: true },
      }),
    ]);
    const itemLabels = new Map(
      items.map((item) => [item.id, `#${item.sequence} ${item.name}`]),
    );
    const grouped = groupBy(rows, (row) => row.orderId ?? '');
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.supplierName,
          row.supplierContact,
          row.craftDescription,
          row.specialRequirement,
          row.orderItemIds.map((id) => itemLabels.get(id) ?? '已删除款式').join('、'),
          row.totalQty,
          date(row.expectedDate),
          date(row.actualDate),
          row.amount ? decimal(row.amount, 2) : null,
          OUTSOURCE_STATUS_LABELS[row.status],
          row.remark,
          row.createdBy?.displayName,
          dateTime(row.createdAt),
          dateTime(row.updatedAt),
        ];
      }
    }
  }
}

async function* costRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield [
    '工单号', '成本类别', '说明', '数量', '单位', '单价', '金额', '来源类型', '备注',
    '录入人', '创建时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    const rows = await tx.orderCostEntry.findMany({
      where: { orderId: { in: keys.map((key) => key.id) } },
      select: {
        orderId: true,
        category: true,
        description: true,
        quantity: true,
        unit: true,
        unitPrice: true,
        amount: true,
        sourceType: true,
        remark: true,
        createdAt: true,
        createdBy: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const grouped = groupBy(rows, (row) => row.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          ORDER_COST_LABELS[row.category],
          row.description,
          row.quantity ? decimal(row.quantity, 3) : null,
          row.unit,
          row.unitPrice ? decimal(row.unitPrice, 4) : null,
          decimal(row.amount, 2),
          row.sourceType,
          row.remark,
          row.createdBy.displayName,
          dateTime(row.createdAt),
        ];
      }
    }
  }
}

async function* changeRequestRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield [
    '工单号', '基准版本', '申请状态', '申请原因', '申请人', '申请时间', '审核人',
    '审核意见', '审核时间', '更新时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    // beforeSnapshot 里存的是整单 items（每个 item 又各带一份 pricingSnapshot），
    // proposedChanges 同理。工作表只出审批元数据，两个 JSON 都不能取。
    const rows = await tx.orderChangeRequest.findMany({
      where: { orderId: { in: keys.map((key) => key.id) } },
      select: {
        orderId: true,
        baseRevision: true,
        status: true,
        reason: true,
        reviewRemark: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        requester: { select: { displayName: true } },
        reviewedBy: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const grouped = groupBy(rows, (row) => row.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.baseRevision,
          CHANGE_REQUEST_STATUS_LABELS[row.status],
          row.reason,
          row.requester.displayName,
          dateTime(row.createdAt),
          row.reviewedBy?.displayName,
          row.reviewRemark,
          dateTime(row.reviewedAt),
          dateTime(row.updatedAt),
        ];
      }
    }
  }
}

async function* logRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield [
    '工单号', '操作', '变更字段', '变更前', '变更后', '操作人', '备注', '操作时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    const rows = await tx.orderLog.findMany({
      where: { orderId: { in: keys.map((key) => key.id) } },
      select: {
        orderId: true,
        action: true,
        // changedFields 是本表唯一真正要用的 JSON —— 白名单过滤在
        // exportableOrderLogFields 里做，不能顺手删掉。
        changedFields: true,
        remark: true,
        createdAt: true,
        operator: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const grouped = groupBy(rows, (row) => row.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        const changes = formatOrderLogChanges(
          exportableOrderLogFields(row.changedFields),
        );
        if (changes.length === 0) {
          yield [
            key.orderNo,
            actionLabel(row.action),
            null,
            null,
            null,
            row.operator.displayName,
            row.remark,
            dateTime(row.createdAt),
          ];
          continue;
        }
        for (const change of changes) {
          yield [
            key.orderNo,
            actionLabel(row.action),
            change.label,
            change.before,
            change.after,
            row.operator.displayName,
            row.remark,
            dateTime(row.createdAt),
          ];
        }
      }
    }
  }
}

async function* designRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield [
    '工单号', '款式序号', '款式名称', '文件类型', '文件名', '文件大小(字节)', '上传时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    const rows = await tx.orderItemDesign.findMany({
      where: { orderItem: { orderId: { in: keys.map((key) => key.id) } } },
      select: {
        fileType: true,
        fileName: true,
        fileSize: true,
        uploadedAt: true,
        orderItem: { select: { orderId: true, sequence: true, name: true } },
      },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
    });
    const grouped = groupBy(rows, (row) => row.orderItem.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.orderItem.sequence,
          row.orderItem.name,
          DESIGN_FILE_TYPE_LABELS[row.fileType],
          row.fileName,
          row.fileSize.toString(),
          dateTime(row.uploadedAt),
        ];
      }
    }
  }
}

async function* billRows(membershipPath: string, tx: Prisma.TransactionClient): AsyncGenerator<XlsxRow> {
  yield [
    '工单号', '账单期间', '账单销售', '账单状态', '本工单入账金额', '发单时间',
    '结清时间', '关联时间',
  ];
  for await (const keys of membershipBatches(membershipPath)) {
    const rows = await tx.billItem.findMany({
      where: { orderId: { in: keys.map((key) => key.id) } },
      select: {
        orderId: true,
        orderAmount: true,
        createdAt: true,
        bill: {
          select: {
            period: true,
            status: true,
            issuedAt: true,
            paidAt: true,
            salesUser: { select: { displayName: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const grouped = groupBy(rows, (row) => row.orderId);
    for (const key of keys) {
      for (const row of grouped.get(key.id) ?? []) {
        yield [
          key.orderNo,
          row.bill.period,
          row.bill.salesUser.displayName,
          billStatusLabel(row.bill.status),
          decimal(row.orderAmount, 2),
          dateTime(row.bill.issuedAt),
          dateTime(row.bill.paidAt),
          dateTime(row.createdAt),
        ];
      }
    }
  }
}

async function writeMembershipManifest(
  filePath: string,
  where: Prisma.OrderWhereInput,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  try {
    await once(output, 'open');
    let cursor: string | undefined;
    let count = 0;
    while (true) {
      const rows = await tx.order.findMany({
        where,
        select: { id: true, orderNo: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        if (!output.write(`${JSON.stringify(row)}\n`)) await once(output, 'drain');
        count += 1;
      }
      cursor = rows.at(-1)?.id;
      if (rows.length < EXPORT_BATCH_SIZE) break;
    }
    const finished = once(output, 'finish');
    output.end();
    await finished;
    return count;
  } catch (error) {
    output.destroy();
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
}

async function writeSelectedMembershipManifest(
  filePath: string,
  membership: readonly MembershipKey[],
): Promise<number> {
  const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  try {
    await once(output, 'open');
    for (const row of membership) {
      if (!output.write(`${JSON.stringify(row)}\n`)) {
        await once(output, 'drain');
      }
    }
    const finished = once(output, 'finish');
    output.end();
    await finished;
    return membership.length;
  } catch (error) {
    output.destroy();
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
}

async function* membershipBatches(filePath: string): AsyncGenerator<MembershipKey[]> {
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let batch: MembershipKey[] = [];
  for await (const line of lines) {
    if (!line) continue;
    const parsed = JSON.parse(line) as unknown;
    if (!isMembershipKey(parsed)) throw new InvalidOrderExportManifestError();
    batch.push(parsed);
    if (batch.length === EXPORT_BATCH_SIZE) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}

function normalizeStoredFilter(
  scope: OrderExportScope,
  params: OrderExportParams,
): StoredExportFilter {
  if (scope !== 'all' && scope !== 'filtered' && scope !== 'selected') {
    throw new InvalidOrderExportRequestError('导出范围不合法');
  }
  if (scope === 'all' || scope === 'selected') {
    const params: OrderExportParams = {};
    return { scope, params, filterHash: hashExportParams(params) };
  }
  const normalized = normalizeParams(params);
  if (isAdminOrderWorkspaceExportParams(normalized)) {
    const parsed = parseAdminOrderWorkspaceQuery(normalized);
    if (parsed.issues.length > 0) {
      throw new InvalidOrderExportRequestError(parsed.issues.join('；'));
    }
    const exportParams = adminOrderExportParamsFromQuery(parsed.query);
    return {
      scope,
      params: exportParams,
      filterHash: hashExportParams(exportParams),
    };
  }
  const parsed = parseOrderListQuery(normalized);
  if (parsed.issues.length > 0) {
    throw new InvalidOrderExportRequestError(parsed.issues.join('；'));
  }
  const exportParams = orderExportParamsFromQuery(parsed.query);
  return { scope, params: exportParams, filterHash: hashExportParams(exportParams) };
}

function parseStoredFilter(value: Prisma.JsonValue): StoredExportFilter {
  if (!isRecord(value)) throw new InvalidOrderExportStoredFilterError();
  const scope = value.scope;
  const params = value.params;
  if (
    (scope !== 'all' && scope !== 'filtered' && scope !== 'selected') ||
    !isRecord(params)
  ) {
    throw new InvalidOrderExportStoredFilterError();
  }
  try {
    const normalized = normalizeStoredFilter(scope, normalizeParams(params));
    // filterHash was added before the first production rollout. Accepting a
    // missing value keeps fixtures/forward compatibility safe, while a stored
    // value that disagrees with the canonical params is corrupt and must fail.
    if (value.filterHash !== undefined && value.filterHash !== normalized.filterHash) {
      throw new InvalidOrderExportStoredFilterError();
    }
    return normalized;
  } catch {
    throw new InvalidOrderExportStoredFilterError();
  }
}

function storedFilterReceipt(stored: StoredExportFilter): StoredExportFilterReceipt {
  return { scope: stored.scope };
}

function storedFilterReceiptFromValue(
  value: Prisma.JsonValue,
): Prisma.InputJsonValue {
  return { scope: safeStoredScope(value) };
}

function exportableOrderLogFields(value: Prisma.JsonValue): Prisma.JsonObject {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([field]) => ORDER_LOG_EXPORT_FIELDS.has(field)),
  ) as Prisma.JsonObject;
}

function normalizeParams(value: Record<string, unknown>): OrderExportParams {
  const entries = Object.entries(value);
  if (
    entries.length > EXPORT_PARAM_KEYS.size ||
    JSON.stringify(value).length > ORDER_EXPORT_PARAMS_MAX_JSON_LENGTH
  ) {
    throw new InvalidOrderExportRequestError('筛选条件过多');
  }
  const result: OrderExportParams = {};
  for (const [key, raw] of entries) {
    if (
      !EXPORT_PARAM_KEYS.has(key) ||
      typeof raw !== 'string' ||
      raw.length > ORDER_EXPORT_PARAMS_MAX_JSON_LENGTH
    ) {
      throw new InvalidOrderExportRequestError('筛选条件不合法');
    }
    result[key] = raw;
  }
  return result;
}

function ownedSummary(
  row: {
    id: string;
    createdById: string;
    filters: Prisma.JsonValue;
    status: OrderExportStatus;
    fileName: string;
    matchedOrderCount: number;
    byteSize: bigint | null;
    expiresAt: Date;
    completedAt: Date | null;
    createdAt: Date;
    lastErrorCode: string | null;
  },
  actorId: string,
): OrderExportSummary {
  if (row.createdById !== actorId) throw new OrderExportNotFoundError();
  return {
    id: row.id,
    status: row.status,
    scope: safeStoredScope(row.filters),
    fileName: row.fileName,
    matchedOrderCount: row.matchedOrderCount,
    byteSize: row.byteSize?.toString() ?? null,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    lastErrorCode: row.lastErrorCode,
  };
}

function exportResult(row: {
  id: string;
  artifactName: string | null;
  fileName: string;
  matchedOrderCount: number;
  rowCounts: Prisma.JsonValue | null;
  byteSize: bigint | null;
}): Prisma.InputJsonValue {
  if (!row.artifactName || row.byteSize === null) throw new OrderExportArtifactMissingError();
  return {
    exportId: row.id,
    artifactName: row.artifactName,
    fileName: row.fileName,
    matchedOrderCount: row.matchedOrderCount,
    rowCounts: row.rowCounts === null
      ? null
      : (JSON.parse(JSON.stringify(row.rowCounts)) as Prisma.InputJsonValue),
    byteSize: row.byteSize.toString(),
  };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const group = key(row);
    const current = grouped.get(group);
    if (current) current.push(row);
    else grouped.set(group, [row]);
  }
  return grouped;
}

function decimal(value: Prisma.Decimal, scale: number) {
  return xlsxDecimal(value.toFixed(scale));
}

function date(value: Date | null | undefined): string | null {
  return value ? formatDateShanghai(value) : null;
}

function dateTime(value: Date | null | undefined): string | null {
  return value ? formatDateTimeShanghai(value) : null;
}

function yesNo(value: boolean): string {
  return value ? '是' : '否';
}

function formatCustomerChargeRuleSource(
  rule:
    | {
        code: string;
        name: string;
        sourceName: string | null;
        sourceSheet: string | null;
        sourceRange: string | null;
      }
    | null
    | undefined,
): string | null {
  if (!rule) return null;
  const sourceLocation = [rule.sourceName, rule.sourceSheet, rule.sourceRange]
    .filter((value): value is string => Boolean(value))
    .join(' / ');
  return `${rule.name}（${String(rule.code)}）${sourceLocation ? ` · ${sourceLocation}` : ''}`;
}

function pricingRevisionKind(status: string, source: string): string {
  if (status === 'ADMIN_CONFIRMED') return '管理员终价';
  if (status === 'AUTO_CONFIRMED') return '自动价';
  if (status === 'PENDING_ADMIN_CONFIRMATION') {
    return source.includes('AUTO') ? '自动暂定价（待管理员终审）' : '人工暂定价（待管理员终审）';
  }
  return '历史确认价';
}

function summarizePricingRevisionSnapshot(snapshot: Prisma.JsonValue): {
  processingAmount: ReturnType<typeof xlsxDecimal> | null;
  packagingAmount: ReturnType<typeof xlsxDecimal> | null;
  totalAmount: ReturnType<typeof xlsxDecimal> | null;
  ruleVersions: string | null;
} {
  const root = isRecord(snapshot) ? snapshot : {};
  const order = isRecord(root.order) ? root.order : {};
  const summaries = new Set<string>();
  const priceBookFingerprints = new Set<string>();

  const addPriceBook = (value: unknown, scope?: string) => {
    if (!isRecord(value)) return;
    const identifier = firstNonEmptyText(value.name, value.code, value.id);
    if (!identifier) return;
    const version = scalarText(value.version);
    const fingerprint = `${identifier}\u0000${version ?? ''}`;
    if (priceBookFingerprints.has(fingerprint)) return;
    priceBookFingerprints.add(fingerprint);
    summaries.add(
      `${scope ? `${scope}：` : ''}${identifier}${version ? ` v${version}` : ''}`,
    );
  };
  const addRule = (value: unknown) => {
    if (!isRecord(value)) return;
    const identifier = firstNonEmptyText(
      value.ruleCode,
      value.code,
      value.name,
      value.sourceId,
    );
    if (identifier) summaries.add(`规则：${identifier}`);
  };
  const addPricingSnapshot = (value: unknown) => {
    if (!isRecord(value)) return;
    addPriceBook(value.priceBook);
    addRule(value.rule);
    addRule(value.base);
    if (Array.isArray(value.appliedAdjustments)) {
      value.appliedAdjustments.forEach(addRule);
    }
    if (Array.isArray(value.components)) value.components.forEach(addRule);
    if (isRecord(value.quote)) addRule(value.quote);
  };

  if (isRecord(root.metadata) && isRecord(root.metadata.priceBooks)) {
    for (const [scope, value] of Object.entries(root.metadata.priceBooks)) {
      addPriceBook(value, PRICE_BOOK_SCOPE_LABELS[scope] ?? scope);
    }
  }
  for (const collectionName of [
    'items',
    'packagingGroups',
    'customerCharges',
  ] as const) {
    const collection = root[collectionName];
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      if (!isRecord(entry)) continue;
      addPricingSnapshot(entry.pricingSnapshot);
    }
  }

  return {
    processingAmount: snapshotMoney(order.processingAmount ?? root.processingAmount),
    packagingAmount: snapshotMoney(order.packagingAmount ?? root.packagingAmount),
    totalAmount: snapshotMoney(order.totalAmount ?? root.totalAmount),
    ruleVersions:
      summaries.size > 0 ? [...summaries].slice(0, 30).join('；') : null,
  };
}

function snapshotMoney(value: unknown): ReturnType<typeof xlsxDecimal> | null {
  const text = scalarText(value);
  if (text === null) return null;
  try {
    return xlsxDecimal(new Prisma.Decimal(text).toFixed(2));
  } catch {
    return null;
  }
}

function firstNonEmptyText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = scalarText(value);
    if (text) return text;
  }
  return null;
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function hashExportParams(params: OrderExportParams): string {
  const stable = Object.entries(params).sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function buildExportFileName(now: Date, requestKey: string): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now).replace(/[-: ]/g, '');
  return `工单导出_${parts}_${requestKey.slice(0, 8)}.xlsx`;
}

function safeStoredScope(value: Prisma.JsonValue): OrderExportScope {
  if (isRecord(value) && value.scope === 'all') return 'all';
  if (isRecord(value) && value.scope === 'selected') return 'selected';
  return 'filtered';
}

function normalizeSelectedOrderIds(values: readonly string[]): string[] {
  if (values.length < 1 || values.length > ORDER_EXPORT_SELECTED_MAX) {
    throw new InvalidOrderExportRequestError(
      `所选工单数量必须为 1–${ORDER_EXPORT_SELECTED_MAX} 单`,
    );
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
      throw new InvalidOrderExportRequestError('所选工单标识不合法');
    }
    if (seen.has(value)) {
      throw new InvalidOrderExportRequestError('所选工单不能重复');
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

async function assertSelectedExportReplay(
  exportId: string,
  filters: Prisma.JsonValue,
  selectedOrderIds: readonly string[],
): Promise<void> {
  if (safeStoredScope(filters) !== 'selected') {
    throw new InvalidOrderExportRequestError(
      '请求标识已用于其他导出范围',
    );
  }
  const stored = await db.orderExportSelection.findMany({
    where: { exportId },
    orderBy: { sequence: 'asc' },
    select: { orderId: true },
  });
  if (
    stored.length !== selectedOrderIds.length ||
    stored.some(
      (selection, index) => selection.orderId !== selectedOrderIds[index],
    )
  ) {
    throw new InvalidOrderExportRequestError(
      '同一请求标识不能更换所选工单',
    );
  }
}

function isMembershipKey(value: unknown): value is MembershipKey {
  return isRecord(value) && typeof value.id === 'string' && typeof value.orderNo === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function orderExportErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 120);
  return 'OrderExportFailed';
}

const EXPORT_PARAM_KEYS = new Set([
  'adminWorkspace', 'queue', 'signal', 'starred', 'unbilled',
  'q', 'orderNo', 'customName', 'customerRef', 'customerPartyId',
  'customerRefExact', 'receiverName', 'receiverPhone',
  'receiverAddress', 'submitterId', 'workerId', 'status', 'kind', 'isUrgent',
  'isSfCollect', 'addressMode', 'amountMin', 'amountMax', 'createdFrom',
  'createdTo', 'promisedFrom', 'promisedTo', 'trackingNo', 'expressCode',
  'shipmentStatus', 'itemName', 'productName', 'specification', 'paperType',
  'quantityMin', 'quantityMax', 'craftId', 'foilColor', 'taskStatus',
  'machineType', 'requiresOutsource', 'outsourceStatus', 'supplierName',
]);

// Operation-log exports are a business audit view, not a dump of the JSON
// column. Unknown fields can contain internal row/worker identifiers or nested
// scheduling payloads, so additions must be reviewed and explicitly allowed.
const ORDER_LOG_EXPORT_FIELDS = new Set([
  'customName',
  'customerRef',
  'receiverName',
  'receiverPhone',
  'receiverAddress',
  'expressCode',
  'packageRequirement',
  'remark',
  'promisedDate',
  'isUrgent',
  'isSfCollect',
  'status',
  'trackingNo',
]);

const ORDER_KIND_LABELS: Record<OrderKind, string> = {
  NORMAL: '普通工单',
  REWORK: '重做单',
};
const BILLING_MODE_LABELS: Record<OrderBillingMode, string> = {
  CHARGE: '计费',
  NO_CHARGE: '不计费',
};
const PACKAGING_MODE_LABELS: Record<string, string> = {
  UNPACKED: '不包装', BOX_RED_CARD: '红卡盒装', BOX_RED_CARD_MIXED: '红卡盒混装', BOX_TACTILE: '触感盒装', BOX_TACTILE_MIXED: '触感盒混装',
  SINGLE_STYLE: '单款装',
  MIXED_STYLE: '混装',
};
const CUSTOMER_CHARGE_STATUS_LABELS: Record<string, string> = {
  ESTIMATED: '暂估',
  PENDING_AMOUNT: '金额待定',
  FINAL: '已终审',
  WAIVED: '免收',
};
const PRICING_STATUS_LABELS: Record<string, string> = {
  LEGACY_CONFIRMED: '历史已确认',
  AUTO_CONFIRMED: '自动价已确认',
  PENDING_ADMIN_CONFIRMATION: '待管理员终审',
  ADMIN_CONFIRMED: '管理员终价已确认',
};
const PRICE_BOOK_SCOPE_LABELS: Record<string, string> = {
  processing: '加工',
  logistics: '物流',
};
const REWORK_CAUSE_LABELS: Record<ReworkCause, string> = {
  QUALITY: '质量问题',
  LOGISTICS_DAMAGE: '物流损毁',
  OTHER: '其他',
};
const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: '待生产',
  IN_PROGRESS: '生产中',
  COMPLETED: '已完工',
  CANCELLED: '已取消',
};
const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  PLANNED: '待发货',
  SHIPPED: '已发货',
};
const OUTSOURCE_STATUS_LABELS: Record<OutsourceStatus, string> = {
  SENT: '已发送',
  IN_PROGRESS: '进行中',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};
const CHANGE_REQUEST_STATUS_LABELS: Record<OrderChangeRequestStatus, string> = {
  PENDING: '待审核',
  APPROVED: '已同意',
  DENIED: '已驳回',
  WITHDRAWN: '已撤回',
  REJECTED: '已拒绝',
  CANCELLED: '已取消',
  STALE: '已过期',
};
const DESIGN_FILE_TYPE_LABELS: Record<DesignFileType, string> = {
  IMAGE: '图片',
  CDR: 'CDR',
};
const ORDER_COST_LABELS: Record<OrderCostCategory, string> = {
  MATERIAL: '材料',
  PIECEWORK: '计件',
  SETUP: '上板/装板',
  OUTSOURCE: '外协',
  SHIPPING: '物流',
  MEAL: '伙食费',
  ELECTRICITY: '电费',
  CUSTOM: '其他',
  ADJUSTMENT: '调整',
};

export class InvalidOrderExportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOrderExportRequestError';
  }
}
export class InvalidOrderExportStoredFilterError extends Error {
  constructor() {
    super('invalid stored order export filter');
    this.name = 'InvalidOrderExportStoredFilterError';
  }
}
export class InvalidOrderExportManifestError extends Error {
  constructor() {
    super('invalid order export membership manifest');
    this.name = 'InvalidOrderExportManifestError';
  }
}
export class OrderExportNotFoundError extends Error {
  constructor() {
    super('工单导出记录不存在');
    this.name = 'OrderExportNotFoundError';
  }
}
export class OrderExportNotPendingError extends Error {
  constructor(status: string) {
    super(`order export is not pending: ${status}`);
    this.name = 'OrderExportNotPendingError';
  }
}
export class OrderExportActorInvalidError extends Error {
  constructor() {
    super('order export actor is no longer an active admin');
    this.name = 'OrderExportActorInvalidError';
  }
}
export class OrderExportSchemaVersionError extends Error {
  constructor() {
    super('unsupported order export schema version');
    this.name = 'OrderExportSchemaVersionError';
  }
}
export class OrderExportArtifactMissingError extends Error {
  constructor() {
    super('order export artifact is missing');
    this.name = 'OrderExportArtifactMissingError';
  }
}
export class OrderExportNotReadyError extends Error {
  constructor() {
    super('工单导出尚未生成');
    this.name = 'OrderExportNotReadyError';
  }
}
export class OrderExportFailedError extends Error {
  constructor() {
    super('工单导出生成失败');
    this.name = 'OrderExportFailedError';
  }
}
export class OrderExportExpiredError extends Error {
  constructor() {
    super('order export expired before processing completed');
    this.name = 'OrderExportExpiredError';
  }
}
