'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// 30 天产量曲线（完工口径）。Server lib 喂的数组**总有 30 个元素**，
// 缺测的天 count=0 —— recharts 把空白点画成 0，曲线连续不跳。
//
// `isAnimationActive={false}` 是视觉回归的硬要求：首帧动画会让 SVG
// path 在不同帧之间不一致，baseline 会浮动（DECISIONS 2026-04-26
// recharts 选型条目）。
//
// `data-slot="dashboard-chart-trend"` 是 E2E + 视觉回归 hook，别改。

export type ProductionTrendChartProps = {
  data: ReadonlyArray<{ day: string; count: number }>;
};

export function ProductionTrendChart({ data }: ProductionTrendChartProps) {
  if (data.length === 0) {
    return <ChartEmpty slot="dashboard-chart-trend" />;
  }
  // X 轴只 tick 5 个标签，避免 30 天全显示重叠。挑头/中/尾的位置。
  const labelIndices = new Set([
    0,
    Math.floor((data.length - 1) / 4),
    Math.floor((data.length - 1) / 2),
    Math.floor((3 * (data.length - 1)) / 4),
    data.length - 1,
  ]);
  return (
    <div data-slot="dashboard-chart-trend" className="h-72 w-full">
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 1, height: 1 }}
      >
        <LineChart
          data={data as { day: string; count: number }[]}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            interval={0}
            tick={(props: unknown) => {
              const p = props as {
                x: number | string;
                y: number | string;
                payload?: { value?: string; index?: number };
              };
              const idx = p.payload?.index;
              if (idx == null || !labelIndices.has(idx)) {
                return <g />;
              }
              const x = typeof p.x === 'string' ? Number(p.x) : p.x;
              const y = typeof p.y === 'string' ? Number(p.y) : p.y;
              return (
                <text
                  x={x}
                  y={y + 12}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  {(p.payload?.value ?? '').slice(5)}
                </text>
              );
            }}
            stroke="var(--muted-foreground)"
          />
          <YAxis
            allowDecimals={false}
            stroke="var(--muted-foreground)"
            fontSize={11}
            width={32}
          />
          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              fontSize: 12,
              backgroundColor: 'var(--popover)',
              borderColor: 'var(--border)',
              color: 'var(--popover-foreground)',
            }}
            labelFormatter={(label) => `${String(label ?? '')}（完工）`}
            formatter={(value) => [`${Number(value)} 单`, '完工']}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={{ r: 2, fill: 'var(--chart-1)' }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartEmpty({ slot }: { slot: string }) {
  return (
    <div
      data-slot={slot}
      className="flex h-72 w-full items-center justify-center text-sm text-muted-foreground"
    >
      暂无数据
    </div>
  );
}
