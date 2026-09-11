import Link from 'next/link';
import { formatMoney } from '@/lib/dashboard/format';
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
import { PageHeader } from '@/components/ui-business';
import { AdminOrderWorkspaceList } from './AdminOrderWorkspaceList';
import styles from './AdminOrderWorkspace.module.css';

const QUEUES: Array<{ key: AdminOrderQueue; label: string }> = [
  { key: 'todo', label: '待办' },
  { key: 'print', label: '待打印' },
  { key: 'production', label: '生产中' },
  { key: 'shipped', label: '已发货' },
  { key: 'done', label: '已结算/取消' },
  { key: 'all', label: '全部' },
];

const SIGNALS: Array<{ key: AdminOrderSignal; label: string }> = [
  { key: 'pending-confirmation', label: '待处理' },
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
  const exactCustomerFilterLabel = selectedCustomerLabel(query, data);

  return (
    <div data-slot="admin-order-workspace" style={{ backgroundColor: 'transparent' }} className={cn(styles.surface, "w-full min-w-0 max-w-none space-y-3.5")}>
      <OrderWorkspaceHeader exportControls={exportControls} />
      <AdminOrderDecisionDashboard
        query={query}
        counts={data.counts.signals}
        billingStats={billingStats}
      />

      <section className="min-w-0 space-y-2">
        <form key={JSON.stringify(params)} action="/orders" className="flex min-w-0 flex-wrap items-center gap-2 [&_input]:rounded-full [&_select]:rounded-full [&_button]:rounded-full [&_a]:rounded-full">
          {hiddenFilterInputs(params)}
        <OrderQueuesSection {...{
          query: query, data: data,
        }} />

          <select
            name="submitterId"
            defaultValue={query.list.filters.submitterId ?? ''}
            aria-label="按业务员筛选"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 w-auto max-w-40 grow sm:grow-0"
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
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 w-auto max-w-40 grow sm:grow-0"
          >
            <option value="">全部工艺线</option>
            {options.crafts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-60">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              name="q"
              defaultValue={query.list.filters.q}
              placeholder="搜工单号 / 产品客户 / 名称 / 运单号"
              aria-label="搜索工单"
              className="pl-9"
            />
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 [&_a]:rounded-full">
          {exactCustomerFilterActive ? (
            <Link
              href={buildTableHref('/orders', params, {
                customerPartyId: undefined,
                customerRefExact: undefined,
                page: undefined,
              })}
              prefetch={false}
              aria-label={`清除精确产品客户筛选：${exactCustomerFilterLabel}`}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-w-0 justify-start xl:w-48',
              )}
            >
              <span className="truncate">
                产品客户：{exactCustomerFilterLabel}（精确）
              </span>
              <span aria-hidden="true">×</span>
            </Link>
          ) : (
            <Input
              name="customerRef"
              defaultValue={query.list.filters.customerRef}
              placeholder="产品客户"
              aria-label="按产品客户筛选"
              className="w-32 grow sm:grow-0"
            />
          )}
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
            aria-current={query.starred ? 'true' : undefined}
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
            aria-current={query.unbilled ? 'true' : undefined}
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
          </div>
        </form>


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
            {formatMoney(data.summary.effectiveFee)}
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
        submitterFilterHrefs={Object.fromEntries(
          data.rows.map((order) => [
            order.id,
            buildTableHref(
              '/orders',
              params,
              adminSubmitterFilterParams(order.submitter),
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

function OrderQueuesSection({ query, data }: { query: AdminOrderWorkspaceQuery; data: AdminOrderWorkspacePage; }) {
  return (
    <nav aria-label="工单队列" className="flex min-w-0 flex-wrap gap-2">
      {QUEUES.map((queue) => {
        const active = query.queue === queue.key && !query.signal;
        const target = updateAdminOrderWorkspaceQuery(query, {
          queue: queue.key,
          signal: undefined,
        });
        return (
          <Link
            key={queue.key}
            href={buildTableHref('/orders', {}, serializeAdminOrderWorkspaceQuery(target))}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            className={cn(
              buttonVariants({
                variant: active ? 'default' : 'outline',
                size: 'sm',
              }),
              'min-h-10 shrink-0 rounded-full px-3.5 text-sm font-bold shadow-none',
              active && 'bg-foreground text-background hover:bg-foreground/90',
            )}
          >
            {queue.label}
            <span className="font-sans text-xs tabular-nums">
              {data.counts.queues[queue.key].toLocaleString('zh-CN')}
            </span>
          </Link>
        );
      })}
    </nav>
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
      className="flex flex-wrap gap-2.5"
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
              'flex !min-w-[104px] flex-col items-start rounded-xl border bg-card px-4 py-2.5 transition-colors hover:border-foreground/60 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none',
              'border-border hover:border-muted-foreground/50',
              active && 'border-foreground bg-muted/40',
            )}
          >
            <span
              className={cn(
                'block font-sans text-xl font-extrabold tabular-nums',
                count > 0 && signal.key === 'overdue' && 'text-destructive',
                count > 0 && ['pending-pricing', 'pending-change', 'on-hold', 'due-today'].includes(signal.key) && 'text-warning-foreground',
              )}
            >
              {count.toLocaleString('zh-CN')}
            </span>
            <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
              {signal.label}
            </span>
          </Link>
        );
      })}
      <Link
        href="/owner/agent-bills?status=CONFIRMED"
        prefetch={false}
        className={cn(
          'flex !min-w-[104px] flex-col items-start rounded-xl border bg-card px-4 py-2.5 transition-colors hover:border-foreground/60 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none',
          'border-border hover:border-muted-foreground/50',
        )}
      >
        <span
          className={cn(
            'block font-sans text-base font-semibold tabular-nums',
          )}
        >
          {formatMoney(billingStats.receivableAmount)}
        </span>
        <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
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

export function adminSubmitterFilterParams(
  submitter: AdminOrderWorkspacePage['rows'][number]['submitter'],
): Record<string, string | undefined> {
  return {
    customerRef: undefined,
    customerPartyId: undefined,
    customerRefExact: undefined,
    submitterId: submitter.id,
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

function OrderWorkspaceHeader({ exportControls }: { exportControls: ReactNode }) {
  return (
      <PageHeader
        title="工单管理"
        className="[&_h1]:text-xl [&_h1]:font-extrabold"
        actions={
          <>
            {exportControls}
            <Link href="/orders/new" className={buttonVariants({ variant: 'outline' })}>
              新建工单
            </Link>
          </>
        }
      />
  );
}

function selectedCustomerLabel(query: AdminOrderWorkspaceQuery, data: AdminOrderWorkspacePage) {
  return query.list.filters.customerPartyId
    ? data.rows.find(
        (order) => order.customer.id === query.list.filters.customerPartyId,
      )?.customer.name ?? '已选产品客户'
    : query.list.filters.customerRefExact ===
        MISSING_ORDER_CUSTOMER_FILTER_VALUE
      ? '未填产品客户'
      : query.list.filters.customerRefExact;
}
