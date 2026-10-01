import Link from 'next/link';
import { Archive } from 'lucide-react';
import { requirePermission } from '@/lib/auth/permissions';
import { listBills } from '@/lib/bill';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState, PageHeader, TableScrollArea } from '@/components/ui-business';
import { BillStatusBadge } from '@/components/business/bill/BillStatusBadge';

export const metadata = { title: '历史账单归档' };

export default async function LegacyBillArchivePage() {
  await requirePermission('bill:view:all');
  const rows = await listBills();
  return (
    <div className="space-y-6">
      <PageHeader
        title="历史账单归档"
        subtitle="不计入当前月账单"
      />
      {rows.length === 0 ? (
        <EmptyState icon={Archive} title="暂无历史账单" />
      ) : (
        <TableScrollArea label="历史账单归档" className="rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">账期 / 序号</th>
                <th className="px-4 py-2 text-left">销售</th>
                <th className="px-4 py-2 text-right">总额</th>
                <th className="px-4 py-2 text-right">已收</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2 text-left">发单时间</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((bill) => (
                <tr key={bill.id}>
                  <td className="px-4 py-3 font-sans tabular-nums">
                    {bill.period} · #{bill.sequence}
                  </td>
                  <td className="px-4 py-3">{bill.salesUser.displayName}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">{formatMoney(bill.totalAmount)}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">{formatMoney(bill.paidAmount)}</td>
                  <td className="px-4 py-3 text-center">
                    <BillStatusBadge status={bill.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTimeShanghai(bill.issuedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/owner/bills/archive/${bill.id}`}
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                    >
                      查看归档
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
