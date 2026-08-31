import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { buildTableHref } from '@/lib/admin/table';
import type { OrderListQuery } from '@/lib/order/list-query';
import type {
  SalesOrderListSummary,
  SalesOrderListView,
} from '@/lib/order/sales-list-query';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const SALES_TABS: Array<{
  id: 'all' | SalesOrderListView;
  label: string;
  count: keyof Pick<
    SalesOrderListSummary,
    'all' | 'todo' | 'doing' | 'shipped' | 'done' | 'draft'
  >;
}> = [
  { id: 'all', label: '全部', count: 'all' },
  { id: 'todo', label: '需处理', count: 'todo' },
  { id: 'doing', label: '进行中', count: 'doing' },
  { id: 'shipped', label: '已发货', count: 'shipped' },
  { id: 'done', label: '已完成', count: 'done' },
  { id: 'draft', label: '草稿', count: 'draft' },
];

export function SalesOrderListFilters({
  query,
  summary,
  issues,
}: {
  query: OrderListQuery;
  summary: SalesOrderListSummary;
  issues: readonly string[];
}) {
  const activeView = query.view ?? 'all';
  const q = query.filters.q ?? '';
  const baseParams = {
    q: q || undefined,
    pageSize: query.pageSize !== 20 ? query.pageSize : undefined,
  };

  return (
    <section
      aria-labelledby="sales-order-list-filter-heading"
      data-slot="sales-order-list-filters"
      className="min-w-0 space-y-3 rounded-xl border bg-card p-3 shadow-sm sm:p-4"
    >
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h2 id="sales-order-list-filter-heading" className="font-semibold">
            我的工单
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {summary.todo} 单需处理 · 本月已发 {summary.shippedThisMonth} 单
          </p>
        </div>
        <p className="text-xs text-muted-foreground">共 {summary.all} 单</p>
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
        <nav
          aria-label="销售工单视图"
          className="flex min-w-0 gap-2 overflow-x-auto pb-1"
        >
          {SALES_TABS.map((tab) => {
            const active = activeView === tab.id;
            const href = buildTableHref('/orders', {}, {
              ...baseParams,
              view: tab.id === 'all' ? undefined : tab.id,
            });
            return (
              <Link
                key={tab.id}
                href={href}
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors',
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'bg-background hover:border-foreground/50 hover:bg-muted',
                  tab.id === 'todo' &&
                    !active &&
                    summary.todo > 0 &&
                    'border-destructive/40 text-destructive',
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    'rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground',
                    active && 'bg-background/15 text-background',
                    tab.id === 'todo' &&
                      summary.todo > 0 &&
                      !active &&
                      'bg-destructive/10 text-destructive',
                  )}
                >
                  {summary[tab.count]}
                </span>
              </Link>
            );
          })}
        </nav>

        <form
          action="/orders"
          role="search"
          className="flex min-w-0 flex-1 items-center gap-2 lg:ml-auto lg:max-w-sm"
        >
          {query.view ? (
            <input type="hidden" name="view" value={query.view} />
          ) : null}
          {query.pageSize !== 20 ? (
            <input type="hidden" name="pageSize" value={query.pageSize} />
          ) : null}
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              name="q"
              defaultValue={q}
              aria-label="搜索工单名、客户或工单号"
              placeholder="搜工单名 / 客户 / 单号"
              className="h-10 rounded-full pl-9 pr-9"
            />
            {q ? (
              <Link
                href={buildTableHref('/orders', {}, {
                  ...baseParams,
                  q: undefined,
                  view: query.view,
                })}
                prefetch={false}
                aria-label="清除搜索"
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
                  'absolute right-2 top-1/2 -translate-y-1/2 rounded-full',
                )}
              >
                <X aria-hidden="true" />
              </Link>
            ) : null}
          </div>
          <Button type="submit" className="h-10 rounded-full px-4">
            搜索
          </Button>
        </form>
      </div>

      {issues.length > 0 ? (
        <p role="alert" className="text-xs text-destructive">
          {issues.join('；')}
        </p>
      ) : null}
    </section>
  );
}
