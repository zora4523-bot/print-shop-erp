import Decimal from 'decimal.js';
import { OrderStatus, OutsourceStatus, Role } from '../generated/prisma/enums';
import { db } from './db';
import {
  transitionOutsource,
  InvalidOutsourceTransitionError,
} from './outsource/status-machine';
import { canAttachOutsource } from './order/status-machine';
import { orderCascadeLockKey } from './order/locks';
import { dispatchNotification } from './notification/dispatch';
import { writeAuditLogInTx, type AuditActor } from './audit-log';
import {
  maybeCompleteProductionOrder,
  type ProductionCompletionTx,
} from './production-completion';
import type {
  CreateOutsourceInput,
  ConfirmOutsourceAmountInput,
  MarkOutsourceReceivedInput,
} from './auth/schemas';

export class OutsourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutsourceError';
  }
}

export type CreatedOutsource = { id: string };

const OUTSOURCE_AMOUNT_MAX = new Decimal('9999999999.99');

function storableOutsourceAmount(
  value: Decimal.Value | null | undefined,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    throw new OutsourceError(`${label}格式不合法`);
  }
  if (
    !amount.isFinite() ||
    amount.isNegative() ||
    amount.decimalPlaces() > 2 ||
    amount.gt(OUTSOURCE_AMOUNT_MAX)
  ) {
    throw new OutsourceError(`${label}必须是非负数，最多 10 位整数和 2 位小数`);
  }
  return amount.toFixed(2);
}

function sameOptionalDate(
  actual: Date | null,
  expected: Date | null | undefined,
): boolean {
  return actual?.getTime() === expected?.getTime();
}

function sameStringArray(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

// Creation joins the shared per-order lock used by schedule/ship/cancel and a
// request-key lock. The locked replay check happens before today's order-state
// gate, so a lost response can still recover the original result after the
// order advances. Actor identity is part of exact-payload equality and the
// first successful write records an audit row in the same transaction.

type OutsourceTxClient = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  order: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{ status: OrderStatus } | null>;
  };
  outsourceOrder: {
    findUnique: (args: {
      where: { idempotencyKey: string };
      select?: unknown;
    }) => Promise<{
      id: string;
      orderId: string | null;
      orderItemIds: string[];
      supplierName: string;
      supplierContact: string | null;
      craftDescription: string | null;
      specialRequirement: string | null;
      totalQty: number | null;
      expectedDate: Date | null;
      amount: Decimal.Value | null;
      remark: string | null;
      createdById: string | null;
    } | null>;
    create: (args: { data: unknown; select?: unknown }) => Promise<{ id: string }>;
  };
};

export async function createOutsourceOrder(
  input: CreateOutsourceInput,
  actor: AuditActor,
): Promise<CreatedOutsource> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as OutsourceTxClient;
    // Per-order advisory lock makes the "order is attachable?" check
    // and the outsource INSERT atomic relative to ANY other Order-
    // status writer (ship / cancel / schedule / finish / cascade).
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.orderId,
    )}))`;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource-create:${input.idempotencyKey}`}))`;

    const amount = storableOutsourceAmount(input.amount, '外协金额');
    const replay = await txClient.outsourceOrder.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: {
        id: true,
        orderId: true,
        orderItemIds: true,
        supplierName: true,
        supplierContact: true,
        craftDescription: true,
        specialRequirement: true,
        totalQty: true,
        expectedDate: true,
        amount: true,
        remark: true,
        createdById: true,
      },
    });
    if (replay) {
      const exactPayload =
        replay.orderId === input.orderId &&
        replay.createdById === actor.id &&
        sameStringArray(replay.orderItemIds, input.orderItemIds) &&
        replay.supplierName === input.supplierName &&
        replay.supplierContact === (input.supplierContact ?? null) &&
        replay.craftDescription === (input.craftDescription ?? null) &&
        replay.specialRequirement === (input.specialRequirement ?? null) &&
        replay.totalQty === (input.totalQty ?? null) &&
        sameOptionalDate(replay.expectedDate, input.expectedDate) &&
        (replay.amount === null
          ? amount === null
          : amount !== null && new Decimal(replay.amount).eq(amount)) &&
        replay.remark === (input.remark ?? null);
      if (!exactPayload) {
        throw new OutsourceError(
          '外协创建请求标识已被其他内容使用，请刷新后重试',
        );
      }
      return { id: replay.id };
    }

    const order = await txClient.order.findUnique({
      where: { id: input.orderId },
      select: { status: true },
    });
    if (!order) throw new OutsourceError('工单不存在');
    if (!canAttachOutsource(order.status)) {
      throw new OutsourceError(
        `工单状态 ${order.status} 不允许新建外协（已发货 / 已完成 / 已取消）`,
      );
    }

    const row = await txClient.outsourceOrder.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        orderId: input.orderId,
        createdById: actor.id,
        orderItemIds: input.orderItemIds,
        supplierName: input.supplierName,
        supplierContact: input.supplierContact ?? null,
        craftDescription: input.craftDescription ?? null,
        specialRequirement: input.specialRequirement ?? null,
        totalQty: input.totalQty ?? null,
        expectedDate: input.expectedDate ?? null,
        amount,
        remark: input.remark ?? null,
        status: OutsourceStatus.SENT,
      },
      select: { id: true },
    });
    await writeAuditLogInTx(tx, {
      actor,
      action: 'CREATE',
      entityType: 'OutsourceOrder',
      entityId: row.id,
      after: {
        orderId: input.orderId,
        orderItemIds: input.orderItemIds,
        supplierName: input.supplierName,
        craftDescription: input.craftDescription ?? null,
        totalQty: input.totalQty ?? null,
        expectedDate: input.expectedDate ?? null,
        amount,
        status: OutsourceStatus.SENT,
      },
      requestMetadata: {
        source: 'foreman-outsource.createOutsourceAction',
        route: '/foreman/outsource/new',
      },
    });
    return row;
  });
}

export type ConfirmedOutsourceAmount = {
  id: string;
  orderId: string | null;
  status: OutsourceStatus;
  amount: string;
};

export async function confirmOutsourceAmount(
  id: string,
  input: ConfirmOutsourceAmountInput,
  actor: AuditActor,
): Promise<ConfirmedOutsourceAmount> {
  const amount = storableOutsourceAmount(input.amount, '外协金额');
  if (amount === null) throw new OutsourceError('请填写外协金额');

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource:${id}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource-amount:${input.idempotencyKey}`}))`;

    const replay = await tx.outsourceAmountChange.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: {
        outsourceOrderId: true,
        newAmount: true,
        reason: true,
        changedById: true,
        outsourceOrder: {
          select: { id: true, orderId: true, status: true },
        },
      },
    });
    if (replay) {
      if (
        replay.outsourceOrderId !== id ||
        replay.changedById !== actor.id ||
        !new Decimal(replay.newAmount).eq(amount) ||
        replay.reason !== input.reason
      ) {
        throw new OutsourceError(
          '外协金额请求标识已被其他内容使用，请刷新后重试',
        );
      }
      return {
        id: replay.outsourceOrder.id,
        orderId: replay.outsourceOrder.orderId,
        status: replay.outsourceOrder.status,
        amount: new Decimal(replay.newAmount).toFixed(2),
      };
    }

    const row = await tx.outsourceOrder.findUnique({
      where: { id },
      select: { id: true, orderId: true, status: true, amount: true },
    });
    if (!row) throw new OutsourceError('外协单不存在');
    if (row.status === OutsourceStatus.CANCELLED) {
      throw new OutsourceError('已取消的外协单不能确认成本金额');
    }
    if (row.amount !== null && new Decimal(row.amount).eq(amount)) {
      throw new OutsourceError('外协金额未发生变化');
    }

    const change = await tx.outsourceAmountChange.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        outsourceOrderId: id,
        previousAmount:
          row.amount === null ? null : new Decimal(row.amount).toFixed(2),
        newAmount: amount,
        reason: input.reason,
        changedById: actor.id,
      },
      select: { id: true },
    });
    await tx.outsourceOrder.update({
      where: { id },
      data: { amount },
    });
    await writeAuditLogInTx(tx, {
      actor,
      action: row.amount === null ? 'CONFIRM_AMOUNT' : 'UPDATE_AMOUNT',
      entityType: 'OutsourceOrder',
      entityId: id,
      before: { amount: row.amount === null ? null : String(row.amount) },
      after: { amount, amountChangeId: change.id, reason: input.reason },
      requestMetadata: {
        source: 'foreman-outsource.confirmOutsourceAmountAction',
        route: `/foreman/outsource/${id}`,
      },
    });

    return { id, orderId: row.orderId, status: row.status, amount };
  });
}

export type OutsourceMutationResult = {
  id: string;
  status: OutsourceStatus;
  orderCompleted?: boolean;
  orderId?: string | null;
};

type ReceiveOutsourceTxClient = ProductionCompletionTx & {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  outsourceOrder: ProductionCompletionTx['outsourceOrder'] & {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{
      id: string;
      orderId: string | null;
      status: OutsourceStatus;
    } | null>;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<{ id: string; status: OutsourceStatus }>;
  };
};

// SENT / IN_PROGRESS → RECEIVED. Receiving the final required outsource
// row participates in the same completion gate as the last internal task.
export async function markOutsourceReceived(
  id: string,
  input: MarkOutsourceReceivedInput,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<OutsourceMutationResult> {
  const result = await db.$transaction(async (tx) => {
    const txClient = tx as unknown as ReceiveOutsourceTxClient;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource:${id}`}))`;

    const row = await txClient.outsourceOrder.findUnique({
      where: { id },
      select: { id: true, orderId: true, status: true },
    });
    if (!row) throw new OutsourceError('外协单不存在');

    if (row.orderId) {
      await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
        row.orderId,
      )}))`;
    }

    // Re-read after the locks so a concurrent receive/cancel cannot leave a
    // stale transition decision.
    const fresh = await txClient.outsourceOrder.findUnique({
      where: { id },
      select: { id: true, orderId: true, status: true },
    });
    if (!fresh) throw new OutsourceError('外协单不存在');
    transitionOutsource(fresh.status, OutsourceStatus.RECEIVED);

    const updated = await txClient.outsourceOrder.update({
      where: { id },
      data: {
        status: OutsourceStatus.RECEIVED,
        actualDate: input.actualDate ?? now,
      },
      select: { id: true, status: true },
    });

    const orderCompleted = fresh.orderId
      ? await maybeCompleteProductionOrder(
          txClient,
          fresh.orderId,
          actor.id,
          now,
        )
      : false;
    return { ...updated, orderCompleted, orderId: fresh.orderId };
  });

  if (result.orderCompleted && result.orderId) {
    const order = await db.order.findUnique({
      where: { id: result.orderId },
      select: { id: true, orderNo: true, customerRef: true },
    });
    if (order) {
      await dispatchNotification(
        'ORDER_COMPLETED',
        {
          orderId: order.id,
          orderNo: order.orderNo,
          customerRef: order.customerRef,
        },
        { dedupeKey: `notification:ORDER_COMPLETED:${order.id}` },
      );
    }
  }

  return {
    id: result.id,
    status: result.status,
    orderCompleted: result.orderCompleted,
    orderId: result.orderId,
  };
}

export async function cancelOutsourceOrder(
  id: string,
  actor: { id: string; role: Role },
): Promise<OutsourceMutationResult> {
  const result = await db.$transaction(async (tx) => {
    const txClient = tx as unknown as ReceiveOutsourceTxClient;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource:${id}`}))`;
    const row = await txClient.outsourceOrder.findUnique({
      where: { id },
      select: { id: true, orderId: true, status: true },
    });
    if (!row) throw new OutsourceError('外协单不存在');
    if (row.orderId) {
      await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
        row.orderId,
      )}))`;
    }
    const fresh = await txClient.outsourceOrder.findUnique({
      where: { id },
      select: { id: true, orderId: true, status: true },
    });
    if (!fresh) throw new OutsourceError('外协单不存在');
    transitionOutsource(fresh.status, OutsourceStatus.CANCELLED);
    const updated = await txClient.outsourceOrder.update({
      where: { id },
      data: { status: OutsourceStatus.CANCELLED },
      select: { id: true, status: true },
    });
    const orderCompleted = fresh.orderId
      ? await maybeCompleteProductionOrder(
          txClient,
          fresh.orderId,
          actor.id,
          new Date(),
        )
      : false;
    return { ...updated, orderId: fresh.orderId, orderCompleted };
  });

  if (result.orderCompleted && result.orderId) {
    const order = await db.order.findUnique({
      where: { id: result.orderId },
      select: { id: true, orderNo: true, customerRef: true },
    });
    if (order) {
      await dispatchNotification(
        'ORDER_COMPLETED',
        {
          orderId: order.id,
          orderNo: order.orderNo,
          customerRef: order.customerRef,
        },
        { dedupeKey: `notification:ORDER_COMPLETED:${order.id}` },
      );
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────

export async function listOutsourceOrders(
  filter: { status?: OutsourceStatus } = {},
) {
  return db.outsourceOrder.findMany({
    where: filter.status ? { status: filter.status } : undefined,
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      status: true,
      supplierName: true,
      craftDescription: true,
      totalQty: true,
      expectedDate: true,
      actualDate: true,
      amount: true,
      createdAt: true,
      order: { select: { id: true, orderNo: true, isUrgent: true } },
    },
  });
}

// Order + items for the "创建外协单" form (checkbox list of items).
// Foreman sees everything, so no scope filter — but the read lives in
// lib/ so the page never touches Prisma directly (CLAUDE.md §3).
export async function getOrderForOutsourceForm(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      items: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          name: true,
          quantity: true,
        },
      },
    },
  });
}

export async function getOutsourceOrderDetail(id: string) {
  return db.outsourceOrder.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      orderItemIds: true,
      supplierName: true,
      supplierContact: true,
      craftDescription: true,
      specialRequirement: true,
      totalQty: true,
      expectedDate: true,
      actualDate: true,
      amount: true,
      status: true,
      remark: true,
      createdAt: true,
      updatedAt: true,
      amountChanges: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          previousAmount: true,
          newAmount: true,
          reason: true,
          createdAt: true,
          changedBy: { select: { displayName: true } },
        },
      },
      order: { select: { id: true, orderNo: true, isUrgent: true } },
    },
  });
}

export { InvalidOutsourceTransitionError };
