'use client';

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import {
  Copy,
  FileImage,
  PackageCheck,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { OrderListQuery } from '@/lib/order/list-query';
import type { SalesOrderListRow } from '@/lib/order/sales-list-query';
import { formatMoney } from '@/lib/dashboard/format';
import {
  formatSalesOrderUpdatedAt,
  salesOrderAmountPresentation,
  salesOrderPrimaryAction,
} from '@/lib/order/sales-list-presentation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { EmptyState, useCopyToClipboard } from '@/components/ui-business';
import { SalesOrderStatusBadge } from './SalesOrderStatusBadge';
import { SalesOrderProgress } from './SalesOrderProgress';
import { UrgentBadge } from './UrgentBadge';

export function SalesOrdersList({
  orders,
  query,
  nowIso,
  footer,
}: {
  orders: SalesOrderListRow[];
  query: OrderListQuery;
  nowIso: string;
  footer?: ReactNode;
}) {
  const [openOrderNo, setOpenOrderNo] = useState<string | null>(null);
  const [remoteResult, setRemoteResult] = useState<{
    orderNo: string;
    order?: SalesOrderListRow;
    error?: string;
  } | null>(null);
  const { feedback: copyFeedback, copy } = useCopyToClipboard();
  const pageOrder = useMemo(
    () => orders.find((order) => order.orderNo === openOrderNo) ?? null,
    [openOrderNo, orders],
  );
  const remoteOrder =
    remoteResult?.orderNo === openOrderNo ? remoteResult.order ?? null : null;
  const remoteOrderError =
    remoteResult?.orderNo === openOrderNo ? remoteResult.error ?? '' : '';
  const remoteOrderLoading = Boolean(
    openOrderNo && !pageOrder && !remoteOrder && !remoteOrderError,
  );
  const openOrder = pageOrder ?? remoteOrder;

  useEffect(() => {
    const syncFromLocation = () => {
      setOpenOrderNo(orderNoFromHash(window.location.hash));
    };
    syncFromLocation();
    window.addEventListener('hashchange', syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);
    return () => {
      window.removeEventListener('hashchange', syncFromLocation);
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, []);

  useEffect(() => {
    if (!openOrderNo || pageOrder) return;

    const controller = new AbortController();
    void fetch(
      `/api/orders/sales/${encodeURIComponent(openOrderNo)}`,
      {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          order?: SalesOrderListRow;
          error?: string;
        };
        if (!response.ok || !payload.order) {
          throw new Error(payload.error || '工单明细加载失败');
        }
        if (payload.order.orderNo !== openOrderNo) {
          throw new Error('工单明细响应与请求不匹配');
        }
        setRemoteResult({ orderNo: openOrderNo, order: payload.order });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRemoteResult({
          orderNo: openOrderNo,
          error:
            error instanceof Error ? error.message : '工单明细加载失败',
        });
      });
    return () => controller.abort();
  }, [openOrderNo, pageOrder]);

  function showOrder(orderNo: string) {
    const url = new URL(window.location.href);
    url.hash = `wo=${encodeURIComponent(orderNo)}`;
    window.history.pushState(
      drawerHistoryState(window.history.state, orderNo),
      '',
      url,
    );
    setRemoteResult(null);
    setOpenOrderNo(orderNo);
  }

  function closeOrder() {
    if (drawerEntryOrderNo(window.history.state) === openOrderNo) {
      setOpenOrderNo(null);
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(window.history.state, '', url);
    setOpenOrderNo(null);
  }

  async function copyValue(value: string, label: string) {
    await copy(value, label);
  }

  return (
    <div data-slot="sales-orders-list" className="min-w-0">
      {orders.length > 0 ? (
        <ul aria-label="销售工单列表" className="grid gap-2">
          {orders.map((order) => (
            <SalesOrderCard
              key={order.id}
              order={order}
              nowIso={nowIso}
              onOpen={() => showOrder(order.orderNo)}
              onCopy={copyValue}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <EmptyState
            kind={query.filters.q || query.view ? 'no-result' : 'no-data'}
            noun="工单"
            onClear={
              query.filters.q || query.view ? (
                <Link
                  href="/orders"
                  prefetch={false}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  查看全部工单
                </Link>
              ) : undefined
            }
          />
        </div>
      )}
      {footer ? (
        <div data-slot="sales-orders-pagination" className="mt-4">
          {footer}
        </div>
      ) : null}
      <Sheet
        open={Boolean(openOrderNo)}
        onOpenChange={(open) => {
          if (!open) closeOrder();
        }}
      >
        {openOrder ? (
          <SalesOrderDrawer
            order={openOrder}
            onCopy={copyValue}
            onClose={closeOrder}
          />
        ) : openOrderNo ? (
          <SalesOrderDrawerState
            orderNo={openOrderNo}
            loading={remoteOrderLoading}
            error={remoteOrderError}
            onClose={closeOrder}
          />
        ) : null}
      </Sheet>
      <p className="sr-only" role="status" aria-live="polite">
        {copyFeedback?.message}
      </p>
    </div>
  );
}

function SalesOrderCard({
  order,
  nowIso,
  onOpen,
  onCopy,
}: {
  order: SalesOrderListRow;
  nowIso: string;
  onOpen: () => void;
  onCopy: (value: string, label: string) => void;
}) {
  const amount = salesOrderAmountPresentation(order);
  const hasPendingAmount = order.feeLines.some((line) => line.amount === null);
  return (
    <li
      data-order-id={order.id}
      data-sales-order-card=""
      className={cn(
        'grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-3 rounded-xl border bg-background p-3 transition-colors hover:border-foreground/30 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:px-4',
        order.needsAction &&
          'border-destructive/50 bg-linear-to-r from-destructive/8 via-background to-background',
      )}
    >
      <OrderThumbnail order={order} />

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <Button
            type="button"
            variant="link"
            onClick={onOpen}
            title="快速预览工单"
            aria-haspopup="dialog"
            className="admin-wrap-anywhere h-auto min-w-0 max-w-full shrink justify-start whitespace-normal p-0 text-left text-sm font-semibold sm:text-base"
          >
            {order.customName ?? '未命名工单'}
          </Button>
          <span className="admin-wrap-anywhere text-xs font-medium text-muted-foreground">
            {order.customerRef ?? '未填客户'}
          </span>
          {order.pendingChangeRequest ? (
            <Badge variant="outline" className="border-foreground/60">
              {order.pendingChangeRequest.type === 'CANCEL' ? '取消申请中' : '修改申请中'}
            </Badge>
          ) : null}
          {order.isUrgent ? <UrgentBadge /> : null}
        </div>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <span className="font-sans tabular-nums">{order.orderNo}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`复制工单号 ${order.orderNo}`}
            onClick={() => onCopy(order.orderNo, '工单号')}
          >
            <Copy aria-hidden="true" />
          </Button>
          <span>v{order.revision}</span>
        </div>

        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <DueDate order={order} />
          <span>
            <b className="font-medium text-foreground">{order.itemCount}</b> 款 ·{' '}
            <b className="font-medium text-foreground tabular-nums">
              {order.totalQuantity.toLocaleString('zh-CN')}
            </b>{' '}
            个
          </span>
          <span className="max-w-full truncate" title={order.craftSummary}>
            {order.craftSummary}
          </span>
          <span>{formatSalesOrderUpdatedAt(order.updatedAt, nowIso)}</span>
        </div>

        {order.pricingAttentionReason ? (
          <p className="mt-2 border-l-2 border-destructive pl-2 text-xs font-medium text-destructive">
            {order.pricingAttentionReason}
          </p>
        ) : null}
        {order.rejectedChangeRequest ? (
          <p className="mt-2 border-l-2 border-destructive pl-2 text-xs font-medium text-destructive">
            {order.rejectedChangeRequest.type === 'CANCEL' ? '取消申请被拒' : '修改申请被拒'} ·{' '}
            {order.rejectedChangeRequest.reviewRemark ?? '请查看申请详情'}
          </p>
        ) : null}
        {order.shipment ? (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <PackageCheck aria-hidden="true" className="size-4 text-success" />
            <span>{order.shipment.carrier}</span>
            <span className="rounded-md bg-muted px-2 py-1 font-sans tabular-nums">
              {order.shipment.trackingNo}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onCopy(order.shipment!.trackingNo, '运单号')}
            >
              复制单号
            </Button>
            {order.shipment.additionalCount > 0 ? (
              <span className="text-muted-foreground">
                另有 {order.shipment.additionalCount} 个运单
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 border-t pt-3 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start sm:border-0 sm:pt-0">
        <SalesOrderStatusBadge status={order.status} />
        <div className="min-w-0 text-right">
          <p
            className={cn(
              'font-sans text-sm font-semibold tabular-nums sm:text-base',
              amount.pending && 'max-w-28 text-xs text-primary sm:text-xs',
            )}
          >
            {amount.label}
            {!amount.pending && hasPendingAmount ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                不含待定
              </span>
            ) : null}
            {amount.estimated ? (
              <span className="ml-1 text-xs text-muted-foreground">估</span>
            ) : null}
          </p>
        </div>
        <Link
          href={`/orders/${order.id}`}
          prefetch={false}
          className={cn(
            buttonVariants({ variant: order.needsAction ? 'destructive' : 'outline', size: 'sm' }),
            'min-h-9 px-3',
          )}
        >
          {salesOrderPrimaryAction(order)}
        </Link>
      </div>
    </li>
  );
}

function OrderThumbnail({ order }: { order: SalesOrderListRow }) {
  const stylePhotos = order.items.flatMap((item) =>
    item.thumbnail && isStylePhotoFileName(item.thumbnail.fileName)
      ? [
          {
            id: item.id,
            sequence: item.sequence,
            name: item.name,
            url: item.thumbnail.url,
          },
        ]
      : [],
  );
  const coverPhoto = stylePhotos[0];

  return (
    <div className="relative h-16 w-12 shrink-0 overflow-visible rounded-md border bg-muted sm:h-[4.5rem] sm:w-[3.25rem]">
      {coverPhoto ? (
        <Dialog>
          <DialogTrigger
            type="button"
            aria-label={`预览款式照片：${order.customName ?? order.orderNo}，共 ${stylePhotos.length} 款`}
            title="点击查看款式照片"
            data-sales-order-thumbnail-trigger=""
            className="group block size-full cursor-zoom-in overflow-hidden rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
          >
            <img
              src={coverPhoto.url}
              alt=""
              className="size-full rounded-md object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none"
            />
          </DialogTrigger>
          <DialogContent
            data-sales-order-image-preview=""
            className="grid max-h-[calc(100dvh-1rem)] max-w-5xl grid-rows-[auto_auto_minmax(0,1fr)] gap-2 overflow-hidden p-3 sm:max-h-[calc(100dvh-3rem)] sm:gap-3 sm:p-4"
          >
            <DialogTitle className="admin-wrap-anywhere pr-10 text-sm">
              款式照片
            </DialogTitle>
            <DialogDescription className="text-xs">
              已上传 {stylePhotos.length} / {order.itemCount} 款，按款式展示代表照片。
            </DialogDescription>
            <ul
              aria-label="款式照片列表"
              className={cn(
                'grid min-h-0 gap-3 overflow-y-auto overscroll-contain',
                stylePhotos.length > 1 && 'sm:grid-cols-2',
              )}
            >
              {stylePhotos.map((photo) => (
                <li key={photo.id} className="min-w-0">
                  <figure className="overflow-hidden rounded-lg border bg-card">
                    <div className="flex h-[min(56dvh,32rem)] items-center justify-center overflow-hidden bg-muted/40 p-2">
                      <img
                        src={photo.url}
                        alt={`第 ${photo.sequence} 款 ${photo.name} 的款式照片`}
                        decoding="async"
                        draggable={false}
                        data-sales-order-preview-image=""
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    <figcaption className="admin-wrap-anywhere border-t px-3 py-2 text-xs">
                      <span className="font-semibold">第 {photo.sequence} 款</span>
                      <span className="ml-1 text-muted-foreground">
                        · {photo.name}
                      </span>
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      ) : (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <FileImage aria-hidden="true" className="size-5" />
          <span className="sr-only">暂无款式照片</span>
        </span>
      )}
      {order.itemCount > 1 ? (
        <span className="pointer-events-none absolute -right-1.5 -bottom-1.5 rounded-full border-2 border-background bg-foreground px-1.5 py-0.5 text-xs font-semibold text-background">
          {order.itemCount}款
        </span>
      ) : null}
    </div>
  );
}

function isStylePhotoFileName(fileName: string) {
  // Playwright 打印视觉基线曾被误传到验收工单的款式图槽位。
  // 只隔离可明确识别的生成快照，不根据一般文件名猜测照片内容。
  return !/^order-print-.+-chromium-(?:darwin|linux|win32)\.png$/iu.test(
    fileName,
  );
}

// 逾期 danger、临期 warning——与 lib/ui/status-registry.ts 的
// PROMISED_DATE_ALERT_REGISTRY 同口径（§6：两档必须能区分开）。
function DueDate({ order }: { order: SalesOrderListRow }) {
  if (!order.promisedDate) return <span>交货未设置</span>;
  const shortDate = order.promisedDate.slice(5);
  if (order.dueAlert?.kind === 'overdue') {
    return (
      <span className="rounded-md bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
        交货 {shortDate} · 已超 {order.dueAlert.days} 天
      </span>
    );
  }
  if (order.dueAlert?.kind === 'due-soon') {
    return (
      <span className="font-medium text-warning-foreground">
        交货 {shortDate} ·{' '}
        {order.dueAlert.days === 0
          ? '今天到期'
          : `剩 ${order.dueAlert.days} 天`}
      </span>
    );
  }
  return <span>交货 {shortDate}</span>;
}

function SalesOrderDrawer({
  order,
  onCopy,
  onClose,
}: {
  order: SalesOrderListRow;
  onCopy: (value: string, label: string) => void;
  onClose: () => void;
}) {
  const amount = salesOrderAmountPresentation(order);
  const hasPendingAmount = order.feeLines.some((line) => line.amount === null);
  return (
    <SheetContent
      side="right"
      className="!w-full gap-0 overflow-hidden sm:!max-w-[30rem]"
    >
      <SheetHeader className="border-b pt-[max(1rem,env(safe-area-inset-top,0px))] pr-[max(4rem,calc(3rem+env(safe-area-inset-right,0px)))]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SheetTitle className="admin-wrap-anywhere min-w-0 text-lg font-semibold">
            <span className="sr-only">工单明细：</span>
            {order.customName ?? '未命名工单'}
          </SheetTitle>
          <SalesOrderStatusBadge status={order.status} />
        </div>
        <SheetDescription className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span>{order.customerRef ?? '未填客户'}</span>
          <span aria-hidden="true">·</span>
          <span className="font-sans tabular-nums">{order.orderNo}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`复制工单号 ${order.orderNo}`}
            onClick={() => onCopy(order.orderNo, '工单号')}
          >
            <Copy aria-hidden="true" />
          </Button>
          <span>v{order.revision}</span>
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto py-4 admin-safe-inline">
        <DrawerSection title="进度">
          <SalesOrderProgress status={order.status} />
          {order.pricingAttentionReason ? (
            <p className="mt-3 border-l-2 border-destructive pl-3 text-xs font-medium text-destructive">
              {order.pricingAttentionReason}
            </p>
          ) : null}
          {order.pendingChangeRequest ? (
            <div className="mt-3 rounded-lg border border-foreground/30 p-3 text-xs">
              <p className="font-semibold">{order.pendingChangeRequest.type === 'CANCEL' ? '取消申请' : '修改申请'} · 等待管理员处理</p>
              <p className="mt-1 text-muted-foreground">
                {order.pendingChangeRequest.reason}
              </p>
            </div>
          ) : null}
          {order.rejectedChangeRequest ? (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <p className="font-semibold text-destructive">{order.rejectedChangeRequest.type === 'CANCEL' ? '取消申请被拒' : '修改申请被拒'}</p>
              <p className="mt-1">{order.rejectedChangeRequest.reason}</p>
              <p className="mt-1 text-muted-foreground">
                管理员：
                {order.rejectedChangeRequest.reviewRemark ?? '未填写说明'}
              </p>
            </div>
          ) : null}
        </DrawerSection>

        <DrawerSection title={`款式 · ${order.itemCount} 款`}>
          <ul className="divide-y">
            {order.items.map((item) => (
              <li key={item.id} className="flex min-w-0 items-center gap-3 py-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                  {item.sequence}
                </span>
                <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md border bg-muted">
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail.url}
                      alt={item.thumbnail.fileName}
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-muted-foreground">
                      <FileImage aria-hidden="true" className="size-4" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="admin-wrap-anywhere text-sm font-medium">
                    {item.name}
                  </p>
                  <p
                    className="mt-0.5 truncate text-xs text-muted-foreground"
                    title={
                      [...item.crafts, item.paper, item.specification]
                        .filter(Boolean)
                        .join(' · ') || '工艺信息待补充'
                    }
                  >
                    {[...item.crafts, item.paper, item.specification]
                      .filter(Boolean)
                      .join(' · ') || '工艺信息待补充'}
                  </p>
                </div>
                <p className="shrink-0 text-right font-sans text-sm font-semibold tabular-nums">
                  {item.quantity.toLocaleString('zh-CN')}
                  <span className="block text-xs font-normal text-muted-foreground">
                    个
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </DrawerSection>

        <DrawerSection title="费用">
          {order.feeLines.length > 0 ? (
            <dl className="divide-y">
              {order.feeLines.map((line) => (
                <div key={line.id} className="flex justify-between gap-3 py-2 text-sm">
                  <dt className="min-w-0 text-muted-foreground">{line.label}</dt>
                  <dd className="shrink-0 font-sans font-medium tabular-nums">
                    {line.amount === null ? '待定' : formatMoney(line.amount)}
                    {line.estimated ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        估
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">暂无费用分项</p>
          )}
          <div className="mt-2 flex items-baseline justify-between border-t-2 border-foreground pt-3">
            <span className="text-xs font-medium text-muted-foreground">
              {!amount.pending && hasPendingAmount
                ? '已知合计（不含待定）'
                : '合计'}
            </span>
            <span
              className={cn(
                'font-sans text-xl font-semibold tabular-nums',
                amount.pending && 'text-sm text-primary',
              )}
            >
              {amount.label}
              {amount.estimated ? (
                <span className="ml-1 text-xs text-muted-foreground">估</span>
              ) : null}
            </span>
          </div>
        </DrawerSection>

        {order.shipment ? (
          <DrawerSection title="发货">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span>{order.shipment.carrier}</span>
              <span className="rounded-md bg-muted px-2 py-1 font-sans text-xs tabular-nums">
                {order.shipment.trackingNo}
              </span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onCopy(order.shipment!.trackingNo, '运单号')}
              >
                复制单号
              </Button>
            </div>
          </DrawerSection>
        ) : null}

        <DrawerSection title="收货">
          <p className="text-sm font-medium">
            {[order.receiver.name, order.receiver.phone]
              .filter(Boolean)
              .join(' · ') || '收货人未填写'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.receiver.address ?? '收货地址未填写'}
          </p>
        </DrawerSection>
      </div>

      <SheetFooter className="flex-row border-t bg-background pt-4 admin-safe-inline admin-safe-bottom">
        <Button type="button" variant="outline" onClick={onClose}>
          关闭预览
        </Button>
        <Link
          href={`/orders/${order.id}`}
          prefetch={false}
          className={cn(buttonVariants(), 'min-w-0 flex-1')}
        >
          查看完整详情
        </Link>
      </SheetFooter>
    </SheetContent>
  );
}

function SalesOrderDrawerState({
  orderNo,
  loading,
  error,
  onClose,
}: {
  orderNo: string;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <SheetContent
      side="right"
      className="!w-full gap-0 overflow-hidden sm:!max-w-[30rem]"
    >
      <SheetHeader className="border-b pt-[max(1rem,env(safe-area-inset-top,0px))] pr-[max(4rem,calc(3rem+env(safe-area-inset-right,0px)))]">
        <SheetTitle>工单明细</SheetTitle>
        <SheetDescription className="font-sans tabular-nums">
          {orderNo}
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 items-center justify-center py-6 admin-safe-inline text-center">
        {loading || !error ? (
          <p role="status" className="text-sm text-muted-foreground">
            正在加载工单明细…
          </p>
        ) : (
          <div>
            <p role="alert" className="text-sm font-medium text-destructive">
              {error || '工单不存在或无权访问'}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={onClose}
            >
              返回工单列表
            </Button>
          </div>
        )}
      </div>
    </SheetContent>
  );
}

function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-2 border-b pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

const SALES_DRAWER_HISTORY_KEY = '__salesOrderDrawer';

function orderNoFromHash(hash: string): string | null {
  if (!hash.startsWith('#')) return null;
  try {
    return new URLSearchParams(hash.slice(1)).get('wo') || null;
  } catch {
    return null;
  }
}

function drawerHistoryState(state: unknown, orderNo: string) {
  const current =
    state && typeof state === 'object'
      ? (state as Record<string, unknown>)
      : {};
  return { ...current, [SALES_DRAWER_HISTORY_KEY]: orderNo };
}

function drawerEntryOrderNo(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[SALES_DRAWER_HISTORY_KEY];
  return typeof value === 'string' ? value : null;
}
