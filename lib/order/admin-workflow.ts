import type { Prisma } from '../../generated/prisma/client';
import {
  OrderChangeRequestStatus,
  OrderPrintJobState,
  OrderPrintKind,
  OrderStatus,
  OrderWorkflowAction,
  OrderWorkflowReasonCode,
  Role,
} from '../../generated/prisma/enums';
import { databaseClockNow } from '../background-jobs/clock';
import { db } from '../db';
import { lockSettlementCutoffShared } from '../finance/settlement-cutoff-lock';
import { activateProductionOperationsInTx } from '../production/operation-materialization-service';
import { orderCascadeLockKey } from './locks';
import { createOrderPrintRequestInTx } from './print-jobs';
import { transitionOrder } from './status-machine';
import {
  confirmOrderPricingAtCurrentPublishedVersionInTx,
  OrderChangeRequestError,
} from './change-request';
import { evaluateFactoryConfirmationPreflight } from './factory-confirmation-preflight';

export type AdminWorkflowActor = { id: string; role: Role };

export class AdminOrderWorkflowError extends Error {
  constructor(
    public readonly code:
      | 'FORBIDDEN'
      | 'INVALID_INPUT'
      | 'ORDER_NOT_FOUND'
      | 'INVALID_STATUS'
      | 'STALE_VERSION'
      | 'PREFLIGHT_FAILED'
      | 'IDEMPOTENCY_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'AdminOrderWorkflowError';
  }
}

type WorkflowTx = Prisma.TransactionClient;

function assertAdmin(actor: AdminWorkflowActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new AdminOrderWorkflowError('FORBIDDEN', '只有管理员可以执行工厂裁决');
  }
}

function checkedIdempotencyKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 128) {
    throw new AdminOrderWorkflowError(
      'INVALID_INPUT',
      '操作请求标识长度必须为 8–128 个字符',
    );
  }
  return key;
}

function checkedNote(value: string, label: string): string {
  const note = value.trim();
  if (!note || note.length > 500) {
    throw new AdminOrderWorkflowError(
      'INVALID_INPUT',
      `${label}必须为 1–500 个字符`,
    );
  }
  return note;
}

function checkedAffectedFigs(value: readonly number[]): number[] {
  const figs = [...new Set(value)];
  if (figs.some((fig) => !Number.isSafeInteger(fig) || fig < 1)) {
    throw new AdminOrderWorkflowError('INVALID_INPUT', '受影响款号必须为正整数');
  }
  return figs.sort((left, right) => left - right);
}

function checkedRecoveryEvidence(
  value: Record<string, string>,
): Prisma.InputJsonObject {
  const evidence = Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key.trim(), item.trim()] as const)
      .filter(([key, item]) => key && item),
  );
  if (Object.keys(evidence).length === 0) {
    throw new AdminOrderWorkflowError(
      'INVALID_INPUT',
      '恢复生产必须提供已排除问题的证据',
    );
  }
  return evidence;
}

async function lockOrder(tx: WorkflowTx, orderId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
    orderId,
  )}))`;
}

const workflowOrderSelect = {
  id: true,
  orderNo: true,
  status: true,
  revision: true,
  workOrderVersion: true,
  pricingStatus: true,
  quotedFeeCompleteness: true,
  quotedFee: true,
  confirmedFee: true,
  totalAmount: true,
  billingMode: true,
  items: { select: { fig: true, quantity: true } },
  _count: {
    select: {
      changeRequests: {
        where: { status: OrderChangeRequestStatus.PENDING },
      },
    },
  },
} satisfies Prisma.OrderSelect;

type WorkflowOrder = Prisma.OrderGetPayload<{
  select: typeof workflowOrderSelect;
}>;

async function readLockedOrder(
  tx: WorkflowTx,
  orderId: string,
): Promise<WorkflowOrder> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: workflowOrderSelect,
  });
  if (!order) {
    throw new AdminOrderWorkflowError('ORDER_NOT_FOUND', '工单不存在');
  }
  return order;
}

function assertExpectedVersion(
  order: Pick<WorkflowOrder, 'revision' | 'workOrderVersion'>,
  input: { expectedRevision: number; expectedWorkOrderVersion: number },
): void {
  if (
    order.revision !== input.expectedRevision ||
    order.workOrderVersion !== input.expectedWorkOrderVersion
  ) {
    throw new AdminOrderWorkflowError(
      'STALE_VERSION',
      '工单内容或纸质版本已变更，请刷新后重试',
    );
  }
}

function assertNoPendingChange(order: WorkflowOrder): void {
  if (order._count.changeRequests > 0) {
    throw new AdminOrderWorkflowError(
      'PREFLIGHT_FAILED',
      '工单存在待裁决变更申请，暂不能执行该操作',
    );
  }
}

function assertFactoryConfirmationPreflight(order: WorkflowOrder): void {
  if (
    order.status !== OrderStatus.PENDING_FACTORY &&
    order.status !== OrderStatus.SUBMITTED
  ) {
    throw new AdminOrderWorkflowError(
      'INVALID_STATUS',
      `工单当前状态 ${order.status} 不是待工厂确认`,
    );
  }
  const preflight = evaluateFactoryConfirmationPreflight({
    status: order.status,
    itemQuantities: order.items.map((item) => item.quantity),
    pricingStatus: order.pricingStatus,
    confirmedFee: order.confirmedFee,
    totalAmount: order.totalAmount,
    pendingChangeRequestCount: order._count.changeRequests,
    manualPricingPending: false,
  });
  if (!preflight.ok) {
    throw new AdminOrderWorkflowError(
      'PREFLIGHT_FAILED',
      `工单预检未通过：${preflight.issues.join('；')}`,
    );
  }
}

function assertFigsBelongToOrder(
  order: WorkflowOrder,
  affectedFigs: readonly number[],
): void {
  const orderFigs = new Set(order.items.flatMap((item) => item.fig ?? []));
  const missing = affectedFigs.filter((fig) => !orderFigs.has(fig));
  if (missing.length > 0) {
    throw new AdminOrderWorkflowError(
      'INVALID_INPUT',
      `受影响款号不属于该工单：${missing.join('、')}`,
    );
  }
}

async function findDecisionReplay(
  tx: WorkflowTx,
  input: {
    idempotencyKey: string;
    orderId: string;
    action: OrderWorkflowAction;
  },
) {
  const existing = await tx.orderWorkflowDecision.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, orderId: true, action: true, toStatus: true },
  });
  if (!existing) return null;
  if (existing.orderId !== input.orderId || existing.action !== input.action) {
    throw new AdminOrderWorkflowError(
      'IDEMPOTENCY_CONFLICT',
      '同一操作请求标识已用于其他裁决',
    );
  }
  return existing;
}

export async function confirmFactoryOrder(
  input: {
    orderId: string;
    expectedRevision: number;
    expectedWorkOrderVersion: number;
  },
  actor: AdminWorkflowActor,
): Promise<{ orderId: string; status: OrderStatus; confirmedFee: string }> {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await readLockedOrder(tx, input.orderId);
    if (order.status === OrderStatus.CONFIRMED) {
      if (order.confirmedFee === null) {
        throw new AdminOrderWorkflowError(
          'PREFLIGHT_FAILED',
          '已确认工单缺少确认费用，请人工审计',
        );
      }
      return {
        orderId: order.id,
        status: order.status,
        confirmedFee: order.confirmedFee.toFixed(2),
      };
    }
    assertExpectedVersion(order, input);
    assertFactoryConfirmationPreflight(order);
    const confirmedAt = await databaseClockNow(tx);
    let currentPricing;
    try {
      currentPricing = await confirmOrderPricingAtCurrentPublishedVersionInTx(
        tx,
        {
          orderId: order.id,
          actorId: actor.id,
          now: confirmedAt,
        },
      );
    } catch (error) {
      if (error instanceof OrderChangeRequestError) {
        throw new AdminOrderWorkflowError(
          'PREFLIGHT_FAILED',
          `按当前发布价核价失败：${error.message}`,
        );
      }
      throw error;
    }
    const confirmedFee = currentPricing.confirmedFee;
    transitionOrder(order.status, OrderStatus.CONFIRMED);
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CONFIRMED,
        confirmedFee,
        revision: { increment: 1 },
      },
      select: { id: true },
    });
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        operatorId: actor.id,
        action: 'FACTORY_CONFIRMED',
        changedFields: {
          status: { before: order.status, after: OrderStatus.CONFIRMED },
          confirmedFee: {
            before: order.confirmedFee?.toFixed(2) ?? null,
            after: confirmedFee,
          },
          revision: { before: order.revision, after: order.revision + 1 },
        },
        remark: '工厂预检通过并确认工单',
      },
    });
    return { orderId: order.id, status: OrderStatus.CONFIRMED, confirmedFee };
  });
}

export async function rejectFactoryOrder(
  input: {
    orderId: string;
    reasonCode: OrderWorkflowReasonCode;
    reasonNote: string;
    affectedFigs: readonly number[];
    idempotencyKey: string;
  },
  actor: AdminWorkflowActor,
): Promise<{ orderId: string; status: OrderStatus; idempotentReplay: boolean }> {
  assertAdmin(actor);
  const idempotencyKey = checkedIdempotencyKey(input.idempotencyKey);
  const reasonNote = checkedNote(input.reasonNote, '驳回说明');
  if (
    input.reasonCode !== OrderWorkflowReasonCode.PAPER_OUT &&
    input.reasonCode !== OrderWorkflowReasonCode.DESIGN_ERROR
  ) {
    throw new AdminOrderWorkflowError(
      'INVALID_INPUT',
      '驳回原因只能是纸张库存不足或设计图有误',
    );
  }
  const affectedFigs = checkedAffectedFigs(input.affectedFigs);
  return db.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const replay = await findDecisionReplay(tx, {
      idempotencyKey,
      orderId: input.orderId,
      action: OrderWorkflowAction.REJECT,
    });
    if (replay) {
      return {
        orderId: input.orderId,
        status: replay.toStatus,
        idempotentReplay: true,
      };
    }
    const order = await readLockedOrder(tx, input.orderId);
    assertNoPendingChange(order);
    assertFigsBelongToOrder(order, affectedFigs);
    transitionOrder(order.status, OrderStatus.REJECTED);
    await tx.orderWorkflowDecision.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: OrderStatus.REJECTED,
        action: OrderWorkflowAction.REJECT,
        reasonCode: input.reasonCode,
        reasonNote,
        affectedFigs,
        actorId: actor.id,
        idempotencyKey,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.REJECTED, revision: { increment: 1 } },
      select: { id: true },
    });
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        operatorId: actor.id,
        action: 'FACTORY_REJECTED',
        changedFields: {
          status: { before: order.status, after: OrderStatus.REJECTED },
          affectedFigs: { before: null, after: affectedFigs },
        },
        remark: `${input.reasonCode}：${reasonNote}`,
      },
    });
    return {
      orderId: order.id,
      status: OrderStatus.REJECTED,
      idempotentReplay: false,
    };
  });
}

export async function holdFactoryOrder(
  input: {
    orderId: string;
    reasonCode: OrderWorkflowReasonCode;
    reasonNote: string;
    affectedFigs: readonly number[];
    idempotencyKey: string;
  },
  actor: AdminWorkflowActor,
): Promise<{ orderId: string; status: OrderStatus; idempotentReplay: boolean }> {
  assertAdmin(actor);
  const idempotencyKey = checkedIdempotencyKey(input.idempotencyKey);
  const reasonNote = checkedNote(input.reasonNote, '暂停说明');
  const affectedFigs = checkedAffectedFigs(input.affectedFigs);
  return db.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const replay = await findDecisionReplay(tx, {
      idempotencyKey,
      orderId: input.orderId,
      action: OrderWorkflowAction.HOLD,
    });
    if (replay) {
      return {
        orderId: input.orderId,
        status: replay.toStatus,
        idempotentReplay: true,
      };
    }
    const order = await readLockedOrder(tx, input.orderId);
    assertNoPendingChange(order);
    assertFigsBelongToOrder(order, affectedFigs);
    transitionOrder(order.status, OrderStatus.ON_HOLD);
    await tx.orderWorkflowDecision.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: OrderStatus.ON_HOLD,
        action: OrderWorkflowAction.HOLD,
        reasonCode: input.reasonCode,
        reasonNote,
        affectedFigs,
        actorId: actor.id,
        idempotencyKey,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.ON_HOLD, revision: { increment: 1 } },
      select: { id: true },
    });
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        operatorId: actor.id,
        action: 'FACTORY_HELD',
        changedFields: {
          status: { before: order.status, after: OrderStatus.ON_HOLD },
          affectedFigs: { before: null, after: affectedFigs },
        },
        remark: `${input.reasonCode}：${reasonNote}`,
      },
    });
    return {
      orderId: order.id,
      status: OrderStatus.ON_HOLD,
      idempotentReplay: false,
    };
  });
}

export async function resumeFactoryOrder(
  input: {
    orderId: string;
    recoveryEvidence: Record<string, string>;
    note?: string | null;
    idempotencyKey: string;
  },
  actor: AdminWorkflowActor,
): Promise<{ orderId: string; status: OrderStatus; idempotentReplay: boolean }> {
  assertAdmin(actor);
  const idempotencyKey = checkedIdempotencyKey(input.idempotencyKey);
  const recoveryEvidence = checkedRecoveryEvidence(input.recoveryEvidence);
  const note = input.note?.trim() || null;
  if (note && note.length > 500) {
    throw new AdminOrderWorkflowError('INVALID_INPUT', '恢复说明不能超过 500 字');
  }
  return db.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const replay = await findDecisionReplay(tx, {
      idempotencyKey,
      orderId: input.orderId,
      action: OrderWorkflowAction.RESUME,
    });
    if (replay) {
      return {
        orderId: input.orderId,
        status: replay.toStatus,
        idempotentReplay: true,
      };
    }
    const order = await readLockedOrder(tx, input.orderId);
    assertNoPendingChange(order);
    if (order.status !== OrderStatus.ON_HOLD) {
      throw new AdminOrderWorkflowError(
        'INVALID_STATUS',
        `工单当前状态 ${order.status} 不是已暂停`,
      );
    }
    const hold = await tx.orderWorkflowDecision.findFirst({
      where: { orderId: order.id, action: OrderWorkflowAction.HOLD },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { fromStatus: true },
    });
    if (!hold) {
      throw new AdminOrderWorkflowError(
        'PREFLIGHT_FAILED',
        '暂停工单缺少原状态裁决记录，禁止猜测恢复',
      );
    }
    transitionOrder(order.status, hold.fromStatus);
    await tx.orderWorkflowDecision.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: hold.fromStatus,
        action: OrderWorkflowAction.RESUME,
        reasonNote: note,
        recoveryEvidence,
        actorId: actor.id,
        idempotencyKey,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { status: hold.fromStatus, revision: { increment: 1 } },
      select: { id: true },
    });
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        operatorId: actor.id,
        action: 'FACTORY_RESUMED',
        changedFields: {
          status: { before: order.status, after: hold.fromStatus },
          recoveryEvidence: { before: null, after: recoveryEvidence },
        },
        remark: note ?? '已验证恢复证据并继续生产',
      },
    });
    return {
      orderId: order.id,
      status: hold.fromStatus,
      idempotentReplay: false,
    };
  });
}

export async function releaseFactoryOrder(
  input: {
    orderId: string;
    expectedRevision: number;
    expectedWorkOrderVersion: number;
    printIdempotencyKey: string;
  },
  actor: AdminWorkflowActor,
): Promise<{
  orderId: string;
  status: OrderStatus;
  printJobId: string;
  idempotentReplay: boolean;
}> {
  assertAdmin(actor);
  const printIdempotencyKey = checkedIdempotencyKey(input.printIdempotencyKey);
  return db.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await readLockedOrder(tx, input.orderId);
    const replay = await tx.orderPrintJob.findUnique({
      where: { idempotencyKey: printIdempotencyKey },
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
    if (replay) {
      if (
        replay.orderId !== order.id ||
        replay.workOrderVersion !== input.expectedWorkOrderVersion ||
        replay.printKind !== OrderPrintKind.INITIAL ||
        replay.reason !== '工单首次下发' ||
        replay.state !== OrderPrintJobState.PENDING ||
        replay.requestJobId !== null
      ) {
        throw new AdminOrderWorkflowError(
          'IDEMPOTENCY_CONFLICT',
          '同一下发请求标识已用于其他操作',
        );
      }
      return {
        orderId: order.id,
        status: OrderStatus.RELEASED,
        printJobId: replay.id,
        idempotentReplay: true,
      };
    }
    assertExpectedVersion(order, input);
    assertNoPendingChange(order);
    if (order.status !== OrderStatus.RELEASED) {
      if (order.status !== OrderStatus.CONFIRMED) {
        throw new AdminOrderWorkflowError(
          'INVALID_STATUS',
          `工单当前状态 ${order.status} 不允许下发`,
        );
      }
      await activateProductionOperationsInTx(tx, order.id, actor, undefined, {
        targetStatus: OrderStatus.RELEASED,
      });
    }
    const print = await createOrderPrintRequestInTx(
      tx,
      {
        orderId: order.id,
        workOrderVersion: order.workOrderVersion,
        printKind: OrderPrintKind.INITIAL,
        reason: '工单首次下发',
        idempotencyKey: printIdempotencyKey,
      },
      actor,
    );
    return {
      orderId: order.id,
      status: OrderStatus.RELEASED,
      printJobId: print.jobId,
      idempotentReplay: print.idempotentReplay,
    };
  });
}

export async function settleFactoryOrder(
  input: {
    orderId: string;
    expectedRevision: number;
    expectedWorkOrderVersion: number;
  },
  actor: AdminWorkflowActor,
): Promise<{
  orderId: string;
  status: OrderStatus;
  settledFee: string;
  settledAt: Date;
  idempotentReplay: boolean;
}> {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    // This must remain the first database statement in the settlement writer.
    await lockSettlementCutoffShared(tx);
    await lockOrder(tx, input.orderId);
    const order = await readLockedOrder(tx, input.orderId);
    if (
      order.status === OrderStatus.SETTLED &&
      order.confirmedFee !== null
    ) {
      const settled = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { settledFee: true, settledAt: true },
      });
      if (settled.settledFee !== null && settled.settledAt !== null) {
        return {
          orderId: order.id,
          status: order.status,
          settledFee: settled.settledFee.toFixed(2),
          settledAt: settled.settledAt,
          idempotentReplay: true,
        };
      }
    }
    assertExpectedVersion(order, input);
    if (order.status !== OrderStatus.SHIPPED) {
      throw new AdminOrderWorkflowError(
        'INVALID_STATUS',
        `工单当前状态 ${order.status} 不允许结算`,
      );
    }
    assertNoPendingChange(order);
    if (order.confirmedFee === null) {
      throw new AdminOrderWorkflowError(
        'PREFLIGHT_FAILED',
        '发货工单缺少已确认费用，禁止猜测结算',
      );
    }
    transitionOrder(order.status, OrderStatus.SETTLED);
    const settledAt = await databaseClockNow(tx);
    const settledFee = order.confirmedFee.toFixed(2);
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.SETTLED,
        settledFee,
        settledAt,
        settlementContractVersion: 2,
        revision: { increment: 1 },
      },
      select: { id: true },
    });
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        operatorId: actor.id,
        action: 'ORDER_SETTLED_V2',
        changedFields: {
          status: { before: order.status, after: OrderStatus.SETTLED },
          settledFee: { before: null, after: settledFee },
          settledAt: { before: null, after: settledAt.toISOString() },
          settlementContractVersion: { before: null, after: 2 },
        },
        remark: '显式结算，按已确认费用写入 v2 结算事实',
      },
    });
    return {
      orderId: order.id,
      status: OrderStatus.SETTLED,
      settledFee,
      settledAt,
      idempotentReplay: false,
    };
  });
}
