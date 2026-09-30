import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import {
  AgentMonthlyBillExportStatus,
  AgentMonthlyBillStatus,
  BackgroundJobAttemptStatus,
  BackgroundJobQueue,
  BackgroundJobStatus,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { enqueueBackgroundJob } from '../background-jobs/repository';
import { BACKGROUND_JOB_TYPES } from '../background-jobs/types';
import { databaseClockNow } from '../background-jobs/clock';
import { db } from '../db';
import { writeXlsxFile, xlsxDecimal, type XlsxRow, type XlsxSheet } from '../export/xlsx';
import { formatDateTimeShanghai } from '../format/dates';
import {
  agentMonthlyBillExportArtifactPath,
  cleanupUntrackedAgentMonthlyBillExportArtifacts,
  deleteAgentMonthlyBillExportArtifact,
  ensureAgentMonthlyBillExportArtifactDir,
  openAgentMonthlyBillExportArtifact,
} from './export-artifact';
import { isAgentBillPeriod } from './period';
import { agentBillWhere } from './list-filter';
import { readBillSettlementDetail } from './settlement-detail';

const EXPORT_SCHEMA_VERSION = 1;
const EXPORT_TTL_MS = 24 * 60 * 60 * 1_000;
const EXPORT_BATCH_SIZE = 500;
const EXPORT_CLEANUP_BATCH_SIZE = 100;
const EXPORT_CLEANUP_MAX_ROWS = 500;
const REQUEST_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AgentMonthlyBillExportFilter = {
  period?: string;
  status?: AgentMonthlyBillStatus;
  agentUserId?: string;
};

export type AgentMonthlyBillExportSummary = {
  id: string;
  status: AgentMonthlyBillExportStatus;
  fileName: string;
  matchedBillCount: number;
  byteSize: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  lastErrorCode: string | null;
};

type ExportExecutionContext = {
  signal?: AbortSignal;
  assertLease?: () => Promise<void>;
};

type RowCounts = Record<string, number>;
type ExportReadClient = Pick<
  Prisma.TransactionClient,
  'agentMonthlyBillExportSnapshot'
>;

type ExportSnapshotPayload = {
  bill: {
    period: string;
    agentDisplayNameSnapshot: string;
    agentUsernameSnapshot: string;
    status: AgentMonthlyBillStatus;
    memberSubtotal: string;
    adjustmentAmount: string;
    totalAmount: string;
    confirmedAt: string | null;
    paidAt: string | null;
    createdAt: string;
    orderCount: number;
  };
  items: Array<{
    orderNoSnapshot: string;
    // 请求时的工单名称，2026-09-27 起写入；更早入队的快照没有此键，表格留空。
    orderNameSnapshot?: string | null;
    orderNameAtSettlement?: boolean;
    // 已停用的客户名称/简称，只存在于 2026-09-27 前写入的快照。不再写入、不再输出，
    // 但键仍留在 strict schema 里，停用前入队、尚未生成的导出才能照常解析。
    customerRefSnapshot?: string | null;
    orderStatusSnapshot: string;
    workOrderVersionSnapshot: number;
    settledFeeSnapshot: string;
    settledAtSnapshot: string;
  }>;
  adjustments: Array<{
    targetPeriod: string;
    targetAgentDisplayNameSnapshot: string;
    sourcePeriod: string;
    sourceOrderNoSnapshot: string;
    amount: string;
    reason: string;
    createdByDisplayName: string;
    createdAt: string;
  }>;
  receipts: Array<{
    period: string;
    agentDisplayNameSnapshot: string;
    amount: string;
    receivedAt: string;
    paymentMethod: string | null;
    referenceNo: string | null;
    recordedByDisplayName: string;
  }>;
};

const SNAPSHOT_MONEY = z.string().regex(/^-?(?:0|[1-9]\d*)\.\d{2}$/);
const SNAPSHOT_INSTANT = z.string().datetime({ offset: true });
// 快照行不可变，且工作进程只处理 schemaVersion 相同的导出：演进只能新增可选键、
// 不能删键或改为必填，否则部署前入队的导出会在生成时整单失败。
const EXPORT_SNAPSHOT_PAYLOAD_SCHEMA = z
  .object({
    bill: z
      .object({
        period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        agentDisplayNameSnapshot: z.string(),
        agentUsernameSnapshot: z.string(),
        status: z.enum(AgentMonthlyBillStatus),
        memberSubtotal: SNAPSHOT_MONEY,
        adjustmentAmount: SNAPSHOT_MONEY,
        totalAmount: SNAPSHOT_MONEY,
        confirmedAt: SNAPSHOT_INSTANT.nullable(),
        paidAt: SNAPSHOT_INSTANT.nullable(),
        createdAt: SNAPSHOT_INSTANT,
        orderCount: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(
      z
        .object({
          orderNoSnapshot: z.string(),
          orderNameSnapshot: z.string().nullable().optional(),
        orderNameAtSettlement: z.boolean().optional(),
          customerRefSnapshot: z.string().nullable().optional(),
          orderStatusSnapshot: z.string(),
          workOrderVersionSnapshot: z.number().int().positive(),
          settledFeeSnapshot: SNAPSHOT_MONEY,
          settledAtSnapshot: SNAPSHOT_INSTANT,
        })
        .strict(),
    ),
    adjustments: z.array(
      z
        .object({
          targetPeriod: z.string(),
          targetAgentDisplayNameSnapshot: z.string(),
          sourcePeriod: z.string(),
          sourceOrderNoSnapshot: z.string(),
          amount: SNAPSHOT_MONEY,
          reason: z.string(),
          createdByDisplayName: z.string(),
          createdAt: SNAPSHOT_INSTANT,
        })
        .strict(),
    ),
    receipts: z.array(
      z
        .object({
          period: z.string(),
          agentDisplayNameSnapshot: z.string(),
          amount: SNAPSHOT_MONEY,
          receivedAt: SNAPSHOT_INSTANT,
          paymentMethod: z.string().nullable(),
          referenceNo: z.string().nullable(),
          recordedByDisplayName: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

const EXPORT_SNAPSHOT_SELECT = {
  id: true,
  period: true,
  agentDisplayNameSnapshot: true,
  agentUsernameSnapshot: true,
  status: true,
  memberSubtotal: true,
  adjustmentAmount: true,
  totalAmount: true,
  confirmedAt: true,
  paidAt: true,
  createdAt: true,
  items: {
    select: {
      orderNoSnapshot: true,
      orderStatusSnapshot: true,
      workOrderVersionSnapshot: true,
      settledFeeSnapshot: true,
      settlementDetailSnapshot: true,
      settledAtSnapshot: true,
      order: { select: { customName: true } },
    },
    orderBy: [{ settledAtSnapshot: 'asc' }, { id: 'asc' }],
  },
  adjustments: {
    select: {
      amount: true,
      createdAt: true,
      credit: {
        select: {
          reason: true,
          createdBy: { select: { displayName: true } },
          sourceItem: {
            select: {
              orderNoSnapshot: true,
              bill: { select: { period: true } },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  receipt: {
    select: {
      amount: true,
      receivedAt: true,
      paymentMethod: true,
      referenceNo: true,
      recordedBy: { select: { displayName: true } },
    },
  },
} as const satisfies Prisma.AgentMonthlyBillSelect;

type ExportSnapshotSource = Prisma.AgentMonthlyBillGetPayload<{
  select: typeof EXPORT_SNAPSHOT_SELECT;
}>;

function exportSnapshotPayload(source: ExportSnapshotSource): ExportSnapshotPayload {
  return {
    bill: {
      period: source.period,
      agentDisplayNameSnapshot: source.agentDisplayNameSnapshot,
      agentUsernameSnapshot: source.agentUsernameSnapshot,
      status: source.status,
      memberSubtotal: source.memberSubtotal.toFixed(2),
      adjustmentAmount: source.adjustmentAmount.toFixed(2),
      totalAmount: source.totalAmount.toFixed(2),
      confirmedAt: source.confirmedAt?.toISOString() ?? null,
      paidAt: source.paidAt?.toISOString() ?? null,
      createdAt: source.createdAt.toISOString(),
      orderCount: source.items.length,
    },
    items: source.items.map((item) => {
      const detail = readBillSettlementDetail(item.settlementDetailSnapshot, item.settledFeeSnapshot);
      return {
        orderNoSnapshot: item.orderNoSnapshot,
        orderNameSnapshot: detail ? detail.orderName : item.order.customName,
        orderNameAtSettlement: Boolean(detail),
        orderStatusSnapshot: item.orderStatusSnapshot,
        workOrderVersionSnapshot: item.workOrderVersionSnapshot,
        settledFeeSnapshot: item.settledFeeSnapshot.toFixed(2),
        settledAtSnapshot: item.settledAtSnapshot.toISOString(),
      };
    }),
    adjustments: source.adjustments.map((adjustment) => ({
      targetPeriod: source.period,
      targetAgentDisplayNameSnapshot: source.agentDisplayNameSnapshot,
      sourcePeriod: adjustment.credit.sourceItem.bill.period,
      sourceOrderNoSnapshot: adjustment.credit.sourceItem.orderNoSnapshot,
      amount: adjustment.amount.toFixed(2),
      reason: adjustment.credit.reason,
      createdByDisplayName: adjustment.credit.createdBy.displayName,
      createdAt: adjustment.createdAt.toISOString(),
    })),
    receipts: source.receipt
      ? [
          {
            period: source.period,
            agentDisplayNameSnapshot: source.agentDisplayNameSnapshot,
            amount: source.receipt.amount.toFixed(2),
            receivedAt: source.receipt.receivedAt.toISOString(),
            paymentMethod: source.receipt.paymentMethod,
            referenceNo: source.receipt.referenceNo,
            recordedByDisplayName: source.receipt.recordedBy.displayName,
          },
        ]
      : [],
  };
}

export async function requestAgentMonthlyBillExport(input: {
  actor: AuditActor;
  requestKey: string;
  filter: AgentMonthlyBillExportFilter;
  durable: boolean;
  now?: Date;
}): Promise<AgentMonthlyBillExportSummary> {
  if (!REQUEST_KEY_PATTERN.test(input.requestKey)) {
    throw new InvalidAgentMonthlyBillExportRequestError('请求标识不合法');
  }
  if (input.actor.role !== Role.ADMIN) {
    throw new InvalidAgentMonthlyBillExportRequestError('仅管理员可导出月账单');
  }
  const filter = normalizeFilter(input.filter);
  const existing = await db.agentMonthlyBillExport.findUnique({
    where: { requestKey: input.requestKey },
  });
  if (existing) {
    assertReplayFilter(existing.filters, filter);
    return ownedSummary(existing, input.actor.id);
  }

  try {
    const created = await db.$transaction(async (tx) => {
      // Database time and the rows below belong to the same REPEATABLE READ
      // transaction. Host clock skew therefore cannot omit or admit bills.
      const snapshotAt = await databaseClockNow(tx);
      const snapshotWhere: Prisma.AgentMonthlyBillWhereInput = {
        createdAt: { lte: snapshotAt },
        ...agentBillWhere(filter),
      };
      const sourceRows = await tx.agentMonthlyBill.findMany({
        where: snapshotWhere,
        select: EXPORT_SNAPSHOT_SELECT,
        orderBy: [{ id: 'asc' }],
      });
      const row = await tx.agentMonthlyBillExport.create({
        data: {
          requestKey: input.requestKey,
          createdById: input.actor.id,
          filters: filter as Prisma.InputJsonValue,
          snapshotAt,
          schemaVersion: EXPORT_SCHEMA_VERSION,
          fileName: buildFileName(snapshotAt, input.requestKey),
          expiresAt: new Date(snapshotAt.getTime() + EXPORT_TTL_MS),
        },
      });

      if (sourceRows.length > 0) {
        for (let offset = 0; offset < sourceRows.length; offset += EXPORT_BATCH_SIZE) {
          const batch = sourceRows.slice(offset, offset + EXPORT_BATCH_SIZE);
          await tx.agentMonthlyBillExportSnapshot.createMany({
            data: batch.map((source, index) => ({
              id: randomUUID(),
              exportId: row.id,
              billId: source.id,
              sequence: offset + index,
              payload: exportSnapshotPayload(
                source,
              ) as unknown as Prisma.InputJsonValue,
            })),
          });
        }
      }

      let backgroundJobId: string | null = null;
      if (input.durable) {
        const { job } = await enqueueBackgroundJob(
          {
            type: BACKGROUND_JOB_TYPES.AGENT_MONTHLY_BILL_EXPORT,
            queue: BackgroundJobQueue.HEAVY,
            dedupeKey: `agent-monthly-bill-export:${row.id}`,
            payload: { exportId: row.id },
            priority: 90,
            maxAttempts: 3,
          },
          tx,
        );
        backgroundJobId = job.id;
        await tx.agentMonthlyBillExport.update({
          where: { id: row.id },
          data: { backgroundJobId },
        });
      }

      await writeAuditLogInTx(tx, {
        actor: input.actor,
        action: 'AGENT_MONTHLY_BILL_EXPORT_REQUESTED',
        entityType: 'AgentMonthlyBillExport',
        entityId: row.id,
        after: {
          schemaVersion: EXPORT_SCHEMA_VERSION,
          filterFields: Object.keys(filter).sort(),
          backgroundJobId: backgroundJobId ? '[QUEUED]' : null,
        },
      });
      return { ...row, backgroundJobId };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 10_000,
      timeout: 60_000,
    });
    return ownedSummary(created, input.actor.id);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const duplicate = await db.agentMonthlyBillExport.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (!duplicate) throw error;
    assertReplayFilter(duplicate.filters, filter);
    return ownedSummary(duplicate, input.actor.id);
  }
}

export async function processQueuedAgentMonthlyBillExport(
  exportId: string,
  context: ExportExecutionContext = {},
): Promise<Prisma.InputJsonValue> {
  const row = await db.agentMonthlyBillExport.findUnique({
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
    },
  });
  if (!row) throw new AgentMonthlyBillExportNotFoundError();
  if (row.status === AgentMonthlyBillExportStatus.READY) return exportResult(row);
  if (row.status !== AgentMonthlyBillExportStatus.PENDING) {
    throw new AgentMonthlyBillExportNotPendingError(row.status);
  }

  const startedAt = new Date();
  if (row.expiresAt <= startedAt) {
    await transitionToExpired(row, startedAt);
    throw new AgentMonthlyBillExportExpiredError();
  }
  // Re-authorization at execution time: an administrator disabled or
  // demoted after requesting the export must not receive a financial file.
  if (!row.createdBy.isActive || row.createdBy.role !== Role.ADMIN) {
    throw new AgentMonthlyBillExportActorInvalidError();
  }
  if (row.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new AgentMonthlyBillExportSchemaVersionError();
  }

  // Validate the retained request metadata, but never reconstruct membership
  // from mutable live bills. The immutable snapshot rows are authoritative.
  parseStoredFilter(row.filters);
  const artifactName = `${row.id}-${randomUUID()}.xlsx`;
  const artifactPath = agentMonthlyBillExportArtifactPath(artifactName);
  const membershipPath = `${artifactPath}.${randomUUID()}.bills`;
  const rowCounts: RowCounts = {};

  await executionCheckpoint(context);
  await ensureAgentMonthlyBillExportArtifactDir();
  try {
    // One REPEATABLE READ snapshot covers membership and every sheet. A DRAFT
    // synchronization or CONFIRMED -> PAID transition racing this worker can
    // therefore appear either before or after the export, never half-way
    // through different sheets in the same workbook.
    const { matchedBillCount, result } = await db.$transaction(
      async (tx) => {
        const matchedBillCount = await writeMembershipManifest(
          membershipPath,
          row.id,
          tx,
          context,
        );
        const result = await writeXlsxFile({
          filePath: artifactPath,
          sheets: buildWorkbookSheets(
            membershipPath,
            rowCounts,
            context,
            tx,
          ),
        });
        return { matchedBillCount, result };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 10 * 60_000,
      },
    );
    await executionCheckpoint(context);

    const completedAt = new Date();
    if (row.expiresAt <= completedAt) {
      await transitionToExpired(row, completedAt);
      throw new AgentMonthlyBillExportExpiredError();
    }
    const actor: AuditActor = {
      id: row.createdBy.id,
      username: row.createdBy.username,
      displayName: row.createdBy.displayName,
      role: row.createdBy.role,
    };
    const updated = await publishReadyExport({
      exportId: row.id,
      artifactName,
      matchedBillCount,
      rowCounts,
      byteLength: result.byteLength,
      completedAt,
      actor,
    });
    await cleanupExpiredAgentMonthlyBillExports().catch(() => undefined);
    return exportResult(updated);
  } catch (error) {
    await deleteAgentMonthlyBillExportArtifact(artifactName);
    throw error;
  } finally {
    await unlink(membershipPath).catch(() => undefined);
  }
}

export async function processAgentMonthlyBillExportInline(
  exportId: string,
): Promise<void> {
  try {
    await processQueuedAgentMonthlyBillExport(exportId);
  } catch (error) {
    await db.agentMonthlyBillExport.updateMany({
      where: {
        id: exportId,
        status: AgentMonthlyBillExportStatus.PENDING,
      },
      data: {
        status: AgentMonthlyBillExportStatus.FAILED,
        filters: {},
        artifactName: null,
        byteSize: null,
        lastErrorCode: exportErrorCode(error),
      },
    });
    throw error;
  }
}

export async function listRecentAgentMonthlyBillExports(
  actorId: string,
  limit = 5,
): Promise<AgentMonthlyBillExportSummary[]> {
  const now = new Date();
  const rows = await db.agentMonthlyBillExport.findMany({
    where: { createdById: actorId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(20, Math.max(1, limit)),
  });
  return rows.map((row) => {
    const summary = ownedSummary(row, actorId);
    return summary.status === AgentMonthlyBillExportStatus.READY &&
      summary.expiresAt <= now
      ? { ...summary, status: AgentMonthlyBillExportStatus.EXPIRED }
      : summary;
  });
}

export async function getAgentMonthlyBillExportStatus(
  exportId: string,
  actor: AuditActor,
  now = new Date(),
): Promise<AgentMonthlyBillExportSummary> {
  const row = await findOwnedExport(exportId, actor);
  if (
    row.status === AgentMonthlyBillExportStatus.READY &&
    row.expiresAt <= now
  ) {
    await transitionToExpired(row, now);
    if (row.artifactName) {
      await deleteAgentMonthlyBillExportArtifact(row.artifactName);
      await clearDeletedArtifact(row.id, row.artifactName);
    }
    return { ...ownedSummary(row, actor.id), status: AgentMonthlyBillExportStatus.EXPIRED };
  }
  return ownedSummary(row, actor.id);
}

export async function prepareAgentMonthlyBillExportDownload(
  exportId: string,
  actor: AuditActor,
  now = new Date(),
) {
  const row = await findOwnedExport(exportId, actor);
  if (
    row.expiresAt <= now ||
    row.status === AgentMonthlyBillExportStatus.EXPIRED
  ) {
    await transitionToExpired(row, now);
    if (row.artifactName) {
      await deleteAgentMonthlyBillExportArtifact(row.artifactName);
      await clearDeletedArtifact(row.id, row.artifactName);
    }
    throw new AgentMonthlyBillExportNotFoundError();
  }
  if (row.status === AgentMonthlyBillExportStatus.PENDING) {
    throw new AgentMonthlyBillExportNotReadyError();
  }
  if (row.status === AgentMonthlyBillExportStatus.FAILED) {
    throw new AgentMonthlyBillExportFailedError();
  }
  if (row.status !== AgentMonthlyBillExportStatus.READY || !row.artifactName) {
    throw new AgentMonthlyBillExportFailedError();
  }

  let artifact: Awaited<ReturnType<typeof openAgentMonthlyBillExportArtifact>>;
  try {
    artifact = await openAgentMonthlyBillExportArtifact(row.artifactName);
  } catch {
    await db.agentMonthlyBillExport.updateMany({
      where: {
        id: row.id,
        status: AgentMonthlyBillExportStatus.READY,
        artifactName: row.artifactName,
      },
      data: {
        status: AgentMonthlyBillExportStatus.FAILED,
        filters: {},
        artifactName: null,
        byteSize: null,
        lastErrorCode: 'AgentMonthlyBillExportArtifactMissingError',
      },
    });
    throw new AgentMonthlyBillExportFailedError();
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.agentMonthlyBillExport.update({
        where: { id: row.id },
        data: { downloadCount: { increment: 1 } },
      });
      await writeAuditLogInTx(tx, {
        actor,
        action: 'AGENT_MONTHLY_BILL_EXPORT_DOWNLOADED',
        entityType: 'AgentMonthlyBillExport',
        entityId: row.id,
        after: {
          fileName: row.fileName,
          byteSize: String(artifact.byteLength),
          matchedBillCount: row.matchedBillCount,
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

export async function cleanupExpiredAgentMonthlyBillExports(
  now = new Date(),
): Promise<number> {
  let expiredCount = 0;
  let examinedCount = 0;
  while (examinedCount < EXPORT_CLEANUP_MAX_ROWS) {
    const take = Math.min(
      EXPORT_CLEANUP_BATCH_SIZE,
      EXPORT_CLEANUP_MAX_ROWS - examinedCount,
    );
    const rows = await findExpiredBatch(now, take);
    if (rows.length === 0) break;
    examinedCount += rows.length;
    for (const row of rows) {
      if (row.status !== AgentMonthlyBillExportStatus.EXPIRED) {
        const transitioned = await transitionToExpired(row, now);
        if (!transitioned) continue;
        expiredCount += 1;
      }
      if (row.artifactName) {
        await deleteAgentMonthlyBillExportArtifact(row.artifactName);
        await clearDeletedArtifact(row.id, row.artifactName);
      }
    }
    if (rows.length < take) break;
  }

  const retained = await db.agentMonthlyBillExport.findMany({
    where: {
      status: AgentMonthlyBillExportStatus.READY,
      expiresAt: { gt: now },
      artifactName: { not: null },
    },
    select: { artifactName: true },
  });
  await cleanupUntrackedAgentMonthlyBillExportArtifacts({
    keep: new Set(
      retained.flatMap((row) => (row.artifactName ? [row.artifactName] : [])),
    ),
    olderThan: new Date(now.getTime() - 2 * EXPORT_TTL_MS),
  });
  return expiredCount;
}

function buildWorkbookSheets(
  membershipPath: string,
  rowCounts: RowCounts,
  context: ExportExecutionContext,
  client: ExportReadClient,
): XlsxSheet[] {
  return [
    trackedSheet('月账单', billRows(membershipPath, context, client), rowCounts, [12, 20, 20, 12, 14, 14, 14, 16, 12, 18, 18]),
    trackedSheet('结算成员', itemRows(membershipPath, context, client), rowCounts, [12, 20, 20, 20, 12, 14, 14, 18, 18, 28]),
    trackedSheet('跨月负项', adjustmentRows(membershipPath, context, client), rowCounts, [12, 20, 20, 20, 14, 40, 18, 18, 28]),
    trackedSheet('收款回执', receiptRows(membershipPath, context, client), rowCounts, [12, 20, 14, 18, 18, 22, 18, 28]),
  ];
}

function trackedSheet(
  name: string,
  source: AsyncIterable<XlsxRow>,
  rowCounts: RowCounts,
  columnWidths: readonly number[],
): XlsxSheet {
  async function* rows(): AsyncGenerator<XlsxRow> {
    let rowIndex = 0;
    for await (const row of source) {
      if (rowIndex > 0) rowCounts[name] = (rowCounts[name] ?? 0) + 1;
      rowIndex += 1;
      yield row;
    }
    rowCounts[name] ??= 0;
  }
  return { name, rows: rows(), columnWidths };
}

async function* billRows(
  membershipPath: string,
  context: ExportExecutionContext,
  client: ExportReadClient,
): AsyncGenerator<XlsxRow> {
  yield [
    '账期', '代理商', '账号快照', '状态', '工单数', '成员小计', '跨月负项',
    '应收总额', '确认时间', '结清时间', '创建时间',
  ];
  for await (const snapshotIds of membershipBatches(membershipPath, context)) {
    const rows = await client.agentMonthlyBillExportSnapshot.findMany({
      where: { id: { in: snapshotIds } },
      select: { payload: true },
      orderBy: { sequence: 'asc' },
    });
    for (const row of rows) {
      const bill = parseExportSnapshot(row.payload).bill;
      yield [
        bill.period,
        bill.agentDisplayNameSnapshot,
        bill.agentUsernameSnapshot,
        billStatusLabel(bill.status),
        bill.orderCount,
        moneyText(bill.memberSubtotal),
        moneyText(bill.adjustmentAmount),
        moneyText(bill.totalAmount),
        dateTime(bill.confirmedAt),
        dateTime(bill.paidAt),
        dateTime(bill.createdAt),
      ];
    }
  }
}

async function* itemRows(
  membershipPath: string,
  context: ExportExecutionContext,
  client: ExportReadClient,
): AsyncGenerator<XlsxRow> {
  yield [
    '账期', '代理商', '工单号', '工单名称', '工单状态', '纸单版本', '结算费', '结算时间', '名称依据', '销售账号',
  ];
  for await (const snapshotIds of membershipBatches(membershipPath, context)) {
    const rows = await client.agentMonthlyBillExportSnapshot.findMany({
      where: { id: { in: snapshotIds } },
      select: { payload: true },
      orderBy: { sequence: 'asc' },
    });
    for (const row of rows) {
      const snapshot = parseExportSnapshot(row.payload);
      for (const item of snapshot.items) {
        yield [
          snapshot.bill.period,
          snapshot.bill.agentDisplayNameSnapshot,
          item.orderNoSnapshot,
          // 与工单导出的“工单名称”列同口径：未命名留空，不重复工单号。
          item.orderNameSnapshot?.trim() || null,
          item.orderStatusSnapshot,
          item.workOrderVersionSnapshot,
          moneyText(item.settledFeeSnapshot),
          dateTime(item.settledAtSnapshot),
          item.orderNameAtSettlement ? '出账时名称' : '导出时名称',
          snapshot.bill.agentUsernameSnapshot,
        ];
      }
    }
  }
}

async function* adjustmentRows(
  membershipPath: string,
  context: ExportExecutionContext,
  client: ExportReadClient,
): AsyncGenerator<XlsxRow> {
  yield [
    '目标账期', '目标代理商', '来源账期', '来源工单', '负项金额', '原因', '记录人', '创建时间', '销售账号',
  ];
  for await (const snapshotIds of membershipBatches(membershipPath, context)) {
    const rows = await client.agentMonthlyBillExportSnapshot.findMany({
      where: { id: { in: snapshotIds } },
      select: { payload: true },
      orderBy: { sequence: 'asc' },
    });
    for (const row of rows) {
      const snapshot = parseExportSnapshot(row.payload);
      for (const adjustment of snapshot.adjustments) {
        yield [
          adjustment.targetPeriod,
          adjustment.targetAgentDisplayNameSnapshot,
          adjustment.sourcePeriod,
          adjustment.sourceOrderNoSnapshot,
          moneyText(adjustment.amount),
          adjustment.reason,
          adjustment.createdByDisplayName,
          dateTime(adjustment.createdAt),
          snapshot.bill.agentUsernameSnapshot,
        ];
      }
    }
  }
}

async function* receiptRows(
  membershipPath: string,
  context: ExportExecutionContext,
  client: ExportReadClient,
): AsyncGenerator<XlsxRow> {
  yield ['账期', '代理商', '收款金额', '收款时间', '收款方式', '流水号', '记录人', '销售账号'];
  for await (const snapshotIds of membershipBatches(membershipPath, context)) {
    const rows = await client.agentMonthlyBillExportSnapshot.findMany({
      where: { id: { in: snapshotIds } },
      select: { payload: true },
      orderBy: { sequence: 'asc' },
    });
    for (const row of rows) {
      const snapshot = parseExportSnapshot(row.payload);
      for (const receipt of snapshot.receipts) {
        yield [
          receipt.period,
          receipt.agentDisplayNameSnapshot,
          moneyText(receipt.amount),
          dateTime(receipt.receivedAt),
          receipt.paymentMethod,
          receipt.referenceNo,
          receipt.recordedByDisplayName,
          snapshot.bill.agentUsernameSnapshot,
        ];
      }
    }
  }
}

async function writeMembershipManifest(
  filePath: string,
  exportId: string,
  client: ExportReadClient,
  context: ExportExecutionContext,
): Promise<number> {
  const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  await once(output, 'open');
  let cursor: string | undefined;
  let count = 0;
  try {
    while (true) {
      await executionCheckpoint(context);
      const rows = await client.agentMonthlyBillExportSnapshot.findMany({
        where: { exportId },
        select: { id: true },
        orderBy: { sequence: 'asc' },
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        if (!output.write(`${JSON.stringify(row.id)}\n`)) {
          await once(output, 'drain');
        }
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

async function* membershipBatches(
  filePath: string,
  context: ExportExecutionContext,
): AsyncGenerator<string[]> {
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let batch: string[] = [];
  for await (const line of lines) {
    if (!line) continue;
    const id = JSON.parse(line) as unknown;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new AgentMonthlyBillExportManifestError();
    }
    batch.push(id);
    if (batch.length === EXPORT_BATCH_SIZE) {
      await executionCheckpoint(context);
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) {
    await executionCheckpoint(context);
    yield batch;
  }
}

async function publishReadyExport(input: {
  exportId: string;
  artifactName: string;
  matchedBillCount: number;
  rowCounts: RowCounts;
  byteLength: number;
  completedAt: Date;
  actor: AuditActor;
}) {
  try {
    return await db.$transaction(async (tx) => {
      const changed = await tx.agentMonthlyBillExport.updateMany({
        where: {
          id: input.exportId,
          status: AgentMonthlyBillExportStatus.PENDING,
          expiresAt: { gt: input.completedAt },
        },
        data: {
          status: AgentMonthlyBillExportStatus.READY,
          matchedBillCount: input.matchedBillCount,
          rowCounts: input.rowCounts,
          artifactName: input.artifactName,
          byteSize: BigInt(input.byteLength),
          expiresAt: new Date(input.completedAt.getTime() + EXPORT_TTL_MS),
          completedAt: input.completedAt,
          lastErrorCode: null,
          filters: {},
        },
      });
      if (changed.count !== 1) {
        throw new AgentMonthlyBillExportNotPendingError('CHANGED');
      }
      await writeAuditLogInTx(tx, {
        actor: input.actor,
        action: 'AGENT_MONTHLY_BILL_EXPORT_READY',
        entityType: 'AgentMonthlyBillExport',
        entityId: input.exportId,
        after: {
          matchedBillCount: input.matchedBillCount,
          rowCounts: input.rowCounts,
          byteSize: String(input.byteLength),
          schemaVersion: EXPORT_SCHEMA_VERSION,
        },
      });
      return tx.agentMonthlyBillExport.findUniqueOrThrow({
        where: { id: input.exportId },
      });
    });
  } catch (error) {
    const published = await db.agentMonthlyBillExport.findUnique({
      where: { id: input.exportId },
    });
    if (
      published?.status === AgentMonthlyBillExportStatus.READY &&
      published.artifactName === input.artifactName
    ) {
      return published;
    }
    throw error;
  }
}

async function findOwnedExport(exportId: string, actor: AuditActor) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(exportId) || actor.role !== Role.ADMIN) {
    throw new AgentMonthlyBillExportNotFoundError();
  }
  const row = await db.agentMonthlyBillExport.findUnique({
    where: { id: exportId },
  });
  if (!row || row.createdById !== actor.id) {
    throw new AgentMonthlyBillExportNotFoundError();
  }
  return row;
}

async function findExpiredBatch(now: Date, take: number) {
  return db.agentMonthlyBillExport.findMany({
    where: {
      OR: [
        {
          status: {
            in: [
              AgentMonthlyBillExportStatus.READY,
              AgentMonthlyBillExportStatus.PENDING,
            ],
          },
          expiresAt: { lte: now },
        },
        {
          status: AgentMonthlyBillExportStatus.EXPIRED,
          artifactName: { not: null },
        },
      ],
    },
    select: {
      id: true,
      status: true,
      artifactName: true,
      backgroundJobId: true,
      expiresAt: true,
    },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take,
  });
}

async function transitionToExpired(
  row: {
    id: string;
    status: AgentMonthlyBillExportStatus;
    backgroundJobId: string | null;
    expiresAt: Date;
  },
  now: Date,
): Promise<boolean> {
  if (
    row.status !== AgentMonthlyBillExportStatus.PENDING &&
    row.status !== AgentMonthlyBillExportStatus.READY
  ) {
    return false;
  }
  return db.$transaction(async (tx) => {
    const changed = await tx.agentMonthlyBillExport.updateMany({
      where: { id: row.id, status: row.status, expiresAt: { lte: now } },
      data: {
        status: AgentMonthlyBillExportStatus.EXPIRED,
        filters: {},
        ...(row.status === AgentMonthlyBillExportStatus.PENDING
          ? { lastErrorCode: 'AgentMonthlyBillExportExpiredBeforeProcessing' }
          : {}),
      },
    });
    if (changed.count !== 1) return false;
    if (
      row.status === AgentMonthlyBillExportStatus.PENDING &&
      row.backgroundJobId
    ) {
      await tx.backgroundJob.updateMany({
        where: {
          id: row.backgroundJobId,
          type: BACKGROUND_JOB_TYPES.AGENT_MONTHLY_BILL_EXPORT,
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
          lastErrorCode: 'AgentMonthlyBillExportExpired',
        },
      });
      await tx.backgroundJobAttempt.updateMany({
        where: {
          jobId: row.backgroundJobId,
          status: BackgroundJobAttemptStatus.RUNNING,
        },
        data: {
          status: BackgroundJobAttemptStatus.ABANDONED,
          errorCode: 'AgentMonthlyBillExportExpired',
          finishedAt: now,
        },
      });
    }
    return true;
  });
}

async function clearDeletedArtifact(
  exportId: string,
  artifactName: string,
): Promise<void> {
  await db.agentMonthlyBillExport.updateMany({
    where: {
      id: exportId,
      status: AgentMonthlyBillExportStatus.EXPIRED,
      artifactName,
    },
    data: { artifactName: null },
  });
}

function normalizeFilter(
  value: AgentMonthlyBillExportFilter,
): AgentMonthlyBillExportFilter {
  const keys = Object.keys(value);
  if (keys.some((key) => !['period', 'status', 'agentUserId'].includes(key))) {
    throw new InvalidAgentMonthlyBillExportRequestError('导出筛选条件不合法');
  }
  const period = value.period?.trim() || undefined;
  const agentUserId = value.agentUserId?.trim() || undefined;
  if (period && !isAgentBillPeriod(period)) {
    throw new InvalidAgentMonthlyBillExportRequestError('导出账期不合法');
  }
  if (
    value.status &&
    !(Object.values(AgentMonthlyBillStatus) as string[]).includes(value.status)
  ) {
    throw new InvalidAgentMonthlyBillExportRequestError('导出状态不合法');
  }
  if (agentUserId && !/^\S{1,128}$/.test(agentUserId)) {
    throw new InvalidAgentMonthlyBillExportRequestError('代理商标识不合法');
  }
  return {
    ...(period ? { period } : {}),
    ...(value.status ? { status: value.status } : {}),
    ...(agentUserId ? { agentUserId } : {}),
  };
}

function parseStoredFilter(value: Prisma.JsonValue): AgentMonthlyBillExportFilter {
  if (!isRecord(value)) throw new InvalidAgentMonthlyBillExportStoredFilterError();
  try {
    return normalizeFilter(value as AgentMonthlyBillExportFilter);
  } catch {
    throw new InvalidAgentMonthlyBillExportStoredFilterError();
  }
}

function assertReplayFilter(
  stored: Prisma.JsonValue,
  requested: AgentMonthlyBillExportFilter,
): void {
  let parsed: AgentMonthlyBillExportFilter;
  try {
    parsed = parseStoredFilter(stored);
  } catch {
    throw new InvalidAgentMonthlyBillExportRequestError(
      '请求标识已完成，不能更换筛选条件',
    );
  }
  if (JSON.stringify(parsed) !== JSON.stringify(requested)) {
    throw new InvalidAgentMonthlyBillExportRequestError(
      '同一请求标识不能更换筛选条件',
    );
  }
}

function ownedSummary(
  row: {
    id: string;
    createdById: string;
    status: AgentMonthlyBillExportStatus;
    fileName: string;
    matchedBillCount: number;
    byteSize: bigint | null;
    expiresAt: Date;
    completedAt: Date | null;
    createdAt: Date;
    lastErrorCode: string | null;
  },
  actorId: string,
): AgentMonthlyBillExportSummary {
  if (row.createdById !== actorId) throw new AgentMonthlyBillExportNotFoundError();
  return {
    id: row.id,
    status: row.status,
    fileName: row.fileName,
    matchedBillCount: row.matchedBillCount,
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
  matchedBillCount: number;
  rowCounts: Prisma.JsonValue | null;
  byteSize: bigint | null;
}): Prisma.InputJsonValue {
  if (!row.artifactName || row.byteSize === null) {
    throw new AgentMonthlyBillExportArtifactMissingError();
  }
  return {
    exportId: row.id,
    artifactName: row.artifactName,
    fileName: row.fileName,
    matchedBillCount: row.matchedBillCount,
    rowCounts:
      row.rowCounts === null
        ? null
        : (JSON.parse(JSON.stringify(row.rowCounts)) as Prisma.InputJsonValue),
    byteSize: row.byteSize.toString(),
  };
}

function buildFileName(now: Date, requestKey: string): string {
  const stamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(now)
    .replace(/[-: ]/g, '');
  return `代理商月账单_${stamp}_${requestKey.slice(0, 8)}.xlsx`;
}

function billStatusLabel(status: AgentMonthlyBillStatus): string {
  if (status === AgentMonthlyBillStatus.DRAFT) return '草稿';
  if (status === AgentMonthlyBillStatus.CONFIRMED) return '已确认·待收';
  return '已收';
}

function parseExportSnapshot(value: Prisma.JsonValue): ExportSnapshotPayload {
  const parsed = EXPORT_SNAPSHOT_PAYLOAD_SCHEMA.safeParse(value);
  if (!parsed.success) throw new AgentMonthlyBillExportSnapshotError();
  return parsed.data;
}

function moneyText(value: string) {
  return xlsxDecimal(value);
}

function dateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new AgentMonthlyBillExportSnapshotError();
  }
  return formatDateTimeShanghai(instant);
}

async function executionCheckpoint(
  context: ExportExecutionContext,
): Promise<void> {
  await context.assertLease?.();
  context.signal?.throwIfAborted();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

function exportErrorCode(error: unknown): string {
  return error instanceof Error && error.name
    ? error.name.slice(0, 120)
    : 'AgentMonthlyBillExportFailed';
}

export class InvalidAgentMonthlyBillExportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAgentMonthlyBillExportRequestError';
  }
}

export class InvalidAgentMonthlyBillExportStoredFilterError extends Error {
  constructor() {
    super('已保存的月账单导出筛选条件不合法');
    this.name = 'InvalidAgentMonthlyBillExportStoredFilterError';
  }
}

export class AgentMonthlyBillExportNotFoundError extends Error {
  constructor() {
    super('月账单导出不存在');
    this.name = 'AgentMonthlyBillExportNotFoundError';
  }
}

export class AgentMonthlyBillExportNotPendingError extends Error {
  constructor(status: string) {
    super(`月账单导出已不在排队中：${status}`);
    this.name = 'AgentMonthlyBillExportNotPendingError';
  }
}

export class AgentMonthlyBillExportActorInvalidError extends Error {
  constructor() {
    super('月账单导出发起人已无效');
    this.name = 'AgentMonthlyBillExportActorInvalidError';
  }
}

export class AgentMonthlyBillExportSchemaVersionError extends Error {
  constructor() {
    super('月账单导出版本不兼容');
    this.name = 'AgentMonthlyBillExportSchemaVersionError';
  }
}

export class AgentMonthlyBillExportArtifactMissingError extends Error {
  constructor() {
    super('月账单导出产物缺失');
    this.name = 'AgentMonthlyBillExportArtifactMissingError';
  }
}

export class AgentMonthlyBillExportManifestError extends Error {
  constructor() {
    super('月账单导出成员清单已损坏');
    this.name = 'AgentMonthlyBillExportManifestError';
  }
}

export class AgentMonthlyBillExportSnapshotError extends Error {
  constructor() {
    super('月账单导出请求快照已损坏');
    this.name = 'AgentMonthlyBillExportSnapshotError';
  }
}

export class AgentMonthlyBillExportNotReadyError extends Error {
  constructor() {
    super('月账单导出正在生成');
    this.name = 'AgentMonthlyBillExportNotReadyError';
  }
}

export class AgentMonthlyBillExportFailedError extends Error {
  constructor() {
    super('月账单导出生成失败');
    this.name = 'AgentMonthlyBillExportFailedError';
  }
}

export class AgentMonthlyBillExportExpiredError extends Error {
  constructor() {
    super('月账单导出已过期');
    this.name = 'AgentMonthlyBillExportExpiredError';
  }
}
