/**
 * 历史脏数据清理（审计 M-7 / L-14，业主 2026-09-24「已经卡住或写脏的历史数据清理掉」）。
 *
 * M-7：修复上线前升版的工单，旧代次仍为待开工/进行中的工序与进度步骤永远不能再报工，
 *      分档烫金计件结算因此被挡住。与升版修复同一口径终止（复用
 *      lib/production/generation-supersede.ts）：置为已取消；带分档烫金报工的工序标记
 *      payrollReviewRequired 转管理员人工核定——脚本从不计算工资。
 * L-14：待下发（CONFIRMED，或由 CONFIRMED 暂停的 ON_HOLD）工单被批准改单时提前写入的
 *      scheduledAt。从未下发（没有任何生产工序 / 进度步骤 / 旧任务，也没有下发类日志）
 *      才清空，真正下发时再由下发流程落定。
 *
 * 默认只读 dry-run（只读事务，打印数量与 id）；--apply 在单个事务里逐单持工单级联锁、
 * 锁内重新判定后写入，并为每张工单写 OrderLog 与 BusinessAuditLog。重复执行无副作用。
 *
 *   pnpm exec tsx scripts/maintenance/cleanup-stuck-production-history.ts --database=<库名>
 *   pnpm exec tsx scripts/maintenance/cleanup-stuck-production-history.ts --database=<库名> --apply --actor=<管理员用户名>
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { OrderStatus, OrderWorkflowAction, ProductionOperationStatus, Role } from '../../generated/prisma/enums';
import type { AuditActor } from '../../lib/audit-log';
import { orderCascadeLockKey } from '../../lib/order/locks';
import {
  planPreviousProductionGenerationSupersedeInTx,
  supersedePreviousProductionGenerationInTx,
  type PreviousProductionGenerationSupersede,
} from '../../lib/production/generation-supersede';

const SCRIPT = 'scripts/maintenance/cleanup-stuck-production-history.ts';
export const STALE_GENERATION_LOG_ACTION = 'MAINTENANCE_STALE_GENERATION_SUPERSEDED';
export const PREMATURE_SCHEDULE_LOG_ACTION = 'MAINTENANCE_PREMATURE_SCHEDULED_AT_CLEARED';
/** 任何一条都证明工单曾经下发，scheduledAt 可能是真实的下发时间，不自动清理。 */
const RELEASE_LOG_ACTIONS = ['OPERATIONS_RELEASED', 'OPERATIONS_MATERIALIZED', 'OPERATIONS_REMATERIALIZED', 'SAMPLE_READY_TO_SHIP'];
const RELEASED_STATUSES = [OrderStatus.RELEASED, OrderStatus.FOILING, OrderStatus.PACKING];
const APPLY_TRANSACTION = { maxWait: 15_000, timeout: 300_000 };

export type CleanupOptions = { apply: boolean; database: string; actorUsername: string | null };

export function parseCleanupArgs(args: readonly string[]): CleanupOptions {
  const options: CleanupOptions = { apply: false, database: '', actorUsername: null };
  for (const arg of args) {
    if (arg === '--apply' && !options.apply) options.apply = true;
    else if (arg.startsWith('--database=') && !options.database) options.database = arg.slice('--database='.length).trim();
    else if (arg.startsWith('--actor=') && options.actorUsername === null) options.actorUsername = arg.slice('--actor='.length).trim();
    else throw new Error(`参数无效：${arg}`);
  }
  if (!options.database) throw new Error('必须用 --database=<库名> 显式确认目标数据库');
  if (options.apply && !options.actorUsername) throw new Error('--apply 必须同时提供 --actor=<活跃管理员用户名>');
  return options;
}

export type StaleGenerationOrder = PreviousProductionGenerationSupersede & {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  workOrderVersion: number;
};

export type PrematureScheduleRow = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  scheduledAt: Date | null;
  _count: { productionOperations: number; productionProgressSteps: number };
  items: { _count: { tasks: number } }[];
  workflowDecisions: { fromStatus: OrderStatus }[];
  logs: { id: string }[];
};

export type PrematureScheduleDecision =
  | { kind: 'CLEAR' }
  | { kind: 'SKIP'; reason: string }
  | { kind: 'NOT_APPLICABLE' };

/**
 * scheduledAt 是当前代次的下发边界。只有「从未下发」的待下发工单上的值才是 L-14 写脏的：
 * 暂停的工单必须暂停前就是 CONFIRMED；任何下发证据都让它转人工复核而不是自动清理。
 */
export function classifyPrematureSchedule(row: PrematureScheduleRow): PrematureScheduleDecision {
  if (row.scheduledAt === null) return { kind: 'NOT_APPLICABLE' };
  if (row.status === OrderStatus.ON_HOLD) {
    if (row.workflowDecisions[0]?.fromStatus !== OrderStatus.CONFIRMED) return { kind: 'NOT_APPLICABLE' };
  } else if (row.status !== OrderStatus.CONFIRMED) {
    return { kind: 'NOT_APPLICABLE' };
  }
  if (row._count.productionOperations > 0 || row._count.productionProgressSteps > 0) {
    return { kind: 'SKIP', reason: '已有生产工序或进度步骤，疑似下发过，请人工核对' };
  }
  if (row.items.some((item) => item._count.tasks > 0)) {
    return { kind: 'SKIP', reason: '已有旧版生产任务，疑似下发过，请人工核对' };
  }
  if (row.logs.length > 0) return { kind: 'SKIP', reason: '日志中有下发记录，请人工核对' };
  return { kind: 'CLEAR' };
}

async function findStaleGenerationOrderIds(tx: Prisma.TransactionClient, orderId?: string) {
  return tx.$queryRaw<{ id: string; orderNo: string; status: OrderStatus; workOrderVersion: number }[]>`
    SELECT o."id", o."orderNo", o."status"::text AS "status", o."workOrderVersion"
    FROM "Order" o
    WHERE (${orderId ?? null}::text IS NULL OR o."id" = ${orderId ?? null}::text)
      AND (
        EXISTS (
          SELECT 1 FROM "ProductionOperation" op
          WHERE op."orderId" = o."id" AND op."workOrderVersion" < o."workOrderVersion"
            AND op."status" IN ('PENDING', 'IN_PROGRESS')
        )
        OR EXISTS (
          SELECT 1 FROM "ProductionProgressStep" step
          WHERE step."orderId" = o."id" AND step."workOrderVersion" < o."workOrderVersion"
            AND step."status" IN ('PENDING', 'IN_PROGRESS')
        )
      )
    ORDER BY o."id"`;
}

async function findPrematureScheduleRows(tx: Prisma.TransactionClient, orderId?: string): Promise<PrematureScheduleRow[]> {
  return tx.order.findMany({
    where: {
      ...(orderId ? { id: orderId } : {}),
      scheduledAt: { not: null },
      status: { in: [OrderStatus.CONFIRMED, OrderStatus.ON_HOLD] },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      orderNo: true,
      status: true,
      scheduledAt: true,
      _count: { select: { productionOperations: true, productionProgressSteps: true } },
      items: { select: { _count: { select: { tasks: true } } } },
      workflowDecisions: {
        where: { action: OrderWorkflowAction.HOLD },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { fromStatus: true },
      },
      logs: {
        where: {
          OR: [
            { action: { in: RELEASE_LOG_ACTIONS } },
            ...RELEASED_STATUSES.map((status) => ({ changedFields: { path: ['status', 'after'], equals: status } })),
          ],
        },
        take: 1,
        select: { id: true },
      },
    },
  });
}

async function lockOrder(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(orderId)}))`;
}

async function assertDatabase(tx: Prisma.TransactionClient, expected: string) {
  const [row] = await tx.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (row?.name !== expected) throw new Error('数据库确认不匹配，未执行任何操作');
}

async function resolveActor(tx: Prisma.TransactionClient, username: string): Promise<AuditActor> {
  const user = await tx.user.findUnique({
    where: { username },
    select: { id: true, role: true, username: true, displayName: true, isActive: true },
  });
  if (!user?.isActive || user.role !== Role.ADMIN) throw new Error('找不到对应的活跃管理员');
  return { id: user.id, role: user.role, username: String(user.username), displayName: user.displayName };
}

export type CleanupReport = {
  mode: 'DRY_RUN' | 'APPLY';
  database: string;
  staleGenerations: {
    orderCount: number;
    operationCount: number;
    payrollReviewOperationCount: number;
    progressStepCount: number;
    orders: StaleGenerationOrder[];
  };
  prematureSchedules: {
    orderCount: number;
    orders: { orderId: string; orderNo: string; status: OrderStatus; scheduledAt: string }[];
    skipped: { orderId: string; orderNo: string; status: OrderStatus; scheduledAt: string; reason: string }[];
  };
};

function emptyReport(options: CleanupOptions): CleanupReport {
  return {
    mode: options.apply ? 'APPLY' : 'DRY_RUN',
    database: options.database,
    staleGenerations: { orderCount: 0, operationCount: 0, payrollReviewOperationCount: 0, progressStepCount: 0, orders: [] },
    prematureSchedules: { orderCount: 0, orders: [], skipped: [] },
  };
}

function addStaleGeneration(report: CleanupReport, order: StaleGenerationOrder) {
  const target = report.staleGenerations;
  target.orders.push(order);
  target.orderCount += 1;
  target.operationCount += order.operationIds.length;
  target.payrollReviewOperationCount += order.payrollReviewOperationIds.length;
  target.progressStepCount += order.progressStepIds.length;
}

// lib/audit-log 在加载时就会创建 Prisma 连接；延迟到真正写审计时再加载，保证 main 先读完 .env。
async function writeAuditLogInTx(...args: Parameters<typeof import('../../lib/audit-log').writeAuditLogInTx>) {
  const { writeAuditLogInTx: write } = await import('../../lib/audit-log');
  return write(...args);
}

type StaleGenerationOriginals = {
  operations: { id: string; status: ProductionOperationStatus; payrollReviewRequired: boolean }[];
  progressSteps: { id: string; status: ProductionOperationStatus }[];
};

/** 与 planPreviousProductionGenerationSupersedeInTx 同一选择口径，只读原值。 */
async function readStaleGenerationOriginals(
  tx: Prisma.TransactionClient,
  orderId: string,
  currentWorkOrderVersion: number,
): Promise<StaleGenerationOriginals> {
  const where = {
    orderId,
    workOrderVersion: { lt: currentWorkOrderVersion },
    status: { in: [ProductionOperationStatus.PENDING, ProductionOperationStatus.IN_PROGRESS] },
  };
  const operations = await tx.productionOperation.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, payrollReviewRequired: true },
  });
  const progressSteps = await tx.productionProgressStep.findMany({ where, select: { id: true, status: true } });
  return {
    operations: operations.map(({ id, status, payrollReviewRequired }) => ({ id, status, payrollReviewRequired })),
    progressSteps: progressSteps.map(({ id, status }) => ({ id, status })),
  };
}

async function applyStaleGeneration(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  candidate: { id: string },
): Promise<StaleGenerationOrder | null> {
  await lockOrder(tx, candidate.id);
  // 锁内重新读取：并发升版或报工可能已经改变了当前代次。
  const [locked] = await findStaleGenerationOrderIds(tx, candidate.id);
  if (!locked) return null;
  // 写入前、锁内记下每行原值（待开工/进行中、人工核定标志是否早已存在），
  // 否则事后无法按审计前向恢复。
  const before = await readStaleGenerationOriginals(tx, locked.id, locked.workOrderVersion);
  const superseded = await supersedePreviousProductionGenerationInTx(tx, locked.id, locked.workOrderVersion);
  if (superseded.operationIds.length === 0 && superseded.progressStepIds.length === 0) return null;
  const maintenance = { audit: 'M-7', script: SCRIPT };
  await tx.orderLog.create({
    data: {
      orderId: locked.id,
      operatorId: actor.id,
      action: STALE_GENERATION_LOG_ACTION,
      changedFields: { supersededProduction: superseded, before, workOrderVersion: locked.workOrderVersion, maintenance },
      remark: '历史清理：终止旧代次未完成的工序与进度步骤，分档烫金报工转人工核定',
    },
  });
  await writeAuditLogInTx(tx, {
    actor,
    action: STALE_GENERATION_LOG_ACTION,
    entityType: 'Order',
    entityId: locked.id,
    before: { workOrderVersion: locked.workOrderVersion, unfinishedPreviousGeneration: superseded, ...before },
    after: { cancelled: superseded, payrollReviewRequired: superseded.payrollReviewOperationIds },
    requestMetadata: maintenance,
  });
  return { orderId: locked.id, orderNo: locked.orderNo, status: locked.status, workOrderVersion: locked.workOrderVersion, ...superseded };
}

async function applyPrematureSchedule(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  candidate: { id: string },
): Promise<PrematureScheduleRow | null> {
  await lockOrder(tx, candidate.id);
  const [locked] = await findPrematureScheduleRows(tx, candidate.id);
  if (!locked || classifyPrematureSchedule(locked).kind !== 'CLEAR' || locked.scheduledAt === null) return null;
  const cleared = await tx.order.updateMany({
    where: { id: locked.id, status: locked.status, scheduledAt: locked.scheduledAt },
    data: { scheduledAt: null },
  });
  if (cleared.count !== 1) throw new Error(`工单 ${locked.orderNo} 并发变化，已整体回滚`);
  const maintenance = { audit: 'L-14', script: SCRIPT };
  const scheduledAt = { before: locked.scheduledAt.toISOString(), after: null };
  await tx.orderLog.create({
    data: {
      orderId: locked.id,
      operatorId: actor.id,
      action: PREMATURE_SCHEDULE_LOG_ACTION,
      changedFields: { scheduledAt, maintenance },
      remark: '历史清理：清除未下发工单被改单审批提前写入的下发时间',
    },
  });
  await writeAuditLogInTx(tx, {
    actor,
    action: PREMATURE_SCHEDULE_LOG_ACTION,
    entityType: 'Order',
    entityId: locked.id,
    before: { status: locked.status, scheduledAt: scheduledAt.before },
    after: { status: locked.status, scheduledAt: null },
    requestMetadata: maintenance,
  });
  return locked;
}

async function collectDryRun(tx: Prisma.TransactionClient, report: CleanupReport) {
  for (const candidate of await findStaleGenerationOrderIds(tx)) {
    const plan = await planPreviousProductionGenerationSupersedeInTx(tx, candidate.id, candidate.workOrderVersion);
    addStaleGeneration(report, { orderId: candidate.id, orderNo: candidate.orderNo, status: candidate.status, workOrderVersion: candidate.workOrderVersion, ...plan });
  }
}

function addPrematureSchedule(report: CleanupReport, row: PrematureScheduleRow) {
  const decision = classifyPrematureSchedule(row);
  if (decision.kind === 'NOT_APPLICABLE' || row.scheduledAt === null) return;
  const entry = { orderId: row.id, orderNo: row.orderNo, status: row.status, scheduledAt: row.scheduledAt.toISOString() };
  if (decision.kind === 'SKIP') report.prematureSchedules.skipped.push({ ...entry, reason: decision.reason });
  else {
    report.prematureSchedules.orders.push(entry);
    report.prematureSchedules.orderCount += 1;
  }
}

type CleanupClient = Pick<PrismaClient, '$transaction'>;

export async function runStuckProductionCleanup(client: CleanupClient, options: CleanupOptions): Promise<CleanupReport> {
  const report = emptyReport(options);
  if (!options.apply) {
    await client.$transaction(async (tx) => {
      // 只读快照：生产库上 dry-run 不会写入或持有写锁。
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await assertDatabase(tx, options.database);
      await collectDryRun(tx, report);
      for (const row of await findPrematureScheduleRows(tx)) addPrematureSchedule(report, row);
    }, { isolationLevel: 'RepeatableRead', ...APPLY_TRANSACTION });
    return report;
  }
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    await assertDatabase(tx, options.database);
    const actor = await resolveActor(tx, options.actorUsername ?? '');
    for (const candidate of await findStaleGenerationOrderIds(tx)) {
      const applied = await applyStaleGeneration(tx, actor, candidate);
      if (applied) addStaleGeneration(report, applied);
    }
    for (const row of await findPrematureScheduleRows(tx)) {
      const decision = classifyPrematureSchedule(row);
      if (decision.kind !== 'CLEAR') {
        addPrematureSchedule(report, row);
        continue;
      }
      const applied = await applyPrematureSchedule(tx, actor, row);
      if (applied) addPrematureSchedule(report, applied);
    }
  }, APPLY_TRANSACTION);
  return report;
}

async function main() {
  const options = parseCleanupArgs(process.argv.slice(2));
  await import('dotenv/config');
  const { db } = await import('../../lib/db');
  try {
    const report = await runStuckProductionCleanup(db, options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error('历史数据清理失败，未写入任何数据：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
