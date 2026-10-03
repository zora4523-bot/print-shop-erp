'use client';
import { usePathname } from 'next/navigation';
import { PageHeader } from '@/components/ui-business';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { ANALYTICS_VIEWS } from '@/lib/analytics/views';

/** Outside the route Suspense boundary so disabled scripts cannot strand its fallback. */
export function AnalyticsNoScript() {
  const pathname = usePathname();
  if (pathname !== '/owner/analytics') return null;
  return <noscript>
    <style>{'[data-slot="admin-route-content"], [data-slot="admin-header"] > [data-slot="sidebar-trigger"], [data-slot="admin-header"] > [data-slot="dropdown-menu-trigger"] { display: none; }'}</style>
    <section aria-label="经营分析导出" className="admin-safe-inline admin-safe-bottom min-w-0 space-y-4 py-4 sm:py-6">
      <PageHeader title="经营分析导出" />
      <p className="text-sm text-muted-foreground">当前可通过 CSV 查看分析结果，日期留空时查看本月。</p>
      <form action="/api/owner/analytics/export" method="get" className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="text-sm">分析内容<NativeSelect aria-label="分析内容" name="view" className="mt-1 w-full">{Object.entries(ANALYTICS_VIEWS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
        <label className="text-sm">开始日期<Input aria-label="开始日期" name="from" type="date" className="mt-1 min-h-11" /></label>
        <label className="text-sm">结束日期<Input aria-label="结束日期" name="to" type="date" className="mt-1 min-h-11" /></label>
        <label className="text-sm">关键词<Input aria-label="关键词" name="q" className="mt-1 min-h-11" /></label>
        <Button type="submit" className="min-h-11 justify-self-start">导出 CSV</Button>
      </form>
    </section>
  </noscript>;
}
