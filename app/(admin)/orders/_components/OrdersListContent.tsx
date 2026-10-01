import { randomUUID } from 'node:crypto';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Role } from '@/generated/prisma/enums';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { OrderExportControls } from '@/components/business/order/OrderExportControls';
import { SalesOrderListFilters } from '@/components/business/order/SalesOrderListFilters';
import { SalesOrdersList } from '@/components/business/order/SalesOrdersList';
import { AdminOrderWorkspace } from '@/components/business/order/AdminOrderWorkspace';
import { OrderListScrollState } from '@/components/business/order/OrderListNavigationState';
import { ErrorBoundary } from '@/components/ui-business';
import {
  getOrderListFilterOptions,
  serializeOrderListQuery,
  type OrderListSearchParams,
} from '@/lib/order/list-query';
import { loadAdminOrderWorkspace } from '@/lib/order/admin-workspace';
import {
  adminOrderExportParamsFromQuery,
  parseAdminOrderWorkspaceQuery,
} from '@/lib/order/admin-workspace-query';
import { getAgentMonthlyBillingStats } from '@/lib/agent-monthly-billing/query';
import { getSetting } from '@/lib/settings';
import {
  getSalesOrderListPageWindow,
  getSalesOrderListSummary,
  getSalesLatestRejectedOrderIds,
  listSalesOrdersPage,
  sanitizeSalesOrderListQuery,
  parseSalesOrderListQuery,
} from '@/lib/order/sales-list-query';
import { listRecentOrderExports } from '@/lib/order/export';
import {
  SalesOrdersFiltersSkeleton,
  SalesOrdersListSkeleton,
} from './OrdersListContentSkeleton';

type OrdersActor = { id: string; role: Role };
type SalesOrdersPagePromise = ReturnType<typeof listSalesOrdersPage>;
type SalesOrderListSummaryPromise = ReturnType<
  typeof getSalesOrderListSummary
>;

type OptionalAdminRead<T> = {
  value: T;
  issue: string | null;
};

async function optionalAdminRead<T>(
  promise: Promise<T>,
  fallback: T,
  issue: string,
): Promise<OptionalAdminRead<T>> {
  try {
    return { value: await promise, issue: null };
  } catch {
    return { value: fallback, issue };
  }
}

export async function OrdersListContent({
  searchParams,
  user,
}: {
  searchParams: Promise<OrderListSearchParams>;
  user: OrdersActor;
}) {
  const rawSearchParams = await searchParams;
  const actor = { id: user.id, role: user.role };
  if (user.role === Role.ADMIN) {
    return (
      <AdminOrdersWorkspaceContent
        user={actor}
        rawSearchParams={rawSearchParams}
      />
    );
  }
  const parsed = parseSalesOrderListQuery(rawSearchParams);
  if (user.role === Role.SALES) {
    return (
      <SalesOrdersListContent
        actor={actor}
        parsed={parsed}
      />
    );
  }
  // 业主 2026-09-24：后台只剩管理员与外部销售，其他角色没有工单列表。
  notFound();
}

export async function AdminOrdersWorkspaceContent({
  user,
  rawSearchParams,
}: {
  user: OrdersActor;
  rawSearchParams: OrderListSearchParams;
}) {
  const actor = user;
  const parsed = parseAdminOrderWorkspaceQuery(rawSearchParams);
  const stagnationSetting = getSetting('production_stagnation_days');
  const [data, optionsRead, billingStatsRead, recentExportsRead] =
    await Promise.all([
      stagnationSetting.then((setting) =>
        loadAdminOrderWorkspace(
          actor,
          parsed.query,
          new Date(),
          setting.days,
        ),
      ),
      optionalAdminRead(
        getOrderListFilterOptions(actor),
        { submitters: [], workers: [], crafts: [] },
        '筛选选项暂时无法加载',
      ),
      optionalAdminRead(
        getAgentMonthlyBillingStats(),
        {
          receivableAmount: '0.00',
          receivableBillCount: 0,
          unbilledOrderCount: 0,
          draftBillCount: 0,
        },
        '账单统计暂时无法加载',
      ),
      optionalAdminRead(
        listRecentOrderExports(user.id),
        [],
        '最近导出记录暂时无法加载',
      ),
    ]);
  const runtimeIssues = [
    optionsRead.issue,
    billingStatsRead.issue,
    recentExportsRead.issue,
  ].filter((issue): issue is string => issue !== null);
  const options = optionsRead.value;
  const billingStats = billingStatsRead.value;
  const recentExports = recentExportsRead.value;
  const exportParams = adminOrderExportParamsFromQuery(parsed.query);
  return (
    <AdminOrderWorkspace
      data={data}
      query={parsed.query}
      issues={[...parsed.issues, ...runtimeIssues]}
      options={options}
      billingStats={billingStats}
      exportControls={
        <OrderExportControls
          params={exportParams}
          filteredTotal={data.total}
          hasFilters={Object.keys(exportParams).length > 0}
          filteredRequestKey={randomUUID()}
          allRequestKey={randomUUID()}
          recent={recentExports.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
            completedAt: item.completedAt?.toISOString() ?? null,
            expiresAt: item.expiresAt.toISOString(),
          }))}
        />
      }
      selectedExportRequestKey={randomUUID()}
    />
  );
}

export async function SalesOrdersListContent({
  actor,
  parsed,
}: {
  actor: OrdersActor;
  parsed: ReturnType<typeof parseSalesOrderListQuery>;
}) {
  const query = sanitizeSalesOrderListQuery(parsed.query);
  const latestRejectedOrderIdsPromise =
    getSalesLatestRejectedOrderIds(actor);
  const pageWindowPromise = getSalesOrderListPageWindow(
    actor,
    query,
    latestRejectedOrderIdsPromise,
  );
  const pagePromise = listSalesOrdersPage(actor, query, pageWindowPromise);
  const summaryPromise = getSalesOrderListSummary(
    actor,
    new Date(),
    latestRejectedOrderIdsPromise,
    query,
  );

  return (
    <>
      <OrderListScrollState
        selectedOrderId={query.selectedOrderId}
        scrollY={query.scrollY}
      />
      <ErrorBoundary
        scope="section"
        title="销售工单筛选暂时无法加载"
        description="工单列表仍可继续使用；请重试筛选区域。"
      >
        <Suspense fallback={<SalesOrdersFiltersSkeleton />}>
          <SalesOrdersListFiltersSection
            query={query}
            issues={parsed.issues}
            summaryPromise={summaryPromise}
          />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary
        scope="section"
        title="销售工单暂时无法加载"
        description="筛选与新建工单入口仍可继续使用；请重试列表区域。"
      >
        <Suspense fallback={<SalesOrdersListSkeleton />}>
          <SalesOrdersListSection
            query={query}
            pagePromise={pagePromise}
          />
        </Suspense>
      </ErrorBoundary>
    </>
  );
}

export async function SalesOrdersListFiltersSection({
  query,
  issues,
  summaryPromise,
}: {
  query: ReturnType<typeof sanitizeSalesOrderListQuery>;
  issues: readonly string[];
  summaryPromise: SalesOrderListSummaryPromise;
}) {
  const summary = await summaryPromise;
  return (
    <SalesOrderListFilters
      query={query}
      summary={summary}
      issues={issues}
    />
  );
}

export async function SalesOrdersListSection({
  query,
  pagePromise,
}: {
  query: ReturnType<typeof sanitizeSalesOrderListQuery>;
  pagePromise: SalesOrdersPagePromise;
}) {
  const page = await pagePromise;
  const displayedQuery = { ...query, page: page.page };
  const queryParams = { ...serializeOrderListQuery(displayedQuery), createdMonth: query.createdMonth };
  return (
    <SalesOrdersList
      orders={page.rows}
      query={displayedQuery}
      nowIso={new Date().toISOString()}
      footer={
        <AdminPagination
          key="sales-orders-pagination"
          basePath="/orders"
          page={page.page}
          pageCount={page.pageCount}
          total={page.total}
          pageSize={page.pageSize}
          queryParams={queryParams}
        />
      }
    />
  );
}

