import Link from 'next/link';
import Decimal from 'decimal.js';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, StatCard } from '@/components/ui-business';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { formatMoney } from '@/lib/dashboard/format';
import { analyticsUrl, type AnalyticsFilters } from '@/lib/analytics/filters';
import type { AnalyticsCell, AnalyticsGroup, AnalyticsMetric, AnalyticsReport, AnalyticsTable } from '@/lib/analytics/types';

function cellText(cell: AnalyticsCell) {
  if (cell.value === null) return cell.format ? '待核对' : '未填写';
  if (cell.format === 'money') return formatMoney(cell.value);
  if (cell.format === 'price') return formatUnitPrice(cell.value);
  return cell.value;
}
export function AnalyticsMetrics({ metrics }: { metrics: AnalyticsMetric[] }) {
  return <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(metric => <StatCard key={metric.label} label={metric.label} value={cellText(metric)} hint={metric.hint} />)}</div>;
}
function AnalyticsDataTable({ table, limit }: { table: AnalyticsTable; limit?: number }) {
  const rows = limit ? table.rows.slice(0, limit) : table.rows;
  return <section className="min-w-0 space-y-3" aria-label={table.title}>
    <h2 className="text-base font-semibold">{table.title}</h2>
    {table.note ? <p className="text-sm text-muted-foreground">{table.note}</p> : null}
    {rows.length ? <div className="min-w-0 overflow-hidden rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"><Table label={table.title}>
      <TableHeader><TableRow>{table.columns.map(column => <TableHead key={column} scope="col">{column}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((row, index) => <TableRow key={index}>{row.map((cell, cellIndex) => <TableCell key={cellIndex} className={cell.format ? 'whitespace-nowrap font-sans tabular-nums' : 'min-w-28 max-w-80 break-words'}>{cell.href ? <Link href={cell.href} prefetch={false} className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">{cellText(cell)}</Link> : cellText(cell)}</TableCell>)}</TableRow>)}</TableBody>
    </Table></div> : <EmptyState kind="no-result" noun="记录" />}
    {limit && table.rows.length > limit ? <p className="text-sm text-muted-foreground">显示前 {limit} 项，共 {table.rows.length} 项；导出包含全部结果。</p> : null}
  </section>;
}
export function AnalyticsReportContent({ report, filters }: { report: AnalyticsReport; filters: AnalyticsFilters }) {
  return <div className="min-w-0 space-y-6" data-slot="analytics-report">
    <AnalyticsMetrics metrics={report.metrics} />
    {report.notes.map(note => <p key={note} className="text-sm text-muted-foreground">{note}</p>)}
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">{report.tables.map(table => <AnalyticsDataTable key={table.title} table={table} limit={20} />)}</div>
    <AnalyticsDataTable table={report.details} />
    <nav aria-label="分析明细分页" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span>共 {report.total} 条 · 第 {report.page} / {report.pages} 页</span>
      <div className="flex gap-2">
        {report.page > 1 ? <Link  href={analyticsUrl(filters, { page: report.page - 1 })} prefetch={false} className={buttonVariants({ variant: "outline", className: "min-h-11" })}>上一页</Link> : null}
        {report.page < report.pages ? <Link  href={analyticsUrl(filters, { page: report.page + 1 })} prefetch={false} className={buttonVariants({ variant: "outline", className: "min-h-11" })}>下一页</Link> : null}
      </div>
    </nav>
  </div>;
}

export function AnalyticsBars({ groups, money = false, title, slot, note }: { groups: AnalyticsGroup[]; money?: boolean; title: string; slot: string; note?: string }) {
  const max = groups.reduce((maximum, group) => Decimal.max(maximum, group.value), new Decimal(0));
  return <section data-slot={slot} className="min-w-0 space-y-4 rounded-xl border bg-card p-4" aria-label={title}>
    <h2 className="text-base font-semibold">{title}</h2>
    {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
    {groups.length ? <ul className="space-y-4">{groups.map((group, index) => <li key={`${group.name}-${index}`} className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm">{group.href ? <Link href={group.href} prefetch={false} className="inline-flex min-h-11 items-center break-words text-primary underline underline-offset-4">{group.name}</Link> : <span className="break-words">{group.name}</span>}<span className="whitespace-nowrap font-sans tabular-nums">{money ? formatMoney(group.value) : `${group.value} 单`}</span></div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${max.gt(0) ? new Decimal(group.value).div(max).mul(100).toNumber() : 0}%`, backgroundColor: `var(--chart-${index % 7 + 1})` }} /></div>
    </li>)}</ul> : <EmptyState kind="no-result" noun="记录" />}
  </section>;
}
