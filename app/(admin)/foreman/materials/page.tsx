import Link from 'next/link';
import {
  AlertTriangle,
  Boxes,
  PackageCheck,
  Search,
  TrendingUp,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requirePermission } from '@/lib/auth/permissions';
import { getMaterialInventoryDashboard } from '@/lib/material-inventory';
import { MATERIAL_CATEGORY_LABELS } from '@/lib/material';
import {
  PageHeader,
  StatCard,
  StatusBadge,
} from '@/components/ui-business';

export const metadata = { title: '物料库存' };

type PageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

function firstParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

function qty(value: string, unit?: string): string {
  return unit ? `${value} ${unit}` : value;
}

function money(value: string | null): string {
  if (value == null) return '-';
  return `¥${value}`;
}

export default async function ForemanMaterialsPage({ searchParams }: PageProps) {
  await requirePermission('material:manage');
  const sp = await searchParams;
  const q = firstParam(sp.q).trim();
  const dashboard = await getMaterialInventoryDashboard(new Date(), { q });

  return (
    <div className="space-y-6">
      <PageHeader
        title="物料库存"
        subtitle="查看安全库存、当日出入库、累计出入库和按手工参考成本估算的库存金额。"
        actions={
          <Link href="/foreman/materials/new" className={buttonVariants()}>
            新建物料
          </Link>
        }
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="物料总数"
          value={`${dashboard.totals.materialCount} 种`}
          icon={Boxes}
          tone="info"
          hint={`${dashboard.totals.activeMaterialCount} 种启用`}
        />
        <StatCard
          label="低于安全库存"
          value={`${dashboard.totals.lowStockCount} 种`}
          icon={AlertTriangle}
          tone={dashboard.totals.lowStockCount > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="库存金额"
          value={money(dashboard.totals.stockValue)}
          icon={PackageCheck}
          tone="primary"
          hint="库存 × 手工参考平均成本（采购不会自动改价）"
        />
        <StatCard
          label="今日入库"
          value={dashboard.totals.todayIn}
          icon={TrendingUp}
          tone="success"
          hint={`上海日期 ${dashboard.date}`}
        />
        <StatCard
          label="今日出库"
          value={dashboard.totals.todayOut}
          icon={TrendingUp}
          tone="warning"
          hint={`上海日期 ${dashboard.date}`}
        />
      </section>

      <form
        action="/foreman/materials"
        className="flex max-w-2xl flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm sm:flex-row"
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="搜索物料编码、名称、规格、单位"
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit">搜索</Button>
          {q ? (
            <Link
              href="/foreman/materials"
              className={buttonVariants({ variant: 'outline' })}
            >
              清空
            </Link>
          ) : null}
        </div>
      </form>

      <div
        className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        role="region"
        aria-label="物料库存列表"
        tabIndex={0}
      >
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">物料</th>
              <th className="px-4 py-2 font-medium">分类 / 规格</th>
              <th className="px-4 py-2 text-right font-medium">当前库存</th>
              <th className="px-4 py-2 text-right font-medium">安全库存</th>
              <th className="px-4 py-2 text-right font-medium">今日出入库</th>
              <th className="px-4 py-2 text-right font-medium">累计出入库</th>
              <th className="px-4 py-2 text-right font-medium">库存金额</th>
              <th className="px-4 py-2 font-medium">状态</th>
              <th className="px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {dashboard.rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{row.name}</div>
                  <div className="mt-1 font-sans tabular-nums text-xs text-muted-foreground">
                    {row.code}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div>{MATERIAL_CATEGORY_LABELS[row.category]}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.specification ?? '-'} · {row.unit}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-sans tabular-nums">
                  {qty(row.currentStock, row.unit)}
                </td>
                <td className="px-4 py-3 text-right font-sans tabular-nums">
                  {row.safetyStock ? qty(row.safetyStock, row.unit) : '-'}
                </td>
                <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                  <div>入 {qty(row.todayIn, row.unit)}</div>
                  <div>出 {qty(row.todayOut, row.unit)}</div>
                </td>
                <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                  <div>入 {qty(row.totalIn, row.unit)}</div>
                  <div>出 {qty(row.totalOut, row.unit)}</div>
                </td>
                <td className="px-4 py-3 text-right font-sans tabular-nums">
                  {money(row.stockValue)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>
                      {row.isActive ? '启用' : '停用'}
                    </StatusBadge>
                    {row.isBelowSafetyStock ? (
                      <StatusBadge tone="warning">低库存</StatusBadge>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/foreman/materials/${row.id}`}
                    className="text-sm text-primary underline hover:no-underline"
                  >
                    编辑
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {dashboard.rows.length === 0 ? (
          <div className="border-t px-4 py-8 text-center text-sm text-muted-foreground">
            没有匹配的物料记录。
          </div>
        ) : null}
      </div>
    </div>
  );
}
