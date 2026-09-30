import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import Form from 'next/form';
import { ClipboardList } from 'lucide-react';
import { requirePermission } from '@/lib/auth/permissions';
import { listWorkerOrders } from '@/lib/worker-portal';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { EmptyState, FilterClearLink, PageHeader } from '@/components/ui-business';
import { formatDateShanghai } from '@/lib/format/dates';
import { formatMoney } from '@/lib/dashboard/format';
import { parsePositiveInt, firstSearchParam } from '@/lib/admin/table';

export const metadata = { title: '我的工单' };

type PageProps = {
  searchParams: Promise<{ page?: string | string[]; q?: string | string[] }>;
};

const WORKER_ORDERS_PATH = '/worker/orders';

// 纯链接翻页：不依赖 JS，师傅端弱网/微信内置浏览器也能用。
function workerOrdersHref(page: number, q?: string): string {
  return `${WORKER_ORDERS_PATH}?${new URLSearchParams({ page: String(page), q: q ?? '' })}`;
}

export default async function WorkerOrdersPage({ searchParams }: PageProps) {
  const user = await requirePermission('order:view:self');
  const raw = await searchParams;
  const sp = { ...raw, q: firstSearchParam(raw.q) };
  const orderPage = await listWorkerOrders(
    { id: user.id, role: user.role },
    { page: parsePositiveInt(sp.page, { defaultValue: 1, min: 1 }), q: sp.q },
  );
  const orders = orderPage.rows;

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader size="worker" title="我的工单" className="worker-wrap-anywhere" />

      {/* next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。 */}
      <Form id="worker-order-filters" key={JSON.stringify([sp.q ?? ''])} action="/worker/orders" className="flex flex-wrap gap-2 rounded-xl border bg-card p-3"><label className="min-w-0 flex-1"><span className="sr-only">工单号或名称</span><Input name="q" defaultValue={sp.q} maxLength={100} placeholder="工单号或名称" className="w-full" /></label><Button type="submit">搜索</Button>{sp.q && <FilterClearLink formId="worker-order-filters" href="/worker/orders" className="inline-flex min-h-11 items-center underline">清除筛选</FilterClearLink>}</Form>
      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={sp.q ? '没有匹配的工单' : '暂无工单'}
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
                      外部销售：{order.externalSalesName ?? '未填'}
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
                  </div>
                  <div className="ml-auto shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">我的已报计件</p>
                    <p className="font-sans tabular-nums font-medium">
                      {formatMoney(order.pieceworkAmount)}
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
                href={workerOrdersHref(orderPage.page - 1, sp.q)}
                prefetch={false}
                className="inline-flex min-h-11 items-center rounded-md border bg-card px-4 hover:bg-muted"
              >
                较新的工单
              </Link>
            ) : null}
            {orderPage.page < orderPage.pageCount ? (
              <Link
                href={workerOrdersHref(orderPage.page + 1, sp.q)}
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
