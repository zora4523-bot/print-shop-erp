'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { SectionLoading } from '@/components/ui-business';
import { Button } from '@/components/ui/button';
const Trend = dynamic(() => import('@/components/business/dashboard/ProductionTrendChart').then(module => module.ProductionTrendChart), { loading: () => <SectionLoading label="工单趋势" className="h-72" /> });
export function AnalyticsTrend({ data }: { data: { day: string; count: number; submitted: number }[] }) {
  const [metric, setMetric] = useState<'completed' | 'submitted'>('completed');
  return <div className="min-w-0 space-y-3">
    <div role="group" aria-label="趋势统计口径" className="flex flex-wrap gap-2">
      <Button className="min-h-11" variant={metric === 'completed' ? 'selected' : 'outline'} aria-pressed={metric === 'completed'} onClick={() => setMetric('completed')}>完工工单</Button>
      <Button className="min-h-11" variant={metric === 'submitted' ? 'selected' : 'outline'} aria-pressed={metric === 'submitted'} onClick={() => setMetric('submitted')}>提交工单</Button>
    </div>
    <p className="text-sm text-muted-foreground" role="status">{metric === 'completed' ? '按完工日期' : '按提交日期'} · 共 {data.reduce((sum, row) => sum + (metric === 'completed' ? row.count : row.submitted), 0)} 单</p>
    <Trend label={metric === 'completed' ? '完工' : '提交'} data={data.map(row => ({ day: row.day, count: metric === 'completed' ? row.count : row.submitted }))} />
  </div>;
}
