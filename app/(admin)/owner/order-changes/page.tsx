import Link from 'next/link';
import {
  OrderChangeRequestStatus,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { listOrderChangeRequests } from '@/lib/order/change-request';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';

export const metadata = {
  title: '工单修改申请 · 红包印刷 ERP',
};

const STATUS_LABELS: Record<OrderChangeRequestStatus, string> = {
  [OrderChangeRequestStatus.PENDING]: '待审核',
  [OrderChangeRequestStatus.APPROVED]: '已批准',
  [OrderChangeRequestStatus.REJECTED]: '已拒绝',
  [OrderChangeRequestStatus.CANCELLED]: '已撤销',
  [OrderChangeRequestStatus.STALE]: '版本已过期',
};

export default async function OrderChangesPage() {
  await requirePermission('order:change:review');
  const requests = await listOrderChangeRequests({ limit: 100 });
  const pendingCount = requests.filter(
    (request) => request.status === OrderChangeRequestStatus.PENDING,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="工单修改申请"
        subtitle={`销售与客服提交的款式变更在这里审核；批准后统一同步生产任务。待审核 ${pendingCount} 条。`}
      />
      {requests.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          暂无工单修改申请。
        </div>
      ) : (
        <ol className="space-y-3" aria-label="工单修改申请列表">
          {requests.map((request) => (
            <li
              key={request.id}
              className="grid min-w-0 gap-3 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      request.status === OrderChangeRequestStatus.REJECTED
                        ? 'destructive'
                        : request.status === OrderChangeRequestStatus.APPROVED
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {STATUS_LABELS[request.status]}
                  </Badge>
                  <Link
                    href={`/orders/${request.order.id}`}
                    className="admin-wrap-anywhere font-sans font-medium tabular-nums text-primary underline"
                  >
                    {request.order.orderNo}
                  </Link>
                  {request.order.customName ? (
                    <span className="admin-wrap-anywhere text-sm">
                      {request.order.customName}
                    </span>
                  ) : null}
                </div>
                <p className="admin-wrap-anywhere mt-2 text-sm">
                  {request.requester.displayName}：{request.reason}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  基于第 {request.baseRevision} 版 · 当前第{' '}
                  {request.order.revision} 版 ·{' '}
                  {formatDateTimeShanghai(request.createdAt)}
                </p>
              </div>
              <Link
                href={`/orders/${request.order.id}`}
                className={buttonVariants({
                  variant:
                    request.status === OrderChangeRequestStatus.PENDING
                      ? 'default'
                      : 'outline',
                })}
              >
                {request.status === OrderChangeRequestStatus.PENDING
                  ? '进入审核'
                  : '查看详情'}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
