'use client';

import Link from 'next/link';
import { FileDown, Link2, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { isOrderEditable } from '@/lib/order/editable-fields';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { Button, buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { ActionNotice, StatusBadge } from '@/components/ui-business';
import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { AdminOrderDecisionPanel } from './AdminOrderDecisionPanel';
import { AdminOrderProgress } from './AdminOrderProgress';
import styles from './AdminOrderDrawer.module.css';

export function AdminOrderDrawer({
  order,
}: {
  order: AdminOrderWorkspaceRow;
}) {
  return (
    <SheetContent
      side="right"
      data-order-drawer=""
      className={styles.drawer}
      overlayClassName={styles.overlay}
    >
      <SheetHeader className={styles.header}>
        <div className={styles.heading}>
          <SheetTitle className={cn('admin-wrap-anywhere', styles.title)}>
            <span className="sr-only">工单明细：</span>
            {order.customName ?? '未命名工单'}
          </SheetTitle>
          <AdminWorkspaceStatusBadge status={order.status} />
        </div>
        <SheetDescription className={styles.meta}>
          <span className="font-mono tabular-nums">{order.orderNo}</span>
          <span>{order.customer.name}</span>
          <span>{order.submitter.name}</span>
          <span>版本 v{order.workOrderVersion}</span>
        </SheetDescription>
      </SheetHeader>

      <div data-slot="admin-order-drawer-body" className={styles.body}>
        {order.pendingChangeRequest && !order.capabilities.reviewChange ? (
          <DrawerSection title={order.pendingChangeRequest.type === 'MODIFY' ? '本次变更申请' : '本次取消申请'}>
            <p className="text-sm font-medium">{order.pendingChangeRequest.reason}</p>
          </DrawerSection>
        ) : !order.pendingChangeRequest && order.statusSummary && !['PENDING_FACTORY', 'SUBMITTED'].includes(order.status) ? (
          <p className="mb-4 text-sm font-medium">{order.statusSummary}</p>
        ) : null}

        <AdminOrderDecisionPanel order={order} compact />

        {!order.pendingChangeRequest && (
          <DrawerSection title="金额">
            <DrawerLines lines={[
              [feeSourceLabel(order.fee.source), order.fee.amount === null ? '待核定' : `¥${formatMoney(order.fee.amount)}`],
            ]} />
          </DrawerSection>
        )}

        {!order.pendingChangeRequest && ['RELEASED', 'FOILING', 'PACKING', 'IN_PRODUCTION'].includes(order.status) ? (
          <Disclosure className={styles.progress}>
            <DisclosureSummary>报工进度</DisclosureSummary>
            <div className="mt-3"><AdminOrderProgress progress={order.progress} /></div>
          </Disclosure>
        ) : null}

      <DrawerSection title="操作">
      <div data-slot="admin-order-drawer-actions" className={styles.actions}>
        <Link
          href={`/orders/${order.id}`}
          prefetch={false}
          className={buttonVariants({ variant: 'outline' })}
        >
          查看完整工单
        </Link>
        <Link
          href={`/api/orders/${order.id}/pdf`}
          prefetch={false}
          className={buttonVariants({ variant: 'outline' })}
        >
          <FileDown aria-hidden="true" />
          下载工单 PDF
        </Link>
        <OrderDeepLinkButton orderNo={order.orderNo} />
        {!order.pendingChangeRequest && shouldShowOrderEditLink(order.status) ? (
          <Link
            href={`/orders/${order.id}/edit`}
            prefetch={false}
            className={buttonVariants({ variant: 'outline' })}
          >
            <Pencil aria-hidden="true" />
            编辑工单
          </Link>
        ) : null}
      </div>
      </DrawerSection>
      </div>
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
    <SheetContent side="right" data-order-drawer="" className={styles.drawer} overlayClassName={styles.overlay}>
      <SheetHeader className={styles.header}>
        <SheetTitle className={styles.title}>工单明细</SheetTitle>
        <SheetDescription className={styles.meta}>
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
  const [failed, setFailed] = useState(false);

  async function copyDeepLink() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }
      const url = new URL(window.location.href);
      url.hash = `wo=${encodeURIComponent(orderNo)}`;
      await navigator.clipboard.writeText(url.toString());
      setFailed(false);
      setMessage('工单链接已复制');
    } catch {
      setFailed(true);
      setMessage('复制失败，请检查浏览器的剪贴板权限后重试');
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={copyDeepLink}>
        <Link2 aria-hidden="true" />
        复制链接
      </Button>
      {message ? <ActionNotice className="basis-full p-2.5 text-xs" tone={failed ? 'error' : 'success'} title={message} /> : null}
    </>
  );
}

export function AdminWorkspaceStatusBadge({
  status,
}: {
  status: AdminOrderWorkspaceRow['status'];
}) {
  return <StatusBadge
    tone={ORDER_STATUS_REGISTRY[status].tone}
    className="h-auto rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
  >{STATUS_LABELS[status]}</StatusBadge>;
}

function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section data-slot="admin-order-drawer-section" className={styles.section}>
      <h3 className={styles.sectionTitle}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function DrawerLines({ lines }: { lines: Array<[string, string]> }) {
  return (
    <dl className={styles.lines}>
      {lines.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="admin-wrap-anywhere text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const STATUS_LABELS: Record<AdminOrderWorkspaceRow['status'], string> = {
  DRAFT: '草稿',
  PENDING_FACTORY: '待处理',
  REJECTED: '已驳回',
  CONFIRMED: '待下发生产',
  ON_HOLD: '已暂停',
  RELEASED: '已下发',
  FOILING: '烫金中',
  PACKING: '打包中',
  SHIPPED: '已发货',
  SETTLED: '已结算',
  CANCELLED: '已取消',
  SUBMITTED: '待处理',
  SCHEDULING: '排产中（历史）',
  IN_PRODUCTION: '生产中（历史）',
  COMPLETED: '已完工（历史）',
  FINISHED: '已完成（历史）',
};

function feeSourceLabel(source: AdminOrderWorkspaceRow['fee']['source']) {
  switch (source) {
    case 'SETTLED':
      return '结算金额';
    case 'CONFIRMED':
      return '确认金额';
    case 'QUOTED':
      return '报价金额';
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
