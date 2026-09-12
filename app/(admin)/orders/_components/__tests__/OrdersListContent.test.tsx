import { Children, isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const {
  getOrderListFilterOptionsMock,
  getOrderListPageWindowMock,
  listOrdersPageMock,
  listRecentOrderExportsMock,
  orderExportControlsMock,
  orderListFiltersMock,
  ordersTableMock,
  getSalesOrderListPageWindowMock,
  getSalesOrderListSummaryMock,
  getSalesLatestRejectedOrderIdsMock,
  listSalesOrdersPageMock,
  salesOrderListFiltersMock,
  salesOrdersListMock,
  loadAdminOrderWorkspaceMock,
  parseAdminOrderWorkspaceQueryMock,
  adminOrderWorkspaceMock,
  getAgentMonthlyBillingStatsMock,
  getSettingMock,
} = vi.hoisted(() => ({
  getOrderListFilterOptionsMock: vi.fn(),
  getOrderListPageWindowMock: vi.fn(),
  listOrdersPageMock: vi.fn(),
  listRecentOrderExportsMock: vi.fn(),
  orderExportControlsMock: vi.fn(() => null),
  orderListFiltersMock: vi.fn(() => null),
  ordersTableMock: vi.fn(() => null),
  getSalesOrderListPageWindowMock: vi.fn(),
  getSalesOrderListSummaryMock: vi.fn(),
  getSalesLatestRejectedOrderIdsMock: vi.fn(),
  listSalesOrdersPageMock: vi.fn(),
  salesOrderListFiltersMock: vi.fn(() => null),
  salesOrdersListMock: vi.fn(() => null),
  loadAdminOrderWorkspaceMock: vi.fn(),
  parseAdminOrderWorkspaceQueryMock: vi.fn(),
  adminOrderWorkspaceMock: vi.fn(() => null),
  getAgentMonthlyBillingStatsMock: vi.fn(),
  getSettingMock: vi.fn(),
}));

vi.mock('@/lib/order/list-query', () => ({
  getOrderListFilterOptions: getOrderListFilterOptionsMock,
  getOrderListPageWindow: getOrderListPageWindowMock,
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

vi.mock('@/lib/order/sales-list-query', () => ({
  getSalesOrderListPageWindow: getSalesOrderListPageWindowMock,
  getSalesOrderListSummary: getSalesOrderListSummaryMock,
  getSalesLatestRejectedOrderIds: getSalesLatestRejectedOrderIdsMock,
  listSalesOrdersPage: listSalesOrdersPageMock,
  sanitizeSalesOrderListQuery: vi.fn((query) => query),
}));

vi.mock('@/lib/order/admin-workspace', () => ({
  loadAdminOrderWorkspace: loadAdminOrderWorkspaceMock,
}));

vi.mock('@/lib/order/admin-workspace-query', () => ({
  parseAdminOrderWorkspaceQuery: parseAdminOrderWorkspaceQueryMock,
  adminOrderExportParamsFromQuery: vi.fn(() => ({
    adminWorkspace: 'v1',
    queue: 'todo',
  })),
}));

vi.mock('@/lib/agent-monthly-billing/query', () => ({
  getAgentMonthlyBillingStats: getAgentMonthlyBillingStatsMock,
}));

vi.mock('@/lib/settings', () => ({
  getSetting: getSettingMock,
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

vi.mock('@/components/business/order/SalesOrderListFilters', () => ({
  SalesOrderListFilters: salesOrderListFiltersMock,
}));

vi.mock('@/components/business/order/SalesOrdersList', () => ({
  SalesOrdersList: salesOrdersListMock,
}));

vi.mock('@/components/business/order/AdminOrderWorkspace', () => ({
  AdminOrderWorkspace: adminOrderWorkspaceMock,
}));

import {
  AdminOrdersWorkspaceContent,
  OrderExportsSection,
  OrdersListContent,
  OrdersListFiltersSection,
  OrdersListTableSection,
  SalesOrdersListContent,
  SalesOrdersListFiltersSection,
  SalesOrdersListSection,
} from '../OrdersListContent';

beforeEach(() => {
  getOrderListPageWindowMock.mockReset().mockResolvedValue({
    total: 0,
    page: 1,
    pageCount: 1,
    pageSize: 20,
    skip: 0,
    take: 20,
  });
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
  getSalesOrderListPageWindowMock.mockReset().mockResolvedValue({
    total: 0,
    page: 1,
    pageCount: 1,
    pageSize: 20,
    skip: 0,
    take: 20,
    latestRejectedOrderIds: [],
  });
  getSalesLatestRejectedOrderIdsMock.mockReset().mockResolvedValue([]);
  listSalesOrdersPageMock.mockReset().mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pageCount: 1,
    pageSize: 20,
  });
  getSalesOrderListSummaryMock.mockReset().mockResolvedValue({
    all: 0,
    todo: 0,
    doing: 0,
    shipped: 0,
    done: 0,
    cancelled: 0,
    draft: 0,
    shippedThisMonth: 0,
  });
  parseAdminOrderWorkspaceQueryMock.mockReset().mockReturnValue({
    issues: [],
    query: {
      list: {
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
      queue: 'todo',
      starred: false,
      unbilled: false,
    },
  });
  loadAdminOrderWorkspaceMock.mockReset().mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pageCount: 1,
    pageSize: 20,
    counts: { queues: {}, signals: {} },
    summary: {
      orderCount: 0,
      totalQuantity: 0,
      effectiveFee: '0.00',
      manualPricingCount: 0,
      incompleteFeeExcludedCount: 0,
      legacyFeeExcludedCount: 0,
    },
  });
  getAgentMonthlyBillingStatsMock.mockReset().mockResolvedValue({
    receivableAmount: '0.00',
    receivableBillCount: 0,
    unbilledOrderCount: 0,
    draftBillCount: 0,
  });
  getSettingMock.mockReset().mockResolvedValue({ days: 2 });
});

describe('OrdersListContent', () => {
  it('runs each fresh read once and carries the no-JS advanced request into the filter UI', async () => {
    const node = await OrdersListContent({
      searchParams: Promise.resolve({ advanced: '1' }),
      user: { id: 'cs-1', role: Role.CUSTOMER_SERVICE },
    });

    expect(listOrdersPageMock).toHaveBeenCalledTimes(1);
    expect(getOrderListPageWindowMock).toHaveBeenCalledTimes(1);
    expect(listOrdersPageMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      getOrderListPageWindowMock.mock.results[0]?.value,
    );
    expect(getOrderListFilterOptionsMock).toHaveBeenCalledTimes(1);
    expect(listRecentOrderExportsMock).not.toHaveBeenCalled();

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
    expect(filterElement?.props.canReviewChanges).toBe(false);
    expect(filterElement?.props.exportControls).toBeNull();

    const tableSectionElement = findElement(node, OrdersListTableSection);
    expect(tableSectionElement).not.toBeNull();
    const tableSection = await OrdersListTableSection(
      tableSectionElement!.props as Parameters<typeof OrdersListTableSection>[0],
    );
    const tableElement = findElement(tableSection, ordersTableMock);
    expect(tableElement?.props).toMatchObject({ canSchedule: false });
    expect(tableElement?.props.footer).toBeDefined();
  });

  it('routes only ADMIN through the queue workspace and safe rich DTO loader', async () => {
    const node = await OrdersListContent({
      searchParams: Promise.resolve({ queue: 'print', starred: 'yes' }),
      user: { id: 'admin-1', role: Role.ADMIN },
    });

    expect(listOrdersPageMock).not.toHaveBeenCalled();
    expect(getOrderListPageWindowMock).not.toHaveBeenCalled();
    expect(listRecentOrderExportsMock).not.toHaveBeenCalled();
    const contentElement = findElement(node, AdminOrdersWorkspaceContent);
    expect(contentElement).not.toBeNull();
    const content = await AdminOrdersWorkspaceContent(
      contentElement!.props as Parameters<typeof AdminOrdersWorkspaceContent>[0],
    );
    expect(parseAdminOrderWorkspaceQueryMock).toHaveBeenCalledWith({
      queue: 'print',
      starred: 'yes',
    });
    expect(loadAdminOrderWorkspaceMock).toHaveBeenCalledWith(
      { id: 'admin-1', role: Role.ADMIN },
      expect.objectContaining({ queue: 'todo', starred: false }),
      expect.any(Date),
      2,
    );
    expect(getOrderListFilterOptionsMock).toHaveBeenCalledWith({
      id: 'admin-1',
      role: Role.ADMIN,
    });
    expect(getAgentMonthlyBillingStatsMock).toHaveBeenCalledTimes(1);
    expect(listRecentOrderExportsMock).toHaveBeenCalledWith('admin-1');
    const workspaceElement = findElement(content, adminOrderWorkspaceMock);
    expect(workspaceElement).not.toBeNull();
    expect(workspaceElement?.props.selectedExportRequestKey).toEqual(
      expect.any(String),
    );
    expect(isValidElement(workspaceElement?.props.exportControls)).toBe(true);
    expect(
      (workspaceElement?.props.exportControls as { props: { params: unknown } })
        .props.params,
    ).toEqual({ adminWorkspace: 'v1', queue: 'todo' });
  });

  it('keeps the admin workspace available when optional reads fail', async () => {
    getOrderListFilterOptionsMock.mockRejectedValueOnce(
      new Error('filter options unavailable'),
    );
    getAgentMonthlyBillingStatsMock.mockRejectedValueOnce(
      new Error('billing stats unavailable'),
    );
    listRecentOrderExportsMock.mockRejectedValueOnce(
      new Error('exports unavailable'),
    );

    const content = await AdminOrdersWorkspaceContent({
      user: { id: 'admin-1', role: Role.ADMIN },
      rawSearchParams: {},
    });

    const workspaceElement = findElement(content, adminOrderWorkspaceMock);
    expect(workspaceElement?.props.options).toEqual({
      submitters: [],
      workers: [],
      crafts: [],
    });
    expect(workspaceElement?.props.billingStats).toEqual({
      receivableAmount: '0.00',
      receivableBillCount: 0,
      unbilledOrderCount: 0,
      draftBillCount: 0,
    });
    expect(workspaceElement?.props.issues).toEqual([
      '筛选选项暂时无法加载',
      '账单统计暂时无法加载',
      '最近导出记录暂时无法加载',
    ]);
    expect(isValidElement(workspaceElement?.props.exportControls)).toBe(true);
  });

  it('routes SALES through the role-specific safe query and card workspace', async () => {
    const node = await OrdersListContent({
      searchParams: Promise.resolve({}),
      user: { id: 'sales-1', role: Role.SALES },
    });

    expect(listOrdersPageMock).not.toHaveBeenCalled();
    expect(getOrderListPageWindowMock).not.toHaveBeenCalled();
    expect(getOrderListFilterOptionsMock).not.toHaveBeenCalled();
    expect(listRecentOrderExportsMock).not.toHaveBeenCalled();
    const salesContentElement = findElement(node, SalesOrdersListContent);
    expect(salesContentElement).not.toBeNull();
    const salesContent = await SalesOrdersListContent(
      salesContentElement!.props as Parameters<typeof SalesOrdersListContent>[0],
    );
    expect(getSalesOrderListPageWindowMock).toHaveBeenCalledTimes(1);
    expect(getSalesLatestRejectedOrderIdsMock).toHaveBeenCalledTimes(1);
    expect(listSalesOrdersPageMock).toHaveBeenCalledTimes(1);
    expect(listSalesOrdersPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sales-1', role: Role.SALES }),
      expect.any(Object),
      getSalesOrderListPageWindowMock.mock.results[0]?.value,
    );
    expect(getSalesOrderListSummaryMock).toHaveBeenCalledTimes(1);

    const filterSectionElement = findElement(
      salesContent,
      SalesOrdersListFiltersSection,
    );
    const filterSection = await SalesOrdersListFiltersSection(
      filterSectionElement!.props as Parameters<
        typeof SalesOrdersListFiltersSection
      >[0],
    );
    expect(findElement(filterSection, salesOrderListFiltersMock)).not.toBeNull();

    const listSectionElement = findElement(salesContent, SalesOrdersListSection);
    const listSection = await SalesOrdersListSection(
      listSectionElement!.props as Parameters<typeof SalesOrdersListSection>[0],
    );
    const listElement = findElement(listSection, salesOrdersListMock);
    expect(listElement).not.toBeNull();
    expect(isValidElement(listElement?.props.footer)).toBe(true);
    expect(
      (listElement?.props.footer as { key: string | null }).key,
    ).toBe('sales-orders-pagination');
  });

  it('keeps filters available when the independent order-row read fails', async () => {
    const rowFailure = new Error('order rows read failed');
    let rejectRows: ((reason: Error) => void) | undefined;
    listOrdersPageMock.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRows = reject;
      }),
    );
    getOrderListPageWindowMock.mockResolvedValueOnce({
      total: 42,
      page: 2,
      pageCount: 3,
      pageSize: 20,
      skip: 20,
      take: 20,
    });

    const node = await OrdersListContent({
      searchParams: Promise.resolve({ page: '2' }),
      user: { id: 'cs-1', role: Role.CUSTOMER_SERVICE },
    });
    const filterSectionElement = findElement(node, OrdersListFiltersSection)!;
    const tableSectionElement = findElement(node, OrdersListTableSection)!;

    expect(filterSectionElement.props).not.toHaveProperty('orderPagePromise');
    const filterSection = await OrdersListFiltersSection(
      filterSectionElement.props as Parameters<
        typeof OrdersListFiltersSection
      >[0],
    );
    const filterElement = findElement(filterSection, orderListFiltersMock);
    expect(filterElement?.props).toMatchObject({ total: 42 });

    const tableResult = OrdersListTableSection(
        tableSectionElement.props as Parameters<
          typeof OrdersListTableSection
        >[0],
      );
    rejectRows?.(rowFailure);
    await expect(tableResult).rejects.toBe(rowFailure);
  });

  it('propagates each section error to its nearest boundary instead of returning fake empty data', async () => {
    const node = await OrdersListContent({
      searchParams: Promise.resolve({}),
      user: { id: 'cs-1', role: Role.CUSTOMER_SERVICE },
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
