import Link from 'next/link';
import type { listSalesMonthlyBills } from '@/lib/agent-monthly-billing/sales-query';
import { buildTableHref } from '@/lib/admin/table';
import { formatMoney } from '@/lib/dashboard/format';
import { SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY as statusRegistry } from '@/lib/ui/status-registry';
import { buttonVariants } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui-business';

type Bill = Awaited<ReturnType<typeof listSalesMonthlyBills>>['rows'][number];

export function SalesBillsList({ rows, returnTo }: { rows: Bill[]; returnTo: string }) {
  return <section aria-label="我的月账单" className="min-w-0">
    <ul className="grid gap-3 lg:grid-cols-2">
      {rows.map((bill) => <li key={bill.id} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{bill.period} 月账单</h2>
          <StatusBadge tone={statusRegistry[bill.status].tone}>{statusRegistry[bill.status].label}</StatusBadge>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted-foreground">工单数量</dt><dd>{bill._count.items} 单</dd></div>
          <div><dt className="text-muted-foreground">工单合计</dt><dd className="tabular-nums">{formatMoney(bill.memberSubtotal)}</dd></div>
          <div><dt className="text-muted-foreground">抵扣金额</dt><dd className="tabular-nums">{formatMoney(bill.adjustmentAmount)}</dd></div>
          <div><dt className="text-muted-foreground">{bill.status === 'DRAFT' ? '暂计金额' : '应付合计'}</dt><dd className="text-lg font-semibold tabular-nums">{formatMoney(bill.totalAmount)}</dd></div>
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {bill.status === 'DRAFT' ? <span className="text-xs text-muted-foreground">金额未定稿</span> : null}
          <Link href={buildTableHref(`/sales/bills/${bill.id}`, {}, { returnTo })} className={buttonVariants({ variant: 'outline' })} aria-label={`查看 ${bill.period} 账单详情`}>查看详情</Link>
        </div>
      </li>)}
    </ul>
  </section>;
}
