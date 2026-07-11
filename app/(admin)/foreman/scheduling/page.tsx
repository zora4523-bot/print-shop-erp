import Link from 'next/link';
import { CalendarCheck } from 'lucide-react';
import { listPendingSchedulingOrders } from '@/lib/production';
import { roleLabel } from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui-business';
import { formatDateShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = { title: '待排产工单' };

export default async function SchedulingListPage() {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('order:schedule');
  const orders = await listPendingSchedulingOrders();

  return (
    <div className="space-y-6">
      <PageHeader
        title="待排产"
        subtitle="已提交（SUBMITTED）的工单按急单优先、提交时间先后排列。点击&ldquo;排产&rdquo;为每个款式的非外协工艺派师傅。"
      />

      {orders.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="没有待排产的工单"
          description="销售 / 客服提交的工单会出现在这里等待排产。"
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">工单号</th>
                <th className="px-4 py-2 text-left">客户代号</th>
                <th className="px-4 py-2 text-left">提交人</th>
                <th className="px-4 py-2 text-left">提交时间</th>
                <th className="px-4 py-2 text-center">款式 / 工艺数</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((o) => {
                const craftTotal = o.items.reduce((sum, it) => sum + it.crafts.length, 0);
                return (
                  <tr key={o.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{o.orderNo}</span>
                        {o.isUrgent ? (
                          <Badge variant="destructive">急单</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">{o.customerRef ?? '—'}</td>
                    <td className="px-4 py-3">
                      {o.submitter.displayName}
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({roleLabel(o.submitter.role)})
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDateShanghai(o.submittedAt ?? o.createdAt, '-')}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs">
                      {o.items.length} / {craftTotal}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/foreman/scheduling/${o.id}`}
                        className={buttonVariants({ size: 'sm' })}
                      >
                        排产
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
