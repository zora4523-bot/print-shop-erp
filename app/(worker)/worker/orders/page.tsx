import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { requirePermission } from '@/lib/auth/permissions';
import { listWorkerOrders } from '@/lib/worker-portal';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui-business';
import { formatDateShanghai } from '@/lib/format/dates';

export const metadata = { title: '我的工单' };

export default async function WorkerOrdersPage() {
  const user = await requirePermission('order:view:self');
  const orders = await listWorkerOrders({ id: user.id, role: user.role });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">我的工单</h1>
        <p className="text-xs text-muted-foreground">
          只显示至少有一个生产任务分配给你的工单，包含已完成的历史记录。
        </p>
      </header>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="暂无关联工单"
          description="车间主管将生产任务分配给你后，对应工单才会显示在这里。"
        />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/worker/orders/${order.id}`}
                className="block rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-sans tabular-nums text-sm">{order.orderNo}</span>
                      <OrderStatusBadge status={order.status} />
                      {order.isUrgent ? <Badge variant="destructive">急单</Badge> : null}
                    </div>
                    <p className="mt-2 text-sm">客户代号：{order.customerRef ?? '—'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      我的任务 {order.completedTaskCount}/{order.taskCount} 已完成
                      {order.promisedDate ? ` · 交期 ${formatDateShanghai(order.promisedDate)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">我的计件</p>
                    <p className="font-sans tabular-nums font-medium">¥ {order.pieceworkAmount}</p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
