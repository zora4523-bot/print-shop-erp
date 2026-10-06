'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { analyticsUrl, type AnalyticsFilters as Filters } from '@/lib/analytics/filters';

export function AnalyticsFilters({ filters, sales, crafts, presets }: {
  filters: Filters; sales: { id: string; displayName: string }[]; crafts: { id: string; name: string }[];
  presets: { label: string; from: string; to: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap gap-2" role="group" aria-label="快捷时间范围">
      {presets.map(preset => <Link key={preset.label}  href={analyticsUrl(filters, { from: preset.from, to: preset.to, page: 1 })} prefetch={false} className={buttonVariants({ variant: filters.from === preset.from && filters.to === preset.to ? 'selected' : 'outline', className: "min-h-11" })}>{preset.label}</Link>)}
    </div>
    <form method="get" action="/owner/analytics" onSubmit={event => {
      event.preventDefault();
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
      startTransition(() => router.push(`/owner/analytics?${params}`));
    }} aria-busy={pending}>
      <input type="hidden" name="view" value={filters.view} />
      <input type="hidden" name="inventoryKind" value={filters.inventoryKind} />
      <fieldset disabled={pending} className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0 space-y-1 text-sm">开始日期<Input type="date" name="from" required defaultValue={filters.from} className="mt-1 min-h-11 w-full min-w-0" /></label>
        <label className="min-w-0 space-y-1 text-sm">结束日期<Input type="date" name="to" required defaultValue={filters.to} className="mt-1 min-h-11 w-full min-w-0" /></label>
        {filters.view !== 'inventory' ? <label className="min-w-0 text-sm">销售<NativeSelect name="sales" defaultValue={filters.sales} className="mt-1 w-full min-w-0">
          <option value="">全部销售</option>
          {filters.sales && !sales.some(sale => sale.id === filters.sales) ? <option value={filters.sales}>所选销售</option> : null}
          {sales.map(sale => <option key={sale.id} value={sale.id}>{sale.displayName}</option>)}
        </NativeSelect></label> : <label className="min-w-0 text-sm">供应商全称<Input name="supplier" defaultValue={filters.supplier} className="mt-1 min-h-11" /></label>}
        {filters.view !== 'overview' && filters.view !== 'inventory' ? <>
          <label className="min-w-0 text-sm">客户全称<Input name="customer" defaultValue={filters.customer} className="mt-1 min-h-11" /></label>
          <label className="min-w-0 text-sm">工艺<NativeSelect name="craft" defaultValue={filters.craft} className="mt-1 w-full min-w-0"><option value="">全部工艺</option><option value="PARTIAL">局部烫金</option><option value="FULL">专版烫金</option><option value="PRINT">彩印</option>{filters.craft && !['PARTIAL', 'FULL', 'PRINT'].includes(filters.craft) && !crafts.some(craft => craft.id === filters.craft) ? <option value={filters.craft}>所选历史工艺</option> : null}{crafts.map(craft => <option key={craft.id} value={craft.id}>{craft.name}</option>)}</NativeSelect></label>
          <label className="min-w-0 text-sm">纸张全称<Input name="paper" defaultValue={filters.paper} className="mt-1 min-h-11" /></label>
        </> : null}
        {filters.view !== 'overview' ? <label className="min-w-0 text-sm">{filters.view === 'inventory' ? '物料关键词' : '工单关键词'}<Input name="q" defaultValue={filters.q} className="mt-1 min-h-11" /></label> : null}
        <div className="flex min-w-0 flex-wrap gap-2"><Button type="submit" disabled={pending} className="min-h-11">{pending ? '正在更新…' : '筛选'}</Button><Link  href={analyticsUrl(filters, { sales: '', customer: '', craft: '', paper: '', supplier: '', q: '', page: 1 })} prefetch={false} className={buttonVariants({ variant: "outline", className: "min-h-11" })}>清除筛选</Link></div>
      </fieldset>
      {pending ? <p role="status" className="mt-2 text-sm text-muted-foreground">正在更新统计，当前仍显示上次结果。</p> : null}
    </form>
  </div>;
}
