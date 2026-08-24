'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  CategoryDistributionChartContentProps,
  DashboardChartsContentProps,
  ProductionTrendChartContentProps,
  SalesRankingChartContentProps,
} from './DashboardChartsContent';

const ProductionTrendChartContent =
  dynamic<ProductionTrendChartContentProps>(
    () =>
      import('./DashboardChartsContent').then(
        (module) => module.ProductionTrendChartContent,
      ),
    {
      loading: () => (
        <ChartPlaceholder
          label="近 30 天产量趋势"
          className="h-[23rem]"
        />
      ),
    },
  );

const SalesRankingChartContent = dynamic<SalesRankingChartContentProps>(
  () =>
    import('./DashboardChartsContent').then(
      (module) => module.SalesRankingChartContent,
    ),
  {
    loading: () => (
      <ChartPlaceholder label="本月销售业绩 Top 10" className="h-[25rem]" />
    ),
  },
);

const CategoryDistributionChartContent =
  dynamic<CategoryDistributionChartContentProps>(
    () =>
      import('./DashboardChartsContent').then(
        (module) => module.CategoryDistributionChartContent,
      ),
    {
      loading: () => (
        <ChartPlaceholder label="本月产品线分布" className="h-[25rem]" />
      ),
    },
  );

export function DeferredProductionTrendChart(
  props: ProductionTrendChartContentProps,
) {
  return (
    <DeferredChart label="近 30 天产量趋势" className="h-[23rem]">
      <ProductionTrendChartContent {...props} />
    </DeferredChart>
  );
}

export function DeferredSalesRankingChart(
  props: SalesRankingChartContentProps,
) {
  return (
    <DeferredChart label="本月销售业绩 Top 10" className="h-[25rem]">
      <SalesRankingChartContent {...props} />
    </DeferredChart>
  );
}

export function DeferredCategoryDistributionChart(
  props: CategoryDistributionChartContentProps,
) {
  return (
    <DeferredChart label="本月产品线分布" className="h-[25rem]">
      <CategoryDistributionChartContent {...props} />
    </DeferredChart>
  );
}

/**
 * 保留组合 API 供独立预览使用；Dashboard 页面本身使用上面三个
 * 粒度更小的组件，以便每个数据读取拥有独立错误边界。
 */
export function DeferredDashboardCharts({
  productionTrend,
  salesRanking,
  categoryDistribution,
}: DashboardChartsContentProps) {
  return (
    <div data-slot="dashboard-charts-deferred" className="space-y-4">
      <DeferredProductionTrendChart data={productionTrend} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeferredSalesRankingChart data={salesRanking} />
        <DeferredCategoryDistributionChart data={categoryDistribution} />
      </div>
    </div>
  );
}

function DeferredChart({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      setReady(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: '320px 0px' },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} data-slot="dashboard-chart-deferred">
      {ready ? (
        children
      ) : (
        <ChartPlaceholder label={label} className={className} />
      )}
    </div>
  );
}

function ChartPlaceholder({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={`${label}图表正在加载`}
      className={`${className} animate-pulse rounded-xl border bg-card motion-reduce:animate-none`}
      data-slot="dashboard-chart-placeholder"
    />
  );
}
