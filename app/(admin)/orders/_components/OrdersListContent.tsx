import { randomUUID } from 'node:crypto';
import { Role } from '@/generated/prisma/enums';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { OrderExportControls } from '@/components/business/order/OrderExportControls';
import { OrderListFilters } from '@/components/business/order/OrderListFilters';
import { OrdersTable } from '@/components/business/order/OrdersTable';
import { OrderListScrollState } from '@/components/business/order/OrderListNavigationState';
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

export async function OrdersListContent({
  searchParams,
  user,
}: {
  searchParams: Promise<OrderListSearchParams>;
  user: { id: string; role: Role };
}) {
  const rawSearchParams = await searchParams;
  const parsed = parseOrderListQuery(rawSearchParams);
  const actor = { id: user.id, role: user.role };
  const query = sanitizeOrderListQueryForActor(actor, parsed.query);
  const showCommercialAmounts = user.role !== Role.WORKER;

  const [orderPage, filterOptions, recentExports] = await Promise.all([
    listOrdersPage(actor, query),
    getOrderListFilterOptions(actor),
    user.role === Role.ADMIN
      ? listRecentOrderExports(user.id)
      : Promise.resolve([]),
  ]);
  const displayedQuery = { ...query, page: orderPage.page };
  const queryParams = serializeOrderListQuery(displayedQuery);
  const exportParams = orderExportParamsFromQuery(displayedQuery);
  const advancedRequested = rawValueIncludes(rawSearchParams.advanced, '1');

  return (
    <>
      <OrderListScrollState
        selectedOrderId={displayedQuery.selectedOrderId}
        scrollY={displayedQuery.scrollY}
      />
      <OrderListFilters
        query={displayedQuery}
        options={filterOptions}
        issues={parsed.issues}
        total={orderPage.total}
        showCommercialAmounts={showCommercialAmounts}
        advancedRequested={advancedRequested}
        canReviewChanges={user.role === Role.ADMIN}
        exportControls={
          user.role === Role.ADMIN ? (
            <OrderExportControls
              params={exportParams}
              filteredTotal={orderPage.total}
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
          ) : null
        }
      />
      <div className="min-w-0 rounded-xl border bg-card shadow-sm">
        <div className="min-w-0 p-0 sm:p-4">
          <OrdersTable
            orders={orderPage.rows}
            showCommercialAmounts={showCommercialAmounts}
            showPieceworkCost={user.role === Role.ADMIN}
            canSchedule={user.role === Role.ADMIN}
            query={displayedQuery}
            queryParams={queryParams}
          />
        </div>
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
      </div>
    </>
  );
}

function rawValueIncludes(
  value: string | string[] | undefined,
  expected: string,
): boolean {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}
