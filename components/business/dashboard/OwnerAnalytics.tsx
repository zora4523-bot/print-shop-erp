import { Suspense } from 'react';
import { ErrorBoundary, SectionLoading } from '@/components/ui-business';
import { getAnalyticsFinance, getAnalyticsTrend, type AnalyticsActor } from '@/lib/analytics/queries';
import { getAnalyticsOverview } from '@/lib/analytics/overview';
import { getAnalyticsReport } from '@/lib/analytics/service';
import { AnalyticsInputError, type AnalyticsFilters } from '@/lib/analytics/filters';
import { AnalyticsBars, AnalyticsMetrics, AnalyticsReportContent } from '@/components/business/analytics/AnalyticsPresentation';
import { AnalyticsTrend } from '@/components/business/analytics/AnalyticsTrend';

type Props = { actor: AnalyticsActor; filters: AnalyticsFilters };

export function OwnerAnalytics(props: Props) {
  if (props.filters.view !== 'overview') return <ErrorBoundary scope="section" title="分析暂时无法加载" description="请重试当前分析。"><Suspense fallback={<SectionLoading label="分析数据" className="h-72" />}><ReportSection {...props} /></Suspense></ErrorBoundary>;
  return <section data-slot="dashboard-charts-deferred" aria-label="经营统计图表" className="min-w-0 space-y-4">
    <ErrorBoundary scope="section" title="经营金额暂时无法加载" description="请重试当前统计。"><Suspense fallback={<SectionLoading label="经营金额" className="h-48" />}><SummarySection {...props} /></Suspense></ErrorBoundary>
    <ErrorBoundary scope="section" title="工单趋势暂时无法加载" description="其他统计仍可使用，请重试当前图表。"><Suspense fallback={<SectionLoading label="工单趋势" className="h-92" />}><ProductionTrendChartSection {...props} /></Suspense></ErrorBoundary>
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <ErrorBoundary scope="section" title="销售排行暂时无法加载" description="其他统计仍可使用，请重试当前图表。"><Suspense fallback={<SectionLoading label="销售排行" className="h-100" />}><SalesRankingChartSection {...props} /></Suspense></ErrorBoundary>
      <ErrorBoundary scope="section" title="产品分布暂时无法加载" description="其他统计仍可使用，请重试当前图表。"><Suspense fallback={<SectionLoading label="产品分布" className="h-100" />}><CategoryDistributionChartSection {...props} /></Suspense></ErrorBoundary>
    </div>
  </section>;
}
async function ReportSection({ actor, filters }: Props) {
  let report;
  try { report = await getAnalyticsReport(actor, filters); }
  catch (error) { if (error instanceof AnalyticsInputError) return <p role="alert" className="rounded-xl border p-4 text-sm">{error.message}</p>; throw error; }
  return <AnalyticsReportContent report={report} filters={filters} />;
}
async function SummarySection({ actor, filters }: Props) {
  let data;
  try { data = await Promise.all([getAnalyticsOverview(actor, filters), getAnalyticsFinance(actor, filters)]); }
  catch (error) { if (error instanceof AnalyticsInputError) return <p role="alert" className="rounded-xl border p-4 text-sm">{error.message}</p>; throw error; }
  const [summary, finance] = data;
  return <div className="space-y-3"><AnalyticsMetrics metrics={[...summary.metrics, { label: '本期出账', value: finance.issued, format: 'money', hint: '按账单确认日期，含已付账单' }, { label: '本期收款', value: finance.received, format: 'money', hint: '按实际收款日期' }, { label: '当前待收款', value: finance.outstanding, format: 'money', hint: '全部未收账单，不受日期影响' }, { label: '本期结算', value: finance.settled, format: 'money', hint: '按外部销售工单结算日期' }]} /><p className="text-sm text-muted-foreground">工单与加工费按提交日期统计；完工趋势按完工日期统计。加工费、结算、出账和收款分别核对，不相加。</p></div>;
}
export async function ProductionTrendChartSection({ actor, filters }: Props) {
  const data = await getAnalyticsTrend(actor, filters);
  return <div data-slot="dashboard-chart-deferred"><section data-slot="dashboard-chart-trend-card" aria-label="工单趋势" className="min-w-0 space-y-3 rounded-xl border bg-card p-4"><h2 className="text-base font-semibold">工单趋势</h2><p className="text-sm text-muted-foreground">按所选日期统计工单数；超过 62 天按月汇总，首尾月份仅计所选日期。</p><AnalyticsTrend data={data} /></section></div>;
}
export async function SalesRankingChartSection({ actor, filters }: Props) {
  const groups = (await getAnalyticsOverview(actor, filters)).ranking;
  return <div data-slot="dashboard-chart-deferred"><AnalyticsBars title="销售加工费 Top 10" groups={groups.slice(0, 10)} money slot="dashboard-chart-ranking-card" note="按提交日期，仅计正加工费；完整排行见订单与收费。" /></div>;
}
export async function CategoryDistributionChartSection({ actor, filters }: Props) {
  return <div data-slot="dashboard-chart-deferred"><AnalyticsBars title="产品线分布" groups={(await getAnalyticsOverview(actor, filters)).distribution} slot="dashboard-chart-category-card" note="按工单去重；同一工单可属于多条产品线，各组不可相加。" /></div>;
}
