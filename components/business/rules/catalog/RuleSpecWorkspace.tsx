import Link from 'next/link';
import { Palette, Pencil, Ruler, Search } from 'lucide-react';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, StatusBadge } from '@/components/ui-business';
import {
  buildTableHref,
  type TableHrefParams,
} from '@/lib/admin/table';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import type {
  ProductActiveStatusFilter,
  ProductListRow,
} from '@/lib/product';
import { cn } from '@/lib/utils';

type RuleSpecWorkspaceProps = {
  products: ProductListRow[];
  routeBase: string;
  query: string;
  status: ProductActiveStatusFilter;
  hiddenSearchParams: TableHrefParams;
  pagination: {
    page: number;
    pageCount: number;
    total: number;
    pageSize: number;
    queryParams: TableHrefParams;
  };
};

function displayText(value: string | null, fallback: string): string {
  return externalPriceBusinessText(value ?? '') || fallback;
}

function SpecFact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/35 px-3 py-2">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="admin-wrap-anywhere mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

export function RuleSpecWorkspace({
  products,
  routeBase,
  query,
  status,
  hiddenSearchParams,
  pagination,
}: RuleSpecWorkspaceProps) {
  const clearHref = buildTableHref(routeBase, {}, hiddenSearchParams);
  const clearSearch = (
    <Link
      href={clearHref}
      prefetch={false}
      className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
    >
      清除搜索
    </Link>
  );

  return (
    <section
      aria-labelledby="spec-master-data-heading"
      className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <div className="border-b p-4 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="spec-master-data-heading" className="text-base font-bold">
              规格主数据
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
              每行对应一条真实报价产品，规格和纸张信息直接来自当前主数据。
            </p>
          </div>
          <span className="shrink-0 rounded-full border bg-background px-3 py-1 text-xs font-medium tabular-nums text-muted-foreground">
            {pagination.total} 条 SKU
          </span>
        </div>

        <div className="mt-4 flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"
            >
              <Palette className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">烫金颜色</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                当前随工单事实维护；暂无独立主数据。此处不生成颜色列表或编辑开关。
              </p>
            </div>
          </div>
          <StatusBadge tone="neutral" className="shrink-0">
            暂无独立主数据
          </StatusBadge>
        </div>

        <form
          action={routeBase}
          role="search"
          aria-label="搜索规格主数据"
          className="mt-4 flex min-w-0 flex-col gap-2"
        >
          {Object.entries(hiddenSearchParams).map(([name, value]) =>
            value === null || value === undefined || value === '' ? null : (
              <input key={name} type="hidden" name={name} value={String(value)} />
            ),
          )}
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                name="q"
                defaultValue={query}
                maxLength={120}
                className="min-h-11 pl-9"
                placeholder="搜索 SKU 编码、名称、规格或纸张"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11">
                搜索
              </Button>
              {query ? clearSearch : null}
            </div>
          </div>

          <div
            role="group"
            aria-label="SKU 建单可选状态筛选"
            className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-muted/20 p-1"
          >
            {(
              [
                ['all', '全部'],
                ['active', '建单可选'],
                ['inactive', '停止新单选用'],
              ] as const
            ).map(([value, label]) => (
              <Link
                key={value}
                href={buildTableHref(routeBase, pagination.queryParams, {
                  status: value,
                  page: null,
                })}
                prefetch={false}
                aria-current={status === value ? 'page' : undefined}
                className={buttonVariants({
                  variant: status === value ? 'secondary' : 'ghost',
                  size: 'sm',
                })}
              >
                {label}
              </Link>
            ))}
          </div>
        </form>
      </div>

      {products.length > 0 ? (
        <ul aria-label="规格主数据列表" className="divide-y">
          {products.map((product) => {
            const name = displayText(product.name, '未命名 SKU');
            const code = displayText(product.code, '未设置编码');
            const category = displayText(
              product.categoryNode.name,
              '未命名产品结构',
            );
            const specification = displayText(
              product.specification,
              '未标注规格',
            );
            const paperType = displayText(product.paperType, '未标注纸张');

            return (
              <li
                key={product.id}
                className={cn(
                  'grid min-w-0 gap-4 p-4 transition-colors hover:bg-muted/20 sm:p-5 xl:grid-cols-[minmax(13rem,0.8fr)_minmax(30rem,1.7fr)_auto] xl:items-center',
                  !product.isActive && 'bg-muted/15',
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background text-muted-foreground"
                  >
                    <Ruler className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="admin-wrap-anywhere text-sm font-bold">
                      {name}
                    </h3>
                    <p className="admin-wrap-anywhere mt-1 font-mono text-[11px] text-muted-foreground">
                      {code}
                    </p>
                    <p className="admin-wrap-anywhere mt-2 text-xs text-muted-foreground">
                      {category}
                    </p>
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                  <SpecFact label="规格" value={specification} />
                  <SpecFact label="纸张" value={paperType} />
                  <SpecFact
                    label="起订量"
                    value={product.minOrderQty ?? '未设置'}
                  />
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
                  <StatusBadge
                    tone={product.isActive ? 'success' : 'neutral'}
                    dot={product.isActive}
                  >
                    {product.isActive ? '建单可选' : '停止新单选用'}
                  </StatusBadge>
                  <Link
                    href={`${routeBase}/${product.id}`}
                    prefetch={false}
                    aria-label={`编辑 SKU：${name}`}
                    className={cn(
                      buttonVariants({ variant: 'outline' }),
                      'min-h-11',
                    )}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                    编辑
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="p-4 sm:p-5">
          <EmptyState
            kind={query ? 'no-result' : 'no-data'}
            noun="报价产品"
            onClear={query ? clearSearch : undefined}
            onCreate={
              query ? undefined : (
                <Link
                  href={`${routeBase}/new`}
                  className={cn(buttonVariants(), 'min-h-11')}
                >
                  新建报价产品
                </Link>
              )
            }
          />
        </div>
      )}

      <div className="border-t px-4 py-3 sm:px-5">
        <AdminPagination
          basePath={routeBase}
          page={pagination.page}
          pageCount={pagination.pageCount}
          total={pagination.total}
          pageSize={pagination.pageSize}
          queryParams={pagination.queryParams}
        />
      </div>
    </section>
  );
}
