import type { Prisma } from '../../generated/prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import {
  OrderPrintAttemptOutcome,
  OrderPrintJobState,
  OrderPrintKind,
  OrderStatus,
  Role,
} from '../../generated/prisma/enums';
import { databaseClockNow } from '../background-jobs/clock';
import { db } from '../db';
import { orderCascadeLockKey } from './locks';
import { resolveOrderChangeStageInTx } from './change-stage';
import { OrderChangeRequestError } from './change-request-error';
import { canConfirmOrderPrinted, ORDER_PRINTABLE_STATUSES } from './print-eligibility';

export type OrderPrintActor = { id: string; role: Role };

export class OrderPrintJobError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'ORDER_NOT_FOUND'
      | 'ORDER_NOT_PRINTABLE'
      | 'VERSION_STALE'
      | 'PRINT_REQUEST_NOT_FOUND'
      | 'PRINT_REQUEST_ALREADY_PENDING'
      | 'IDEMPOTENCY_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'OrderPrintJobError';
  }
}

const PRINTABLE_STATUSES = new Set<OrderStatus>(ORDER_PRINTABLE_STATUSES);

function assertAdmin(actor: OrderPrintActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new OrderPrintJobError('ORDER_NOT_PRINTABLE', '只有管理员可以管理工单打印');
  }
}

function checkedKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 128) {
    throw new OrderPrintJobError('INVALID_INPUT', '打印请求标识长度必须为 8–128 个字符');
  }
  return key;
}

function checkedReason(value: string): string {
  const reason = value.trim();
  if (!reason || reason.length > 64) {
    throw new OrderPrintJobError('INVALID_INPUT', '打印原因必须为 1–64 个字符');
  }
  return reason;
}

type PrintTx = Prisma.TransactionClient;

export async function createOrderPrintRequestInTx(
  tx: PrintTx,
  input: {
    orderId: string;
    workOrderVersion: number;
    printKind: OrderPrintKind;
    reason: string;
    idempotencyKey: string;
  },
  actor: OrderPrintActor,
): Promise<{ jobId: string; idempotentReplay: boolean }> {
  assertAdmin(actor);
  const idempotencyKey = checkedKey(input.idempotencyKey);
  const reason = checkedReason(input.reason);
  if (!Number.isSafeInteger(input.workOrderVersion) || input.workOrderVersion < 1) {
    throw new OrderPrintJobError('INVALID_INPUT', '工单版本必须为正整数');
  }

  const existingByKey = await tx.orderPrintJob.findUnique({
    where: { idempotencyKey },
    select: {
      id: true,
      orderId: true,
      workOrderVersion: true,
      printKind: true,
      reason: true,
      state: true,
      requestJobId: true,
    },
  });
  if (existingByKey) {
    if (
      existingByKey.orderId !== input.orderId ||
      existingByKey.workOrderVersion !== input.workOrderVersion ||
      existingByKey.printKind !== input.printKind ||
      existingByKey.reason !== reason ||
      existingByKey.state !== OrderPrintJobState.PENDING ||
      existingByKey.requestJobId !== null
    ) {
      throw new OrderPrintJobError('IDEMPOTENCY_CONFLICT', '同一打印请求标识已用于其他操作');
    }
    return { jobId: existingByKey.id, idempotentReplay: true };
  }

  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, status: true, workOrderVersion: true },
  });
  if (!order) throw new OrderPrintJobError('ORDER_NOT_FOUND', '工单不存在');
  if (order.workOrderVersion !== input.workOrderVersion) {
    throw new OrderPrintJobError('VERSION_STALE', `工单当前版本为 v${order.workOrderVersion}`);
  }
  let printableStatus = order.status;
  if (order.status === OrderStatus.ON_HOLD && input.printKind === OrderPrintKind.REPRINT) {
    try {
      printableStatus = await resolveOrderChangeStageInTx(tx, order);
    } catch (error) {
      if (!(error instanceof OrderChangeRequestError)) throw error;
      throw new OrderPrintJobError('ORDER_NOT_PRINTABLE', error.message);
    }
  }
  if (!PRINTABLE_STATUSES.has(printableStatus)) {
    throw new OrderPrintJobError('ORDER_NOT_PRINTABLE', `工单状态 ${order.status} 不允许创建打印任务`);
  }

  const currentPending = await tx.orderPrintJob.findFirst({
    where: {
      orderId: order.id,
      workOrderVersion: order.workOrderVersion,
      state: OrderPrintJobState.PENDING,
      resolution: { is: null },
    },
    select: { id: true, printKind: true, reason: true },
  });
  if (currentPending) {
    throw new OrderPrintJobError(
      'PRINT_REQUEST_ALREADY_PENDING',
      '当前版本已有待打印任务，不能用新请求标识重复创建',
    );
  }

  const created = await tx.orderPrintJob.create({
    data: {
      orderId: order.id,
      workOrderVersion: order.workOrderVersion,
      printKind: input.printKind,
      reason,
      state: OrderPrintJobState.PENDING,
      idempotencyKey,
      createdById: actor.id,
    },
    select: { id: true },
  });
  await tx.orderLog.create({
    data: {
      orderId: order.id,
      operatorId: actor.id,
      action: 'ORDER_PRINT_REQUESTED',
      changedFields: {
        printJobId: created.id,
        workOrderVersion: order.workOrderVersion,
        printKind: input.printKind,
        state: { before: null, after: OrderPrintJobState.PENDING },
      },
      remark: reason,
    },
  });
  return { jobId: created.id, idempotentReplay: false };
}

export async function markOrderPrintRequestPrintedInTx(
  tx: PrintTx,
  input: { requestJobId: string; idempotencyKey: string },
  actor: OrderPrintActor,
): Promise<{ receiptId: string; orderId: string; idempotentReplay: boolean }> {
  assertAdmin(actor);
  const idempotencyKey = checkedKey(input.idempotencyKey);
  const requestJobId = input.requestJobId.trim();
  if (!requestJobId) {
    throw new OrderPrintJobError('INVALID_INPUT', '打印任务不能为空');
  }

  const existingByKey = await tx.orderPrintJob.findUnique({
    where: { idempotencyKey },
    select: {
      id: true,
      orderId: true,
      state: true,
      requestJobId: true,
      printedById: true,
    },
  });
  if (existingByKey) {
    if (
      existingByKey.state !== OrderPrintJobState.PRINTED ||
      existingByKey.requestJobId !== requestJobId ||
      existingByKey.printedById !== actor.id
    ) {
      throw new OrderPrintJobError('IDEMPOTENCY_CONFLICT', '同一打印确认标识已用于其他操作');
    }
    return {
      receiptId: existingByKey.id,
      orderId: existingByKey.orderId,
      idempotentReplay: true,
    };
  }

  const request = await tx.orderPrintJob.findUnique({
    where: { id: requestJobId },
    select: {
      id: true,
      orderId: true,
      workOrderVersion: true,
      printKind: true,
      reason: true,
      state: true,
      resolution: { select: { id: true, printedById: true } },
      order: { select: { workOrderVersion: true, status: true } },
    },
  });
  if (!request || request.state !== OrderPrintJobState.PENDING) {
    throw new OrderPrintJobError('PRINT_REQUEST_NOT_FOUND', '待打印任务不存在');
  }
  if (request.workOrderVersion !== request.order.workOrderVersion) {
    throw new OrderPrintJobError('VERSION_STALE', `该打印任务属于旧版 v${request.workOrderVersion}`);
  }
  if (!canConfirmOrderPrinted(request.order.status)) {
    throw new OrderPrintJobError('ORDER_NOT_PRINTABLE', '工单已不在生产中，不能确认打印，请刷新后核对');
  }
  if (request.resolution) {
    // A replay is valid only when the caller presents the key stored on the
    // immutable resolution row; that case was handled by existingByKey above.
    // Treating an unused key as a replay here would leave the key unreserved,
    // so the same key could later confirm a different print request.
    throw new OrderPrintJobError(
      'IDEMPOTENCY_CONFLICT',
      '该打印任务已由其他打印确认标识处理',
    );
  }

  const printedAt = await databaseClockNow(tx);
  const receipt = await tx.orderPrintJob.create({
    data: {
      orderId: request.orderId,
      workOrderVersion: request.workOrderVersion,
      printKind: request.printKind,
      reason: request.reason,
      state: OrderPrintJobState.PRINTED,
      requestJobId: request.id,
      idempotencyKey,
      printedById: actor.id,
      printedAt,
    },
    select: { id: true },
  });
  await tx.orderLog.create({
    data: {
      orderId: request.orderId,
      operatorId: actor.id,
      action: 'ORDER_PRINTED',
      changedFields: {
        requestJobId: request.id,
        receiptId: receipt.id,
        workOrderVersion: request.workOrderVersion,
        state: {
          before: OrderPrintJobState.PENDING,
          after: OrderPrintJobState.PRINTED,
        },
        printedAt: { before: null, after: printedAt.toISOString() },
      },
      remark: request.reason,
    },
  });
  return {
    receiptId: receipt.id,
    orderId: request.orderId,
    idempotentReplay: false,
  };
}

/**
 * Appends one SUPERSEDED resolution for every older unresolved request. This
 * is called under the canonical order lock in the same transaction that bumps
 * workOrderVersion, so no consumer can observe a new version whose old print
 * request still has `resolution = null`.
 */
export async function supersedeOlderOrderPrintRequestsInTx(
  tx: PrintTx,
  input: {
    orderId: string;
    currentWorkOrderVersion: number;
    reasonKey: string;
  },
  actor: OrderPrintActor,
): Promise<{ requestJobIds: string[] }> {
  assertAdmin(actor);
  const reasonKey = checkedKey(input.reasonKey);
  if (
    !Number.isSafeInteger(input.currentWorkOrderVersion) ||
    input.currentWorkOrderVersion < 1
  ) {
    throw new OrderPrintJobError('INVALID_INPUT', '工单版本必须为正整数');
  }
  const unresolved = await tx.orderPrintJob.findMany({
    where: {
      orderId: input.orderId,
      workOrderVersion: { lt: input.currentWorkOrderVersion },
      state: OrderPrintJobState.PENDING,
      requestJobId: null,
      resolution: { is: null },
    },
    orderBy: [{ workOrderVersion: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      orderId: true,
      workOrderVersion: true,
      printKind: true,
      reason: true,
    },
  });
  for (const request of unresolved) {
    const supersedeKey = `supersede:${createHash('sha256')
      .update(reasonKey)
      .update('\0')
      .update(request.id)
      .digest('hex')}`;
    await tx.orderPrintJob.create({
      data: {
        orderId: request.orderId,
        workOrderVersion: request.workOrderVersion,
        printKind: request.printKind,
        reason: request.reason,
        state: OrderPrintJobState.SUPERSEDED,
        requestJobId: request.id,
        idempotencyKey: supersedeKey,
        createdById: actor.id,
      },
      select: { id: true },
    });
  }
  if (unresolved.length > 0) {
    await tx.orderLog.create({
      data: {
        orderId: input.orderId,
        operatorId: actor.id,
        action: 'ORDER_PRINT_REQUESTS_SUPERSEDED',
        changedFields: {
          requestJobIds: unresolved.map((request) => request.id),
          obsoleteWorkOrderVersions: [
            ...new Set(unresolved.map((request) => request.workOrderVersion)),
          ],
          currentWorkOrderVersion: input.currentWorkOrderVersion,
          state: {
            before: OrderPrintJobState.PENDING,
            after: OrderPrintJobState.SUPERSEDED,
          },
        },
        remark: '工单版本升级，旧版待打印任务已作废',
      },
    });
  }
  return { requestJobIds: unresolved.map((request) => request.id) };
}

/**
 * 一次打印尝试：打印页每次渲染、批量打印文件每次打开 / 下载（每张工单）各有唯一的 `attemptKey`。
 * 结果写入 OrderPrintAttempt 账本，同一尝试的重试只返回原结果。
 */
type PrintAttempt = { orderId: string; workOrderVersion: number; attemptKey: string };
export type RenderedPrintOutcome = OrderPrintAttemptOutcome;

/**
 * 点「打印」即记已打印（业主 2026-10-02）：管理员在打印页关闭浏览器打印对话框、或打开 / 下载
 * 批量打印文件时调用，把纸上那份内容记为已打印。在工单级联锁内：
 *
 * - 账本里已有同一 `attemptKey` → 返回原结果（任何结果都重放，不再找新任务）。
 * - 版本已变、或 `contentIsCurrent` 判定纸上内容不是当前内容（如同版本换了生产师傅）→ `STALE`。
 *   调用方负责比较：打印页比「生产指令摘要」，批量文件比完整快照摘要；比较必须用同一事务
 *   客户端在锁内读取，持锁写入方（改单、排单等）无法在比较与记录之间插入。
 * - 有当前版本待打印任务就记它；没有、且本版本从未打印过（例如下发时没建打印任务）就在
 *   同一事务里建任务并记已打印；本版本已打印过 → `ALREADY_PRINTED`。
 * - 浏览器取消打印对话框也会触发记录——纸在管理员手上，看得见，重打即可。
 */
export async function recordRenderedPrintInTx(
  tx: PrintTx,
  attempt: PrintAttempt,
  actor: OrderPrintActor,
  contentIsCurrent: () => Promise<boolean>,
): Promise<RenderedPrintOutcome> {
  assertAdmin(actor);
  const attemptKey = checkedKey(attempt.attemptKey);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
    attempt.orderId,
  )}))`;
  const earlier = await tx.orderPrintAttempt.findUnique({
    where: { attemptKey },
    select: { orderId: true, outcome: true },
  });
  if (earlier) {
    if (earlier.orderId !== attempt.orderId) {
      throw new OrderPrintJobError('IDEMPOTENCY_CONFLICT', '同一打印记录标识已用于其他工单');
    }
    return earlier.outcome;
  }
  const { outcome, receiptId } = await resolveRenderedPrintInTx(tx, attempt, attemptKey, actor, contentIsCurrent);
  await tx.orderPrintAttempt.create({
    data: {
      attemptKey,
      orderId: attempt.orderId,
      workOrderVersion: attempt.workOrderVersion,
      outcome,
      receiptId,
      actorId: actor.id,
    },
  });
  return outcome;
}

async function resolveRenderedPrintInTx(
  tx: PrintTx,
  attempt: PrintAttempt,
  attemptKey: string,
  actor: OrderPrintActor,
  contentIsCurrent: () => Promise<boolean>,
): Promise<{ outcome: RenderedPrintOutcome; receiptId: string | null }> {
  const order = await tx.order.findUnique({
    where: { id: attempt.orderId },
    select: { status: true, workOrderVersion: true },
  });
  if (!order) throw new OrderPrintJobError('ORDER_NOT_FOUND', '工单不存在');
  const done = (outcome: RenderedPrintOutcome) => ({ outcome, receiptId: null });
  if (order.workOrderVersion !== attempt.workOrderVersion) return done(OrderPrintAttemptOutcome.STALE);
  if (!canConfirmOrderPrinted(order.status)) return done(OrderPrintAttemptOutcome.NOT_PRINTABLE);
  if (!(await contentIsCurrent())) return done(OrderPrintAttemptOutcome.STALE);
  const pending = await tx.orderPrintJob.findFirst({
    where: {
      orderId: attempt.orderId,
      workOrderVersion: order.workOrderVersion,
      state: OrderPrintJobState.PENDING,
      resolution: { is: null },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  let requestJobId = pending?.id;
  if (!requestJobId) {
    const printed = await tx.orderPrintJob.findFirst({
      where: { orderId: attempt.orderId, workOrderVersion: order.workOrderVersion, state: OrderPrintJobState.PRINTED },
      select: { id: true },
    });
    if (printed) return done(OrderPrintAttemptOutcome.ALREADY_PRINTED);
    if (!PRINTABLE_STATUSES.has(order.status)) return done(OrderPrintAttemptOutcome.NOT_PRINTABLE);
    // 工单锁内已确认没有待打印任务，任务标识只需唯一（重放由尝试账本承担）。
    requestJobId = (await createOrderPrintRequestInTx(tx, {
      orderId: attempt.orderId,
      workOrderVersion: order.workOrderVersion,
      printKind: OrderPrintKind.INITIAL,
      reason: '管理员直接打印',
      idempotencyKey: `print-request:${randomUUID()}`,
    }, actor)).jobId;
  }
  const { receiptId } = await markOrderPrintRequestPrintedInTx(tx, { requestJobId, idempotencyKey: attemptKey }, actor);
  return { outcome: OrderPrintAttemptOutcome.MARKED, receiptId };
}

/**
 * Public single-order command used by row and batch actions. The caller never
 * gets to choose a persisted state or timestamp; those remain server facts.
 */
export async function createOrderPrintRequest(
  input: {
    orderId: string;
    workOrderVersion: number;
    printKind: OrderPrintKind;
    reason: string;
    idempotencyKey: string;
  },
  actor: OrderPrintActor,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.orderId,
    )}))`;
    return createOrderPrintRequestInTx(tx, input, actor);
  });
}

/**
 * Creates the next manual print request while deriving INITIAL/REPRINT from
 * append-only print history under the canonical order lock. A work-order
 * version is only an optimistic-concurrency token; it does not describe
 * whether that version has already been printed.
 */
export async function createNextOrderPrintRequest(
  input: {
    orderId: string;
    workOrderVersion: number;
    reason: string;
    idempotencyKey: string;
  },
  actor: OrderPrintActor,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.orderId,
    )}))`;

    // Preserve the original kind for an exact idempotent replay. Without this
    // lookup, replaying an INITIAL request after it has been acknowledged as
    // printed would be misclassified as a new REPRINT and conflict with itself.
    const existingByKey = await tx.orderPrintJob.findUnique({
      where: { idempotencyKey: input.idempotencyKey.trim() },
      select: { printKind: true },
    });
    const printedHistory = existingByKey
      ? null
      : await tx.orderPrintJob.findFirst({
          where: {
            orderId: input.orderId,
            workOrderVersion: input.workOrderVersion,
            state: OrderPrintJobState.PRINTED,
          },
          select: { id: true },
        });

    return createOrderPrintRequestInTx(
      tx,
      {
        ...input,
        printKind:
          existingByKey?.printKind ??
          (printedHistory ? OrderPrintKind.REPRINT : OrderPrintKind.INITIAL),
      },
      actor,
    );
  });
}
