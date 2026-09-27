// Shared by the Next workspace and the normal Node background worker.
// Keep this read/authorization layer free of Next-only runtime imports.
import {
  OrderBillingMode, OrderChangeRequestStatus, OrderCustomerChargeStatus,
  OrderItemQuoteDisposition, OrderQuotedFeeCompleteness, OrderSettlementType,
  OrderStatus, Prisma, Role,
} from '../../generated/prisma/client';
import { UnauthorizedError } from '../auth/errors';
import { db } from '../db';
import { shanghaiDayBoundary, todayShanghai } from '../dashboard/shanghai-clock';
import { buildOrderWhere } from './list-query';
import { overdueCutoff } from './promised-date';
import { FACTORY_CONFIRMATION_PENDING_STATUSES } from './factory-confirmation-preflight';
import { ORDER_PRINTABLE_STATUSES } from './print-eligibility';
import type { AdminOrderQueue, AdminOrderSignal, AdminOrderWorkspaceQuery } from './admin-workspace-query';

export type AdminOrdersActor = { id: string; role: Role };

export const ACTIVE_PROMISE_STATUSES = [
  OrderStatus.PENDING_FACTORY,
  OrderStatus.CONFIRMED,
  OrderStatus.ON_HOLD,
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
  // Expand-migrate-contract 期间的历史行仍可读。
  OrderStatus.SUBMITTED,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.COMPLETED,
] as const;

export const PRODUCTION_STATUSES = [
  OrderStatus.CONFIRMED,
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.COMPLETED,
] as const;

export const PRINTABLE_STATUSES = ORDER_PRINTABLE_STATUSES;

export const DONE_STATUSES = [
  OrderStatus.SETTLED,
  OrderStatus.CANCELLED,
  OrderStatus.FINISHED,
] as const;

export const PENDING_CHANGE_WHERE = {
  changeRequests: {
    some: { status: OrderChangeRequestStatus.PENDING },
  },
} as const satisfies Prisma.OrderWhereInput;

export async function loadCurrentPrintOrderIds(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<string[]> {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT orders."id"
    FROM "Order" orders
    WHERE orders."status" IN (
      'RELEASED'::"OrderStatus",
      'FOILING'::"OrderStatus",
      'PACKING'::"OrderStatus"
    )
      AND (
        EXISTS (
          SELECT 1
          FROM "OrderPrintJob" request
          WHERE request."orderId" = orders."id"
            AND request."workOrderVersion" = orders."workOrderVersion"
            AND request."state" = 'PENDING'::"OrderPrintJobState"
            AND request."requestJobId" IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM "OrderPrintJob" resolution
              WHERE resolution."requestJobId" = request."id"
            )
        )
        OR NOT EXISTS (
          SELECT 1
          FROM "OrderPrintJob" request
          INNER JOIN "OrderPrintJob" resolution
            ON resolution."requestJobId" = request."id"
          WHERE request."orderId" = orders."id"
            AND request."workOrderVersion" = orders."workOrderVersion"
            AND request."state" = 'PENDING'::"OrderPrintJobState"
            AND request."requestJobId" IS NULL
            AND resolution."state" = 'PRINTED'::"OrderPrintJobState"
        )
      )
  `;
  return rows.map((row) => row.id);
}

/**
 * An incomplete customer fee is a persisted business fact, never inferred
 * from a zero amount or from the broad PENDING_ADMIN_CONFIRMATION state. This
 * predicate intentionally has no workflow-status restriction: partial quotes
 * remain excluded from totals after an order is rejected or cancelled.
 */
export function adminIncompleteCustomerFeeWhere(): Prisma.OrderWhereInput {
  return {
    confirmedFee: null,
    settledFee: null,
    OR: [
      {
        quotedFeeCompleteness:
          OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
      },
      {
        items: {
          some: {
            quoteDisposition:
              OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
          },
        },
      },
      {
        customerCharges: {
          some: { status: OrderCustomerChargeStatus.PENDING_AMOUNT },
        },
      },
    ],
  };
}

/**
 * Actionable manual-pricing work is the intersection of an incomplete fee
 * fact and a status in which an administrator can resolve it. Keep this
 * predicate aligned with the row's pending-pricing presentation.
 */
export function adminManualPricingWhere(): Prisma.OrderWhereInput {
  return {
    status: { in: [...FACTORY_CONFIRMATION_PENDING_STATUSES] },
    ...adminIncompleteCustomerFeeWhere(),
  };
}

/**
 * Confirmed work awaits the canonical production-release command. Legacy
 * SCHEDULING orders have already entered production, while SUBMITTED orders
 * still require factory confirmation. Pending changes must be decided first.
 * Membership is a workflow queue, not a replacement for release preflight.
 */
function pendingReleaseWhere(): Prisma.OrderWhereInput {
  return {
    status: OrderStatus.CONFIRMED,
    NOT: PENDING_CHANGE_WHERE,
  };
}

function printableWhere(): Prisma.OrderWhereInput {
  return {
    status: { in: [...PRINTABLE_STATUSES] },
  };
}

export function adminQueueWhere(
  queue: AdminOrderQueue,
): Prisma.OrderWhereInput {
  switch (queue) {
    case 'todo':
      return {
        OR: [
          {
            status: {
              in: [...FACTORY_CONFIRMATION_PENDING_STATUSES],
            },
          },
          adminManualPricingWhere(),
          pendingReleaseWhere(),
          PENDING_CHANGE_WHERE,
          { status: OrderStatus.ON_HOLD },
        ],
      };
    case 'print':
      // Prisma cannot express request.workOrderVersion = order.workOrderVersion.
      // Snapshot/export callers replace this superset with the correlated raw
      // predicate from loadCurrentPrintOrderIds.
      return printableWhere();
    case 'production':
      return {
        status: { in: [...PRODUCTION_STATUSES] },
        NOT: PENDING_CHANGE_WHERE,
      };
    case 'shipped':
      return { status: OrderStatus.SHIPPED };
    case 'done':
      return {
        // REJECTED 是可恢复的驳回态，不是完结。FINISHED 仅作历史兼容读。
        status: {
          in: [...DONE_STATUSES],
        },
      };
    case 'all':
      return {};
  }
}

export function adminSignalWhere(
  signal: AdminOrderSignal,
  now: Date = new Date(),
): Prisma.OrderWhereInput {
  switch (signal) {
    case 'pending-confirmation':
      return {
        status: {
          in: [...FACTORY_CONFIRMATION_PENDING_STATUSES],
        },
      };
    case 'pending-pricing':
      return adminManualPricingWhere();
    case 'pending-release':
      return pendingReleaseWhere();
    case 'pending-change':
      return PENDING_CHANGE_WHERE;
    case 'on-hold':
      return { status: OrderStatus.ON_HOLD };
    case 'overdue':
      return {
        status: { in: [...ACTIVE_PROMISE_STATUSES] },
        promisedDate: { lt: overdueCutoff(now) },
      };
    case 'due-today': {
      const { start, end } = shanghaiDayBoundary(todayShanghai(now));
      return {
        status: { in: [...ACTIVE_PROMISE_STATUSES] },
        promisedDate: { gte: start, lt: end },
      };
    }
  }
}

export function andWhere(...parts: Prisma.OrderWhereInput[]): Prisma.OrderWhereInput {
  return { AND: parts };
}

export function buildAdminWorkspaceBaseWhere(
  actor: AdminOrdersActor,
  query: AdminOrderWorkspaceQuery,
): Prisma.OrderWhereInput {
  assertAdmin(actor);
  return andWhere(
    buildOrderWhere(actor, query.list.filters),
    query.starred ? { stars: { some: { userId: actor.id } } } : {},
    query.unbilled
      ? {
          settlementType: OrderSettlementType.EXTERNAL_SALES,
          billingMode: OrderBillingMode.CHARGE,
          status: { in: [OrderStatus.SETTLED, OrderStatus.CANCELLED] },
          settledFee: { not: null },
          settledAt: { not: null },
          agentMonthlyBillItem: { is: null },
        }
      : {},
  );
}

export function buildAdminWorkspaceResultWhere(
  actor: AdminOrdersActor,
  query: AdminOrderWorkspaceQuery,
  now: Date = new Date(),
): Prisma.OrderWhereInput {
  return andWhere(
    buildAdminWorkspaceBaseWhere(actor, query),
    adminQueueWhere(query.queue),
    query.signal ? adminSignalWhere(query.signal, now) : {},
  );
}

/** Resolve the durable-export predicate against the same current-version
 * print membership rule used by the interactive workspace snapshot. */
export async function resolveAdminWorkspaceResultWhere(
  actor: AdminOrdersActor,
  query: AdminOrderWorkspaceQuery,
  now: Date,
): Promise<Prisma.OrderWhereInput> {
  assertAdmin(actor);
  const queueWhere =
    query.queue === 'print'
      ? { id: { in: await loadCurrentPrintOrderIds(db) } }
      : adminQueueWhere(query.queue);
  return andWhere(
    buildAdminWorkspaceBaseWhere(actor, query),
    queueWhere,
    query.signal ? adminSignalWhere(query.signal, now) : {},
  );
}

export function assertAdmin(actor: AdminOrdersActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new UnauthorizedError('管理端工单工作台仅对管理员开放');
  }
}
