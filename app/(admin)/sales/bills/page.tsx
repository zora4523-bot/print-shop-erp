import Form from 'next/form';
import { buildTableHref } from '@/lib/admin/table';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth/permissions';
import { listSalesMonthlyBills } from '@/lib/agent-monthly-billing/sales-query';
import { SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, EmptyState, TableScrollArea, StatusBadge, StatCard, FilterClearLink } from '@/components/ui-business';
import { NativeSelect } from '@/components/ui/native-select';

import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { parseAgentBillFilters, type AgentBillSearchParams } from '@/lib/agent-monthly-billing/list-filter';

export const metadata = { title: '我的对客应付账单' };
export default async function SalesBillsPage({ searchParams }: { searchParams: Promise<AgentBillSearchParams> }) {
  const user = await requirePermission('bill:view:self');
  const raw = await searchParams;
  const filters = parseAgentBillFilters(raw);
  const result = await listSalesMonthlyBills(user, raw);
  const { rows, summary } = result;
  return <div className="space-y-6">
    <PageHeader title="我的对客应付账单" />
    <p className="text-sm text-muted-foreground">统计范围：当前筛选结果。整理中金额未定稿，不计入待支付。</p>
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="整理中" value={formatMoney(summary.DRAFT.amount)} tone="neutral" hint="金额未定稿" />
      <StatCard label="待支付" value={formatMoney(summary.CONFIRMED.amount)} tone="warning" hint="已确认，待支付" />
      <StatCard label="已结清" value={formatMoney(summary.PAID.amount)} tone="success" />
    </div>
    {/* next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。 */}
    <Form id="sales-bill-filters" key={JSON.stringify([filters.status ?? '', filters.period ?? ''])} action="/sales/bills" className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1">状态<NativeSelect name="status" defaultValue={filters.status ?? ''}>
        <option value="">全部</option>{Object.entries(SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}
      </NativeSelect></label>
      <label className="grid gap-1">周期<Input name="period" type="month" defaultValue={filters.period ?? ''} className="w-auto" /></label>
      <Button type="submit">筛选</Button><FilterClearLink formId="sales-bill-filters" href="/sales/bills" className={buttonVariants({ variant: 'ghost' })}>清除筛选</FilterClearLink>
    </Form>
    {rows.length === 0 ? <EmptyState title="当前筛选条件下暂无账单" /> : <TableScrollArea label="我的月账单">
      <table className="w-full text-sm"><thead><tr><th className="p-3 text-left">周期</th><th className="p-3 text-right">总额</th><th className="p-3">状态</th><th className="p-3">详情</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} className="border-t"><td className="p-3">{row.period}</td><td className="p-3 text-right tabular-nums">{formatMoney(row.totalAmount)}</td><td className="p-3 text-center"><StatusBadge tone={SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY[row.status].tone}>{SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY[row.status].label}{row.status === 'DRAFT' ? ' / 金额未定稿' : ''}</StatusBadge></td><td className="p-3 text-center"><Link href={buildTableHref(`/sales/bills/${row.id}`, {}, { returnTo: buildTableHref('/sales/bills', {}, { period: filters.period, status: filters.status, page: result.page }) })} className={buttonVariants({ variant: 'outline' })}>查看详情</Link></td></tr>)}</tbody>
      </table>
    </TableScrollArea>}
    <AdminPagination basePath="/sales/bills" page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} queryParams={{ period: filters.period, status: filters.status }} />
  </div>;
}
