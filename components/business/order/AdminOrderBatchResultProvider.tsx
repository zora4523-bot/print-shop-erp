'use client';

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { AdminOrderBatchActionResult } from '@/actions/admin-order-workflow';
import type { AdminOrderBatchCommand } from '@/lib/order/admin-batch';
import { ActionNotice, BatchActionResult } from '@/components/ui-business';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BATCH_COMMAND_CONFIG, batchReceiptRows, type BatchOrderSnapshot } from './admin-order-batch-ui';
import { useRefreshAfterPrint } from './use-refresh-after-print';

type BatchReceipt = {
  command: AdminOrderBatchCommand;
  orders: readonly BatchOrderSnapshot[];
  pending: boolean;
  response: AdminOrderBatchActionResult | null;
};

const BatchResultContext = createContext<{
  pending: boolean;
  begin: (command: AdminOrderBatchCommand, orders: readonly BatchOrderSnapshot[]) => void;
  complete: (response: AdminOrderBatchActionResult | null) => void;
} | null>(null);

/** Lives outside the page-keyed selection so queue refreshes cannot discard a receipt. */
export function AdminOrderBatchResultProvider({ children }: { children: ReactNode }) {
  const [receipt, setReceipt] = useState<BatchReceipt | null>(null);
  const [open, setOpen] = useState(false);
  const focusReturnRef = useRef<HTMLButtonElement | null>(null);
  const armPrintRefresh = useRefreshAfterPrint();
  const rows = receipt && !receipt.pending
    ? batchReceiptRows(receipt.command, receipt.orders, receipt.response)
    : [];
  const counts = {
    success: rows.filter((row) => row.outcome === 'success').length,
    skipped: rows.filter((row) => row.outcome === 'skipped' && row.order.eligible).length,
    excluded: rows.filter((row) => !row.order.eligible).length,
    unknown: rows.filter((row) => row.outcome === 'unknown').length,
    notAttempted: rows.filter((row) => row.outcome === 'not-attempted').length,
  };
  const summary = `成功 ${counts.success} 张，跳过 ${counts.skipped} 张，结果未知 ${counts.unknown} 张，未执行 ${counts.notAttempted} 张${counts.excluded > 0 ? `，未纳入处理 ${counts.excluded} 张` : ''}`;

  return (
    <BatchResultContext.Provider value={{
      pending: receipt?.pending ?? false,
      begin: (command, orders) => {
        setReceipt({ command, orders, pending: true, response: null });
        // Keep the pending receipt visible even if successful rows leave the queue.
        setOpen(true);
      },
      complete: (response) => {
        setReceipt((current) => current ? { ...current, pending: false, response } : null);
        setOpen(true);
      },
    }}>
      {children}
      {receipt ? (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2" data-slot="admin-order-batch-receipt-link">
          <p role="status" className="min-w-0 text-sm text-muted-foreground">
            {receipt.pending ? `正在${BATCH_COMMAND_CONFIG[receipt.command].label}，请等待处理结果…` : summary}
          </p>
          <Button ref={focusReturnRef} variant="outline" className="min-h-11" onClick={() => setOpen(true)}>
            {receipt.pending ? '查看处理进度' : '查看批量结果'}
          </Button>
        </div>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl [&_[data-slot=dialog-close]]:size-11"
          finalFocus={focusReturnRef}
        >
          <DialogHeader>
            <DialogTitle>批量处理结果</DialogTitle>
            <DialogDescription>
              {receipt ? `${BATCH_COMMAND_CONFIG[receipt.command].label} · 已选 ${receipt.orders.length} 张工单` : '工单批量操作'}
            </DialogDescription>
          </DialogHeader>
          {receipt?.pending ? (
            <ActionNotice tone="info" title="正在逐单处理…" description="请等待处理结果，勿重复提交。" />
          ) : receipt ? (
            <BatchActionResult
              status={counts.success === rows.length ? 'complete' : 'partial'}
              title={counts.success === rows.length ? '所选工单处理完成' : counts.unknown > 0 ? '部分结果需要核对' : '请处理未完成的工单'}
              succeededCount={counts.success}
              failedCount={counts.unknown}
              summary={summary}
              items={rows.map((row) => ({
                id: row.order.id,
                outcome: row.outcome,
                label: (
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <Link href={`/orders/${encodeURIComponent(row.order.id)}`} prefetch={false} className="inline-flex min-h-11 min-w-0 max-w-full items-center underline underline-offset-4">
                      {row.order.orderNo}
                    </Link>
                    <span className="text-xs font-normal text-muted-foreground">{row.label}</span>
                    {row.outcome === 'success' && (receipt.command === 'RELEASE_AND_CREATE_PRINT' || receipt.command === 'CREATE_PRINT') ? (
                      <a
                        href={`/print/orders/${encodeURIComponent(row.order.id)}?autoprint=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`去打印工单 ${row.order.orderNo}`}
                        onClick={armPrintRefresh}
                        className={buttonVariants({ variant: 'outline', className: 'min-h-11 min-w-11' })}
                      >
                        去打印
                      </a>
                    ) : null}
                  </span>
                ),
                reason: row.reason,
              }))}
            />
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="min-h-11" />}>
              {receipt?.pending ? '返回列表' : '关闭结果'}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BatchResultContext.Provider>
  );
}

export function useAdminOrderBatchResult() {
  const context = useContext(BatchResultContext);
  if (!context) throw new Error('AdminOrderBatchResultProvider is required');
  return context;
}
