'use client';

import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { AdminOrderDecisionPanel } from './AdminOrderDecisionPanel';

/** Detail-only presentation around the same guarded workflow actions used by the list. */
export function AdminOrderDetailDecision({ order, requiresPaperRecall }: {
  order: AdminOrderWorkspaceRow;
  requiresPaperRecall: boolean;
}) {
  // 业主 2026-10-02：点「打印」即记已打印，不再单独「确认已打印」。改单后补打时只提醒收回旧纸单；
  // 打印入口在共用操作面板里，打印完成回到本页时由面板刷新。
  const printPending = order.capabilities.markPrinted;
  const hasAction = Object.values(order.capabilities).some(Boolean) ||
    ['PENDING_FACTORY', 'SUBMITTED'].includes(order.status) || Boolean(order.shipDisabledReason) ||
    (order.status === 'SHIPPED' && order.feeStages.confirmed === null);

  return <div className="space-y-3">
    {!order.pendingChangeRequest && order.priceComparison ? <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
      <p className="font-semibold">{order.priceComparison.hasVersionDiff ? '价表已更新 · 确认时重新锁价' : '本次确认金额'}</p>
      <dl className="mt-2 space-y-1"><div className="flex flex-wrap justify-between gap-2"><dt>提交报价</dt><dd>{order.priceComparison.quoted.amount === null ? '待核定' : formatMoney(order.priceComparison.quoted.amount)}</dd></div>
        <div className="flex flex-wrap justify-between gap-2 font-semibold"><dt>当前确认价</dt><dd>{formatMoney(order.priceComparison.current.amount)}</dd></div></dl>
    </div> : null}
    {hasAction ? <AdminOrderDecisionPanel order={order} compact hideHeading /> : <p className="text-sm">{ORDER_STATUS_REGISTRY[order.status].label} · 暂无待办</p>}
    {printPending && requiresPaperRecall ? <p className="text-sm text-muted-foreground">改单后需打印新版 v{order.workOrderVersion}，打印后请收回旧版纸单。</p> : null}
  </div>;
}
