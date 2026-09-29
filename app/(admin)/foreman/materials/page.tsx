import Form from 'next/form';
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
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { formatMoney } from '@/lib/dashboard/format';
import {
  EmptyState,
  FilterClearLink,
  PageHeader,
  StatCard,
  StatusBadge,
  TableScrollArea,
} from '@/components/ui-business';
import { ActiveStatusBadge } from '@/components/business/master-data/ActiveStatusBadge';

export const metadata = { title: '车间用料' };

const MATERIAL_FILTER_FORM_ID = 'material-filters';

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

function stockValueText(value: string | null): string {
  if (value == null) return '-';
  return formatMoney(value);
}

export default async function ForemanMaterialsPage({ searchParams }: PageProps) {
  await requirePermission('material:manage');
  const sp = await searchParams;
  const q = firstParam(sp.q).trim();
  const dashboard = await getMaterialInventoryDashboard(new Date(), { q });

  return (
    <div className="space-y-6">
      <PageHeader
        title="车间用料"
        subtitle="查看库存、出入库和库存金额。"
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
          tone="neutral"
          hint={`${dashboard.totals.activeMaterialCount} 种启用`}
        />
        <StatCard
          label="低于安全库存"
          value={`${dashboard.totals.lowStockCount} 种`}
          icon={AlertTriangle}
          tone={dashboard.totals.lowStockCount > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="库存金额"
          value={stockValueText(dashboard.totals.stockValue)}
          icon={PackageCheck}
          tone="neutral"
          hint="库存 × 参考成本；采购入库不会自动更新参考成本"
        />
        <StatCard
          label="今日入库"
          value={dashboard.totals.todayIn}
          icon={TrendingUp}
          tone="neutral"
          hint={`上海日期 ${dashboard.date}`}
        />
        <StatCard
          label="今日出库"
          value={dashboard.totals.todayOut}
          icon={TrendingUp}
          tone="neutral"
          hint={`上海日期 ${dashboard.date}`}
        />
      </section>

      {/* next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。 */}
      {/* 宽度：与下方物料表格卡片同宽（全宽、同为 rounded-xl 卡片），左右边缘对齐。 */}
      <Form
        id={MATERIAL_FILTER_FORM_ID}
        key={JSON.stringify([q])}
        action="/foreman/materials"
        className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm sm:flex-row"
      >
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="搜索物料编码、名称、规格、单位"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {/* 页头「新建物料」是页面唯一主按钮，工具栏搜索降为 outline。 */}
          <Button type="submit" variant="outline">搜索</Button>
          {q ? (
            <FilterClearLink
              formId={MATERIAL_FILTER_FORM_ID}
              href="/foreman/materials"
              className={buttonVariants({ variant: 'outline' })}
            />
          ) : null}
        </div>
      </Form>

      <TableScrollArea label="物料库存列表" className="rounded-xl border bg-card shadow-sm">
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
                  <div className="font-medium">
                    {externalPriceBusinessText(row.name)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div>{MATERIAL_CATEGORY_LABELS[row.category]}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.specification
                      ? externalPriceBusinessText(row.specification)
                      : '-'}{' '}
                    · {row.unit}
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
                  {stockValueText(row.stockValue)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <ActiveStatusBadge active={row.isActive} />
                    {row.isBelowSafetyStock ? (
                      <StatusBadge tone="warning">低库存</StatusBadge>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/foreman/materials/${row.id}`}
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  >
                    编辑
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {dashboard.rows.length === 0 ? (
          <div className="border-t p-4">
            {q ? (
              <EmptyState
                kind="no-result"
                noun="物料"
                className="border-0 bg-transparent py-6"
                onClear={
                  <FilterClearLink
                    formId={MATERIAL_FILTER_FORM_ID}
                    href="/foreman/materials"
                    className={buttonVariants({ variant: 'outline' })}
                  />
                }
              />
            ) : (
              <EmptyState
                kind="no-data"
                noun="物料"
                className="border-0 bg-transparent py-6"
              />
            )}
          </div>
        ) : null}
      </TableScrollArea>
    </div>
  );
}
