'use client';

import { OrderPurposeBadge } from './OrderPurposeBadge';
import { OrderRemark } from './OrderRemark';

/* eslint-disable @next/next/no-img-element */

import {
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { orderAmountPresentation } from '@/lib/order/amount-presentation';
import { FileImage, Star } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setOrderStarredAction } from '@/actions/order-workspace';
import { adminOrderDueHint } from '@/lib/order/admin-list-presentation';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { Button, buttonVariants } from '@/components/ui/button';
import { ActionNotice, TableEmptyState } from '@/components/ui-business';
import { cn } from '@/lib/utils';
import {
  OrderListPageSelection,
  OrderListRowSelection,
  OrderListSelectionProvider,
} from './OrderListBatchSelection';
import { AdminWorkspaceStatusBadge } from './AdminWorkspaceStatusBadge';
import { LegacyOrderDetailRedirect } from './LegacyOrderDetailRedirect';
import { AdminOrderBatchActions } from './AdminOrderBatchActions';
import { AdminOrderProgress } from './AdminOrderProgress';
import { AdminOrderBatchResultProvider } from './AdminOrderBatchResultProvider';
import styles from './AdminOrderWorkspace.module.css';

export function AdminOrderWorkspaceList({
  orders,
  submitterFilterHrefs,
  selectedExportRequestKey,
  hasFilters = false,
  clearFiltersHref = '/orders',
  footer,
}: {
  orders: AdminOrderWorkspaceRow[];
  submitterFilterHrefs: Record<string, string>;
  selectedExportRequestKey: string;
  hasFilters?: boolean;
  clearFiltersHref?: string;
  footer?: ReactNode;
}) {
  const selectionKey = orders.map((order) => order.id).join(':');
  const [feedback, setFeedback] = useState<OrderRowFeedback | null>(null);
  return (
    <AdminOrderBatchResultProvider>
      {feedback ? <ActionNotice tone={feedback.tone} title={feedback.message} className="mb-2" /> : null}
      <OrderListSelectionProvider
        key={selectionKey}
        batchBarLayout="inline"
        showCopyOrderNumbers={false}
        items={orders.map((order) => ({
          id: order.id,
          orderNo: order.orderNo,
          status: order.status,
          canSchedule: false,
        }))}
        renderBatchActions={(selectedItems) => (
          <AdminOrderBatchActions
            orders={orders}
            selectedItems={selectedItems}
            selectedExportRequestKey={selectedExportRequestKey}
          />
        )}
      >
        <AdminOrderWorkspaceListInner
          orders={orders}
          submitterFilterHrefs={submitterFilterHrefs}
          hasFilters={hasFilters}
          clearFiltersHref={clearFiltersHref}
          onFeedback={setFeedback}
          footer={footer}
        />
      </OrderListSelectionProvider>
    </AdminOrderBatchResultProvider>
  );
}

function AdminOrderWorkspaceListInner({
  orders,
  submitterFilterHrefs,
  hasFilters,
  clearFiltersHref,
  onFeedback,
  footer,
}: {
  orders: AdminOrderWorkspaceRow[];
  submitterFilterHrefs: Record<string, string>;
  hasFilters: boolean;
  clearFiltersHref: string;
  onFeedback: (feedback: OrderRowFeedback) => void;
  footer?: ReactNode;
}) {
  const router = useRouter();

  return (
    <section
      data-slot="admin-order-workspace-list"
      style={{ backgroundColor: 'transparent' }}
      className={cn(styles.surface, "@container min-w-0 space-y-2")}
    >
      {orders.length > 0 ? (
        <>
          {/* 与行同一套列模板 / 内边距 / 紧凑勾选尺寸，「选择本页」和行勾选框同列同尺寸（审查 #17）。 */}
          <div
            data-slot="admin-order-selection-header"
            className={cn(
              styles.selectionHeader,
              'grid min-h-8 min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-3 border border-transparent px-3.5 text-xs font-medium text-muted-foreground @min-[960px]:grid-cols-[1.75rem_minmax(0,1fr)]',
            )}
          >
            <div className="flex flex-col items-center">
              <OrderListPageSelection />
            </div>
            <span>选择本页</span>
          </div>
          <ul aria-label="管理端工单列表" className="space-y-2">
            {orders.map((order) => (
              <AdminOrderRow
                key={order.id}
                order={order}
                submitterFilterHref={
                  submitterFilterHrefs[order.id] ?? '/orders'
                }
                onOpen={() => router.push(`/orders/${encodeURIComponent(order.id)}`)}
                onFeedback={onFeedback}
              />
            ))}
          </ul>
        </>
      ) : (
        <div className="p-4">
          <TableEmptyState
            variant="compact"
            title={hasFilters ? '没有符合筛选条件的工单' : '这个队列清空了'}
            action={<Link href={hasFilters ? clearFiltersHref : '/orders?queue=all'} prefetch={false} className={buttonVariants({ variant: 'outline' })}>
              {hasFilters ? '清除筛选' : '查看全部工单'}
            </Link>}
          />
        </div>
      )}
      {footer ? <div className="border-t px-4 py-3">{footer}</div> : null}

      <LegacyOrderDetailRedirect orders={orders} />
    </section>
  );
}

type OrderRowFeedback = { tone: 'success' | 'error'; message: string };

function AdminOrderRow({
  order,
  submitterFilterHref,
  onOpen,
  onFeedback,
}: {
  order: AdminOrderWorkspaceRow;
  submitterFilterHref: string;
  onOpen: () => void;
  onFeedback: (feedback: OrderRowFeedback) => void;
}) {
  const feeAmount = orderAmountPresentation({
    status: order.status,
    amount: order.fee.amount,
    estimated: order.fee.estimated,
    incomplete: order.fee.source === 'INCOMPLETE',
  });
  return (
    <li
      data-order-id={order.id}
      data-order-density="compact"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, a, input, [role="checkbox"]')) return;
        onOpen();
      }}
      className={cn(
        styles.row,
        'grid min-w-0 cursor-pointer grid-cols-[2.75rem_2.125rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl border bg-card px-3.5 py-3 transition-colors hover:border-foreground/60 motion-reduce:transition-none @min-[960px]:grid-cols-[1.75rem_2.125rem_minmax(160px,1.35fr)_minmax(110px,1fr)_5.5rem_7rem_6rem_7rem] @min-[960px]:items-center @min-[960px]:py-1.5',
        'border border-border hover:border-muted-foreground/50 hover:bg-card has-[[data-batch-checkbox][aria-checked=true]]:bg-muted/50',
      )}
    >
      <div className="flex flex-col items-center gap-1.5">
        <OrderListRowSelection orderId={order.id} orderNo={order.orderNo} displayName={order.customName?.trim() || '未命名工单'} />
        <OrderStarButton order={order} onFeedback={onFeedback} />
      </div>
      <OrderThumbnail order={order} />

      <div className="min-w-0">
        <div className={cn(styles.identity, 'flex min-w-0 flex-col items-start gap-1')}>
          {/* 工作台页头是 h1，行标题是其下唯一层级：用 h2 才不跳级（axe heading-order）。
              Tailwind preflight 把标题字号/字重重置为 inherit，改层级不改观感。 */}
          <h2 className="m-0 flex min-w-0 max-w-full items-start gap-2">
            <Link
              href={`/orders/${order.id}`}
              prefetch={false}
              className="admin-wrap-anywhere inline-flex min-h-11 min-w-11 items-center rounded-sm text-left text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            >
              {order.customName?.trim() || '未命名工单'}
            </Link>
            <OrderPurposeBadge purpose={order.purpose} />
            {order.isUrgent && <span className="mt-2 shrink-0 rounded-md bg-warning/10 px-1.5 py-0.5 text-xs font-bold text-warning-foreground">急单</span>}
          </h2>
        </div>
        <p className={cn(styles.meta, "mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs font-semibold text-muted-foreground")}>
          <Link
            href={submitterFilterHref}
            prefetch={false}
            className="admin-wrap-anywhere underline decoration-dotted underline-offset-2 hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            业务员：{order.submitter.name.trim() || '未命名账号'}
          </Link>
          {order.craftTags?.map((tag) => (
            <span key={tag} className="my-0.5 inline-block whitespace-nowrap rounded-md border border-border px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {tag}
            </span>
          ))}
        </p>
        <OrderRemark remark={order.remark} compact />
      </div>

      <div className="col-start-3 min-w-0 @min-[960px]:col-start-auto">
        <AdminWorkspaceStatusBadge status={order.status} />
        {!!order.productionOwners?.length && <p className="mt-1 text-xs">生产师傅：{order.productionOwners.join('、')}</p>}
        {!!order.productionReviews?.length && <div className="mt-1 flex flex-wrap gap-2">{order.productionReviews.map(job => <Link key={job.id} href={`/orders/${order.id}#production-job-${job.id}`} className="inline-flex min-h-11 items-center text-xs underline">核对 v{job.version} · {job.workerName} · {job.label}</Link>)}</div>}
        {order.pendingProductionWages && <Link href={`/orders/${order.id}#detail-production-records`} className="inline-flex min-h-11 items-center text-xs underline">待补录提成</Link>}
        {order.pendingChangeRequest ? (
          <p className="mt-1 text-xs font-semibold">
            <span className="mr-1 rounded-md border border-foreground px-1 text-xs">{order.pendingChangeRequest.type === 'CANCEL' ? '取消申请' : '变更申请'}</span>
            {order.pendingChangeRequest.summary ?? order.pendingChangeRequest.reason}
          </p>
        ) : order.statusSummary ? (
          <p className={cn('mt-1 text-xs font-semibold',
            rowSummaryClassName(order))}>
            {order.statusSummary}
          </p>
        ) : null}
      </div>

      <DueCell order={order} />

      <div className="col-start-3 min-w-0 text-xs @min-[960px]:col-start-auto">
        <p className="font-semibold tabular-nums">
          {order.itemCount} 款 · {order.totalQuantity.toLocaleString('zh-CN')}
        </p>
        {!order.simpleProduction && showOrderProgress(order) && <div data-slot="admin-order-row-progress" className="mt-1">
          <AdminOrderProgress progress={order.progress} compact />
        </div>}
      </div>

      <div className="col-start-3 min-w-0 @min-[960px]:col-start-auto @min-[960px]:text-right">
        <p
          className={cn(
            'font-sans text-sm font-semibold tabular-nums',
            feeAmount.pending && 'text-xs text-warning-foreground',
          )}
        >
          {feeAmount.label}
          {feeAmount.estimated ? (
            <span className="ml-1 text-xs font-normal text-muted-foreground">估</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {order.status === 'DRAFT' && order.fee.source === 'PENDING' ? '提交后报价' : feeSourceLabel(order.fee.source)}
        </p>
        {order.fee.source === 'SETTLED' ? (
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">
            {order.billing ? `${order.billing.period} 账单` : '未出账'}
          </p>
        ) : null}
      </div>

      <div className="col-start-3 min-w-0 @min-[960px]:col-start-auto @min-[960px]:text-right">
        {order.status === 'DRAFT' ? (
          <Link href={`/orders/${order.id}/edit`} prefetch={false} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            编辑草稿
          </Link>
        ) : (
          <Link
            href={`/orders/${encodeURIComponent(order.id)}`}
            prefetch={false}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), styles.action, rowActionClassName(order))}
          >
            {rowActionLabel(order)}
          </Link>
        )}
      </div>
    </li>
  );
}

function OrderStarButton({ order, onFeedback }: { order: AdminOrderWorkspaceRow; onFeedback: (feedback: OrderRowFeedback) => void }) {
  const router = useRouter();
  const [starred, setStarred] = useState(order.isStarred);
  const [pending, startTransition] = useTransition();
  const inFlightRef = useRef(false);

  function toggle() {
    if (inFlightRef.current) return;
    const next = !starred;
    inFlightRef.current = true;
    setStarred(next);
    startTransition(async () => {
      try {
        const result = await setOrderStarredAction({
          orderId: order.id,
          starred: next,
        });
        if (result.status !== 'success') {
          setStarred(!next);
          onFeedback({ tone: 'error', message: result.message });
          return;
        }
        onFeedback({ tone: 'success', message: `${order.customName?.trim() || '未命名工单'} ${next ? '已添加星标' : '已取消星标'}` });
        router.refresh();
      } catch {
        setStarred(!next);
        onFeedback({ tone: 'error', message: '星标更新失败，请重试' });
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={pending}
        aria-pressed={starred}
        aria-label={`${starred ? '取消' : '添加'}星标：${order.customName?.trim() || '未命名工单'}（${order.orderNo}）`}
        onClick={toggle}
        className={cn(styles.star, starred && 'text-warning hover:text-warning-foreground')}
      >
        <Star aria-hidden="true" className={cn(starred && 'fill-current')} />
      </Button>
    </>
  );
}

function OrderThumbnail({ order }: { order: AdminOrderWorkspaceRow }) {
  return (
    <div className="relative h-[46px] w-[34px] shrink-0 overflow-visible rounded-md border bg-muted">
      {order.thumbnail ? (
        <img
          src={order.thumbnail.url}
          alt={order.thumbnail.fileName}
          width={34}
          height={46}
          loading="lazy"
          decoding="async"
          className="size-full rounded-md object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <FileImage aria-hidden="true" className="size-5" />
          <span className="sr-only">暂无设计图</span>
        </span>
      )}
      {order.itemCount > 1 ? (
        <span className="absolute -bottom-1.5 -right-1.5 rounded-full border-2 border-background bg-foreground px-1.5 py-0.5 text-xs font-semibold text-background">
          {order.itemCount}
        </span>
      ) : null}
    </div>
  );
}

function DueCell({ order }: { order: AdminOrderWorkspaceRow }) {
  if (!order.promisedDate) {
    return (
      <p className="col-start-3 min-w-0 text-xs text-muted-foreground @min-[960px]:col-start-auto">
        交期未设
      </p>
    );
  }
  const date = order.promisedDate;
  const alert = order.dueAlert;
  const hint = adminOrderDueHint(alert);
  return (
    <p
      className={cn(
        'col-start-3 min-w-0 text-xs font-semibold @min-[960px]:col-start-auto',
        alert?.kind === 'overdue' ? 'text-destructive' : alert && 'text-warning-foreground',
      )}
    >
      <time dateTime={date}>{date}</time>
      {hint ? <span className="mt-0.5 block text-xs">{hint}</span> : null}
    </p>
  );
}

export function showOrderProgress(order: AdminOrderWorkspaceRow): boolean {
  return ['RELEASED', 'FOILING', 'PACKING', 'IN_PRODUCTION'].includes(order.status)
    || Number(order.progress.foilingProgress) > 0 || Number(order.progress.packingProgress) > 0
    || order.progress.foilingOverLimit || order.progress.packingOverLimit || order.progress.packingAhead || order.progress.stagnant;
}

function rowSummaryClassName(order: AdminOrderWorkspaceRow): string {
  if (order.status === 'REJECTED' || order.progress.foilingOverLimit || order.progress.packingOverLimit) return 'text-destructive';
  if (order.fee.source === 'PENDING' || order.status === 'ON_HOLD' || order.statusSummary?.startsWith('⚠')) return 'text-warning-foreground';
  return 'text-muted-foreground';
}

function rowActionClassName(order: AdminOrderWorkspaceRow): string {
  const actionable = order.pendingChangeRequest || order.fee.source === 'PENDING' ||
    ['PENDING_FACTORY', 'SUBMITTED'].includes(order.status) ||
    order.capabilities.confirm || order.capabilities.release || order.capabilities.ship || order.printPending;
  return actionable
    ? 'border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background dark:bg-foreground dark:hover:bg-foreground/90'
    : '';
}

function rowActionLabel(order: AdminOrderWorkspaceRow): string {
  if (order.pendingChangeRequest) return '裁决变更';
  if (order.fee.source === 'PENDING') return '录价';
  if (order.printPending) return '处理打印';
  if (order.status === 'PENDING_FACTORY' || order.status === 'SUBMITTED') {
    return '查看处理';
  }
  if (order.status === 'ON_HOLD') return '处理';
  if (order.capabilities.release) return '查看处理';
  if (order.capabilities.settle) return '结算';
  if (order.capabilities.ship) return '录运单发货';
  return '详情';
}

function feeSourceLabel(source: AdminOrderWorkspaceRow['fee']['source']) {
  switch (source) {
    case 'SETTLED':
      return '结算';
    case 'CONFIRMED':
      return '确认';
    case 'QUOTED':
      return '报价';
    case 'LEGACY':
      return '历史金额';
    case 'PENDING':
      return '未计入合计';
    case 'INCOMPLETE':
      return '未计入合计';
  }
}
