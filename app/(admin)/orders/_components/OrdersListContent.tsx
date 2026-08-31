import { randomUUID } from 'node:crypto';
import { Suspense } from 'react';
import { Role } from '@/generated/prisma/enums';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { OrderExportControls } from '@/components/business/order/OrderExportControls';
import { OrderListFilters } from '@/components/business/order/OrderListFilters';
import { SalesOrderListFilters } from '@/components/business/order/SalesOrderListFilters';
import { SalesOrdersList } from '@/components/business/order/SalesOrdersList';
import { OrdersTable } from '@/components/business/order/OrdersTable';
import { OrderListScrollState } from '@/components/business/order/OrderListNavigationState';
import { ErrorBoundary } from '@/components/ui-business';
import {
  getOrderListPageWindow,
  getOrderListFilterOptions,
  listOrdersPage,
  parseOrderListQuery,
  sanitizeOrderListQueryForActor,
  serializeOrderListQuery,
  type OrderListSearchParams,
} from '@/lib/order/list-query';
import {
  getSalesOrderListPageWindow,
  getSalesOrderListSummary,
  getSalesLatestRejectedOrderIds,
  listSalesOrdersPage,
  sanitizeSalesOrderListQuery,
} from '@/lib/order/sales-list-query';
import {
  listRecentOrderExports,
  orderExportParamsFromQuery,
} from '@/lib/order/export';
import {
  OrderExportControlsSkeleton,
  OrdersListFiltersSkeleton,
  OrdersListTableSkeleton,
  SalesOrdersFiltersSkeleton,
  SalesOrdersListSkeleton,
} from './OrdersListContentSkeleton';

type OrdersActor = { id: string; role: Role };
type OrdersPagePromise = ReturnType<typeof listOrdersPage>;
type OrderListPageWindowPromise = ReturnType<typeof getOrderListPageWindow>;
type FilterOptionsPromise = ReturnType<typeof getOrderListFilterOptions>;
type RecentExportsPromise = ReturnType<typeof listRecentOrderExports>;
type SalesOrdersPagePromise = ReturnType<typeof listSalesOrdersPage>;
type SalesOrderListSummaryPromise = ReturnType<
  typeof getSalesOrderListSummary
>;

export async function OrdersListContent({
  searchParams,
  user,
}: {
  searchParams: Promise<OrderListSearchParams>;
  user: OrdersActor;
}) {
  const rawSearchParams = await searchParams;
  const parsed = parseOrderListQuery(rawSearchParams);
  const actor = { id: user.id, role: user.role };
  if (user.role === Role.SALES) {
    return (
      <SalesOrdersListContent
        actor={actor}
        parsed={parsed}
      />
    );
  }
  const query = sanitizeOrderListQueryForActor(actor, parsed.query);
  // count + pagination 和行数据分开：筛选区只等待窗口与选项，
  // 行查询失败时不会连带替换已可用的筛选控件。列表复用同一窗口
  // Promise，因此 count 仍只执行一次。
  const orderListPageWindowPromise = getOrderListPageWindow(actor, query);
  const orderPagePromise = listOrdersPage(
    actor,
    query,
    orderListPageWindowPromise,
  );
  const filterOptionsPromise = getOrderListFilterOptions(actor);
  const recentExportsPromise: RecentExportsPromise =
    user.role === Role.ADMIN
      ? listRecentOrderExports(user.id)
      : Promise.resolve([]);
  const advancedRequested = rawValueIncludes(rawSearchParams.advanced, '1');

  return (
    <>
      <OrderListScrollState
        selectedOrderId={query.selectedOrderId}
        scrollY={query.scrollY}
      />
      <ErrorBoundary
        scope="section"
        title="工单筛选暂时无法加载"
        description="页头和工单列表仍可继续使用；请重试筛选区域。"
      >
        <Suspense fallback={<OrdersListFiltersSkeleton />}>
          <OrdersListFiltersSection
            query={query}
            issues={parsed.issues}
            advancedRequested={advancedRequested}
            actor={actor}
            orderListPageWindowPromise={orderListPageWindowPromise}
            filterOptionsPromise={filterOptionsPromise}
            recentExportsPromise={recentExportsPromise}
          />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary
        scope="section"
        title="工单数据暂时无法加载"
        description="页头和已加载的筛选仍可继续使用；请重试工单列表区域。"
      >
        <Suspense fallback={<OrdersListTableSkeleton />}>
          <OrdersListTableSection
            query={query}
            actor={actor}
            orderPagePromise={orderPagePromise}
          />
        </Suspense>
      </ErrorBoundary>
    </>
  );
}

export async function SalesOrdersListContent({
  actor,
  parsed,
}: {
  actor: OrdersActor;
  parsed: ReturnType<typeof parseOrderListQuery>;
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
  const queryParams = serializeOrderListQuery(displayedQuery);
  return (
    <SalesOrdersList
      orders={page.rows}
      query={displayedQuery}
      nowIso={new Date().toISOString()}
      footer={
        <div className="border-t px-4 py-3">
          <AdminPagination
            basePath="/orders"
            page={page.page}
            pageCount={page.pageCount}
            total={page.total}
            pageSize={page.pageSize}
            queryParams={queryParams}
          />
        </div>
      }
    />
  );
}

export async function OrdersListFiltersSection({
  query,
  issues,
  advancedRequested,
  actor,
  orderListPageWindowPromise,
  filterOptionsPromise,
  recentExportsPromise,
}: {
  query: ReturnType<typeof sanitizeOrderListQueryForActor>;
  issues: readonly string[];
  advancedRequested: boolean;
  actor: OrdersActor;
  orderListPageWindowPromise: OrderListPageWindowPromise;
  filterOptionsPromise: FilterOptionsPromise;
  recentExportsPromise: RecentExportsPromise;
}) {
  const [orderListPageWindow, filterOptions] = await Promise.all([
    orderListPageWindowPromise,
    filterOptionsPromise,
  ]);
  const displayedQuery = { ...query, page: orderListPageWindow.page };
  const showCommercialAmounts = actor.role !== Role.WORKER;

  return (
    <OrderListFilters
      query={displayedQuery}
      options={filterOptions}
      issues={issues}
      total={orderListPageWindow.total}
      showCommercialAmounts={showCommercialAmounts}
      advancedRequested={advancedRequested}
      canReviewChanges={actor.role === Role.ADMIN}
      exportControls={
        actor.role === Role.ADMIN ? (
          <ErrorBoundary
            scope="field"
            title="导出记录暂时无法加载"
            description="筛选与工单列表不受影响；请重试导出区域。"
          >
            <Suspense fallback={<OrderExportControlsSkeleton />}>
              <OrderExportsSection
                query={displayedQuery}
                filteredTotal={orderListPageWindow.total}
                recentExportsPromise={recentExportsPromise}
              />
            </Suspense>
          </ErrorBoundary>
        ) : null
      }
    />
  );
}

export async function OrderExportsSection({
  query,
  filteredTotal,
  recentExportsPromise,
}: {
  query: ReturnType<typeof sanitizeOrderListQueryForActor>;
  filteredTotal: number;
  recentExportsPromise: RecentExportsPromise;
}) {
  const recentExports = await recentExportsPromise;
  const exportParams = orderExportParamsFromQuery(query);

  return (
    <OrderExportControls
      params={exportParams}
      filteredTotal={filteredTotal}
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
  );
}

export async function OrdersListTableSection({
  query,
  actor,
  orderPagePromise,
}: {
  query: ReturnType<typeof sanitizeOrderListQueryForActor>;
  actor: OrdersActor;
  orderPagePromise: OrdersPagePromise;
}) {
  const orderPage = await orderPagePromise;
  const displayedQuery = { ...query, page: orderPage.page };
  const queryParams = serializeOrderListQuery(displayedQuery);
  const showCommercialAmounts = actor.role !== Role.WORKER;

  return (
    <OrdersTable
      orders={orderPage.rows}
      showCommercialAmounts={showCommercialAmounts}
      showPieceworkCost={actor.role === Role.ADMIN}
      canSchedule={actor.role === Role.ADMIN}
      query={displayedQuery}
      queryParams={queryParams}
      footer={
        <div className="border-t px-4 py-3">
          <AdminPagination
            basePath="/orders"
            page={orderPage.page}
            pageCount={orderPage.pageCount}
            total={orderPage.total}
            pageSize={orderPage.pageSize}
            queryParams={queryParams}
          />
        </div>
      }
    />
  );
}

function rawValueIncludes(
  value: string | string[] | undefined,
  expected: string,
): boolean {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}
