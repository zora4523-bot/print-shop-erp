'use client';

import type { ReactNode } from 'react';
import {
  ProductionTrendChart,
  type ProductionTrendChartProps,
} from './ProductionTrendChart';
import {
  SalesRankingChart,
  type SalesRankingChartProps,
} from './SalesRankingChart';
import {
  CategoryDistributionChart,
  type CategoryDistributionChartProps,
} from './CategoryDistributionChart';

export type DashboardChartsContentProps = {
  productionTrend: ProductionTrendChartProps['data'];
  salesRanking: SalesRankingChartProps['data'];
  categoryDistribution: CategoryDistributionChartProps['data'];
};

export function DashboardChartsContent({
  productionTrend,
  salesRanking,
  categoryDistribution,
}: DashboardChartsContentProps) {
  return (
    <>
      <ChartCard
        slot="dashboard-chart-trend-card"
        title="近 30 天产量趋势"
        description="按完工时间汇总 · COMPLETED / SHIPPED / FINISHED"
      >
        <ProductionTrendChart data={productionTrend} />
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          slot="dashboard-chart-ranking-card"
          title="本月销售业绩 Top 10"
          description="按提交时间归属 · SALES 蓝色 / 客服 绿色"
        >
          <SalesRankingChart data={salesRanking} />
        </ChartCard>
        <ChartCard
          slot="dashboard-chart-category-card"
          title="本月产品线分布"
          description="按工单计数（同一工单多款式只计 1 次）"
        >
          <CategoryDistributionChart data={categoryDistribution} />
        </ChartCard>
      </div>
    </>
  );
}

function ChartCard({
  slot,
  title,
  description,
  children,
}: {
  slot: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section data-slot={slot} className="rounded-xl border bg-card shadow-sm">
      <header className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
