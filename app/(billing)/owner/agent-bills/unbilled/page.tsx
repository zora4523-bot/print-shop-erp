import Link from 'next/link';
import Form from 'next/form';
import { requirePermission } from '@/lib/auth/permissions';
import { listUnbilledAgentOrders } from '@/lib/agent-monthly-billing/query';
import { parseAgentBillFilters, type AgentBillSearchParams } from '@/lib/agent-monthly-billing/list-filter';
import { formatDateTimeShanghai, formatDateInputShanghai } from '@/lib/format/dates';
import { formatMoney } from '@/lib/dashboard/format';
import { PageHeader, EmptyState, TableScrollArea, FilterClearLink } from '@/components/ui-business';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';

export const metadata = { title: '未出账工单' };

export default async function UnbilledOrdersPage({ searchParams }: { searchParams: Promise<AgentBillSearchParams> }) {
  await requirePermission('bill:view:all');
  const { period, page } = parseAgentBillFilters(await searchParams);
  const result = await listUnbilledAgentOrders({ period, page });
  const currentPeriod = formatDateInputShanghai(new Date()).slice(0, 7);
  return <div className="min-w-0 space-y-6">
    <PageHeader title="未出账工单" back={{ href: '/owner/agent-bills', label: '返回外部销售月账单' }} />
    <Form id="unbilled-filters" key={period ?? ''} action="/owner/agent-bills/unbilled" className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">结算月份<Input name="period" type="month" defaultValue={period} className="w-auto" /></label>
      <Button type="submit">筛选</Button><FilterClearLink formId="unbilled-filters" href="/owner/agent-bills/unbilled" className={buttonVariants({ variant: 'ghost' })}>清除筛选</FilterClearLink>
    </Form>
    {result.rows.length ? <TableScrollArea label="未出账工单列表"><table className="w-full text-sm"><thead><tr>
      <th className="p-3 text-left">工单</th><th className="p-3 text-left">外部销售</th><th className="p-3 text-left">结算时间</th><th className="p-3 text-right">金额</th><th className="p-3 text-left">出账</th>
    </tr></thead><tbody>{result.rows.map((row) => {
      const billPeriod = formatDateInputShanghai(row.settledAt!).slice(0, 7);
      return <tr key={row.id} className="border-t">
        <td className="p-3"><Link href={`/orders/${row.id}`} className={buttonVariants({ variant: 'ghost' })}>{row.customName || row.orderNo}</Link></td>
        <td className="p-3">{row.submitter.displayName}</td><td className="p-3">{formatDateTimeShanghai(row.settledAt!)}</td>
        <td className="p-3 text-right tabular-nums">{formatMoney(row.settledFee!)}</td><td className="p-3">{billPeriod < currentPeriod ? <Link href={`/owner/agent-bills?period=${billPeriod}`} className={buttonVariants({ variant: 'outline' })}>查看 {billPeriod} 账单</Link> : '本月结束后可出账'}</td>
      </tr>;
    })}</tbody></table></TableScrollArea> : <EmptyState title="当前条件下没有未出账工单" />}
    <AdminPagination basePath="/owner/agent-bills/unbilled" page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} queryParams={{ period }} />
  </div>;
}
