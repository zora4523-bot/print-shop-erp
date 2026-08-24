import { randomUUID } from 'node:crypto';
import { Suspense } from 'react';
import { Role } from '@/generated/prisma/enums';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { OrderExportControls } from '@/components/business/order/OrderExportControls';
import { OrderListFilters } from '@/components/business/order/OrderListFilters';
import { OrdersTable } from '@/components/business/order/OrdersTable';
import { OrderListScrollState } from '@/components/business/order/OrderListNavigationState';
import { ErrorBoundary } from '@/components/ui-business';
import {
  getOrderListFilterOptions,
  listOrdersPage,
  parseOrderListQuery,
  sanitizeOrderListQueryForActor,
  serializeOrderListQuery,
  type OrderListSearchParams,
} from '@/lib/order/list-query';
import {
  listRecentOrderExports,
  orderExportParamsFromQuery,
} from '@/lib/order/export';
import {
  OrderExportControlsSkeleton,
  OrdersListFiltersSkeleton,
  OrdersListTableSkeleton,
} from './OrdersListContentSkeleton';

type OrdersActor = { id: string; role: Role };
type OrdersPagePromise = ReturnType<typeof listOrdersPage>;
type FilterOptionsPromise = ReturnType<typeof getOrderListFilterOptions>;
type RecentExportsPromise = ReturnType<typeof listRecentOrderExports>;

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
  const query = sanitizeOrderListQueryForActor(actor, parsed.query);
  // 三次读取只在这里各启动一次。orderPagePromise 会被筛选与表格子区共享；
  // React 可在两个 Suspense 边界中等待同一个 Promise，不会重复访问数据库。
  const orderPagePromise = listOrdersPage(actor, query);
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
            orderPagePromise={orderPagePromise}
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

export async function OrdersListFiltersSection({
  query,
  issues,
  advancedRequested,
  actor,
  orderPagePromise,
  filterOptionsPromise,
  recentExportsPromise,
}: {
  query: ReturnType<typeof sanitizeOrderListQueryForActor>;
  issues: readonly string[];
  advancedRequested: boolean;
  actor: OrdersActor;
  orderPagePromise: OrdersPagePromise;
  filterOptionsPromise: FilterOptionsPromise;
  recentExportsPromise: RecentExportsPromise;
}) {
  const [orderPage, filterOptions] = await Promise.all([
    orderPagePromise,
    filterOptionsPromise,
  ]);
  const displayedQuery = { ...query, page: orderPage.page };
  const showCommercialAmounts = actor.role !== Role.WORKER;

  return (
    <OrderListFilters
      query={displayedQuery}
      options={filterOptions}
      issues={issues}
      total={orderPage.total}
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
                filteredTotal={orderPage.total}
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
