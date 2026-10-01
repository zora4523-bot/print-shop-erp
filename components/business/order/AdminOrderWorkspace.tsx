import Form from 'next/form';
import Link from 'next/link';
import { formatMoney } from '@/lib/dashboard/format';
import { Search, Star, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderWorkspacePage } from '@/lib/order/admin-workspace';
import type { OrderListFilterOptions } from '@/lib/order/list-query';
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
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { LinkPendingHint, PageHeader } from '@/components/ui-business';
import { AdminOrderScrollStrip } from './AdminOrderScrollStrip';
import { AdminOrderWorkspaceList } from './AdminOrderWorkspaceList';
import styles from './AdminOrderWorkspace.module.css';
import { OrderQueuePending } from './OrderQueuePending';
import { OrderQueueResults } from './OrderQueueResults';
import { ORDER_FILTER_FORM_ID, OrderFilterClearLink } from './OrderFilterClearLink';

const QUEUES: Array<{ key: AdminOrderQueue; label: string }> = [
  { key: 'todo', label: '待办' },
  { key: 'print', label: '待打印' },
  { key: 'production', label: '生产中' },
  { key: 'shipped', label: '已发货' },
  { key: 'done', label: '已结算/取消' },
  { key: 'all', label: '全部' },
];

const SIGNALS: Array<{ key: AdminOrderSignal; label: string }> = [
  // 看板卡 9 列时内容宽约 70px，标签超过 5 个字会在词中折行。
  { key: 'pending-quantity', label: '产量待核对' },
  { key: 'pending-confirmation', label: '待下发检查' },
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
  const rejectedFilterActive = query.list.filters.statuses.length === 1
    && query.list.filters.statuses[0] === OrderStatus.REJECTED;
  const clearFiltersHref = buildTableHref('/orders', {}, {
    queue: query.queue === 'todo' ? undefined : query.queue,
  });
  const excludedFees = excludedFeeSummary(data.summary);

  return (
    <div data-slot="admin-order-workspace" style={{ backgroundColor: 'transparent' }} className={cn(styles.surface, "w-full min-w-0 max-w-none space-y-3.5")}>
      <OrderWorkspaceHeader exportControls={exportControls} />
      <AdminOrderDecisionDashboard
        query={query}
        counts={data.counts.signals}
        billingStats={billingStats}
      />

      <section className="@container min-w-0 space-y-2">
        {/* 队列标签条在表单外、不带 key：切换队列时只更新 aria-current，不重挂载
            （审查 #38）。表单 key 只跟已应用的可见筛选值走——切队列/看板时未点
            「应用筛选」的输入保留（仍不生效），清除/应用筛选后才按 URL 重置。
            已应用值为空时清除不改变 key，由 OrderFilterClearLink 点击时显式 reset。 */}
        <OrderQueuesSection {...{
          query: query, data: data,
        }} />
        {/* 筛选、应用与切换按钮同一行流式排布，底边对齐（§8.1）；不再用 w-full 行把按钮强行挤到下一行。 */}
        <Form
          key={appliedFilterFormKey(query)}
          id={ORDER_FILTER_FORM_ID}
          action="/orders"
          scroll={false}
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {hiddenFilterInputs(params)}

          <NativeSelect
            name="submitterId"
            defaultValue={query.list.filters.submitterId ?? ''}
            aria-label="按业务员筛选"
            className="w-auto max-w-40 grow sm:grow-0"
          >
            <option value="">全部业务员</option>
            {options.submitters.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            name="craftId"
            defaultValue={query.list.filters.craftIds[0] ?? ''}
            aria-label="按工艺线筛选"
            className="w-auto max-w-40 grow sm:grow-0"
          >
            <option value="">全部工艺线</option>
            {options.crafts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          <div className="relative min-w-[200px] flex-1 sm:max-w-60">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              name="q"
              defaultValue={query.list.filters.q}
              placeholder="搜工单号 / 名称 / 运单号"
              aria-label="搜索工单"
              className="pl-9"
            />
          </div>
          {/* 与其他列表一致（09-29 #36）：筛选是次要按钮，页头「新建工单」是本页主操作。 */}
          <Button type="submit" variant="outline">应用筛选</Button>
          {/* 快捷筛选整组换行：1280 宽下不再把最后一个开关单独挤到第二行；窄容器整组一行横向滚动，
              与「清除筛选」同行（审查 L-8）。
              开关文字不随状态改变（原「取消仅星标」等会改变按钮宽度、引起换行跳动），
              选中态由 selected 变体 + ✕ 表达，读屏由 aria-current 与「再次点击取消」表达。 */}
          <AdminOrderScrollStrip
            role="group"
            aria-label="快捷筛选"
            activeKey={[rejectedFilterActive, query.starred, query.pendingWages, query.unbilled].map((on) => (on ? 1 : 0)).join('')}
            className={cn(NARROW_SCROLL_STRIP, 'flex-[1_1_12rem] items-center gap-2 @min-[60rem]:flex-initial')}
          >
            <QuickFilterLink
              href={buildTableHref('/orders', {}, adminRejectedFilterParams(query))}
              active={rejectedFilterActive}
              label="已驳回 / 待补正"
            />
            <QuickFilterLink
              href={buildTableHref(
                '/orders',
                {},
                serializeAdminOrderWorkspaceQuery(
                  updateAdminOrderWorkspaceQuery(query, {
                    starred: !query.starred,
                  }),
                ),
              )}
              active={query.starred}
              label="仅星标"
              icon={
                <Star
                  aria-hidden="true"
                  className={cn(query.starred && 'fill-warning text-warning')}
                />
              }
            />
            <QuickFilterLink
              href={buildTableHref('/orders', {}, adminPendingWagesFilterParams(query))}
              active={query.pendingWages}
              label="待补录提成"
            />
            <QuickFilterLink
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
              active={query.unbilled}
              label="仅未出账"
            />
          </AdminOrderScrollStrip>
          {hasUserFilters ? (
            <OrderFilterClearLink href={clearFiltersHref} className={buttonVariants({ variant: 'ghost' })} />
          ) : null}
        </Form>


        {issues.length > 0 ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {issues.join('；')}
          </p>
        ) : null}
      </section>

      <OrderQueueResults>
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
          {excludedFees ? <span>{excludedFees}</span> : null}
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
      </OrderQueueResults>
    </div>
  );
}

function QuickFilterLink({
  href,
  active,
  label,
  icon,
}: {
  href: string;
  active: boolean | undefined;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cn(
        buttonVariants({ variant: active ? 'selected' : 'outline' }),
        'relative shrink-0',
      )}
    >
      {icon}
      {label}
      {active ? (
        <>
          <X aria-hidden="true" />
          <span className="sr-only">（再次点击取消）</span>
        </>
      ) : null}
      <LinkPendingHint />
    </Link>
  );
}

/** 「金额合计」未计入的工单合成一句，不再逐类重复「（另 N 单…未计入）」。 */
export function excludedFeeSummary(
  summary: Pick<
    AdminOrderWorkspacePage['summary'],
    'manualPricingCount' | 'incompleteFeeExcludedCount' | 'legacyFeeExcludedCount'
  >,
): string | null {
  const parts = [
    [summary.manualPricingCount, '待核价'],
    [summary.incompleteFeeExcludedCount, '金额不完整'],
    [summary.legacyFeeExcludedCount, '历史金额'],
  ] as const;
  const listed = parts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${label} ${count.toLocaleString('zh-CN')} 单`);
  return listed.length > 0 ? `（未计入：${listed.join('、')}）` : null;
}

function OrderQueuesSection({ query, data }: { query: AdminOrderWorkspaceQuery; data: AdminOrderWorkspacePage; }) {
  return (
    <nav aria-label="工单队列" className="min-w-0">
      <AdminOrderScrollStrip
        activeKey={query.signal ? '' : query.queue}
        className={cn(NARROW_SCROLL_STRIP, 'gap-2')}
      >
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
            scroll={false}
            aria-current={active ? 'page' : undefined}
            className={cn(
              buttonVariants({
                variant: active ? 'selected' : 'outline',
                size: 'sm',
              }),
              'relative shrink-0',
            )}
          >
            {queue.label}
            <span className="font-sans text-xs tabular-nums">
              {data.counts.queues[queue.key].toLocaleString('zh-CN')}
            </span>
            <OrderQueuePending label={queue.label} />
            <LinkPendingHint />
          </Link>
        );
      })}
      </AdminOrderScrollStrip>
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
  // 9 张卡（8 个信号 + 待收款）宽容器 9 列一行；窄容器（<56rem）不再排成 3×3（手机上占约 240px），
  // 改为单行横向滚动，卡片按内容取宽、最窄 6rem，375 宽露出第 4 张的一角提示可滑（审查 L-8）。
  // 9 列时待收款卡占 1.5 份：金额比计数长，等宽列会把「¥ 15,395.29」从数字中间折开。
  return (
    <section
      aria-label="工单决定看板"
      className="@container"
    >
      <AdminOrderScrollStrip
        activeKey={query.signal ?? ''}
        className="-m-1 flex gap-2.5 overflow-x-auto overscroll-x-contain p-1 @min-[56rem]:m-0 @min-[56rem]:grid @min-[56rem]:grid-cols-[repeat(8,minmax(0,1fr))_minmax(0,1.5fr)] @min-[56rem]:overflow-visible @min-[56rem]:p-0"
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
            scroll={false}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // 选中态只用 Button 的 selected 变体（§8.2）；未选中保持中性卡片。
              active
                ? buttonVariants({ variant: 'selected' })
                : 'border border-border bg-card hover:border-muted-foreground/50',
              DECISION_CARD_LAYOUT,
            )}
          >
            <span
              className={cn(
                'block font-sans text-xl font-extrabold tabular-nums',
                count > 0 && signalCountClassName(signal.key),
              )}
            >
              {count.toLocaleString('zh-CN')}
            </span>
            <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
              {signal.label}
            </span>
            <LinkPendingHint />
          </Link>
        );
      })}
      <Link
        href="/owner/agent-bills?status=CONFIRMED"
        prefetch={false}
        className={cn(
          'border border-border bg-card hover:border-muted-foreground/50',
          DECISION_CARD_LAYOUT,
        )}
      >
        {/* 不用 admin-wrap-anywhere：金额只允许在「¥」后的空格处换行，数字本身不拆开。 */}
        <span className="block max-w-full font-sans text-sm font-semibold tabular-nums @min-[56rem]:text-base">
          {formatMoney(billingStats.receivableAmount)}
        </span>
        <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
          待收款 · {billingStats.receivableBillCount.toLocaleString('zh-CN')} 张
        </span>
      </Link>
      </AdminOrderScrollStrip>
    </section>
  );
}

const DECISION_CARD_LAYOUT =
  'relative flex h-auto min-w-24 shrink-0 flex-col items-start justify-start gap-0 whitespace-normal rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none @min-[56rem]:min-w-0';

/**
 * 队列与快捷筛选在窄容器（<960px）排成一行、条内横向滚动，不再各自折成 2–3 行（审查 L-8）；
 * -m-1 p-1 给焦点框留出不被滚动容器裁切的空间，外框位置不变。≥960px 恢复原来的换行排布。
 */
const NARROW_SCROLL_STRIP =
  'flex min-w-0 -m-1 overflow-x-auto overscroll-x-contain p-1 @min-[60rem]:m-0 @min-[60rem]:flex-wrap @min-[60rem]:overflow-visible @min-[60rem]:p-0';

/** 看板数字的语义色：逾期 = 失败，待核价 = 主强调（§4.3），其余待办 = 风险。 */
function signalCountClassName(signal: AdminOrderSignal): string | undefined {
  if (signal === 'overdue') return 'text-destructive';
  if (signal === 'pending-pricing') return 'text-primary';
  if (['pending-change', 'on-hold', 'due-today'].includes(signal)) return 'text-warning-foreground';
  return undefined;
}

/** 表单只在「已应用的可见筛选值」变化时重挂载，见上方 #38 注释。 */
function appliedFilterFormKey(query: AdminOrderWorkspaceQuery): string {
  const f = query.list.filters;
  return JSON.stringify([f.q ?? '', f.submitterId ?? '', f.craftIds[0] ?? '']);
}

function hiddenFilterInputs(
  params: ReturnType<typeof serializeAdminOrderWorkspaceQuery>,
) {
  const visible = new Set([
    'q',
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
    submitterId: submitter.id,
    page: undefined,
  };
}

function adminPendingWagesFilterParams(query: AdminOrderWorkspaceQuery) {
  return serializeAdminOrderWorkspaceQuery({
    ...query,
    queue: 'all',
    signal: undefined,
    pendingWages: !query.pendingWages,
    list: { ...query.list, page: 1 },
  });
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
        title="工单列表"
        actions={
          <>
            {exportControls}
            <Link href="/orders/new" className={buttonVariants()}>
              新建工单
            </Link>
          </>
        }
      />
  );
}
