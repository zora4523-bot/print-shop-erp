import Form from 'next/form';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { buildTableHref } from '@/lib/admin/table';
import type {
  SalesOrderListQuery,
  SalesOrderListSummary,
  SalesOrderListView,
} from '@/lib/order/sales-list-query';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterClearLink, LinkPendingHint } from '@/components/ui-business';

/** 销售工单搜索表单的 id，供「清除筛选」在导航时 reset 未提交的输入。 */
const SALES_ORDER_FILTER_FORM_ID = 'sales-order-filters';

const SALES_TABS: Array<{
  id: 'all' | SalesOrderListView;
  label: string;
  count: keyof Pick<
    SalesOrderListSummary,
    'all' | 'todo' | 'doing' | 'shipped' | 'done' | 'cancelled' | 'draft'
  >;
}> = [
  { id: 'all', label: '全部', count: 'all' },
  { id: 'todo', label: '需关注', count: 'todo' },
  { id: 'doing', label: '进行中', count: 'doing' },
  { id: 'shipped', label: '已发货', count: 'shipped' },
  { id: 'done', label: '已完成', count: 'done' },
  { id: 'cancelled', label: '已取消', count: 'cancelled' },
  { id: 'draft', label: '草稿', count: 'draft' },
];

export function SalesOrderListFilters({
  query,
  summary,
  issues,
}: {
  query: SalesOrderListQuery;
  summary: SalesOrderListSummary;
  issues: readonly string[];
}) {
  const activeView = query.view ?? 'all';
  const q = query.filters.q ?? '';
  const createdMonth = query.createdMonth ?? '';
  const filtered = Boolean(q || createdMonth);
  const baseParams = {
    q: q || undefined,
    createdMonth: createdMonth || undefined,
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
          {/* 页面 H1 已是「我的工单」，卡片标题只留给读屏（业主 2026-10-01）。 */}
          <h2 id="sales-order-list-filter-heading" className="sr-only">
            工单筛选
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {filtered ? `当前筛选：${summary.all} 单 · ${summary.todo} 单需关注` : `${summary.todo} 单需关注 · 本月已发 ${summary.shippedThisMonth} 单`}
          </p>
        </div>
        {createdMonth ? <p className="text-xs text-muted-foreground">下单月份 {createdMonth}</p> : null}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <nav
          aria-label="销售工单视图"
          className="flex min-w-0 flex-wrap gap-2 xl:flex-1"
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
                scroll={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  buttonVariants({ variant: active ? 'selected' : 'outline' }),
                  'relative shrink-0 gap-1.5',
                  tab.id === 'todo' &&
                    !active &&
                    summary.todo > 0 &&
                    'border-warning/40 text-warning-foreground',
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    'rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground',
                    // 选中态按钮自身已是 primary 淡底；计数胶囊再叠一层会让暗色对比跌破 4.5:1。
                    active && 'bg-transparent text-primary ring-1 ring-inset ring-primary/40',
                    tab.id === 'todo' &&
                      summary.todo > 0 &&
                      !active &&
                      'bg-warning/10 text-warning-foreground',
                  )}
                >
                  {summary[tab.count]}
                </span>
                <LinkPendingHint />
              </Link>
            );
          })}
        </nav>

        {/* Applied filters reset input values; switching views preserves pending edits. */}
        <Form
          key={`${q}:${createdMonth}`}
          id={SALES_ORDER_FILTER_FORM_ID}
          action="/orders"
          role="search"
          scroll={false}
          className="flex w-full min-w-0 flex-wrap items-end gap-2"
        >
          {query.view ? (
            <input type="hidden" name="view" value={query.view} />
          ) : null}
          {query.pageSize !== 20 ? (
            <input type="hidden" name="pageSize" value={query.pageSize} />
          ) : null}
          <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted-foreground sm:max-w-48">
            下单月份
            <Input type="month" name="createdMonth" defaultValue={createdMonth} className="min-w-0 bg-background text-foreground" />
          </label>
          <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1 sm:max-w-sm">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              name="q"
              defaultValue={q}
              aria-label="搜索工单名或工单号"
              placeholder="搜工单名 / 单号"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">
            应用筛选
          </Button>
          {filtered ? (
            <FilterClearLink
              href={buildTableHref('/orders', {}, {
                ...baseParams,
                q: undefined,
                createdMonth: undefined,
                view: query.view,
              })}
              formId={SALES_ORDER_FILTER_FORM_ID}
              className={buttonVariants({ variant: 'ghost' })}
            />
          ) : null}
        </Form>
      </div>

      {issues.length > 0 ? (
        <p role="alert" className="text-xs text-destructive">
          {issues.join('；')}
        </p>
      ) : null}
    </section>
  );
}
