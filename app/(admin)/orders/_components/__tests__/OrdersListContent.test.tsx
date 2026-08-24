import { Children, isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const {
  getOrderListFilterOptionsMock,
  listOrdersPageMock,
  listRecentOrderExportsMock,
  orderExportControlsMock,
  orderListFiltersMock,
  ordersTableMock,
} = vi.hoisted(() => ({
  getOrderListFilterOptionsMock: vi.fn(),
  listOrdersPageMock: vi.fn(),
  listRecentOrderExportsMock: vi.fn(),
  orderExportControlsMock: vi.fn(() => null),
  orderListFiltersMock: vi.fn(() => null),
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
  OrderExportControls: orderExportControlsMock,
}));

vi.mock('@/components/business/order/OrderListFilters', () => ({
  OrderListFilters: orderListFiltersMock,
}));

vi.mock('@/components/business/order/OrdersTable', () => ({
  OrdersTable: ordersTableMock,
}));

import {
  OrderExportsSection,
  OrdersListContent,
  OrdersListFiltersSection,
  OrdersListTableSection,
} from '../OrdersListContent';

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

    const filterSectionElement = findElement(node, OrdersListFiltersSection);
    expect(filterSectionElement).not.toBeNull();
    const filterSection = await OrdersListFiltersSection(
      filterSectionElement!.props as Parameters<
        typeof OrdersListFiltersSection
      >[0],
    );
    const filterElement = findElement(filterSection, orderListFiltersMock);
    expect(isValidElement(filterElement)).toBe(true);
    expect(
      filterElement?.props.advancedRequested,
    ).toBe(true);
    expect(filterElement?.props.canReviewChanges).toBe(true);

    const exportSectionElement = findElement(
      filterElement?.props.exportControls,
      OrderExportsSection,
    );
    expect(exportSectionElement).not.toBeNull();
    const exportSection = await OrderExportsSection(
      exportSectionElement!.props as Parameters<typeof OrderExportsSection>[0],
    );
    expect(findElement(exportSection, orderExportControlsMock)).not.toBeNull();

    const tableSectionElement = findElement(node, OrdersListTableSection);
    expect(tableSectionElement).not.toBeNull();
    const tableSection = await OrdersListTableSection(
      tableSectionElement!.props as Parameters<typeof OrdersListTableSection>[0],
    );
    const tableElement = findElement(tableSection, ordersTableMock);
    expect(tableElement?.props).toMatchObject({ canSchedule: true });
    expect(tableElement?.props.footer).toBeDefined();
  });

  it('does not start an admin export read for non-admin users', async () => {
    const node = await OrdersListContent({
      searchParams: Promise.resolve({}),
      user: { id: 'sales-1', role: Role.SALES },
    });

    expect(listOrdersPageMock).toHaveBeenCalledTimes(1);
    expect(getOrderListFilterOptionsMock).toHaveBeenCalledTimes(1);
    expect(listRecentOrderExportsMock).not.toHaveBeenCalled();
    const tableSectionElement = findElement(node, OrdersListTableSection);
    const tableSection = await OrdersListTableSection(
      tableSectionElement!.props as Parameters<typeof OrdersListTableSection>[0],
    );
    const tableElement = findElement(tableSection, ordersTableMock);
    expect(tableElement?.props).toMatchObject({ canSchedule: false });
  });

  it('propagates each section error to its nearest boundary instead of returning fake empty data', async () => {
    const node = await OrdersListContent({
      searchParams: Promise.resolve({}),
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    const filterSectionElement = findElement(node, OrdersListFiltersSection)!;
    const tableSectionElement = findElement(node, OrdersListTableSection)!;

    const filtersFailure = new Error('filter options read failed');
    await expect(
      OrdersListFiltersSection({
        ...(filterSectionElement.props as Parameters<
          typeof OrdersListFiltersSection
        >[0]),
        filterOptionsPromise: Promise.reject(filtersFailure),
      }),
    ).rejects.toBe(filtersFailure);

    const ordersFailure = new Error('orders read failed');
    await expect(
      OrdersListTableSection({
        ...(tableSectionElement.props as Parameters<
          typeof OrdersListTableSection
        >[0]),
        orderPagePromise: Promise.reject(ordersFailure),
      }),
    ).rejects.toBe(ordersFailure);

    const exportsFailure = new Error('recent exports read failed');
    await expect(
      OrderExportsSection({
        query: tableSectionElement.props.query as Parameters<
          typeof OrderExportsSection
        >[0]['query'],
        filteredTotal: 0,
        recentExportsPromise: Promise.reject(exportsFailure),
      }),
    ).rejects.toBe(exportsFailure);
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
