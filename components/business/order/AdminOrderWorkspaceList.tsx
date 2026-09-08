'use client';

/* eslint-disable @next/next/no-img-element */

import {
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
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

export function AdminOrderWorkspaceList({
  orders,
  customerFilterHrefs,
  selectedExportRequestKey,
  hasFilters = false,
  clearFiltersHref = '/orders',
  footer,
}: {
  orders: AdminOrderWorkspaceRow[];
  customerFilterHrefs: Record<string, string>;
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
          customerFilterHrefs={customerFilterHrefs}
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
  customerFilterHrefs,
  hasFilters,
  clearFiltersHref,
  onFeedback,
  footer,
}: {
  orders: AdminOrderWorkspaceRow[];
  customerFilterHrefs: Record<string, string>;
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
      className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      {orders.length > 0 ? (
        <>
          <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground 2xl:hidden">
            <OrderListPageSelection />
            <span>选择本页</span>
          </div>
          <div className="hidden grid-cols-[2.75rem_3rem_minmax(15rem,1.4fr)_minmax(10rem,1fr)_7rem_8rem_8rem_auto] items-center gap-3 border-b bg-muted/30 px-3 py-2 text-[11px] font-semibold text-muted-foreground 2xl:grid">
            <OrderListPageSelection />
            <span aria-hidden="true" />
            <span>工单</span>
            <span>状态</span>
            <span>交期</span>
            <span>数量 / 进度</span>
            <span className="text-right">费用</span>
            <span className="text-right">操作</span>
          </div>
          <ul aria-label="管理端工单列表" className="divide-y">
            {orders.map((order) => (
              <AdminOrderRow
                key={order.id}
                order={order}
                customerFilterHref={
                  customerFilterHrefs[order.id] ?? '/orders'
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
  customerFilterHref,
  onOpen,
  onFeedback,
}: {
  order: AdminOrderWorkspaceRow;
  customerFilterHref: string;
  onOpen: () => void;
  onFeedback: (feedback: OrderRowFeedback) => void;
}) {
  return (
    <li
      data-order-id={order.id}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, a, input, [role="checkbox"]')) return;
        onOpen();
      }}
      className={cn(
        'grid min-w-0 bg-card grid-cols-[2.75rem_3rem_minmax(0,1fr)_auto] gap-3 px-3 py-3 transition-colors hover:bg-muted/20 2xl:grid-cols-[2.75rem_3rem_minmax(15rem,1.4fr)_minmax(10rem,1fr)_7rem_8rem_8rem_auto] 2xl:items-center',
        'border border-border hover:border-muted-foreground/50 hover:bg-card has-[[data-batch-checkbox][aria-checked=true]]:bg-muted/50',
      )}
    >
      <div className="flex flex-col items-center gap-1">
        <OrderListRowSelection orderId={order.id} orderNo={order.orderNo} displayName={order.customName?.trim() || '未命名工单'} />
        <OrderStarButton order={order} onFeedback={onFeedback} />
      </div>
      <OrderThumbnail order={order} />

      <div className="min-w-0">
        <div className="flex min-w-0 flex-col items-start gap-1">
          <h3 className="m-0 flex min-w-0 max-w-full items-start gap-2">
            <Link
              href={`/orders/${order.id}`}
              prefetch={false}
              className="admin-wrap-anywhere inline-flex min-h-11 min-w-11 items-center rounded-sm text-left text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            >
              {order.customName?.trim() || '未命名工单'}
            </Link>
            {order.isUrgent && <span className="mt-2 shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-warning-foreground">急单</span>}
          </h3>
        </div>
        <p className="mt-1 flex min-w-0 flex-wrap gap-x-1.5 text-[11px] text-muted-foreground">
          <Link
            href={customerFilterHref}
            prefetch={false}
            className="admin-wrap-anywhere underline decoration-dotted underline-offset-2 hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            {order.customer.name}
          </Link>
          {order.craftTags?.map((tag) => (
            <span key={tag} className="my-0.5 inline-block whitespace-nowrap rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {tag}
            </span>
          ))}
        </p>
      </div>

      <div className="min-w-0 text-right 2xl:text-left">
        <AdminWorkspaceStatusBadge status={order.status} />
        {order.pendingChangeRequest ? (
          <p className="mt-1 text-[11px] font-semibold">
            <span className="mr-1 rounded border border-foreground px-1 text-[10px]">{order.pendingChangeRequest.type === 'CANCEL' ? '取消申请' : '变更申请'}</span>
            {order.pendingChangeRequest.summary ?? order.pendingChangeRequest.reason}
          </p>
        ) : order.statusSummary ? (
          <p
            className={cn(
              'mt-1 max-w-64 text-[11px] font-medium text-muted-foreground 2xl:max-w-none',
              rowSummaryClassName(order),
            )}
          >
            {order.statusSummary}
          </p>
        ) : null}
      </div>

      <DueCell order={order} />

      <div className="col-span-2 pl-[3.75rem] text-xs 2xl:col-span-1 2xl:pl-0">
        <p className="font-semibold tabular-nums">
          {order.itemCount} 款 · {order.totalQuantity.toLocaleString('zh-CN')}
        </p>
        <div className="mt-1.5">
          <AdminOrderProgress progress={order.progress} compact />
        </div>
      </div>

      <div className="col-span-2 text-right 2xl:col-span-1">
        <p
          className={cn(
            'font-sans text-sm font-semibold tabular-nums',
            order.fee.amount === null && 'text-xs text-warning-foreground',
          )}
        >
          {order.fee.amount === null
            ? order.fee.source === 'INCOMPLETE'
              ? '金额不完整'
              : order.status === 'DRAFT' ? '未报价' : '待核价'
            : `¥${formatMoney(order.fee.amount)}`}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {order.status === 'DRAFT' && order.fee.source === 'PENDING' ? '提交后报价' : feeSourceLabel(order.fee.source)}
        </p>
        {order.fee.source === 'SETTLED' ? (
          <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
            {order.billing ? `${order.billing.period} 账单` : '未出账'}
          </p>
        ) : null}
      </div>

      <div className="col-span-2 text-right 2xl:col-span-1">
        {order.status === 'DRAFT' ? (
          <Link href={`/orders/${order.id}/edit`} prefetch={false} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            编辑草稿
          </Link>
        ) : (
          <Link
            href={`/orders/${encodeURIComponent(order.id)}`}
            prefetch={false}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), rowActionClassName(order))}
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
        className={cn(starred && 'text-warning hover:text-warning-foreground')}
      >
        <Star aria-hidden="true" className={cn(starred && 'fill-current')} />
      </Button>
    </>
  );
}

function OrderThumbnail({ order }: { order: AdminOrderWorkspaceRow }) {
  return (
    <div className="relative h-16 w-12 shrink-0 overflow-visible rounded-md border bg-muted">
      {order.thumbnail ? (
        <img
          src={order.thumbnail.url}
          alt={order.thumbnail.fileName}
          className="size-full rounded-md object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <FileImage aria-hidden="true" className="size-5" />
          <span className="sr-only">暂无设计图</span>
        </span>
      )}
      {order.itemCount > 1 ? (
        <span className="absolute -bottom-1.5 -right-1.5 rounded-full border-2 border-background bg-foreground px-1.5 py-0.5 text-[9px] font-semibold text-background">
          {order.itemCount}
        </span>
      ) : null}
    </div>
  );
}

function DueCell({ order }: { order: AdminOrderWorkspaceRow }) {
  if (!order.promisedDate) {
    return (
      <p className="col-span-2 pl-[3.75rem] text-xs text-muted-foreground 2xl:col-span-1 2xl:pl-0">
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
        'col-span-2 pl-[3.75rem] text-xs font-semibold 2xl:col-span-1 2xl:pl-0',
        alert?.kind === 'overdue' ? 'text-destructive' : alert && 'text-warning-foreground',
      )}
    >
      <time dateTime={date}>{date}</time>
      {hint ? <span className="mt-0.5 block text-[10px]">{hint}</span> : null}
    </p>
  );
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
  if (order.pendingChangeRequest) return '审查变更';
  if (order.fee.source === 'PENDING') return '查看待核价';
  if (order.printPending) return '查看待打印';
  if (order.status === 'PENDING_FACTORY' || order.status === 'SUBMITTED') {
    return '查看处理';
  }
  if (order.status === 'ON_HOLD') return '查看暂停';
  if (order.capabilities.release) return '查看处理';
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

function formatMoney(value: string): string {
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
