'use client';

import {
  useActionState,
  useRef,
  useState,
  useTransition,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BatchPrintControls } from './BatchPrintControls';
import { ChevronDown } from 'lucide-react';
import {
  runAdminOrderBatchAction,
  type AdminOrderBatchActionResult,
} from '@/actions/admin-order-workflow';
import {
  requestOrderExportAction,
  type OrderExportActionResult,
} from '@/actions/order-export';
import type { AdminOrderBatchCommand } from '@/lib/order/admin-batch';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import type { OrderListSelectionItem } from './OrderListBatchSelection';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import { useAdminOrderBatchResult } from './AdminOrderBatchResultProvider';
import {
  BATCH_COMMAND_CONFIG,
  batchConfirmationImpact,
  batchFailureReason,
  snapshotBatchSelection,
  type BatchOrderSnapshot,
} from './admin-order-batch-ui';

export function AdminOrderBatchActions({
  orders,
  selectedItems,
  selectedExportRequestKey,
}: {
  orders: readonly AdminOrderWorkspaceRow[];
  selectedItems: readonly OrderListSelectionItem[];
  selectedExportRequestKey: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inFlightRef = useRef(false);
  const [message, setMessage] = useState('');
  const batchResult = useAdminOrderBatchResult();
  const [confirmation, setConfirmation] = useState<{
    command: AdminOrderBatchCommand;
    orders: BatchOrderSnapshot[];
  } | null>(null);
  const focusReturnRef = useRef<HTMLButtonElement | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [exportState, exportAction, exportPending] = useActionState<
    OrderExportActionResult | null,
    FormData
  >(requestOrderExportAction, null);
  const busy = pending || batchResult.pending || exportPending;

  // A completed export request has fulfilled its idempotency key. The action
  // revalidates /orders on every queued/success branch, so its response
  // already carries a fresh render with a new UUID; no extra router.refresh()
  // (DECISIONS 2026-08-27).

  function run(command: AdminOrderBatchCommand, reviewedOrders: BatchOrderSnapshot[]) {
    if (inFlightRef.current) return;
    const eligible = reviewedOrders.filter((order) => order.eligible);
    if (eligible.length === 0) return;
    inFlightRef.current = true;
    setMessage('');
    const items = eligible.map((order) => ({
      orderId: order.id,
      expectedRevision: order.revision,
      expectedWorkOrderVersion: order.workOrderVersion,
      ...(order.pendingPrintJobId ? { requestJobId: order.pendingPrintJobId } : {}),
    }));
    batchResult.begin(command, reviewedOrders);
    startTransition(async () => {
      try {
        const result = await runAdminOrderBatchAction({
          requestId: `workspace-${globalThis.crypto.randomUUID()}`,
          command,
          items,
        });
        setMessage(resultMessage(result, reviewedOrders.length - eligible.length));
        batchResult.complete(result);
        // Success already revalidated /orders in the action response. Only
        // the result-unknown branch forces a second read (DECISIONS 2026-08-27).
        if (result.status === 'partial_failure') router.refresh();
      } catch {
        setMessage('未能确认批量处理结果，请先打开工单核对实际记录，再决定是否重试');
        batchResult.complete(null);
        router.refresh();
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  const commandOptions = (Object.keys(BATCH_COMMAND_CONFIG) as AdminOrderBatchCommand[])
    .map((command) => {
      const reviewedOrders = snapshotBatchSelection(command, selectedItems, orders);
      return {
        command,
        config: BATCH_COMMAND_CONFIG[command],
        reviewedOrders,
        count: reviewedOrders.filter((order) => order.eligible).length,
      };
    })
    .filter(({ count }) => count > 0);
  const primaryOptions = commandOptions.filter(({ command }) => command !== 'CREATE_PRINT');
  const printOption = commandOptions.find(({ command }) => command === 'CREATE_PRINT');
  const controls = (
    <BatchPrintControls selectedItems={selectedItems} disabled={busy} renderLayout={(printAction, printResult) => (
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {primaryOptions.map(({ command, config, reviewedOrders, count }) => (
            <Button
              key={command}
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={(event) => {
                focusReturnRef.current = event.currentTarget;
                setConfirmation({ command, orders: reviewedOrders });
              }}
            >
              {config.label}（{count}）
            </Button>
          ))}
          {printOption ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                ref={moreTriggerRef}
                render={<Button type="button" variant="secondary" className="min-h-11" disabled={busy} />}
              >
                更多操作
                <ChevronDown aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48" finalFocus={confirmation ? false : moreTriggerRef}>
                <DropdownMenuItem
                  disabled={busy}
                  onClick={() => {
                    focusReturnRef.current = moreTriggerRef.current;
                    setConfirmation({ command: printOption.command, orders: printOption.reviewedOrders });
                  }}
                >
                  {printOption.config.label}（{printOption.count}）
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {printAction}
          <form action={exportAction} aria-busy={exportPending}>
            <input type="hidden" name="scope" value="selected" />
            <input
              type="hidden"
              name="requestKey"
              value={selectedExportRequestKey}
            />
            <input type="hidden" name="params" value="{}" />
            {selectedItems.map((item) => (
              <input
                key={item.id}
                type="hidden"
                name="selectedOrderId"
                value={item.id}
              />
            ))}
            <Button type="submit" variant="secondary" className="min-h-11" disabled={busy}>
              {exportPending ? '正在提交…' : '导出所选'}
            </Button>
          </form>
        </div>
        {printResult}
      </div>
    )} />
  );

  return (
    <>
      <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">{controls}</div>
      {selectedItems.length > 0 && selectedItems.length <= 20 && <Link className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium" href={`/orders/production?ids=${selectedItems.map(item => encodeURIComponent(item.id)).join(',')}`}>安排生产师傅</Link>}
      <ConfirmActionController level="L2"
        open={confirmation !== null}
        onOpenChange={(open) => { if (!open) setConfirmation(null); }}
        focusReturnRef={focusReturnRef}
        disabled={busy}
        className="[&_button]:min-h-11"
        onConfirm={() => {
          if (confirmation) run(confirmation.command, confirmation.orders);
          setConfirmation(null);
        }}>
        <ConfirmActionDialog action={confirmation ? BATCH_COMMAND_CONFIG[confirmation.command].confirmLabel : '批量处理所选工单'} changes={[]} consequences={confirmation ? batchConfirmationImpact(confirmation.command, confirmation.orders) : []} confirmText={confirmation ? BATCH_COMMAND_CONFIG[confirmation.command].confirmLabel : '批量处理所选工单'} />
      </ConfirmActionController>
      <p
        role="status"
        aria-live="polite"
        className={message || pending ? 'basis-full text-xs text-background/80' : 'sr-only'}
      >
        {pending ? '正在逐单处理…' : message}
      </p>
      {exportState ? (
        <p
          role={
            exportState.status === 'invalid' || exportState.status === 'error'
              ? 'alert'
              : 'status'
          }
          className="basis-full text-xs text-background/80"
        >
          {exportResultMessage(exportState)}
        </p>
      ) : null}
    </>
  );
}

function exportResultMessage(result: OrderExportActionResult): string {
  switch (result.status) {
    case 'queued':
      return '所选工单已进入导出队列。';
    case 'success':
      return '所选工单导出已生成。';
    case 'invalid':
    case 'error':
      return result.message;
  }
}

export function resultMessage(result: AdminOrderBatchActionResult, excludedCount = 0): string {
  if (result.status === 'invalid') return '批量请求不合法，请刷新后重试';
  if (result.status === 'error') return batchFailureReason(result.code);
  return `成功 ${result.result.successCount} 张，业务跳过 ${result.result.skippedCount} 张，结果未知 ${result.result.failedCount} 张，未执行 ${result.result.notAttemptedCount} 张${excludedCount > 0 ? `，未纳入处理 ${excludedCount} 张` : ''}`;
}
