'use client';

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  PRODUCT_CATEGORY_LABELS,
  productCategoryLabel,
} from '@/lib/auth/role-labels';
import type { ProductCategory } from '@/generated/prisma/enums';

// 本月产品线分布饼图。lib 喂的是字符串（ProductCategory enum value
// 或 'UNCATEGORIZED'），客户端再 map 成中文标签。

export type CategoryDistributionChartProps = {
  data: ReadonlyArray<{ category: string; orderCount: number }>;
};

// 6 类常见 + "未分类" 兜底，固定颜色避免每次重渲染颜色重排（视觉
// 回归会因此 fail）。
const CATEGORY_COLOR_MAP: Record<string, string> = {
  BLANK_STOCK: 'var(--chart-1)',
  GENERIC_STOCK: 'var(--chart-2)',
  CUSTOM_FLAT_FOIL: 'var(--chart-3)',
  COLOR_PRINT: 'var(--chart-4)',
  STOCK_FOIL_ADD: 'var(--chart-5)',
  BYO_MATERIAL: 'var(--chart-6)',
  // 之前和 BYO_MATERIAL 同为 chart-6，饼图里两个扇区完全同色，只能
  // 靠图例文字区分。新增的 --chart-7 是 Okabe–Ito 里还没用掉的黄。
  UNCATEGORIZED: 'var(--chart-7)',
};

function labelFor(category: string): string {
  if (category === 'UNCATEGORIZED') return '未分类';
  if (category in PRODUCT_CATEGORY_LABELS) {
    return productCategoryLabel(category as ProductCategory);
  }
  return category;
}

export function CategoryDistributionChart({
  data,
}: CategoryDistributionChartProps) {
  if (data.length === 0) {
    return (
      <div
        data-slot="dashboard-chart-category"
        className="flex h-80 w-full items-center justify-center text-sm text-muted-foreground"
      >
        暂无数据
      </div>
    );
  }
  const rows = data.map((d) => ({
    name: labelFor(d.category),
    value: d.orderCount,
    // 真正的「未知类目」用灰，不要再去撞已经分配出去的分类色。
    color: CATEGORY_COLOR_MAP[d.category] ?? 'var(--muted-foreground)',
  }));
  return (
    <div data-slot="dashboard-chart-category" className="h-80 w-full">
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 1, height: 1 }}
      >
        <PieChart>
          {/* External labels sit 10px beyond the arc. At the 375px admin
              viewport a 90px arc pushes the longest known category label
              past the document edge, so keep a small invariant label gutter. */}
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={84}
            innerRadius={48}
            paddingAngle={1}
            isAnimationActive={false}
            label={(props: unknown) => {
              const p = props as { name?: string; value?: number };
              return `${p.name ?? ''} · ${p.value ?? 0}`;
            }}
            labelLine={false}
          >
            {rows.map((row) => (
              <Cell key={row.name} fill={row.color} />
            ))}
          </Pie>
          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              fontSize: 12,
              backgroundColor: 'var(--popover)',
              borderColor: 'var(--border)',
              color: 'var(--popover-foreground)',
            }}
            formatter={(value, name) => [
              `${Number(value)} 单`,
              String(name ?? ''),
            ]}
          />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            wrapperStyle={{ fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
