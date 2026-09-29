import Decimal from 'decimal.js';
import Form from 'next/form';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth/permissions';
import { listSalesMonthlyBills } from '@/lib/agent-monthly-billing/sales-query';
import { SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageHeader, EmptyState, TableScrollArea, StatusBadge, StatCard, FilterClearLink } from '@/components/ui-business';
import { NativeSelect } from '@/components/ui/native-select';

export const metadata = { title: '我的对客应付账单' };
export default async function SalesBillsPage({ searchParams }: { searchParams: Promise<{ status?: string; period?: string }> }) {
  const user = await requirePermission('bill:view:self');
  const filters = await searchParams;
  const rows = await listSalesMonthlyBills(user, filters);
  const draft = rows.filter((row) => row.status === 'DRAFT').reduce((sum, row) => sum.plus(row.totalAmount.toString()), new Decimal(0));
  const unpaid = rows.filter((row) => row.status === 'CONFIRMED').reduce((sum, row) => sum.plus(row.totalAmount.toString()), new Decimal(0));
  const paid = rows.filter((row) => row.status === 'PAID').reduce((sum, row) => sum.plus(row.totalAmount.toString()), new Decimal(0));
  return <div className="space-y-6">
    <PageHeader title="我的对客应付账单" />
    <p className="text-sm text-muted-foreground">统计范围：当前筛选结果。整理中金额未定稿，不计入待支付。</p>
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="整理中" value={formatMoney(draft)} tone="neutral" hint="金额未定稿" />
      <StatCard label="待支付" value={formatMoney(unpaid)} tone="warning" hint="已确认，待支付" />
      <StatCard label="已结清" value={formatMoney(paid)} tone="success" />
    </div>
    {/* next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。 */}
    <Form id="sales-bill-filters" key={JSON.stringify([filters.status ?? '', filters.period ?? ''])} action="/sales/bills" className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1">状态<NativeSelect name="status" defaultValue={filters.status ?? ''}>
        <option value="">全部</option>{Object.entries(SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}
      </NativeSelect></label>
      <label className="grid gap-1">周期<input name="period" type="month" defaultValue={filters.period ?? ''} className="min-h-11 rounded-md border bg-background px-3" /></label>
      <Button type="submit">筛选</Button><FilterClearLink formId="sales-bill-filters" href="/sales/bills" className={buttonVariants({ variant: 'ghost' })}>清除筛选</FilterClearLink>
    </Form>
    {rows.length === 0 ? <EmptyState title="当前筛选条件下暂无账单" /> : <TableScrollArea label="我的月账单">
      <table className="w-full text-sm"><thead><tr><th className="p-3 text-left">周期</th><th className="p-3 text-right">总额</th><th className="p-3">状态</th><th className="p-3">详情</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="p-3">{row.period}</td><td className="p-3 text-right tabular-nums">{formatMoney(row.totalAmount)}</td><td className="p-3 text-center"><StatusBadge tone={SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY[row.status].tone}>{SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY[row.status].label}{row.status === 'DRAFT' ? ' / 金额未定稿' : ''}</StatusBadge></td><td className="p-3 text-center"><Link href={`/sales/bills/${row.id}`} className={buttonVariants({ variant: 'outline' })}>查看详情</Link></td></tr>)}</tbody>
      </table>
    </TableScrollArea>}
  </div>;
}
