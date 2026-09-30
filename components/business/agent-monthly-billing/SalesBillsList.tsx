import Link from 'next/link';
import type { listSalesMonthlyBills } from '@/lib/agent-monthly-billing/sales-query';
import { buildTableHref } from '@/lib/admin/table';
import { formatMoney } from '@/lib/dashboard/format';
import { SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY as statusRegistry } from '@/lib/ui/status-registry';
import { buttonVariants } from '@/components/ui/button';
import { StatusBadge, TableScrollArea } from '@/components/ui-business';

type Bill = Awaited<ReturnType<typeof listSalesMonthlyBills>>['rows'][number];

export function SalesBillsList({ rows, returnTo }: { rows: Bill[]; returnTo: string }) {
  return <section aria-label="我的月账单" className="min-w-0">
    <TableScrollArea label="我的月账单列表" className="md:rounded-xl md:border md:bg-card">
      <table className="block w-full text-sm md:table">
        <thead className="sr-only border-b bg-muted/40 text-muted-foreground md:not-sr-only md:table-header-group"><tr>
          <th className="p-3 text-left">账期</th><th className="p-3 text-left">状态</th><th className="p-3 text-right">工单</th><th className="p-3 text-right">工单合计</th><th className="p-3 text-right">抵扣</th><th className="p-3 text-right">应付货款</th><th className="p-3 text-right">操作</th>
        </tr></thead>
        <tbody className="grid gap-3 md:table-row-group md:divide-y">{rows.map((bill) => <tr key={bill.id} className="grid min-w-0 grid-cols-2 items-center gap-3 rounded-xl border bg-card p-4 md:table-row md:rounded-none md:border-0 md:p-0">
          <th scope="row" className="text-left font-semibold tabular-nums md:p-3 md:font-medium">{bill.period}<span className="md:hidden"> 月账单</span></th>
          <td className="text-right md:p-3 md:text-left"><StatusBadge tone={statusRegistry[bill.status].tone}>{statusRegistry[bill.status].label}</StatusBadge></td>
          <td className="text-muted-foreground md:p-3 md:text-right md:text-foreground"><span className="mr-1 md:hidden">工单</span>{bill._count.items} 单</td>
          <td className="text-right tabular-nums md:p-3"><span className="mr-1 text-xs text-muted-foreground md:hidden">工单合计</span>{formatMoney(bill.memberSubtotal)}</td>
          <td className="text-xs text-muted-foreground md:p-3 md:text-right md:text-sm md:text-foreground"><span className="mr-1 md:hidden">抵扣</span>{formatMoney(bill.adjustmentAmount)}</td>
          <td className="text-right font-semibold tabular-nums md:p-3"><span className="mb-1 block text-xs font-normal text-muted-foreground md:hidden">{bill.status === 'DRAFT' ? '暂计货款' : '应付货款'}</span><span className="text-xl md:text-sm">{formatMoney(bill.totalAmount)}</span>{bill.status === 'DRAFT' ? <span className="block text-xs font-normal text-muted-foreground">暂计 · 金额未定稿</span> : null}</td>
          <td className="col-span-2 md:p-3 md:text-right"><Link href={buildTableHref(`/sales/bills/${bill.id}`, {}, { returnTo })} className={buttonVariants({ variant: 'outline' })} aria-label={`查看 ${bill.period} 账单详情`}>查看详情</Link></td>
        </tr>)}</tbody>
      </table>
    </TableScrollArea>
  </section>;
}
