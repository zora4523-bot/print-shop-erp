'use client';

/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { FileImage, Star } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setOrderStarredAction } from '@/actions/order-workspace';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState } from '@/components/ui-business';
import { cn } from '@/lib/utils';
import {
  OrderListPageSelection,
  OrderListRowSelection,
  OrderListSelectionProvider,
} from './OrderListBatchSelection';
import {
  AdminOrderDrawer,
  AdminOrderDrawerState,
  AdminWorkspaceStatusBadge,
} from './AdminOrderDrawer';
import { useOrderHashDrawer } from './use-order-hash-drawer';
import { AdminOrderBatchActions } from './AdminOrderBatchActions';
import { AdminOrderProgress } from './AdminOrderProgress';

export function AdminOrderWorkspaceList({
  orders,
  customerFilterHrefs,
  selectedExportRequestKey,
  footer,
}: {
  orders: AdminOrderWorkspaceRow[];
  customerFilterHrefs: Record<string, string>;
  selectedExportRequestKey: string;
  footer?: ReactNode;
}) {
  const selectionKey = orders.map((order) => order.id).join(':');
  return (
    <OrderListSelectionProvider
      key={selectionKey}
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
        footer={footer}
      />
    </OrderListSelectionProvider>
  );
}

function AdminOrderWorkspaceListInner({
  orders,
  customerFilterHrefs,
  footer,
}: {
  orders: AdminOrderWorkspaceRow[];
  customerFilterHrefs: Record<string, string>;
  footer?: ReactNode;
}) {
  const detailEndpoint = useCallback(
    (orderNo: string) =>
      `/api/orders/admin/${encodeURIComponent(orderNo)}`,
    [],
  );
  const drawer = useOrderHashDrawer({
    pageOrders: orders,
    detailEndpoint,
    alwaysFetchDetail: true,
  });

  return (
    <section
      data-slot="admin-order-workspace-list"
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
                onOpen={() => drawer.showOrder(order.orderNo)}
              />
            ))}
          </ul>
        </>
      ) : (
        <div className="p-4">
          <EmptyState
            title="这个队列清空了"
            description="可以切换队列或清除筛选查看其他工单。"
          />
        </div>
      )}
      {footer ? <div className="border-t px-4 py-3">{footer}</div> : null}

      <Sheet
        open={Boolean(drawer.openOrderNo)}
        onOpenChange={(open) => {
          if (!open) drawer.closeOrder();
        }}
      >
        {drawer.error && drawer.openOrderNo ? (
          <AdminOrderDrawerState
            orderNo={drawer.openOrderNo}
            loading={false}
            error={drawer.error}
            onRetry={drawer.retryOrder}
            onClose={drawer.closeOrder}
          />
        ) : drawer.openOrder ? (
          <AdminOrderDrawer order={drawer.openOrder} />
        ) : drawer.openOrderNo ? (
          <AdminOrderDrawerState
            orderNo={drawer.openOrderNo}
            loading={drawer.loading}
            error={drawer.error}
            onRetry={drawer.retryOrder}
            onClose={drawer.closeOrder}
          />
        ) : null}
      </Sheet>
    </section>
  );
}

function AdminOrderRow({
  order,
  customerFilterHref,
  onOpen,
}: {
  order: AdminOrderWorkspaceRow;
  customerFilterHref: string;
  onOpen: () => void;
}) {
  return (
    <li
      data-order-id={order.id}
      className={cn(
        'grid min-w-0 grid-cols-[2.75rem_3rem_minmax(0,1fr)_auto] gap-3 px-3 py-3 transition-colors hover:bg-muted/20 2xl:grid-cols-[2.75rem_3rem_minmax(15rem,1.4fr)_minmax(10rem,1fr)_7rem_8rem_8rem_auto] 2xl:items-center',
        (order.status === 'PENDING_FACTORY' ||
          order.pendingChangeRequest ||
          order.status === 'ON_HOLD') &&
          'bg-destructive/[0.025]',
      )}
    >
      <div className="flex flex-col items-center gap-1">
        <OrderListRowSelection orderId={order.id} orderNo={order.orderNo} />
        <OrderStarButton order={order} />
      </div>
      <OrderThumbnail order={order} />

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="link"
            onClick={onOpen}
            className="admin-wrap-anywhere h-auto min-w-0 max-w-full shrink justify-start whitespace-normal p-0 text-left font-sans text-xs font-semibold tabular-nums"
          >
            {order.orderNo}
          </Button>
          <span className="rounded bg-foreground px-1.5 py-0.5 text-[9px] font-semibold text-background">
            v{order.workOrderVersion}
          </span>
          {order.isUrgent ? (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive dark:bg-destructive/20">
              急单
            </span>
          ) : null}
        </div>
        <p className="admin-wrap-anywhere mt-1 text-sm font-semibold">
          {order.customName ?? '未命名工单'}
        </p>
        <p className="mt-1 flex min-w-0 flex-wrap gap-x-1.5 text-[11px] text-muted-foreground">
          <Link
            href={customerFilterHref}
            prefetch={false}
            className="admin-wrap-anywhere underline decoration-dotted underline-offset-2 hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            {order.customer.name}
          </Link>
          <span aria-hidden="true">·</span>
          <span>{order.submitter.name}</span>
          <span aria-hidden="true">·</span>
          <span>{order.craftSummary}</span>
          <span aria-hidden="true">·</span>
          <span>{formatShanghai(order.submittedAt ?? order.createdAt)}</span>
        </p>
      </div>

      <div className="min-w-0 text-right 2xl:text-left">
        <AdminWorkspaceStatusBadge status={order.status} />
        {order.statusSummary ? (
          <p
            className={cn(
              'mt-1 max-w-64 text-[11px] font-medium text-muted-foreground 2xl:max-w-none',
              (order.pendingChangeRequest ||
                order.fee.source === 'PENDING' ||
                order.printPending ||
                order.status === 'ON_HOLD') &&
                'text-destructive',
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
            order.fee.amount === null && 'text-xs text-destructive',
          )}
        >
          {order.fee.amount === null
            ? order.fee.source === 'INCOMPLETE'
              ? '金额不完整'
              : '待核价'
            : `¥${formatMoney(order.fee.amount)}`}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {feeSourceLabel(order.fee.source)}
        </p>
        {order.fee.source === 'SETTLED' ? (
          <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
            {order.billing ? `${order.billing.period} 账单` : '未出账'}
          </p>
        ) : null}
      </div>

      <div className="col-span-2 text-right 2xl:col-span-1">
        <Button
          type="button"
          variant={
            order.pendingChangeRequest || order.fee.source === 'PENDING'
              ? 'destructive'
              : 'outline'
          }
          size="sm"
          onClick={onOpen}
        >
          {rowActionLabel(order)}
        </Button>
      </div>
    </li>
  );
}

function OrderStarButton({ order }: { order: AdminOrderWorkspaceRow }) {
  const router = useRouter();
  const [starred, setStarred] = useState(order.isStarred);
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const inFlightRef = useRef(false);

  function toggle() {
    if (inFlightRef.current) return;
    const next = !starred;
    inFlightRef.current = true;
    setStarred(next);
    setMessage('');
    startTransition(async () => {
      try {
        const result = await setOrderStarredAction({
          orderId: order.id,
          starred: next,
        });
        if (result.status !== 'success') {
          setStarred(!next);
          setMessage(result.message);
          return;
        }
        router.refresh();
      } catch {
        setStarred(!next);
        setMessage('星标更新失败，请重试');
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
        aria-label={`${starred ? '取消' : '添加'}星标：${order.orderNo}`}
        onClick={toggle}
        className={cn(starred && 'text-warning hover:text-warning-foreground')}
      >
        <Star aria-hidden="true" className={cn(starred && 'fill-current')} />
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {message}
      </span>
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
  const date = order.promisedDate.slice(5);
  const alert = order.dueAlert;
  return (
    <p
      className={cn(
        'col-span-2 pl-[3.75rem] text-xs font-semibold 2xl:col-span-1 2xl:pl-0',
        alert && 'text-destructive',
      )}
    >
      {date}
      {alert ? (
        <span className="mt-0.5 block text-[10px]">
          {alert.kind === 'overdue'
            ? `超 ${alert.days} 天`
            : alert.days === 0
              ? '今天待发'
              : `剩 ${alert.days} 天`}
        </span>
      ) : null}
    </p>
  );
}

function rowActionLabel(order: AdminOrderWorkspaceRow): string {
  if (order.pendingChangeRequest) return '审查变更';
  if (order.fee.source === 'PENDING') return '查看待核价';
  if (order.printPending) return '查看待打印';
  if (order.status === 'PENDING_FACTORY' || order.status === 'SUBMITTED') {
    return '审核';
  }
  if (order.status === 'ON_HOLD') return '查看暂停';
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

function formatShanghai(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
