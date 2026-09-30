import { SalesBillOverview } from '@/components/business/agent-monthly-billing/SalesBillOverview';
import { SalesBillsList } from '@/components/business/agent-monthly-billing/SalesBillsList';
import Form from 'next/form';
import { buildTableHref } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { listSalesMonthlyBills } from '@/lib/agent-monthly-billing/sales-query';
import { SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, EmptyState, StatCard, FilterClearLink } from '@/components/ui-business';
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
    <p className="text-sm text-muted-foreground">统计范围：当前筛选结果。按已确认应收的结算月份归集，月末后出账。</p>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatCard label="整理中" value={formatMoney(summary.DRAFT.amount)} tone="neutral" hint="金额未定稿" className="col-span-2 sm:col-span-1" />
      <StatCard label="待支付" value={formatMoney(summary.CONFIRMED.amount)} tone="warning" hint="已确认，待支付" />
      <StatCard label="已结清" value={formatMoney(summary.PAID.amount)} tone="success" />
    </div>
    <SalesBillOverview months={result.trend} expanded={false} />
    {/* next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。 */}
    <Form id="sales-bill-filters" key={JSON.stringify([filters.status ?? '', filters.period ?? ''])} action="/sales/bills" className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1">状态<NativeSelect name="status" defaultValue={filters.status ?? ''}>
        <option value="">全部</option>{Object.entries(SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}
      </NativeSelect></label>
      <label className="grid gap-1">周期<Input name="period" type="month" defaultValue={filters.period ?? ''} className="w-auto" /></label>
      <Button type="submit">筛选</Button><FilterClearLink formId="sales-bill-filters" href="/sales/bills" className={buttonVariants({ variant: 'ghost' })}>清除筛选</FilterClearLink>
    </Form>
    {rows.length === 0 ? <EmptyState title="当前筛选条件下暂无账单" /> : <SalesBillsList rows={rows} returnTo={buildTableHref('/sales/bills', {}, { period: filters.period, status: filters.status, page: result.page })} />}
    <AdminPagination basePath="/sales/bills" page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} queryParams={{ period: filters.period, status: filters.status }} />
  </div>;
}
