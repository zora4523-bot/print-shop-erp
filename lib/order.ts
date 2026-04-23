import Decimal from 'decimal.js';
import {
  OrderStatus,
  type Role,
} from '../generated/prisma/client';
import { db } from './db';
import { nextOrderNumber } from './order/order-number';
import {
  transitionOrder,
  InvalidOrderTransitionError,
} from './order/status-machine';
import type { CreateOrderInput } from './auth/schemas';
import { getOrderScopeFilter } from './auth/order-scope';

export class OrderInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderInvariantError';
  }
}

// Minimum TxClient surface the order module needs. Kept local so we don't
// import from lib/account.ts (different table surface).
type OrderTxClient = {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  order: {
    create: (args: { data: unknown; select?: unknown }) => Promise<{ id: string; orderNo: string }>;
    findFirst: (args: {
      where: unknown;
      orderBy?: unknown;
      select?: unknown;
    }) => Promise<{ orderNo: string } | null>;
  };
  craft: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string }>>;
  };
  product: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{ id: string; isActive: boolean } | null>;
  };
};

// Decimal(12,2) column — 12 total digits, 2 after the point. Quantity is
// an int and unitPrice is a string like '0.1234'. The multiplication must
// happen in Decimal.js to preserve precision (plain JS floats round).
function computeSubtotal(quantity: number, unitPrice: string | null): string {
  const price = new Decimal(unitPrice ?? '0');
  return price.times(quantity).toFixed(2);
}

function sumTotals(subtotals: string[]): string {
  return subtotals
    .reduce((acc, s) => acc.plus(new Decimal(s)), new Decimal(0))
    .toFixed(2);
}

export type CreatedOrderSummary = {
  id: string;
  orderNo: string;
};

// The transaction path:
//   1. advisory-lock the per-day order-seq (inside nextOrderNumber)
//   2. verify every referenced Craft exists + is active
//   3. verify the optional productId (if any) exists + is active
//   4. compute subtotals + totalAmount in Decimal.js
//   5. nested-create Order + items + initial OrderLog("CREATE") in one call
export async function createOrder(
  input: CreateOrderInput,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<CreatedOrderSummary> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as OrderTxClient;

    // (1) allocate a fresh YYYYMMDD-XXXX (advisory lock inside).
    const orderNo = await nextOrderNumber(txClient, now);

    // (2) craft FK + activation check — surfaces a clean invariant error
    // instead of a Prisma FK error.
    const craftIds = [...new Set(input.items.flatMap((it) => it.crafts))];
    const foundCrafts = await txClient.craft.findMany({
      where: { id: { in: craftIds }, isActive: true },
      select: { id: true },
    });
    if (foundCrafts.length !== craftIds.length) {
      const missing = craftIds.filter((id) => !foundCrafts.some((c) => c.id === id));
      throw new OrderInvariantError(
        `工艺不存在或已停用：${missing.join(', ')}`,
      );
    }

    // (3) product FK per item (if supplied). Cheaper to do per-id since
    // most items won't reference a product explicitly.
    for (const item of input.items) {
      if (!item.productId) continue;
      const product = await txClient.product.findUnique({
        where: { id: item.productId },
        select: { id: true, isActive: true },
      });
      if (!product) {
        throw new OrderInvariantError(`产品不存在：${item.productId}`);
      }
      if (!product.isActive) {
        throw new OrderInvariantError(`产品已停用：${item.productId}`);
      }
    }

    // (4) totals.
    const itemsWithSubtotals = input.items.map((it) => ({
      ...it,
      subtotal: computeSubtotal(it.quantity, it.unitPrice),
    }));
    const totalAmount = sumTotals(itemsWithSubtotals.map((i) => i.subtotal));

    // (5) one nested write: Order + items + first OrderLog.
    const created = await txClient.order.create({
      data: {
        orderNo,
        submitterId: actor.id,
        submitterRole: actor.role,
        createdById: actor.id,
        status: OrderStatus.DRAFT,
        isUrgent: input.isUrgent,
        customerRef: input.customerRef,
        receiverName: input.receiverName,
        receiverPhone: input.receiverPhone,
        receiverAddress: input.receiverAddress,
        expressCode: input.expressCode,
        packageRequirement: input.packageRequirement,
        remark: input.remark,
        totalAmount,
        items: {
          create: itemsWithSubtotals.map((it, idx) => ({
            sequence: idx + 1,
            name: it.name,
            productId: it.productId ?? null,
            specification: it.specification ?? null,
            paperType: it.paperType ?? null,
            quantity: it.quantity,
            crafts: it.crafts,
            foilColor: it.foilColor ?? null,
            isDoubleSided: it.isDoubleSided,
            isDoubleColor: it.isDoubleColor,
            unitPrice: it.unitPrice ?? '0',
            subtotal: it.subtotal,
            suggestedPrice: it.suggestedPrice,
            remark: it.remark ?? null,
          })),
        },
        logs: {
          create: [
            {
              operatorId: actor.id,
              action: 'CREATE',
              remark: input.isUrgent ? '创建急单' : '创建工单',
            },
          ],
        },
      },
      select: { id: true, orderNo: true },
    });

    return created;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────────────────────────────

// Minimal tx surface for status-transition operations (no craft / product
// cross-table work, unlike create).
type StatusTxClient = {
  order: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{ id: string; status: OrderStatus; submitterId: string } | null>;
    update: (args: { where: { id: string }; data: unknown; select?: unknown }) => Promise<{
      id: string;
      status: OrderStatus;
    }>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

async function transitionWithLog(
  orderId: string,
  target: OrderStatus,
  actor: { id: string; role: Role },
  remark: string | null,
): Promise<{ id: string; status: OrderStatus }> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as StatusTxClient;
    const target_order = await txClient.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, submitterId: true },
    });
    if (!target_order) throw new OrderInvariantError('工单不存在');

    // status-machine.ts throws InvalidOrderTransitionError on bad moves —
    // we let it propagate (action layer maps to a generic error result).
    transitionOrder(target_order.status, target);

    const updated = await txClient.order.update({
      where: { id: orderId },
      data: {
        status: target,
        submittedAt: target === OrderStatus.SUBMITTED ? new Date() : undefined,
      },
      select: { id: true, status: true },
    });

    await txClient.orderLog.create({
      data: {
        orderId,
        operatorId: actor.id,
        action: 'STATUS_CHANGE',
        changedFields: {
          status: { before: target_order.status, after: target },
        },
        remark,
      },
    });

    return updated;
  });
}

export async function submitOrder(
  orderId: string,
  actor: { id: string; role: Role },
): Promise<{ id: string; status: OrderStatus }> {
  return transitionWithLog(orderId, OrderStatus.SUBMITTED, actor, '提交工单');
}

export async function cancelOrder(
  orderId: string,
  actor: { id: string; role: Role },
  reason: string | null,
): Promise<{ id: string; status: OrderStatus }> {
  return transitionWithLog(
    orderId,
    OrderStatus.CANCELLED,
    actor,
    reason ? `取消：${reason}` : '取消工单',
  );
}

// ─────────────────────────────────────────────────────────────────────
// Read helpers — scoped by role (SPEC §2.2 permission matrix)
// ─────────────────────────────────────────────────────────────────────

export type OrderListRow = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  isUrgent: boolean;
  customerRef: string | null;
  receiverName: string | null;
  totalAmount: unknown; // Prisma Decimal — UI layer formats
  submitterId: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function listOrders(
  user: { id: string; role: Role },
): Promise<OrderListRow[]> {
  return db.order.findMany({
    where: getOrderScopeFilter(user),
    select: {
      id: true,
      orderNo: true,
      status: true,
      isUrgent: true,
      customerRef: true,
      receiverName: true,
      totalAmount: true,
      submitterId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ isUrgent: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getOrderDetail(id: string, user: { id: string; role: Role }) {
  const order = await db.order.findFirst({
    where: {
      id,
      // Same scope filter as listOrders — fetching by id respects the
      // role-based visibility rather than erroring inconsistently.
      ...getOrderScopeFilter(user),
    },
    include: {
      items: {
        orderBy: { sequence: 'asc' },
        include: { designs: true },
      },
      logs: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      submitter: {
        select: { id: true, displayName: true, username: true, role: true },
      },
    },
  });
  return order;
}

// Re-export for action-layer error mapping.
export { InvalidOrderTransitionError };
