'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Text,
  Tooltip,
  XAxis,
  YAxis,
  type YAxisTickContentProps,
} from 'recharts';

// Y 轴分类刻度用 <Text> 按实际字体度量做单行省略：长显示名（或 CI 机器缺中文
// 字体时更宽的回退字形）不再把刻度文字顶出视口左边界；完整名字仍在 tooltip。
// 必须用函数形式：对象形式的 tick 会被 recharts 按 SVG 属性过滤，maxLines /
// breakAll 传不进 <Text>。
const RANKING_LABEL_WIDTH = 60;
function renderRankingTick({ x, y, payload }: YAxisTickContentProps) {
  return (
    <Text
      x={x}
      y={y}
      textAnchor="end"
      verticalAnchor="middle"
      fontSize={11}
      fill="var(--muted-foreground)"
      width={RANKING_LABEL_WIDTH}
      maxLines={1}
      breakAll
    >
      {String(payload.value ?? '')}
    </Text>
  );
}

// 本月销售业绩 Top 10 横向柱状图。layout="vertical" 把 X 轴当数值
// 轴、Y 轴当类目（recharts 的 vertical 命名跟人的直觉相反，但这是
// 它的约定）。
//
// 配色按角色：SALES = 蓝色。收费工单都归属外部销售；历史上管理员
// 自己接的工单也可能上榜 → 用 muted 灰色。

type SalesRankingChartProps = {
  data: ReadonlyArray<{
    userId: string;
    displayName: string;
    role: string;
    totalAmount: string; // decimal-string
    orderCount: number;
  }>;
};

const ROLE_COLORS: Record<string, string> = {
  SALES: 'var(--chart-1)',
  // 注释上面写的是「用 muted 灰色」，之前却实现成 chart-5——那是一支
  // 蓝，和 SALES 的 chart-1 对比度只有 2.25:1，两个角色看起来一样。
  ADMIN: 'var(--muted-foreground)',
};

const ROLE_LEGEND: ReadonlyArray<{ role: string; label: string }> = [
  { role: 'SALES', label: '销售' },
  { role: 'ADMIN', label: '管理员' },
];

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
  // 只带图表真正要用的字段。之前是 `{...d}` 整行摊平，recharts 会把
  // payload 上的属性透传到 <path>，于是渲染出 role="SALES"
  // 这种非法 ARIA 角色，axe aria-roles 直接报错。
  const rows = data.map((d) => ({
    displayName: d.displayName,
    amount: Number(d.totalAmount),
  }));
  const barColors = data.map(
    (d) => ROLE_COLORS[d.role] ?? 'var(--muted-foreground)',
  );

  return (
    <div data-slot="dashboard-chart-ranking" className="flex h-80 w-full flex-col">
      {/* 柱子颜色编码的是「角色」，但此前整张图没有任何图例，颜色承载的
          信息对用户不可解读。这一行同时也是 WCAG 1.4.1（不能只靠颜色
          传达信息）的补救：颜色 + 文字双通道。 */}
      <ul className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {ROLE_LEGEND.map((entry) => (
          <li key={entry.role} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: ROLE_COLORS[entry.role] }}
            />
            {entry.label}
          </li>
        ))}
      </ul>
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 1, height: 1 }}
      >
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 8, right: 32, bottom: 8, left: 16 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickFormatter={(v: number) => formatAxisMoney(v)}
          />
          <YAxis
            type="category"
            dataKey="displayName"
            stroke="var(--muted-foreground)"
            fontSize={11}
            width={72}
            tick={renderRankingTick}
          />
          <Tooltip
            isAnimationActive={false}
            itemStyle={{ color: 'var(--popover-foreground)' }}
            contentStyle={{
              fontSize: 12,
              backgroundColor: 'var(--popover)',
              borderColor: 'var(--border)',
              color: 'var(--popover-foreground)',
            }}
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
            {data.map((row, i) => (
              <Cell key={row.userId} fill={barColors[i]} />
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
