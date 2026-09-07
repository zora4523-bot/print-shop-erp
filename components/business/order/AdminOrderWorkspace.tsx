import Link from 'next/link';
import { Search, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderWorkspacePage } from '@/lib/order/admin-workspace';
import type { OrderListFilterOptions } from '@/lib/order/list-query';
import { MISSING_ORDER_CUSTOMER_FILTER_VALUE } from '@/lib/order/list-query';
import {
  serializeAdminOrderWorkspaceQuery,
  updateAdminOrderWorkspaceQuery,
  type AdminOrderQueue,
  type AdminOrderSignal,
  type AdminOrderWorkspaceQuery,
} from '@/lib/order/admin-workspace-query';
import { buildTableHref } from '@/lib/admin/table';
import { cn } from '@/lib/utils';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AdminOrderWorkspaceList } from './AdminOrderWorkspaceList';

const QUEUES: Array<{ key: AdminOrderQueue; label: string }> = [
  { key: 'todo', label: '待办' },
  { key: 'print', label: '待打印' },
  { key: 'production', label: '生产中' },
  { key: 'shipped', label: '已发货' },
  { key: 'done', label: '已结算/取消' },
  { key: 'all', label: '全部' },
];

const SIGNALS: Array<{ key: AdminOrderSignal; label: string }> = [
  { key: 'pending-confirmation', label: '待确认' },
  { key: 'pending-pricing', label: '待核价' },
  { key: 'pending-change', label: '变更申请' },
  { key: 'pending-release', label: '待下发生产' },
  { key: 'on-hold', label: '已暂停' },
  { key: 'overdue', label: '已逾期' },
  { key: 'due-today', label: '今日待发' },
];

type BillingStats = {
  receivableAmount: string;
  receivableBillCount: number;
  unbilledOrderCount: number;
  draftBillCount: number;
};

export function AdminOrderWorkspace({
  data,
  query,
  issues,
  options,
  billingStats,
  exportControls,
  selectedExportRequestKey,
}: {
  data: AdminOrderWorkspacePage;
  query: AdminOrderWorkspaceQuery;
  issues: readonly string[];
  options: OrderListFilterOptions;
  billingStats: BillingStats;
  exportControls: ReactNode;
  selectedExportRequestKey: string;
}) {
  const params = serializeAdminOrderWorkspaceQuery({
    ...query,
    list: { ...query.list, page: data.page },
  });
  const paginationParams = { ...params, page: undefined };
  const hasUserFilters = Object.entries(params).some(
    ([key, value]) =>
      !['queue', 'page', 'pageSize'].includes(key) &&
      value !== null &&
      value !== undefined &&
      value !== '',
  );
  const exactCustomerFilterActive = Boolean(
    query.list.filters.customerPartyId ||
      query.list.filters.customerRefExact,
  );
  const rejectedFilterActive = query.list.filters.statuses.length === 1
    && query.list.filters.statuses[0] === OrderStatus.REJECTED;
  const clearFiltersHref = buildTableHref('/orders', {}, {
    queue: query.queue === 'todo' ? undefined : query.queue,
  });
  const exactCustomerFilterLabel = query.list.filters.customerPartyId
    ? data.rows.find(
        (order) => order.customer.id === query.list.filters.customerPartyId,
      )?.customer.name ?? '已选客户'
    : query.list.filters.customerRefExact ===
        MISSING_ORDER_CUSTOMER_FILTER_VALUE
      ? '未填客户'
      : query.list.filters.customerRefExact;

  return (
    <div data-slot="admin-order-workspace" className="min-w-0 space-y-4">
      <AdminOrderDecisionDashboard
        query={query}
        counts={data.counts.signals}
        billingStats={billingStats}
      />

      <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <nav aria-label="工单队列" className="flex min-w-0 gap-2 overflow-x-auto pb-1">
          {QUEUES.map((queue) => {
            const active = query.queue === queue.key && !query.signal;
            const target = updateAdminOrderWorkspaceQuery(query, {
              queue: queue.key,
              signal: undefined,
            });
            return (
              <Link
                key={queue.key}
                href={buildTableHref(
                  '/orders',
                  {},
                  serializeAdminOrderWorkspaceQuery(target),
                )}
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  buttonVariants({
                    variant: active ? 'default' : 'outline',
                    size: 'sm',
                  }),
                  'min-h-10 shrink-0 rounded-full',
                )}
              >
                {queue.label}
                <span className="font-sans text-[10px] tabular-nums">
                  {data.counts.queues[queue.key].toLocaleString('zh-CN')}
                </span>
              </Link>
            );
          })}
        </nav>

        <form key={JSON.stringify(params)} action="/orders" className="flex min-w-0 flex-col gap-2 xl:flex-row">
          {hiddenFilterInputs(params)}
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              name="q"
              defaultValue={query.list.filters.q}
              placeholder="搜工单号 / 客户 / 名称 / 运单号"
              aria-label="搜索工单"
              className="pl-9"
            />
          </div>
          {exactCustomerFilterActive ? (
            <Link
              href={buildTableHref('/orders', params, {
                customerPartyId: undefined,
                customerRefExact: undefined,
                page: undefined,
              })}
              prefetch={false}
              aria-label={`清除精确客户筛选：${exactCustomerFilterLabel}`}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-w-0 justify-start xl:w-48',
              )}
            >
              <span className="truncate">
                客户：{exactCustomerFilterLabel}（精确）
              </span>
              <span aria-hidden="true">×</span>
            </Link>
          ) : (
            <Input
              name="customerRef"
              defaultValue={query.list.filters.customerRef}
              placeholder="客户"
              aria-label="按客户筛选"
              className="xl:w-40"
            />
          )}
          <select
            name="submitterId"
            defaultValue={query.list.filters.submitterId ?? ''}
            aria-label="按业务员筛选"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 xl:w-44"
          >
            <option value="">全部业务员</option>
            {options.submitters.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            name="craftId"
            defaultValue={query.list.filters.craftIds[0] ?? ''}
            aria-label="按工艺线筛选"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 xl:w-40"
          >
            <option value="">全部工艺线</option>
            {options.crafts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <Button type="submit">应用筛选</Button>
          <Link
            href={buildTableHref('/orders', {}, adminRejectedFilterParams(query))}
            prefetch={false}
            aria-current={rejectedFilterActive ? 'true' : undefined}
            className={buttonVariants({ variant: rejectedFilterActive ? 'secondary' : 'outline' })}
          >
            {rejectedFilterActive ? '取消已驳回筛选' : '已驳回 / 待补正'}
          </Link>
          <Link
            href={buildTableHref(
              '/orders',
              {},
              serializeAdminOrderWorkspaceQuery(
                updateAdminOrderWorkspaceQuery(query, {
                  starred: !query.starred,
                }),
              ),
            )}
            prefetch={false}
            aria-pressed={query.starred}
            className={cn(
              buttonVariants({
                variant: query.starred ? 'secondary' : 'outline',
              }),
              'shrink-0',
            )}
          >
            <Star
              aria-hidden="true"
              className={cn(query.starred && 'fill-warning text-warning')}
            />
            {query.starred ? '取消仅星标' : '仅星标'}
          </Link>
          <Link
            href={buildTableHref(
              '/orders',
              {},
              serializeAdminOrderWorkspaceQuery(
                updateAdminOrderWorkspaceQuery(query, {
                  queue: 'done',
                  signal: undefined,
                  unbilled: !query.unbilled,
                }),
              ),
            )}
            prefetch={false}
            aria-pressed={query.unbilled}
            className={buttonVariants({
              variant: query.unbilled ? 'secondary' : 'outline',
            })}
          >
            {query.unbilled ? '取消仅未出账' : '仅未出账'}
          </Link>
          {hasUserFilters ? (
            <Link
              href={clearFiltersHref}
              prefetch={false}
              className={buttonVariants({ variant: 'ghost' })}
            >
              清除筛选
            </Link>
          ) : null}
        </form>

        <div className="flex min-w-0 justify-end">{exportControls}</div>

        {issues.length > 0 ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {issues.join('；')}
          </p>
        ) : null}
      </section>

      <section
        aria-label="当前筛选合计"
        className="flex min-w-0 flex-wrap gap-x-5 gap-y-1 px-1 text-xs font-medium text-muted-foreground"
      >
        <span>
          当前筛选{' '}
          <b className="font-sans text-foreground tabular-nums">
            {data.summary.orderCount.toLocaleString('zh-CN')}
          </b>{' '}
          单
        </span>
        <span>
          共{' '}
          <b className="font-sans text-foreground tabular-nums">
            {data.summary.totalQuantity.toLocaleString('zh-CN')}
          </b>{' '}
          个
        </span>
        <span>
          金额合计{' '}
          <b className="font-sans text-foreground tabular-nums">
            ¥{formatMoney(data.summary.effectiveFee)}
          </b>
          {data.summary.manualPricingCount > 0 ? (
            <span>
              （另 {data.summary.manualPricingCount.toLocaleString('zh-CN')} 单待核价未计入）
            </span>
          ) : null}
          {data.summary.incompleteFeeExcludedCount > 0 ? (
            <span>
              （另{' '}
              {data.summary.incompleteFeeExcludedCount.toLocaleString('zh-CN')}{' '}
              单金额不完整未计入）
            </span>
          ) : null}
          {data.summary.legacyFeeExcludedCount > 0 ? (
            <span>
              （另 {data.summary.legacyFeeExcludedCount.toLocaleString('zh-CN')} 单历史金额未计入）
            </span>
          ) : null}
        </span>
      </section>

      <AdminOrderWorkspaceList
        orders={data.rows}
        hasFilters={hasUserFilters}
        clearFiltersHref={clearFiltersHref}
        selectedExportRequestKey={selectedExportRequestKey}
        customerFilterHrefs={Object.fromEntries(
          data.rows.map((order) => [
            order.id,
            buildTableHref(
              '/orders',
              params,
              adminCustomerExactFilterParams(order.customer),
            ),
          ]),
        )}
        footer={
          <AdminPagination
            basePath="/orders"
            page={data.page}
            pageCount={data.pageCount}
            total={data.total}
            pageSize={data.pageSize}
            queryParams={paginationParams}
          />
        }
      />
    </div>
  );
}

function AdminOrderDecisionDashboard({
  query,
  counts,
  billingStats,
}: {
  query: AdminOrderWorkspaceQuery;
  counts: AdminOrderWorkspacePage['counts']['signals'];
  billingStats: BillingStats;
}) {
  return (
    <section
      aria-label="工单决定看板"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7"
    >
      {SIGNALS.map((signal) => {
        const active = query.signal === signal.key;
        const count = counts[signal.key];
        const target = updateAdminOrderWorkspaceQuery(query, {
          queue: 'all',
          signal: active ? undefined : signal.key,
        });
        return (
          <Link
            key={signal.key}
            href={buildTableHref(
              '/orders',
              {},
              serializeAdminOrderWorkspaceQuery(target),
            )}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-xl border bg-card px-4 py-3 shadow-sm transition-colors hover:border-foreground/50',
              count > 0 && 'border-destructive/40',
              active && 'border-foreground bg-muted/40',
            )}
          >
            <span
              className={cn(
                'block font-sans text-xl font-semibold tabular-nums',
                count > 0 && 'text-destructive',
              )}
            >
              {count.toLocaleString('zh-CN')}
            </span>
            <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground">
              {signal.label}
            </span>
          </Link>
        );
      })}
      <Link
        href="/owner/agent-bills?status=CONFIRMED"
        prefetch={false}
        className={cn(
          'rounded-xl border bg-card px-4 py-3 shadow-sm transition-colors hover:border-foreground/50',
          billingStats.receivableBillCount > 0 && 'border-destructive/40',
        )}
      >
        <span
          className={cn(
            'block font-sans text-base font-semibold tabular-nums',
            billingStats.receivableBillCount > 0 && 'text-destructive',
          )}
        >
          ¥{formatMoney(billingStats.receivableAmount)}
        </span>
        <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground">
          待收款 · {billingStats.receivableBillCount.toLocaleString('zh-CN')} 张
        </span>
      </Link>
    </section>
  );
}

function hiddenFilterInputs(
  params: ReturnType<typeof serializeAdminOrderWorkspaceQuery>,
) {
  const visible = new Set([
    'q',
    'customerRef',
    'submitterId',
    'craftId',
    'page',
  ]);
  return Object.entries(params).map(([key, value]) =>
    visible.has(key) || value === null || value === undefined || value === '' ? null : (
      <input key={key} type="hidden" name={key} value={String(value)} />
    ),
  );
}

export function adminCustomerExactFilterParams(
  customer: AdminOrderWorkspacePage['rows'][number]['customer'],
): Record<string, string | undefined> {
  return {
    customerRef: undefined,
    customerPartyId: customer.id ?? undefined,
    customerRefExact: customer.id ? undefined : customer.filterValue,
    page: undefined,
  };
}

export function adminRejectedFilterParams(query: AdminOrderWorkspaceQuery) {
  const active = query.list.filters.statuses.length === 1
    && query.list.filters.statuses[0] === OrderStatus.REJECTED;
  return serializeAdminOrderWorkspaceQuery({
    ...query,
    queue: 'all',
    signal: undefined,
    unbilled: false,
    list: {
      ...query.list,
      page: 1,
      filters: { ...query.list.filters, statuses: active ? [] : [OrderStatus.REJECTED] },
    },
  });
}

function formatMoney(value: string): string {
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
