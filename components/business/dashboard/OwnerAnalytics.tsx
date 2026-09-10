import { Suspense } from 'react';
import {
  getCategoryDistribution,
  getProductionTrend,
  getSalesRanking,
} from '@/lib/dashboard/owner-charts';
import { ErrorBoundary, SectionLoading } from '@/components/ui-business';
import {
  DeferredCategoryDistributionChart,
  DeferredProductionTrendChart,
  DeferredSalesRankingChart,
} from './DeferredDashboardCharts';

// 每张图表在各自的服务端片段启动查询，保留独立流式加载与失败反馈。
// 查询口径和客户端延迟挂载沿用原工作台，迁移不重算金额或归属日期。
export function OwnerAnalytics() {
  return (
    <section
      data-slot="dashboard-charts-deferred"
      aria-label="经营统计图表"
      className="min-w-0 space-y-4"
    >
      <ErrorBoundary
        scope="section"
        title="产量趋势暂时无法加载"
        description="销售排行和产品分布仍可使用；请重试当前图表。"
      >
        <Suspense
          fallback={<SectionLoading label="近 30 天产量趋势" className="h-92" />}
        >
          <ProductionTrendChartSection />
        </Suspense>
      </ErrorBoundary>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ErrorBoundary
          scope="section"
          title="销售排行暂时无法加载"
          description="产量趋势和产品分布仍可使用；请重试当前图表。"
        >
          <Suspense
            fallback={<SectionLoading label="本月销售业绩 Top 10" className="h-100" />}
          >
            <SalesRankingChartSection />
          </Suspense>
        </ErrorBoundary>

        <ErrorBoundary
          scope="section"
          title="产品分布暂时无法加载"
          description="产量趋势和销售排行仍可使用；请重试当前图表。"
        >
          <Suspense
            fallback={<SectionLoading label="本月产品线分布" className="h-100" />}
          >
            <CategoryDistributionChartSection />
          </Suspense>
        </ErrorBoundary>
      </div>
    </section>
  );
}

export async function ProductionTrendChartSection() {
  const productionTrend = await getProductionTrend();
  return <DeferredProductionTrendChart data={productionTrend} />;
}

export async function SalesRankingChartSection() {
  const salesRanking = await getSalesRanking();
  return <DeferredSalesRankingChart data={salesRanking} />;
}

export async function CategoryDistributionChartSection() {
  const categoryDistribution = await getCategoryDistribution();
  return <DeferredCategoryDistributionChart data={categoryDistribution} />;
}
