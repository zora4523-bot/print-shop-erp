import Form from 'next/form';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Search,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  buildTableHref,
  nextSortDirection,
  type SortDirection,
  type TableHrefParams,
} from '@/lib/admin/table';
import { cn } from '@/lib/utils';
import { EmptyState, FilterClearLink } from '@/components/ui-business';

export function AdminListToolbar({
  action,
  query,
  placeholder,
  clearHref,
  hiddenParams = {},
  filters,
  filterValues = {},
  formId = 'admin-list-filters',
}: {
  action: string;
  query: string;
  placeholder: string;
  clearHref: string;
  hiddenParams?: TableHrefParams;
  filters?: React.ReactNode;
  /** `filters` 里非受控控件对应的**已应用**值（如 `{ type }`），参与表单 key。 */
  filterValues?: TableHrefParams;
  /** 筛选表单 id，供「清除筛选」在导航时 reset 未提交输入；同页多个工具栏时必须区分。 */
  formId?: string;
}) {
  return (
    // next/form（审查 #41）：有 JS 时客户端导航 + 预取，无 JS 时仍是原生 GET 提交。
    // 软导航不会重建非受控字段：key 取全部已应用查询，提交 / 清空 / 后退时字段按 URL 重建，
    // 否则清空后输入框仍显示旧词，再提交又把旧条件带回来。
    // 宽度：与下方 AdminTableCard 同宽（全宽、同为 rounded-xl 卡片），左右边缘对齐。
    <Form
      id={formId}
      key={adminListToolbarKey(query, hiddenParams, filterValues)}
      action={action}
      className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={query}
            placeholder={placeholder}
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {/* 页头「新建X」是页面唯一主按钮，工具栏搜索降为 outline（审查 #36）。 */}
          <Button type="submit" variant="outline">搜索</Button>
          {query ? (
            <FilterClearLink
              href={clearHref}
              formId={formId}
              className={buttonVariants({ variant: 'outline' })}
            />
          ) : null}
        </div>
      </div>
      {Object.entries(hiddenParams).map(([key, value]) =>
        value === null || value === undefined || value === '' ? null : (
          <input key={key} type="hidden" name={key} value={String(value)} />
        ),
      )}
      {filters ? <div className="flex flex-wrap gap-2">{filters}</div> : null}
    </Form>
  );
}

/** 规范化已应用查询：空值与 undefined 等价，参数顺序无关。 */
function adminListToolbarKey(
  query: string,
  hiddenParams: TableHrefParams,
  filterValues: TableHrefParams,
): string {
  const normalize = (params: TableHrefParams) =>
    Object.entries(params)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => [key, String(value)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([query, normalize(hiddenParams), normalize(filterValues)]);
}

export function AdminTableCard({
  children,
  isEmpty,
  emptyTitle = '暂无数据',
  emptyDescription,
  footer,
}: {
  children: React.ReactNode;
  isEmpty: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card shadow-sm">
      <div className="min-w-0 p-0 sm:p-4">{children}</div>
      {isEmpty ? (
        <div className="border-t p-4">
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            className="border-0 bg-transparent py-6"
          />
        </div>
      ) : null}
      {footer ? <div className="border-t px-4 py-3">{footer}</div> : null}
    </div>
  );
}

export function AdminSortLink<T extends string>({
  basePath,
  field,
  label,
  currentSort,
  currentDirection,
  queryParams,
  className,
}: {
  basePath: string;
  field: T;
  label: React.ReactNode;
  currentSort: T;
  currentDirection: SortDirection;
  queryParams: TableHrefParams;
  className?: string;
}) {
  const active = currentSort === field;
  const nextDirection = nextSortDirection(currentSort, currentDirection, field);
  const href = buildTableHref(basePath, queryParams, {
    sort: field,
    dir: nextDirection,
    page: null,
  });
  const Icon = active
    ? currentDirection === 'asc'
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        'inline-flex items-center gap-1 hover:text-primary',
        active ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      <span>{label}</span>
      <Icon className="size-3.5" />
    </Link>
  );
}

export function AdminPagination({
  basePath,
  page,
  pageCount,
  total,
  pageSize,
  queryParams,
  pageParam = 'page',
  anchor,
}: {
  basePath: string;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  queryParams: TableHrefParams;
  /** 同页多张表时用于区分的分页参数名，默认 `page`。 */
  pageParam?: string;
  /** 分页后定位的元素 id，不含 #。 */
  anchor?: string;
}) {
  const hash = anchor ? `#${encodeURIComponent(anchor)}` : '';
  const prevHref = buildTableHref(basePath, queryParams, { [pageParam]: page - 1 }) + hash;
  const nextHref = buildTableHref(basePath, queryParams, { [pageParam]: page + 1 }) + hash;

  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div>
        共 {total} 条 · 每页 {pageSize} 条 · 第 {page} / {pageCount} 页
      </div>
      <div className="flex gap-2">
        {page <= 1 ? (
          <span
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'pointer-events-none bg-muted text-muted-foreground',
            )}
          >
            上一页
          </span>
        ) : (
          <Link
            href={prevHref}
            prefetch={false}
            className={buttonVariants({ variant: 'outline' })}
          >
            上一页
          </Link>
        )}
        {page >= pageCount ? (
          <span
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'pointer-events-none bg-muted text-muted-foreground',
            )}
          >
            下一页
          </span>
        ) : (
          <Link
            href={nextHref}
            prefetch={false}
            className={buttonVariants({ variant: 'outline' })}
          >
            下一页
          </Link>
        )}
      </div>
    </div>
  );
}

export function AdminRowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-max flex-wrap items-center gap-2">{children}</div>;
}
