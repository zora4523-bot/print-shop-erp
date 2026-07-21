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
    <div className="min-w-0 space-y-4">
      <header className="worker-wrap-anywhere">
        <h1 className="text-lg font-semibold">我的工单</h1>
        <p className="text-xs text-muted-foreground">
          只显示至少有一个生产任务分配给你的工单，包含已完成的历史记录。
        </p>
      </header>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="暂无关联工单"
          description="管理员将生产任务分配给你后，对应工单才会显示在这里。"
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
                      {order.isUrgent ? (
                        <Badge
                          variant="destructive"
                          className="bg-destructive text-background dark:bg-destructive dark:text-background"
                        >
                          急单
                        </Badge>
                      ) : null}
                    </div>
                    <p className="worker-wrap-anywhere mt-2 text-sm">
                      客户代号：{order.customerRef ?? '—'}
                    </p>
                    <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                      我的任务 {order.completedTaskCount}/{order.taskCount} 已完成
                      {order.promisedDate
                        ? ` · 交期 ${formatDateShanghai(order.promisedDate)}`
                        : ''}
                    </p>
                  </div>
                  <div className="ml-auto shrink-0 text-right">
                    {order.hasPieceworkTasks ? (
                      <>
                        <p className="text-xs text-muted-foreground">我的计件</p>
                        <p className="font-sans tabular-nums font-medium">
                          ¥ {order.pieceworkAmount}
                        </p>
                      </>
                    ) : (
                      <p className="worker-wrap-anywhere text-xs text-muted-foreground">
                        按考勤时薪结算
                      </p>
                    )}
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
