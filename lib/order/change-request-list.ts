import 'server-only';

import {
  OrderChangeRequestStatus,
  Prisma,
} from '../../generated/prisma/client';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
} from '../admin/table';
import { db } from '../db';

export const PENDING_ORDER_CHANGE_REQUEST_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const pendingOrderChangeRequestSelect = {
  id: true,
  baseRevision: true,
  baseWorkOrderVersion: true,
  type: true,
  modifyKind: true,
  status: true,
  reason: true,
  proposedChanges: true,
  workOrderVersionAfter: true,
  createdAt: true,
  requester: {
    select: {
      displayName: true,
    },
  },
  order: {
    select: {
      id: true,
      orderNo: true,
      customName: true,
      status: true,
      revision: true,
      workOrderVersion: true,
    },
  },
} satisfies Prisma.OrderChangeRequestSelect;

export type PendingOrderChangeRequestListRow =
  Prisma.OrderChangeRequestGetPayload<{
    select: typeof pendingOrderChangeRequestSelect;
  }>;

export type PendingOrderChangeRequestListInput = {
  page?: number;
  pageSize?: number;
};

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}

/**
 * Returns the administrator review queue only. Processed requests deliberately
 * stay out of this query and remain available from their order's audit trail.
 */
export async function listPendingOrderChangeRequests(
  input: PendingOrderChangeRequestListInput = {},
): Promise<PaginatedResult<PendingOrderChangeRequestListRow>> {
  const requestedPage = positiveInteger(input.page, 1);
  const requestedPageSize = positiveInteger(
    input.pageSize,
    PENDING_ORDER_CHANGE_REQUEST_PAGE_SIZE,
  );
  const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
  const where = {
    status: OrderChangeRequestStatus.PENDING,
  } satisfies Prisma.OrderChangeRequestWhereInput;

  // Count first so an out-of-range URL can be clamped before issuing the row
  // query. This also keeps the header count independent from page size.
  const total = await db.orderChangeRequest.count({ where });
  const window = paginationWindow(total, requestedPage, pageSize);
  const rows = await db.orderChangeRequest.findMany({
    where,
    select: pendingOrderChangeRequestSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    skip: window.skip,
    take: window.take,
  });

  return paginatedResult(rows, total, window);
}
