'use client';

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
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
import { ConfirmActionDialog, DisabledReason } from '@/components/ui-business';
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
  const [exportState, exportAction, exportPending] = useActionState<
    OrderExportActionResult | null,
    FormData
  >(requestOrderExportAction, null);
  const busy = pending || batchResult.pending || exportPending;

  // A completed response means the request key has fulfilled its idempotency
  // purpose. Refresh the server component so a later, intentional export (or
  // a changed selection) receives a fresh UUID and cannot collide with the
  // membership snapshot that was just persisted.
  useEffect(() => {
    if (exportState?.status === 'queued' || exportState?.status === 'success') {
      router.refresh();
    }
  }, [exportState, router]);

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
        if (
          result.status === 'partial_failure' ||
          (result.status === 'success' && result.result.successCount > 0)
        ) {
          router.refresh();
        }
      } catch {
        setMessage('未能确认批量处理结果，请先打开工单核对实际记录，再决定是否重试');
        batchResult.complete(null);
        router.refresh();
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  return (
    <>
      {(Object.keys(BATCH_COMMAND_CONFIG) as AdminOrderBatchCommand[]).map((command) => {
        const config = BATCH_COMMAND_CONFIG[command];
        const reviewedOrders = snapshotBatchSelection(command, selectedItems, orders);
        const count = reviewedOrders.filter((order) => order.eligible).length;
        const button = (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={busy || count === 0}
            onClick={(event) => {
              focusReturnRef.current = event.currentTarget;
              setConfirmation({ command, orders: reviewedOrders });
            }}
          >
            {config.label}（{count}）
          </Button>
        );
        return count > 0 ? <span key={command}>{button}</span> : (
          <DisabledReason
            key={command}
            cause="prerequisite"
            reason={config.prerequisite}
            className="[&_[data-slot=disabled-reason-copy]]:text-xs [&_[data-slot=disabled-reason-copy]]:text-background/80"
          >
            {button}
          </DisabledReason>
        );
      })}
      <ConfirmActionDialog
        level="L2"
        open={confirmation !== null}
        onOpenChange={(open) => { if (!open) setConfirmation(null); }}
        focusReturnRef={focusReturnRef}
        title={confirmation ? `确认${BATCH_COMMAND_CONFIG[confirmation.command].label}` : '确认批量操作'}
        description={confirmation ? `已选 ${confirmation.orders.length} 张，本次可处理 ${confirmation.orders.filter((order) => order.eligible).length} 张，其余不纳入处理。` : ''}
        impactItems={confirmation ? batchConfirmationImpact(confirmation.command, confirmation.orders) : []}
        confirmLabel={confirmation ? `确认${BATCH_COMMAND_CONFIG[confirmation.command].label}` : '确认操作'}
        disabled={busy}
        className="[&_button]:min-h-11"
        onConfirm={() => {
          if (confirmation) run(confirmation.command, confirmation.orders);
          setConfirmation(null);
        }}
      />
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
