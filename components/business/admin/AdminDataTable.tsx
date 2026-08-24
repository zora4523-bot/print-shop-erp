import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  buildTableHref,
  nextSortDirection,
  type SortDirection,
  type TableHrefParams,
} from '@/lib/admin/table';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui-business';

export function AdminListToolbar({
  action,
  query,
  placeholder,
  clearHref,
  hiddenParams = {},
  filters,
}: {
  action: string;
  query: string;
  placeholder: string;
  clearHref: string;
  hiddenParams?: TableHrefParams;
  filters?: React.ReactNode;
}) {
  return (
    <form
      action={action}
      className="flex max-w-3xl flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={query}
            placeholder={placeholder}
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">搜索</Button>
          {query ? (
            <Link
              href={clearHref}
              prefetch={false}
              className={buttonVariants({ variant: 'outline' })}
            >
              清空
            </Link>
          ) : null}
        </div>
      </div>
      {Object.entries(hiddenParams).map(([key, value]) =>
        value === null || value === undefined || value === '' ? null : (
          <input key={key} type="hidden" name={key} value={String(value)} />
        ),
      )}
      {filters ? <div className="flex flex-wrap gap-2">{filters}</div> : null}
    </form>
  );
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
}: {
  basePath: string;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  queryParams: TableHrefParams;
}) {
  const prevHref = buildTableHref(basePath, queryParams, { page: page - 1 });
  const nextHref = buildTableHref(basePath, queryParams, { page: page + 1 });

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

export function AdminStatusBadge({
  active,
  activeLabel = '启用',
  inactiveLabel = '停用',
}: {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  return active ? (
    <Badge variant="outline">{activeLabel}</Badge>
  ) : (
    <Badge variant="secondary">{inactiveLabel}</Badge>
  );
}

export function AdminRowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-max flex-wrap items-center gap-2">{children}</div>;
}
