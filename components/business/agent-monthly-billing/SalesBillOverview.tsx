import Link from 'next/link';
import Decimal from 'decimal.js';
import { buildTableHref } from '@/lib/admin/table';
import { formatMoney } from '@/lib/dashboard/format';
import { LinkPendingHint } from '@/components/ui-business';

type Month = { period: string; draft: string; confirmed: string; paid: string };

export function SalesBillOverview({ months, status }: { months: Month[]; status?: string }) {
  if (!months.length) return null;
  const total = (row: Month) => new Decimal(row.draft).plus(row.confirmed).plus(row.paid);
  const max = Decimal.max(0, ...months.map(total));
  const width = (amount: string) => `${max.isZero() ? 0 : new Decimal(amount).div(max).times(100).toNumber()}%`;
  return <section aria-labelledby="sales-bill-overview-title" className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
    <div>
      <h2 id="sales-bill-overview-title" className="font-semibold">账期概览</h2>
      <p className="mt-1 text-sm text-muted-foreground">我的全部账单，最近 {months.length} 个有账单的月份。</p>
    </div>
    <ul aria-label="我的账期概览" className="grid min-w-0 gap-x-6 gap-y-1 lg:grid-cols-2">
      {months.map((month) => <li key={month.period} className="min-w-0">
        <Link href={`${buildTableHref('/sales/bills', {}, { period: month.period, status })}#sales-bill-results`} className="relative flex min-h-11 items-center gap-3 rounded-md px-2 py-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${month.period}：整理中 ${formatMoney(month.draft)}，待支付 ${formatMoney(month.confirmed)}，已结清 ${formatMoney(month.paid)}，查看该月账单`}>
          <span className="shrink-0 text-sm tabular-nums">{month.period}</span>
          <span aria-hidden className="flex h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="bg-info" style={{ width: width(month.draft) }} /><span className="bg-warning" style={{ width: width(month.confirmed) }} /><span className="bg-success" style={{ width: width(month.paid) }} />
          </span>
          <span className="shrink-0 text-sm tabular-nums">{formatMoney(total(month))}</span>
          <LinkPendingHint />
        </Link>
      </li>)}
    </ul>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-info" />整理中</span>
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-warning" />待支付</span>
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-success" />已结清</span>
      <span>点击账期查看明细；整理中金额未计入待支付。</span>
    </div>
  </section>;
}
