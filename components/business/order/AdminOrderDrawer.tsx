'use client';

import Link from 'next/link';
import { FileDown, Link2, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { isOrderEditable } from '@/lib/order/editable-fields';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { AdminOrderDecisionPanel } from './AdminOrderDecisionPanel';
import { AdminOrderProgress } from './AdminOrderProgress';

export function AdminOrderDrawer({
  order,
}: {
  order: AdminOrderWorkspaceRow;
}) {
  return (
    <SheetContent
      side="right"
      className="!w-full gap-0 overflow-hidden sm:!max-w-[32rem]"
    >
      <SheetHeader className="border-b pt-[max(1rem,env(safe-area-inset-top,0px))] pr-[max(4rem,calc(3rem+env(safe-area-inset-right,0px)))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SheetTitle className="admin-wrap-anywhere min-w-0 text-lg font-semibold">
            <span className="sr-only">工单明细：</span>
            {order.customName ?? '未命名工单'}
          </SheetTitle>
          <AdminWorkspaceStatusBadge status={order.status} />
        </div>
        <SheetDescription className="flex min-w-0 flex-wrap gap-1.5">
          <span>{order.customer.name}</span>
          <span aria-hidden="true">·</span>
          <span className="font-sans tabular-nums">{order.orderNo}</span>
          <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
            v{order.workOrderVersion}
          </span>
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto py-4 pr-[max(1rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
        {order.statusSummary ? (
          <div className="mb-5 rounded-lg border bg-muted/40 p-3 text-sm font-medium">
            {order.statusSummary}
          </div>
        ) : null}

        <DrawerSection title="基本信息">
          <DrawerLines
            lines={[
              ['客户', order.customer.name],
              ['业务员', order.submitter.name],
              ['提交时间', formatShanghai(order.submittedAt ?? order.createdAt)],
              ['承诺交期', order.promisedDate ?? '未设置'],
              ['工艺', order.craftSummary],
              ['运单号', order.trackingNo ?? '未录入'],
            ]}
          />
        </DrawerSection>

        <DrawerSection title={`款式 · ${order.itemCount} 款`}>
          <ul className="divide-y">
            {order.items.map((item) => (
              <li key={item.id} className="flex min-w-0 gap-3 py-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
                  {item.fig ?? item.sequence}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="admin-wrap-anywhere text-sm font-medium">
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {[...item.crafts, item.paper, item.specification]
                      .filter(Boolean)
                      .join(' · ') || '工艺信息待补'}
                  </p>
                </div>
                <p className="shrink-0 font-sans text-sm font-semibold tabular-nums">
                  {item.quantity.toLocaleString('zh-CN')}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    个
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </DrawerSection>

        <DrawerSection title="费用三段">
          <div className="grid grid-cols-3 gap-2">
            <FeeStageCard
              label="报价"
              field="quotedFee"
              amount={order.feeStages.quoted}
              current={order.feeStages.active === 'QUOTED'}
            />
            <FeeStageCard
              label="确认"
              field="confirmedFee"
              amount={order.feeStages.confirmed}
              current={order.feeStages.active === 'CONFIRMED'}
            />
            <FeeStageCard
              label="结算"
              field="settledFee"
              amount={order.feeStages.settled}
              current={order.feeStages.active === 'SETTLED'}
            />
          </div>
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            当前阶段：{feeSourceLabel(order.fee.source)}
          </p>
          {order.feeStages.active === 'LEGACY' ? (
            <p className="mt-2 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              该历史工单只有旧金额事实：¥
              {order.fee.amount === null ? '—' : formatMoney(order.fee.amount)}。不伪造三段快照。
            </p>
          ) : null}
          {order.fee.source === 'PENDING' ? (
            <p className="mt-2 text-xs font-medium text-destructive">
              人工核价完成前不计入列表金额合计，不伪造三段快照。
            </p>
          ) : null}
          {order.fee.source === 'INCOMPLETE' ? (
            <p className="mt-2 text-xs font-medium text-destructive">
              该工单保留了不完整报价事实，当前状态下不可核价，也不计入列表金额合计。
            </p>
          ) : null}
          {order.fee.source === 'SETTLED' ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {order.billing
                ? `已归属 ${order.billing.period} 月度账单（${billStatusLabel(order.billing.status)}）`
                : '已结算，尚未进入月度账单'}
            </p>
          ) : null}
          {order.priceComparison ? (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <PriceVersionCard
                label="提交报价"
                amount={order.priceComparison.quoted.amount}
                versions={order.priceComparison.quoted.versions}
              />
              <PriceVersionCard
                label="当前确认价"
                amount={order.priceComparison.current.amount}
                versions={order.priceComparison.current.versions}
                current
              />
              {order.priceComparison.hasVersionDiff ? (
                <p className="col-span-2 rounded-md border border-warning/40 bg-warning/10 p-2 font-medium text-foreground">
                  价表版本已变更：确认时按当前版重算锁定，原 quotedFee 快照保留。
                </p>
              ) : null}
            </div>
          ) : order.priceComparisonError ? (
            <p className="mt-2 text-xs font-medium text-destructive">
              当前价预检失败：{order.priceComparisonError}
            </p>
          ) : null}
        </DrawerSection>

        <AdminOrderDecisionPanel order={order} />

        <DrawerSection title="报工进度">
          <div className="rounded-lg border p-3">
            <AdminOrderProgress progress={order.progress} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              {order.progress.firstClaimedAt
                ? `首次扫码 ${formatShanghai(order.progress.firstClaimedAt)}`
                : '当前版本尚无有效扫码认领'}
            </p>
          </div>
        </DrawerSection>

        <DrawerSection title="动态">
          {order.logs.length > 0 ? (
            <ol className="divide-y">
              {order.logs.map((log) => (
                <li key={log.id} className="py-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{log.actorName}</span>
                    <time className="shrink-0 text-xs text-muted-foreground">
                      {formatShanghai(log.createdAt)}
                    </time>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {log.remark || log.action}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">暂无动态</p>
          )}
        </DrawerSection>
      </div>

      <SheetFooter className="flex-row flex-wrap border-t bg-background pt-4 pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
        <Link
          href={`/orders/${order.id}`}
          prefetch={false}
          className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
        >
          完整工单
        </Link>
        <Link
          href={`/api/orders/${order.id}/pdf`}
          prefetch={false}
          className={buttonVariants({ variant: 'outline' })}
        >
          <FileDown aria-hidden="true" />
          PDF
        </Link>
        <OrderDeepLinkButton orderNo={order.orderNo} />
        {shouldShowOrderEditLink(order.status) ? (
          <Link
            href={`/orders/${order.id}/edit`}
            prefetch={false}
            className={buttonVariants()}
          >
            <Pencil aria-hidden="true" />
            编辑另页
          </Link>
        ) : null}
      </SheetFooter>
    </SheetContent>
  );
}

export function AdminOrderDrawerState({
  orderNo,
  loading,
  error,
  onRetry,
  onClose,
}: {
  orderNo: string;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <SheetContent side="right" className="!w-full gap-0 sm:!max-w-[32rem]">
      <SheetHeader className="border-b">
        <SheetTitle>工单明细</SheetTitle>
        <SheetDescription className="font-sans tabular-nums">
          {orderNo}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        {loading || !error ? (
          <p role="status" className="text-sm text-muted-foreground">
            正在加载工单明细…
          </p>
        ) : (
          <div>
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={onRetry}>
                重新加载
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                返回工单列表
              </Button>
            </div>
          </div>
        )}
      </div>
    </SheetContent>
  );
}

export function shouldShowOrderEditLink(
  status: AdminOrderWorkspaceRow['status'],
): boolean {
  return isOrderEditable(status);
}

function OrderDeepLinkButton({ orderNo }: { orderNo: string }) {
  const [message, setMessage] = useState('');

  async function copyDeepLink() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }
      const url = new URL(window.location.href);
      url.hash = `wo=${encodeURIComponent(orderNo)}`;
      await navigator.clipboard.writeText(url.toString());
      setMessage('工单链接已复制');
    } catch {
      setMessage('复制失败，请检查浏览器的剪贴板权限后重试');
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={copyDeepLink}>
        <Link2 aria-hidden="true" />
        复制链接
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {message}
      </span>
    </>
  );
}

export function AdminWorkspaceStatusBadge({
  status,
}: {
  status: AdminOrderWorkspaceRow['status'];
}) {
  return <Badge variant="outline">{STATUS_LABELS[status]}</Badge>;
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

function DrawerLines({ lines }: { lines: Array<[string, string]> }) {
  return (
    <dl className="divide-y">
      {lines.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 py-2 text-sm">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="admin-wrap-anywhere text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PriceVersionCard({
  label,
  amount,
  versions,
  current = false,
}: {
  label: string;
  amount: string | null;
  versions: {
    processing: { version: number } | null;
    logistics: { version: number } | null;
  };
  current?: boolean;
}) {
  return (
    <div className={cn('rounded-lg border p-2.5', current && 'border-foreground bg-background')}>
      <p className="font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 font-sans text-base font-semibold tabular-nums">
        {amount === null ? '—' : `¥${formatMoney(amount)}`}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        加工 v{versions.processing?.version ?? '—'} · 物流 v{versions.logistics?.version ?? '—'}
      </p>
    </div>
  );
}

function FeeStageCard({
  label,
  field,
  amount,
  current,
}: {
  label: string;
  field: string;
  amount: string | null;
  current: boolean;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border p-2.5',
        current && 'border-foreground bg-foreground text-background',
      )}
      aria-current={current ? 'step' : undefined}
    >
      <p className={cn('text-xs font-semibold', !current && 'text-muted-foreground')}>
        {label}
      </p>
      <p className="mt-1 break-all font-sans text-sm font-semibold tabular-nums">
        {amount === null ? '—' : `¥${formatMoney(amount)}`}
      </p>
      <p className={cn('mt-1 break-all text-[9px]', current ? 'text-background/70' : 'text-muted-foreground')}>
        {field}
      </p>
    </div>
  );
}

const STATUS_LABELS: Record<AdminOrderWorkspaceRow['status'], string> = {
  DRAFT: '草稿',
  PENDING_FACTORY: '待确认',
  REJECTED: '已驳回',
  CONFIRMED: '已确认',
  ON_HOLD: '已暂停',
  RELEASED: '已下发',
  FOILING: '烫金中',
  PACKING: '打包中',
  SHIPPED: '已发货',
  SETTLED: '已结算',
  CANCELLED: '已取消',
  SUBMITTED: '待确认（历史）',
  SCHEDULING: '排产中（历史）',
  IN_PRODUCTION: '生产中（历史）',
  COMPLETED: '已完工（历史）',
  FINISHED: '已完成（历史）',
};

function feeSourceLabel(source: AdminOrderWorkspaceRow['fee']['source']) {
  switch (source) {
    case 'SETTLED':
      return '结算 settledFee';
    case 'CONFIRMED':
      return '确认 confirmedFee';
    case 'QUOTED':
      return '报价 quotedFee';
    case 'LEGACY':
      return '历史金额';
    case 'PENDING':
      return '人工核价';
    case 'INCOMPLETE':
      return '金额不完整（未计入）';
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

function billStatusLabel(status: NonNullable<AdminOrderWorkspaceRow['billing']>['status']) {
  switch (status) {
    case 'DRAFT':
      return '草稿';
    case 'CONFIRMED':
      return '待收款';
    case 'PAID':
      return '已收款';
  }
}
