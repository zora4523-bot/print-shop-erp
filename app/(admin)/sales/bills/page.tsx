import Form from 'next/form';
import { ChevronDown } from 'lucide-react';
import { SalesBillOverview } from '@/components/business/agent-monthly-billing/SalesBillOverview';
import { SalesBillExportButton } from '@/components/business/billing/SalesBillExportButton';
import { SalesBillsList } from '@/components/business/agent-monthly-billing/SalesBillsList';
import { buildTableHref } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { listSalesMonthlyBills } from '@/lib/agent-monthly-billing/sales-query';
import { SALES_BILL_PAGE_TITLE } from '@/lib/agent-monthly-billing/labels';
import { SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY as statusRegistry } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { PageHeader, EmptyState, StatCard, FilterClearLink } from '@/components/ui-business';
import { NativeSelect } from '@/components/ui/native-select';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { parseAgentBillFilters, type AgentBillSearchParams } from '@/lib/agent-monthly-billing/list-filter';

export const metadata = { title: SALES_BILL_PAGE_TITLE };

export default async function SalesBillsPage({ searchParams }: { searchParams: Promise<AgentBillSearchParams> }) {
  const user = await requirePermission('bill:view:self');
  const raw = await searchParams;
  const filters = parseAgentBillFilters(raw);
  const result = await listSalesMonthlyBills(user, raw);
  const { rows, summary } = result;

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title={SALES_BILL_PAGE_TITLE} />
      <section id="sales-bill-results" aria-labelledby="sales-bill-results-title" className="scroll-mt-24 space-y-4">
        <div>
          <h2 id="sales-bill-results-title" className="font-semibold">月账单列表</h2>
          <p className="mt-1 text-sm text-muted-foreground">当前筛选 · {result.total} 张账单</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label={statusRegistry.DRAFT.label} value={formatMoney(summary.DRAFT.amount)} tone="neutral" hint="金额未定稿" className="col-span-2 sm:col-span-1" />
          <StatCard label={statusRegistry.CONFIRMED.label} value={formatMoney(summary.CONFIRMED.amount)} tone="warning" />
          <StatCard label={statusRegistry.PAID.label} value={formatMoney(summary.PAID.amount)} tone="success" />
        </div>
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          {/* next/form 软导航不重建非受控字段：按已应用查询重建，以支持清除筛选和后退。 */}
          <Form id="sales-bill-filters" key={JSON.stringify([filters.status ?? '', filters.period ?? ''])} action="/sales/bills" className="flex min-w-0 flex-wrap items-end gap-3">
            <label className="grid gap-1">状态
              <NativeSelect name="status" defaultValue={filters.status ?? ''}>
                <option value="">全部</option>
                {Object.entries(statusRegistry).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}
              </NativeSelect>
            </label>
            <label className="grid gap-1">账期<Input name="period" type="month" defaultValue={filters.period ?? ''} className="w-auto" /></label>
            <Button type="submit">筛选</Button>
            <FilterClearLink formId="sales-bill-filters" href="/sales/bills" className={buttonVariants({ variant: 'ghost' })}>清除筛选</FilterClearLink>
          </Form>
          {rows.length > 0 ? <SalesBillExportButton href={buildTableHref('/api/sales/bills/export', {}, { period: filters.period, status: filters.status })} label="导出当前筛选 CSV" /> : null}
        </div>
        {rows.length === 0 ? <EmptyState title="当前筛选条件下暂无账单" /> : <SalesBillsList rows={rows} returnTo={buildTableHref('/sales/bills', {}, { period: filters.period, status: filters.status, page: result.page })} />}
        <AdminPagination basePath="/sales/bills" page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} queryParams={{ period: filters.period, status: filters.status }} />
      </section>
      {result.trend.length > 0 ? (
        <Disclosure className="min-w-0 border-t pt-3">
          <DisclosureSummary className="justify-between gap-3 px-2">
            查看账期金额分布<ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-180" />
          </DisclosureSummary>
          <div className="pt-3"><SalesBillOverview months={result.trend} status={filters.status} /></div>
        </Disclosure>
      ) : null}
    </div>
  );
}
