import Link from 'next/link';
import { listOutsourceOrders } from '@/lib/outsource';
import { OutsourceStatus } from '@/generated/prisma/enums';
import { buttonVariants } from '@/components/ui/button';
import { formatDateShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';
import {
  StatusBadge as UiStatusBadge,
  TableScrollArea,
} from '@/components/ui-business';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { OUTSOURCE_STATUS_REGISTRY } from '@/lib/ui/status-registry';

export const metadata = { title: '外协单' };

export default async function OutsourceListPage() {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('outsource:manage');
  const rows = await listOutsourceOrders();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">外协单</h1>
          <p className="text-sm text-muted-foreground">
            发往 UV / 啤 / 彩印 等外协厂的工艺清单。回货后点&ldquo;已回货&rdquo;。
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          暂无外协单。
        </div>
      ) : (
        <TableScrollArea
          label="外协单列表"
          className="rounded-xl border bg-card shadow-sm"
        >
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">工单号</th>
                <th className="px-4 py-2 text-left">外协厂</th>
                <th className="px-4 py-2 text-left">工艺</th>
                <th className="px-4 py-2 text-right">数量</th>
                <th className="px-4 py-2 text-left">预计回货</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-sans tabular-nums">
                        {r.order?.orderNo ?? '—'}
                      </span>
                      {r.order?.isUrgent ? <UrgentBadge /> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">{r.supplierName}</td>
                  <td className="px-4 py-3">{r.craftDescription ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {r.totalQty?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDateShanghai(r.expectedDate)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/foreman/outsource/${r.id}`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      详情
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: OutsourceStatus }) {
  const definition = OUTSOURCE_STATUS_REGISTRY[status];
  return (
    <UiStatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </UiStatusBadge>
  );
}
