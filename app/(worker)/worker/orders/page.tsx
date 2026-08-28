import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { requirePermission } from '@/lib/auth/permissions';
import { listWorkerOrders } from '@/lib/worker-portal';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { EmptyState } from '@/components/ui-business';
import { formatDateShanghai } from '@/lib/format/dates';
import { parsePositiveInt } from '@/lib/admin/table';

export const metadata = { title: '我的工单' };

type PageProps = {
  searchParams: Promise<{ page?: string | string[] }>;
};

const WORKER_ORDERS_PATH = '/worker/orders';

// 纯链接翻页：不依赖 JS，师傅端弱网/微信内置浏览器也能用。
function workerOrdersHref(page: number): string {
  return page <= 1 ? WORKER_ORDERS_PATH : `${WORKER_ORDERS_PATH}?page=${page}`;
}

export default async function WorkerOrdersPage({ searchParams }: PageProps) {
  const user = await requirePermission('order:view:self');
  const sp = await searchParams;
  const orderPage = await listWorkerOrders(
    { id: user.id, role: user.role },
    { page: parsePositiveInt(sp.page, { defaultValue: 1, min: 1 }) },
  );
  const orders = orderPage.rows;

  return (
    <div className="min-w-0 space-y-4">
      <header className="worker-wrap-anywhere">
        <h1 className="text-lg font-semibold">我的工单</h1>
        <p className="text-xs text-muted-foreground">
          展示与你固定计件岗位或共享无计件进度相关的工单。
        </p>
      </header>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="暂无工序工单"
          description="价格确认并生成对应工序后，工单会自动显示。"
        />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/worker/orders/${order.id}`}
                className="block min-h-11 min-w-0 rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="worker-wrap-anywhere min-w-0 font-sans tabular-nums text-sm">
                        {order.orderNo}
                      </span>
                      <OrderStatusBadge
                        status={order.status}
                        className="border-border bg-background text-foreground"
                      />
                      {order.isUrgent ? <UrgentBadge /> : null}
                    </div>
                    <p className="worker-wrap-anywhere mt-2 text-sm">
                      客户名称/简称：{order.customerRef ?? '—'}
                    </p>
                    {order.customName ? (
                      <p className="worker-wrap-anywhere mt-1 text-sm font-semibold">
                        {order.customName}
                      </p>
                    ) : null}
                    <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                      可见生产步骤 {order.completedOperationCount}/
                      {order.operationCount} 已完成
                      {order.promisedDate
                        ? ` · 交期 ${formatDateShanghai(order.promisedDate)}`
                        : ''}
                    </p>
                    <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                      接单人：{order.submitterName}
                    </p>
                  </div>
                  <div className="ml-auto shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">我的已报计件</p>
                    <p className="font-sans tabular-nums font-medium">
                      ¥ {order.pieceworkAmount}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {orderPage.pageCount > 1 ? (
        <nav
          aria-label="工单分页"
          className="flex min-w-0 flex-wrap items-center gap-3 border-t pt-3"
        >
          <p className="worker-wrap-anywhere text-xs text-muted-foreground">
            共 {orderPage.total} 个工单 · 第 {orderPage.page} /{' '}
            {orderPage.pageCount} 页
          </p>
          <div className="ml-auto flex flex-wrap gap-2 text-sm">
            {orderPage.page > 1 ? (
              <Link
                href={workerOrdersHref(orderPage.page - 1)}
                prefetch={false}
                className="inline-flex min-h-11 items-center rounded-md border bg-card px-4 hover:bg-muted"
              >
                较新的工单
              </Link>
            ) : null}
            {orderPage.page < orderPage.pageCount ? (
              <Link
                href={workerOrdersHref(orderPage.page + 1)}
                prefetch={false}
                className="inline-flex min-h-11 items-center rounded-md border bg-card px-4 hover:bg-muted"
              >
                更早的工单
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
