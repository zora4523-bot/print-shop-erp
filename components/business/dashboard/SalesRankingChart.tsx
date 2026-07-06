'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// 本月销售业绩 Top 10 横向柱状图。layout="vertical" 把 X 轴当数值
// 轴、Y 轴当类目（recharts 的 vertical 命名跟人的直觉相反，但这是
// 它的约定）。
//
// 配色按角色：SALES = 蓝色，CUSTOMER_SERVICE = 绿色。OWNER / FOREMAN
// 在 dashboard 看排行的概率不大但极少数 owner 自己接的工单也会上榜
// → 用 muted 灰色。

export type SalesRankingChartProps = {
  data: ReadonlyArray<{
    userId: string;
    displayName: string;
    role: string;
    totalAmount: string; // decimal-string
    orderCount: number;
  }>;
};

const ROLE_COLORS: Record<string, string> = {
  SALES: '#2563eb',
  CUSTOMER_SERVICE: '#10b981',
  OWNER: '#94a3b8',
  FOREMAN: '#94a3b8',
};

export function SalesRankingChart({ data }: SalesRankingChartProps) {
  if (data.length === 0) {
    return (
      <div
        data-slot="dashboard-chart-ranking"
        className="flex h-80 w-full items-center justify-center text-sm text-muted-foreground"
      >
        暂无数据
      </div>
    );
  }
  // recharts 期望 number 类型给 BarChart 数值轴；从 decimal-string 转
  // 一道。Top 10 总额一般在百万级，Number 精度足够（千分位由 tick 显示）。
  const rows = data.map((d) => ({
    ...d,
    amount: Number(d.totalAmount),
  }));

  return (
    <div data-slot="dashboard-chart-ranking" className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 8, right: 32, bottom: 8, left: 16 }}
        >
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            stroke="#9ca3af"
            fontSize={11}
            tickFormatter={(v: number) => formatAxisMoney(v)}
          />
          <YAxis
            type="category"
            dataKey="displayName"
            stroke="#9ca3af"
            fontSize={11}
            width={72}
          />
          <Tooltip
            isAnimationActive={false}
            contentStyle={{ fontSize: 12 }}
            // tooltip 走&ldquo;精确到分&rdquo;格式，**不**用 formatAxisMoney——后者
            // 会把 5000.50 圆成 5,001、把 12500 压成 1.3 万，这是 axis
            // tick 的密度妥协，不是金额展示口径。
            formatter={(value) => [
              `¥ ${formatTooltipMoney(Number(value))}`,
              '业绩',
            ]}
            labelFormatter={(label) => String(label ?? '')}
          />
          <Bar dataKey="amount" isAnimationActive={false}>
            {rows.map((row) => (
              <Cell
                key={row.userId}
                fill={ROLE_COLORS[row.role] ?? '#94a3b8'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// 简化的轴文案：1 万以上压成"X.X 万"，否则千分位整数。这是 axis tick
// 视觉密度，**有损**——金额展示请用 formatTooltipMoney 走精确到分。
function formatAxisMoney(v: number): string {
  if (Math.abs(v) >= 10000) {
    return `${(v / 10000).toFixed(1)} 万`;
  }
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(v);
}

// 精确金额格式：千分位 + 2 位小数，与 lib/dashboard/format.ts 的
// formatMoney 同口径（Decimal-string 通常是 toFixed(2) 已经精确，这里
// 接 number；走 zh-CN locale 千分位）。
function formatTooltipMoney(v: number): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}
