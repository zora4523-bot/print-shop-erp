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
import {
  maybeCompleteProductionOrder,
  type ProductionCompletionTx,
} from './production-completion';
import type {
  CreateOutsourceInput,
  MarkOutsourceReceivedInput,
} from './auth/schemas';

export class OutsourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutsourceError';
  }
}

export type CreatedOutsource = { id: string };

// Simple non-transactional create — one INSERT. We verify the order
// exists and keep orderItemIds as a plain string[] (no FK relation
// table). Prisma already rejects a missing orderId FK, so we don't
// redundantly findFirst; the error maps cleanly to { status: 'error' }.
//
// Actor is taken but not used today — kept in the signature for
// forward-compat when we start writing an audit log for
// outsource-order mutations.
// Same lock namespace as transitionWithLog + scheduleOrder + worker
// cascade。
// races against shipOrder / cancelOrder; folding both into one tx
// behind the per-order lock makes "order is still attachable" an
// atomic decision.

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
    create: (args: { data: unknown; select?: unknown }) => Promise<{ id: string }>;
  };
};

export async function createOutsourceOrder(
  input: CreateOutsourceInput,
  actor: { id: string; role: Role },
): Promise<CreatedOutsource> {
  void actor;
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as OutsourceTxClient;
    // Per-order advisory lock makes the "order is attachable?" check
    // and the outsource INSERT atomic relative to ANY other Order-
    // status writer (ship / cancel / schedule / finish / cascade).
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.orderId,
    )}))`;

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
        orderId: input.orderId,
        orderItemIds: input.orderItemIds,
        supplierName: input.supplierName,
        supplierContact: input.supplierContact,
        craftDescription: input.craftDescription,
        specialRequirement: input.specialRequirement,
        totalQty: input.totalQty ?? null,
        expectedDate: input.expectedDate ?? null,
        amount:
          input.amount === null || input.amount === undefined
            ? null
            : new Decimal(input.amount).toFixed(2),
        remark: input.remark,
        status: OutsourceStatus.SENT,
      },
      select: { id: true },
    });
    return row;
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
      order: { select: { id: true, orderNo: true, isUrgent: true } },
    },
  });
}

export { InvalidOutsourceTransitionError };
