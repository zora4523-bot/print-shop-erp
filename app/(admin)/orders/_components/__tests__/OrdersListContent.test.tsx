import { Children, isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const {
  getOrderListFilterOptionsMock,
  listOrdersPageMock,
  listRecentOrderExportsMock,
  ordersTableMock,
} = vi.hoisted(() => ({
  getOrderListFilterOptionsMock: vi.fn(),
  listOrdersPageMock: vi.fn(),
  listRecentOrderExportsMock: vi.fn(),
  ordersTableMock: vi.fn(() => null),
}));

vi.mock('@/lib/order/list-query', () => ({
  getOrderListFilterOptions: getOrderListFilterOptionsMock,
  listOrdersPage: listOrdersPageMock,
  parseOrderListQuery: vi.fn(() => ({
    issues: [],
    query: {
      filters: {
        statuses: [],
        kinds: [],
        shipmentStatuses: [],
        craftIds: [],
        foilColors: [],
        taskStatuses: [],
        machineTypes: [],
        outsourceStatuses: [],
      },
      page: 1,
      pageSize: 20,
      sort: 'createdAt',
      dir: 'desc',
    },
  })),
  sanitizeOrderListQueryForActor: vi.fn((actor, query) => query),
  serializeOrderListQuery: vi.fn(() => ({})),
}));

vi.mock('@/lib/order/export', () => ({
  listRecentOrderExports: listRecentOrderExportsMock,
  orderExportParamsFromQuery: vi.fn(() => ({})),
}));

vi.mock('@/components/business/admin/AdminDataTable', () => ({
  AdminPagination: vi.fn(() => null),
}));

vi.mock('@/components/business/order/OrderExportControls', () => ({
  OrderExportControls: vi.fn(() => null),
}));

vi.mock('@/components/business/order/OrderListFilters', () => ({
  OrderListFilters: vi.fn(() => null),
}));

vi.mock('@/components/business/order/OrdersTable', () => ({
  OrdersTable: ordersTableMock,
}));

import { OrdersListContent } from '../OrdersListContent';

beforeEach(() => {
  listOrdersPageMock.mockReset().mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pageCount: 0,
    pageSize: 20,
  });
  getOrderListFilterOptionsMock.mockReset().mockResolvedValue({
    submitters: [],
    workers: [],
    crafts: [],
  });
  listRecentOrderExportsMock.mockReset().mockResolvedValue([]);
});

describe('OrdersListContent', () => {
  it('runs each fresh read once and carries the no-JS advanced request into the filter UI', async () => {
    const node = await OrdersListContent({
      searchParams: Promise.resolve({ advanced: '1' }),
      user: { id: 'admin-1', role: Role.ADMIN },
    });

    expect(listOrdersPageMock).toHaveBeenCalledTimes(1);
    expect(getOrderListFilterOptionsMock).toHaveBeenCalledTimes(1);
    expect(listRecentOrderExportsMock).toHaveBeenCalledTimes(1);
    expect(listRecentOrderExportsMock).toHaveBeenCalledWith('admin-1');

    const filterElement = Children.toArray(node.props.children)[1];
    expect(isValidElement(filterElement)).toBe(true);
    expect(
      (filterElement as { props: { advancedRequested?: boolean } }).props
      .advancedRequested,
    ).toBe(true);
    expect(
      (filterElement as { props: { canReviewChanges?: boolean } }).props
        .canReviewChanges,
    ).toBe(true);
    const tableElement = findElement(node, ordersTableMock);
    expect(tableElement?.props).toMatchObject({ canSchedule: true });
  });

  it('does not start an admin export read for non-admin users', async () => {
    const node = await OrdersListContent({
      searchParams: Promise.resolve({}),
      user: { id: 'sales-1', role: Role.SALES },
    });

    expect(listOrdersPageMock).toHaveBeenCalledTimes(1);
    expect(getOrderListFilterOptionsMock).toHaveBeenCalledTimes(1);
    expect(listRecentOrderExportsMock).not.toHaveBeenCalled();
    const tableElement = findElement(node, ordersTableMock);
    expect(tableElement?.props).toMatchObject({ canSchedule: false });
  });

  it('propagates data errors instead of replacing them with empty results', async () => {
    const failure = new Error('orders read failed');
    listOrdersPageMock.mockRejectedValueOnce(failure);

    await expect(
      OrdersListContent({
        searchParams: Promise.resolve({}),
        user: { id: 'admin-1', role: Role.ADMIN },
      }),
    ).rejects.toBe(failure);
  });
});

function findElement(
  node: unknown,
  type: unknown,
): { props: Record<string, unknown> } | null {
  if (!isValidElement(node)) return null;
  if (node.type === type) {
    return node as unknown as { props: Record<string, unknown> };
  }
  for (const child of Children.toArray(
    (node.props as { children?: ReactNode }).children,
  )) {
    const match = findElement(child, type);
    if (match) return match;
  }
  return null;
}
