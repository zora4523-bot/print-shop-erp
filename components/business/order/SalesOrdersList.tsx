'use client';

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import {
  Copy,
  FileImage,
  PackageCheck,
  Pencil,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { OrderStatus } from '@/generated/prisma/enums';
import type { OrderListQuery } from '@/lib/order/list-query';
import type { SalesOrderListRow } from '@/lib/order/sales-list-query';
import {
  formatMoney,
  formatSalesOrderUpdatedAt,
  salesOrderAmountPresentation,
  salesOrderPrimaryAction,
  salesOrderStatusPresentation,
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
import { EmptyState } from '@/components/ui-business';

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
  const [copyFeedback, setCopyFeedback] = useState('');
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
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(`已复制${label} ${value}`);
    } catch {
      setCopyFeedback(`${label}复制失败，请手动选择复制`);
    }
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
            copyFeedback={copyFeedback}
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
        {copyFeedback}
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
  const status = salesOrderStatusPresentation(order.status);
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
            className="admin-wrap-anywhere h-auto min-w-0 justify-start whitespace-normal p-0 text-left text-sm font-semibold sm:text-[15px]"
          >
            {order.customName ?? '未命名工单'}
          </Button>
          <span className="admin-wrap-anywhere text-xs font-medium text-muted-foreground">
            {order.customerRef ?? '未填客户'}
          </span>
          {order.pendingChangeRequest ? (
            <Badge variant="outline" className="border-foreground/60">
              修改申请中
            </Badge>
          ) : null}
          {order.isUrgent ? <Badge variant="destructive">急单</Badge> : null}
        </div>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
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
            修改申请被拒 ·{' '}
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
        <SalesStatusBadge label={status.label} tone={status.tone} />
        <div className="min-w-0 text-right">
          <p
            className={cn(
              'font-sans text-sm font-semibold tabular-nums sm:text-base',
              amount.pending && 'max-w-28 text-xs text-destructive sm:text-xs',
            )}
          >
            {amount.label}
            {!amount.pending && hasPendingAmount ? (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                不含待定
              </span>
            ) : null}
            {amount.estimated ? (
              <span className="ml-1 text-[10px] text-muted-foreground">估</span>
            ) : null}
          </p>
        </div>
        <Button
          type="button"
          variant={order.needsAction ? 'destructive' : 'outline'}
          size="sm"
          onClick={onOpen}
          className="min-h-9 px-3"
        >
          {salesOrderPrimaryAction(order)}
        </Button>
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
        <span className="pointer-events-none absolute -right-1.5 -bottom-1.5 rounded-full border-2 border-background bg-foreground px-1.5 py-0.5 text-[9px] font-semibold text-background">
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

function DueDate({ order }: { order: SalesOrderListRow }) {
  if (!order.promisedDate) return <span>交货未设置</span>;
  const shortDate = order.promisedDate.slice(5);
  if (order.dueAlert?.kind === 'overdue') {
    return (
      <span className="rounded bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
        交货 {shortDate} · 已超 {order.dueAlert.days} 天
      </span>
    );
  }
  if (order.dueAlert?.kind === 'due-soon') {
    return (
      <span className="font-medium text-destructive">
        交货 {shortDate} ·{' '}
        {order.dueAlert.days === 0
          ? '今天到期'
          : `剩 ${order.dueAlert.days} 天`}
      </span>
    );
  }
  return <span>交货 {shortDate}</span>;
}

function SalesStatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: ReturnType<typeof salesOrderStatusPresentation>['tone'];
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        tone === 'muted' && 'border-muted bg-muted text-muted-foreground',
        tone === 'outline' && 'border-foreground/70',
        tone === 'production' &&
          'border-foreground bg-foreground text-background',
        tone === 'shipped' &&
          'border-success/40 bg-success/10 text-success-foreground',
        tone === 'attention' &&
          'border-destructive/40 bg-destructive/10 text-destructive',
      )}
    >
      {label}
    </Badge>
  );
}

function SalesOrderDrawer({
  order,
  copyFeedback,
  onCopy,
  onClose,
}: {
  order: SalesOrderListRow;
  copyFeedback: string;
  onCopy: (value: string, label: string) => void;
  onClose: () => void;
}) {
  const status = salesOrderStatusPresentation(order.status);
  const amount = salesOrderAmountPresentation(order);
  const hasPendingAmount = order.feeLines.some((line) => line.amount === null);
  const hasOperations =
    order.status === OrderStatus.SUBMITTED ||
    order.status === OrderStatus.SCHEDULING ||
    order.status === OrderStatus.IN_PRODUCTION ||
    order.status === OrderStatus.COMPLETED;
  return (
    <SheetContent
      side="right"
      className="!w-full gap-0 overflow-hidden sm:!max-w-[30rem]"
    >
      <SheetHeader className="border-b pt-[max(1rem,env(safe-area-inset-top,0px))] pr-[max(4rem,calc(3rem+env(safe-area-inset-right,0px)))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SheetTitle className="admin-wrap-anywhere min-w-0 text-lg font-semibold">
            <span className="sr-only">工单明细：</span>
            {order.customName ?? '未命名工单'}
          </SheetTitle>
          <SalesStatusBadge label={status.label} tone={status.tone} />
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

      <div className="min-h-0 flex-1 overflow-y-auto py-4 pr-[max(1rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
        <DrawerSection title="进度">
          <OrderProgress order={order} />
          {order.pricingAttentionReason ? (
            <p className="mt-3 border-l-2 border-destructive pl-3 text-xs font-medium text-destructive">
              {order.pricingAttentionReason}
            </p>
          ) : null}
          {order.pendingChangeRequest ? (
            <div className="mt-3 rounded-lg border border-foreground/30 p-3 text-xs">
              <p className="font-semibold">修改申请 · 等待管理员处理</p>
              <p className="mt-1 text-muted-foreground">
                {order.pendingChangeRequest.reason}
              </p>
            </div>
          ) : null}
          {order.rejectedChangeRequest ? (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <p className="font-semibold text-destructive">修改申请被拒</p>
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
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
                  {item.sequence}
                </span>
                <div className="h-12 w-9 shrink-0 overflow-hidden rounded border bg-muted">
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
                    className="mt-0.5 truncate text-[11px] text-muted-foreground"
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
                  <span className="block text-[10px] font-normal text-muted-foreground">
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
                    {line.amount === null ? '待定' : `¥${formatMoney(line.amount)}`}
                    {line.estimated ? (
                      <span className="ml-1 text-[10px] text-muted-foreground">
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
                amount.pending && 'text-sm text-destructive',
              )}
            >
              {amount.label}
              {amount.estimated ? (
                <span className="ml-1 text-[10px] text-muted-foreground">估</span>
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

      <SheetFooter className="flex-row border-t bg-background pt-4 pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
        {order.status === OrderStatus.DRAFT ? (
          <Link
            href={`/orders/${order.id}`}
            prefetch={false}
            className={cn(buttonVariants(), 'flex-1')}
          >
            <Pencil aria-hidden="true" />
            继续填写
          </Link>
        ) : hasOperations ? (
          <Link
            href={`/orders/${order.id}#change-request`}
            prefetch={false}
            className={cn(
              buttonVariants({
                variant: order.needsAction ? 'destructive' : 'default',
              }),
              'flex-1',
            )}
          >
            {order.needsAction ? '处理此工单' : '工单操作'}
          </Link>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onClose}
          >
            关闭详情
          </Button>
        )}
      </SheetFooter>
      <p className="sr-only" role="status" aria-live="polite">
        {copyFeedback}
      </p>
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
      <SheetHeader className="border-b pt-[max(1rem,env(safe-area-inset-top,0px))] pr-[max(4rem,calc(3rem+env(safe-area-inset-right,0px)))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
        <SheetTitle>工单明细</SheetTitle>
        <SheetDescription className="font-sans tabular-nums">
          {orderNo}
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 items-center justify-center py-6 pr-[max(1.5rem,env(safe-area-inset-right,0px))] pl-[max(1.5rem,env(safe-area-inset-left,0px))] text-center">
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
      <h3 className="mb-2 border-b pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function OrderProgress({ order }: { order: SalesOrderListRow }) {
  if (order.status === OrderStatus.CANCELLED) {
    return <p className="text-sm text-muted-foreground">工单已取消</p>;
  }
  const steps = ['已提交', '工厂处理', '生产', '发货', '完成'];
  const current =
    order.status === OrderStatus.DRAFT
      ? -1
      : order.status === OrderStatus.SUBMITTED
        ? 0
        : order.status === OrderStatus.SCHEDULING
          ? 1
          : order.status === OrderStatus.IN_PRODUCTION ||
              order.status === OrderStatus.COMPLETED
            ? 2
            : order.status === OrderStatus.SHIPPED
              ? 3
              : 4;
  return (
    <ol aria-label="工单进度" className="grid grid-cols-5">
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? 'step' : undefined}
          className={cn(
            'relative text-center text-[10px] text-muted-foreground before:mx-auto before:mb-1.5 before:block before:size-2.5 before:rounded-full before:border before:border-muted-foreground/30 before:bg-muted after:absolute after:left-[calc(50%+0.45rem)] after:right-[calc(-50%+0.45rem)] after:top-[0.28rem] after:h-px after:bg-border last:after:hidden',
            index < current &&
              'text-foreground before:border-foreground before:bg-foreground after:bg-foreground',
            index === current &&
              'font-medium text-foreground before:border-destructive before:bg-destructive',
          )}
        >
          {step}
        </li>
      ))}
    </ol>
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
