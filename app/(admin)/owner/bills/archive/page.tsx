import Link from 'next/link';
import { Archive } from 'lucide-react';
import { BillStatus } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { listBills } from '@/lib/bill';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState, PageHeader, StatusBadge, TableScrollArea } from '@/components/ui-business';

export const metadata = { title: 'Legacy 账单只读归档' };

const STATUS_LABELS: Record<BillStatus, string> = {
  DRAFT: '草稿',
  ISSUED: '已发单',
  PARTIAL_PAID: '部分收款',
  FULLY_PAID: '已结清',
};

export default async function LegacyBillArchivePage() {
  await requirePermission('bill:view:all');
  const rows = await listBills();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Legacy 账单只读归档"
        subtitle="保留 finishedAt、补充账单与部分收款的原始历史语义；本页不提供任何写操作，也不与 v2 数字混算。"
      />
      <Link href="/owner/agent-bills" className={buttonVariants({ variant: 'outline' })}>
        ← 返回代理商月度账单
      </Link>
      {rows.length === 0 ? (
        <EmptyState icon={Archive} title="暂无 legacy 账单" description="归档表中尚无历史记录。" />
      ) : (
        <TableScrollArea label="Legacy 账单归档" className="rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">账期 / 序号</th>
                <th className="px-4 py-2 text-left">销售 / 客服</th>
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
                    <StatusBadge
                      tone={bill.status === BillStatus.FULLY_PAID ? 'success' : 'neutral'}
                      dot
                    >
                      {STATUS_LABELS[bill.status]}
                    </StatusBadge>
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
