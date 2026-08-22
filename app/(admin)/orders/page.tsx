import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { Role } from '../../../generated/prisma/enums';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/auth/session';
import {
  getOrderListFilterOptions,
  listOrdersPage,
  parseOrderListQuery,
  sanitizeOrderListQueryForActor,
  serializeOrderListQuery,
  type OrderListSearchParams,
} from '@/lib/order/list-query';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { OrderListFilters } from '@/components/business/order/OrderListFilters';
import { OrderExportControls } from '@/components/business/order/OrderExportControls';
import { OrdersTable } from '@/components/business/order/OrdersTable';
import { PageHeader } from '@/components/ui-business';
import {
  listRecentOrderExports,
  orderExportParamsFromQuery,
} from '@/lib/order/export';

export const metadata = {
  title: '工单列表 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<OrderListSearchParams>;
};

export default async function OrdersListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const parsed = parseOrderListQuery(sp);
  const { user } = await requireSession();
  const canCreate =
    user.role === Role.SALES ||
    user.role === Role.CUSTOMER_SERVICE ||
    user.role === Role.ADMIN;
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="工单"
        subtitle="销售 / 客服只看自己提交的；管理员看全部；师傅看分配给自己的任务所在工单。"
        actions={
          canCreate ? (
            <Link href="/orders/new" className={buttonVariants()}>
              新建工单
            </Link>
          ) : null
        }
      />
      <OrderListFilters
        query={displayedQuery}
        options={filterOptions}
        issues={parsed.issues}
        total={orderPage.total}
        showCommercialAmounts={showCommercialAmounts}
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
    </div>
  );
}
