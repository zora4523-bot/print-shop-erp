import Link from 'next/link';
import Decimal from 'decimal.js';
import { ChevronDown } from 'lucide-react';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { buildTableHref } from '@/lib/admin/table';
import { formatMoney } from '@/lib/dashboard/format';

type Month = { period: string; draft: string; confirmed: string; paid: string };

export function SalesBillOverview({ months, expanded }: { months: Month[]; expanded: boolean }) {
  if (!months.length) return null;
  const total = (row: Month) => new Decimal(row.draft).plus(row.confirmed).plus(row.paid);
  const max = Decimal.max(0, ...months.map(total));
  const width = (amount: string) => `${max.isZero() ? 0 : new Decimal(amount).div(max).times(100).toNumber()}%`;
  return <Disclosure open={expanded} className="min-w-0 rounded-xl border bg-card p-4">
    <DisclosureSummary className="justify-between gap-3 font-semibold">账单趋势<ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" /></DisclosureSummary>
    <section aria-label="我的账期概览" className="mt-4 space-y-3">
      <p className="text-sm text-muted-foreground">最近 {months.length} 个有账单的月份。整理中金额未定稿，不计入待支付。</p>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {months.map((month) => <li key={month.period} className="min-w-0">
          <Link href={buildTableHref('/sales/bills', {}, { period: month.period })} className="block space-y-2 rounded-md p-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <span className="flex flex-wrap justify-between gap-2"><span className="font-medium">{month.period}</span><span className="text-sm tabular-nums">合计 {formatMoney(total(month))}</span></span>
            <span aria-hidden className="flex h-2 overflow-hidden rounded-full bg-muted">
              <span className="bg-info" style={{ width: width(month.draft) }} /><span className="bg-warning" style={{ width: width(month.confirmed) }} /><span className="bg-success" style={{ width: width(month.paid) }} />
            </span>
            <span className="grid gap-1 text-xs text-muted-foreground">
              <span>整理中 {formatMoney(month.draft)}</span><span>待支付 {formatMoney(month.confirmed)} · 已结清 {formatMoney(month.paid)}</span>
            </span>
          </Link>
        </li>)}
      </ul>
    </section>
  </Disclosure>;
}
