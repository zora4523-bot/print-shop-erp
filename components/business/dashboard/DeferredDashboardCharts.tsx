'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { DashboardChartsContentProps } from './DashboardChartsContent';

const DashboardChartsContent = dynamic<DashboardChartsContentProps>(
  () =>
    import('./DashboardChartsContent').then(
      (module) => module.DashboardChartsContent,
    ),
  { loading: () => <DashboardChartsPlaceholder /> },
);

export function DeferredDashboardCharts(props: DashboardChartsContentProps) {
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
    <div ref={rootRef} data-slot="dashboard-charts-deferred">
      {ready ? <DashboardChartsContent {...props} /> : <DashboardChartsPlaceholder />}
    </div>
  );
}

function DashboardChartsPlaceholder() {
  return (
    <div
      aria-busy="true"
      aria-label="图表正在加载"
      className="space-y-4"
      data-slot="dashboard-charts-placeholder"
    >
      <div className="h-[23rem] animate-pulse rounded-xl border bg-card motion-reduce:animate-none" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-[25rem] animate-pulse rounded-xl border bg-card motion-reduce:animate-none" />
        <div className="h-[25rem] animate-pulse rounded-xl border bg-card motion-reduce:animate-none" />
      </div>
    </div>
  );
}
