import Link from 'next/link';
import { canonicalAnalyticsCraft } from '@/lib/analytics/crafts';
import { requirePermission } from '@/lib/auth/permissions';
import { PageHeader } from '@/components/ui-business';
import { buttonVariants } from '@/components/ui/button';
import { OwnerAnalytics } from '@/components/business/dashboard/OwnerAnalytics';
import { AnalyticsFilters } from '@/components/business/analytics/AnalyticsFilters';
import { SalesBillExportButton } from '@/components/business/billing/SalesBillExportButton';
import { ANALYTICS_VIEWS, AnalyticsInputError, analyticsPeriod, analyticsUrl, parseAnalyticsFilters, type AnalyticsParams, type AnalyticsView } from '@/lib/analytics/filters';
import { getAnalyticsCrafts, getAnalyticsSales } from '@/lib/analytics/queries';

export const metadata = { title: '经营概览' };
export default async function OwnerAnalyticsPage({ searchParams }: { searchParams: Promise<AnalyticsParams> }) {
  const actor = await requirePermission('report:all');
  let filters;
  try { filters = parseAnalyticsFilters(await searchParams); }
  catch (error) {
    if (!(error instanceof AnalyticsInputError)) throw error;
    return <div className="space-y-4"><PageHeader title="经营概览" /><p role="alert">{error.message}</p><Link href="/owner/analytics" className="inline-flex min-h-11 items-center text-primary underline">重新选择筛选</Link></div>;
  }
  const [sales, crafts] = await Promise.all([getAnalyticsSales(actor), getAnalyticsCrafts(actor)]);
  const craftNames = new Map(crafts.map(craft => [craft.id, craft.name]));
  filters = { ...filters, craft: canonicalAnalyticsCraft(filters.craft, craftNames) };
  const craftOptions = crafts.filter(craft => canonicalAnalyticsCraft(craft.id, craftNames) === craft.id);
  const exportHref = analyticsUrl(filters, {}, '/api/owner/analytics/export');
  const presets = [['month', '本月'], ['previous', '上月'], ['rolling', '近 30 天'], ['year', '今年']].map(([key, label]) => ({ label: label!, ...analyticsPeriod(key!) }));
  return <div className="min-w-0 space-y-6">
    <PageHeader title="经营概览" actions={<SalesBillExportButton key={exportHref} href={exportHref} label="导出当前分析 CSV" />} />
    <nav aria-label="经营分析视图" className="flex flex-wrap gap-2">{Object.entries(ANALYTICS_VIEWS).map(([view, label]) => <Link key={view}  href={analyticsUrl(filters, { view: view as AnalyticsView })} aria-current={view === filters.view ? 'page' : undefined} prefetch={false} className={buttonVariants({ variant: view === filters.view ? 'selected' : 'outline', className: "min-h-11" })}>{label}</Link>)}</nav>
    <AnalyticsFilters key={`filters-${analyticsUrl(filters)}`} filters={filters} sales={sales} crafts={craftOptions} presets={presets} />
    <p className="text-sm text-muted-foreground">{filters.from} 至 {filters.to} · 上海时间</p>
    {filters.view === 'inventory' ? <nav aria-label="采购库存明细" className="flex flex-wrap gap-2">{([['purchases', '采购明细'], ['receipts', '入库明细'], ['stock', '当前库存']] as const).map(([inventoryKind, label]) => <Link key={inventoryKind}  href={analyticsUrl(filters, { inventoryKind, page: 1 })} aria-current={inventoryKind === filters.inventoryKind ? 'page' : undefined} prefetch={false} className={buttonVariants({ variant: inventoryKind === filters.inventoryKind ? 'selected' : 'outline', className: "min-h-11" })}>{label}</Link>)}</nav> : null}
    <OwnerAnalytics key={`report-${analyticsUrl(filters)}`} actor={actor} filters={filters} />
  </div>;
}
