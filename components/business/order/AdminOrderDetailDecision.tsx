'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { runAdminOrderBatchAction } from '@/actions/admin-order-workflow';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ActionNotice } from '@/components/ui-business';
import { AdminOrderDecisionPanel } from './AdminOrderDecisionPanel';

/** Detail-only presentation around the same guarded workflow actions used by the list. */
export function AdminOrderDetailDecision({ order, requiresPaperRecall }: {
  order: AdminOrderWorkspaceRow;
  requiresPaperRecall: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [recalled, setRecalled] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [resultUnknown, setResultUnknown] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const requiresRecall = requiresPaperRecall && order.capabilities.markPrinted;
  const panelOrder = requiresRecall ? { ...order, capabilities: { ...order.capabilities, markPrinted: false } } : order;
  const hasAction = Object.values(order.capabilities).some(Boolean) ||
    ['PENDING_FACTORY', 'SUBMITTED'].includes(order.status) || Boolean(order.shipDisabledReason) ||
    (order.status === 'SHIPPED' && order.feeStages.confirmed === null);

  function markPrinted() {
    if (!recalled || !order.pendingPrintJobId || inFlight.current || resultUnknown) return;
    inFlight.current = true;
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await runAdminOrderBatchAction({
          requestId: `detail-print-${crypto.randomUUID()}`,
          command: 'MARK_PRINTED',
          items: [{ orderId: order.id, expectedRevision: order.revision,
            expectedWorkOrderVersion: order.workOrderVersion, requestJobId: order.pendingPrintJobId! }],
        });
        if (result.status === 'success') {
          const item = result.result.items[0];
          if (item?.status === 'success') {
            setNotice({ tone: 'success', text: `已标记 v${order.workOrderVersion} 打印完成` });
            setOpen(false);
          } else setNotice({ tone: 'warning', text: item?.message ?? '本次未执行，请刷新工单核对。' });
          router.refresh();
        } else if (result.status === 'partial_failure') {
          setResultUnknown(true);
          setNotice({ tone: 'warning', text: '打印结果尚未确认，请刷新工单核对后再处理。' });
          router.refresh();
        } else setNotice({ tone: 'error', text: result.status === 'invalid'
          ? '打印信息已变化，请刷新后重试。' : result.message });
      } catch {
        setResultUnknown(true);
        setNotice({ tone: 'warning', text: '打印结果尚未确认，请刷新工单核对后再处理。' });
      } finally { inFlight.current = false; }
    });
  }

  return <div className="space-y-3">
    {!order.pendingChangeRequest && order.priceComparison ? <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
      <p className="font-semibold">{order.priceComparison.hasVersionDiff ? '价表已更新 · 确认时重新锁价' : '本次确认金额'}</p>
      <dl className="mt-2 space-y-1"><div className="flex flex-wrap justify-between gap-2"><dt>提交报价</dt><dd>{order.priceComparison.quoted.amount === null ? '待核定' : formatMoney(order.priceComparison.quoted.amount)}</dd></div>
        <div className="flex flex-wrap justify-between gap-2 font-semibold"><dt>当前确认价</dt><dd>{formatMoney(order.priceComparison.current.amount)}</dd></div></dl>
    </div> : null}
    {hasAction ? <AdminOrderDecisionPanel order={panelOrder} compact /> : <p className="text-sm">{ORDER_STATUS_REGISTRY[order.status].label} · 暂无待办</p>}
    {requiresRecall ? <Dialog open={open} onOpenChange={(value) => { if (pending) return; setOpen(value); if (value) { setRecalled(false); setNotice(null); } }}>
      <DialogTrigger render={<Button type="button" variant="outline" disabled={pending || resultUnknown || !order.pendingPrintJobId}>标记已打印</Button>} />
      <DialogContent>
        <DialogTitle>标记 v{order.workOrderVersion} 已打印</DialogTitle>
        <DialogDescription>请先核对本次打印件，并收回此前纸质工单，避免车间继续使用旧单。</DialogDescription>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm">
          <Checkbox checked={recalled} onCheckedChange={(value) => setRecalled(value === true)} disabled={pending} />
          我已收回并作废此前纸质工单
        </label>
        {notice ? <ActionNotice tone={notice.tone} title={notice.text} /> : null}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => setOpen(false)}>取消</Button>
          <Button type="button" className="min-h-11" disabled={!recalled || pending || resultUnknown} onClick={markPrinted}>{pending ? '正在保存…' : '确认打印完成'}</Button></div>
      </DialogContent>
    </Dialog> : null}
    {notice && !open ? <ActionNotice tone={notice.tone} title={notice.text} /> : null}
    {resultUnknown ? <Button type="button" variant="outline" onClick={() => window.location.reload()}>刷新核对打印结果</Button> : null}
  </div>;
}
