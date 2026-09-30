import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import Link from 'next/link';
import Decimal from 'decimal.js';
import type { getAgentBillDashboard } from '@/lib/agent-monthly-billing/dashboard-query';
import { formatMoney } from '@/lib/dashboard/format';
import { buildTableHref } from '@/lib/admin/table';
import { TableScrollArea } from '@/components/ui-business';

type Data = Awaited<ReturnType<typeof getAgentBillDashboard>>;
const list = '/owner/agent-bills';
function percent(value: string, max: Decimal) {
  return max.isZero() ? 0 : new Decimal(value).div(max).times(100).toNumber();
}
export function BillDashboard({ data, accounts, expanded }: { expanded: boolean; data: Data; accounts: Array<{ id: string; displayName: string }> }) {
  const monthMax = Decimal.max(0, ...data.periods.map((row) => new Decimal(row.total)));
  const accountMax = Decimal.max(0, ...data.accounts.map((row) => new Decimal(row.amount)));
  return <Disclosure className="min-w-0 rounded-xl border bg-card p-4" open={expanded}>
    <DisclosureSummary className="min-h-11 cursor-pointer py-2 font-semibold">账单概览</DisclosureSummary>
    <p className="mb-4 text-sm text-muted-foreground">全部外部销售，不受下方筛选影响。按结算账期展示当前金额，已结清金额不代表该月实际收款。</p>
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <section className="min-w-0 space-y-3" aria-label="最近十二个账期金额">
        <h2 className="font-semibold">最近 12 个账期</h2>
        <ul className="space-y-1">{data.periods.map((row) => <li key={row.period}>
          <Link href={buildTableHref(list, {}, { period: row.period })} className="flex min-h-11 items-center gap-3 rounded-md p-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <span className="shrink-0 text-sm">{row.period}</span>
            <span aria-hidden className="flex h-3 min-w-0 flex-1 overflow-hidden rounded bg-muted">
              <span className="bg-primary" style={{ width: `${percent(row.confirmed, monthMax)}%` }} />
              <span className="bg-success" style={{ width: `${percent(row.paid, monthMax)}%` }} />
              <span className="bg-muted-foreground" style={{ width: `${percent(row.draft, monthMax)}%` }} />
            </span>
            <span className="shrink-0 text-sm tabular-nums">{formatMoney(row.total)}</span>
          </Link>
        </li>)}</ul>
        <p className="text-xs text-muted-foreground">待收 · 已结清 · 草稿；点击账期查看账单。</p>
      </section>
      <section className="min-w-0 space-y-3" aria-label="外部销售待收分布">
        <h2 className="font-semibold">当前待收前 10 位</h2>
        {data.accounts.length ? <ul className="space-y-2">{data.accounts.map((row) => <li key={row.agentUserId}>
          <Link href={buildTableHref(list, {}, { agentUserId: row.agentUserId, status: 'CONFIRMED' })} className="block min-h-11 space-y-2 rounded-md p-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <span className="flex justify-between gap-4 text-sm"><span className="min-w-0 break-words">{accounts.find((account) => account.id === row.agentUserId)?.displayName ?? '外部销售'}</span><span className="shrink-0 tabular-nums">{formatMoney(row.amount)} · {row.count} 张</span></span>
            <span aria-hidden className="block h-2 overflow-hidden rounded bg-muted"><span className="block h-full bg-primary" style={{ width: `${percent(row.amount, accountMax)}%` }} /></span>
          </Link>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">暂无待收账单</p>}
      </section>
    </div>
    <Disclosure className="mt-4">
      <DisclosureSummary className="min-h-11 cursor-pointer py-2 text-sm">查看账期数据表</DisclosureSummary>
      <TableScrollArea label="账期金额数据"><table className="w-full text-sm"><thead><tr>
        <th className="p-2 text-left">账期</th><th className="p-2 text-right">待收</th><th className="p-2 text-right">已结清</th><th className="p-2 text-right">草稿</th>
      </tr></thead><tbody>{data.periods.map((row) => <tr key={row.period} className="border-t">
        <td className="p-2"><Link className="inline-flex min-h-11 items-center underline" href={buildTableHref(list, {}, { period: row.period })}>{row.period}</Link></td>
        <td className="p-2 text-right tabular-nums">{formatMoney(row.confirmed)}</td><td className="p-2 text-right tabular-nums">{formatMoney(row.paid)}</td><td className="p-2 text-right tabular-nums">{formatMoney(row.draft)}</td>
      </tr>)}</tbody></table></TableScrollArea>
    </Disclosure>
  </Disclosure>;
}
