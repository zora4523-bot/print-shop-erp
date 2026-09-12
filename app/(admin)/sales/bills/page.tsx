import Decimal from 'decimal.js';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth/permissions';
import { listSalesMonthlyBills } from '@/lib/agent-monthly-billing/sales-query';
import { AGENT_MONTHLY_BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageHeader, EmptyState, TableScrollArea, StatusBadge } from '@/components/ui-business';

export const metadata = { title: '我的对客应付账单' };
export default async function SalesBillsPage({ searchParams }: { searchParams: Promise<{ status?: string; period?: string }> }) {
  const user = await requirePermission('bill:view:self');
  const filters = await searchParams;
  const rows = await listSalesMonthlyBills(user, filters);
  const unpaid = rows.filter((row) => row.status === 'CONFIRMED').reduce((sum, row) => sum.plus(row.totalAmount.toString()), new Decimal(0));
  const paid = rows.filter((row) => row.status === 'PAID').reduce((sum, row) => sum.plus(row.totalAmount.toString()), new Decimal(0));
  return <div className="space-y-6">
    <PageHeader title="我的对客应付账单" />
    <dl className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border bg-card p-4"><dt>待支付</dt><dd className="text-xl font-semibold tabular-nums">{formatMoney(unpaid)}</dd></div>
      <div className="rounded-xl border bg-card p-4"><dt>已结清</dt><dd className="text-xl font-semibold tabular-nums">{formatMoney(paid)}</dd></div>
    </dl>
    <form className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1">状态<select name="status" defaultValue={filters.status ?? ''} className="min-h-11 rounded-md border bg-background px-3">
        <option value="">全部</option>{Object.entries(AGENT_MONTHLY_BILL_STATUS_REGISTRY).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}
      </select></label>
      <label className="grid gap-1">周期<input name="period" type="month" defaultValue={filters.period ?? ''} className="min-h-11 rounded-md border bg-background px-3" /></label>
      <Button type="submit">筛选</Button><Link href="/sales/bills" className={buttonVariants({ variant: 'ghost' })}>清除</Link>
    </form>
    {rows.length === 0 ? <EmptyState title="当前筛选条件下暂无账单" /> : <TableScrollArea label="我的月账单">
      <table className="w-full text-sm"><thead><tr><th className="p-3 text-left">周期</th><th className="p-3 text-right">总额</th><th className="p-3">状态</th><th className="p-3">详情</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="p-3">{row.period}</td><td className="p-3 text-right tabular-nums">{formatMoney(row.totalAmount)}</td><td className="p-3 text-center"><StatusBadge tone={AGENT_MONTHLY_BILL_STATUS_REGISTRY[row.status].tone}>{AGENT_MONTHLY_BILL_STATUS_REGISTRY[row.status].label}</StatusBadge></td><td className="p-3 text-center"><Link href={`/sales/bills/${row.id}`} className={buttonVariants({ variant: 'outline' })}>查看详情</Link></td></tr>)}</tbody>
      </table>
    </TableScrollArea>}
  </div>;
}
