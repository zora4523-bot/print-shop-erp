import Link from 'next/link';
import { FileText, Pencil, Search } from 'lucide-react';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, StatusBadge } from '@/components/ui-business';
import type { TableHrefParams } from '@/lib/admin/table';
import type { MaterialSummary } from '@/lib/material';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { cn } from '@/lib/utils';

type RulePaperWorkspaceProps = {
  papers: MaterialSummary[];
  routeBase: string;
  query: string;
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

function decimal(value: unknown): string {
  if (value === null || value === undefined) return '未设置';
  return String(value);
}

function PaperMetric({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/35 px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <p className="admin-wrap-anywhere mt-1 font-sans text-sm font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

export function RulePaperWorkspace({
  papers,
  routeBase,
  query,
  hiddenSearchParams,
  pagination,
}: RulePaperWorkspaceProps) {
  const clearSearch = (
    <Link
      href={routeBase}
      prefetch={false}
      className={cn(
        buttonVariants({ variant: 'outline' }),
        'min-h-11',
      )}
    >
      清除搜索
    </Link>
  );

  return (
    <section
      aria-labelledby="paper-master-data-heading"
      className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <div className="border-b p-4 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="paper-master-data-heading" className="text-base font-bold">
              纸张主数据
            </h2>
          </div>
          <span className="shrink-0 rounded-full border bg-background px-3 py-1 text-xs font-medium tabular-nums text-muted-foreground">
            {pagination.total} 种纸张
          </span>
        </div>

        <form
          action={routeBase}
          role="search"
          aria-label="搜索纸张主数据"
          className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row"
        >
          {Object.entries(hiddenSearchParams).map(([name, value]) =>
            value === null || value === undefined || value === '' ? null : (
              <input key={name} type="hidden" name={name} value={String(value)} />
            ),
          )}
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
              placeholder="搜索纸张编码、名称、规格、单位或拼音"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-11">
              搜索
            </Button>
            {query ? clearSearch : null}
          </div>
        </form>
      </div>

      {papers.length > 0 ? (
        <ul aria-label="纸张主数据列表" className="divide-y">
          {papers.map((paper) => {
            const name = displayText(paper.name, '未命名纸张');
            const specification = paper.specification
              ? displayText(paper.specification, '未标注规格')
              : '未标注规格';

            return (
              <li
                key={paper.id}
                className={cn(
                  'grid min-w-0 gap-4 p-4 transition-colors hover:bg-muted/20 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(25rem,auto)] lg:items-center',
                  !paper.isActive && 'bg-muted/15',
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background text-muted-foreground"
                  >
                    <FileText className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="admin-wrap-anywhere text-sm font-bold">
                      {name}
                    </h3>
                    <p className="admin-wrap-anywhere mt-1 font-mono text-xs text-muted-foreground">
                      {paper.code}
                    </p>
                    <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground">
                      <span className="admin-wrap-anywhere rounded-md bg-muted/60 px-2 py-1">
                        {specification}
                      </span>
                      <span className="rounded-md bg-muted/60 px-2 py-1">
                        单位：{paper.unit}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_auto_auto] sm:items-center">
                  <PaperMetric
                    label="当前库存"
                    value={`${decimal(paper.currentStock)} ${paper.unit}`}
                  />
                  <PaperMetric
                    label="安全库存"
                    value={
                      paper.safetyStock === null
                        ? '未设置'
                        : `${decimal(paper.safetyStock)} ${paper.unit}`
                    }
                  />
                  <div className="flex min-h-11 items-center sm:justify-end">
                    <StatusBadge
                      tone={paper.isActive ? 'success' : 'neutral'}
                      dot={paper.isActive}
                    >
                      {paper.isActive ? '启用' : '停用'}
                    </StatusBadge>
                  </div>
                  <Link
                    href={`${routeBase}/${paper.id}`}
                    prefetch={false}
                    aria-label={`编辑纸张：${name}`}
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
            noun="纸张"
            onClear={query ? clearSearch : undefined}
            onCreate={
              query ? undefined : (
                <Link
                  href={`${routeBase}/new`}
                  className={cn(buttonVariants(), 'min-h-11')}
                >
                  新建纸张
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
