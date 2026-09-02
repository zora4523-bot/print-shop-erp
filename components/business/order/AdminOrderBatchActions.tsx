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
  const [exportState, exportAction, exportPending] = useActionState<
    OrderExportActionResult | null,
    FormData
  >(requestOrderExportAction, null);
  const orderById = new Map(orders.map((order) => [order.id, order]));

  // A completed response means the request key has fulfilled its idempotency
  // purpose. Refresh the server component so a later, intentional export (or
  // a changed selection) receives a fresh UUID and cannot collide with the
  // membership snapshot that was just persisted.
  useEffect(() => {
    if (exportState?.status === 'queued' || exportState?.status === 'success') {
      router.refresh();
    }
  }, [exportState, router]);

  function run(command: AdminOrderBatchCommand) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setMessage('');
    const items = selectedItems.flatMap((selected) => {
      const order = orderById.get(selected.id);
      return order
        ? [
            {
              orderId: order.id,
              expectedRevision: order.revision,
              expectedWorkOrderVersion: order.workOrderVersion,
              ...(order.pendingPrintJobId
                ? { requestJobId: order.pendingPrintJobId }
                : {}),
            },
          ]
        : [];
    });
    startTransition(async () => {
      try {
        const result = await runAdminOrderBatchAction({
          requestId: `workspace-${globalThis.crypto.randomUUID()}`,
          command,
          items,
        });
        setMessage(resultMessage(result));
        if (
          result.status === 'partial_failure' ||
          (result.status === 'success' && result.result.successCount > 0)
        ) {
          router.refresh();
        }
      } catch {
        setMessage('批量操作未完成，请刷新列表后重试');
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => run('RELEASE_AND_CREATE_PRINT')}
      >
        下发+打印
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => run('CREATE_PRINT')}
      >
        创建打印
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => run('MARK_PRINTED')}
      >
        标记已打印
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => run('SETTLE')}
      >
        批量结算
      </Button>
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
        <Button type="submit" variant="secondary" disabled={exportPending}>
          {exportPending ? '正在提交…' : '导出所选'}
        </Button>
      </form>
      <p
        role="status"
        aria-live="polite"
        className={message ? 'basis-full text-xs text-background/80' : 'sr-only'}
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

export function resultMessage(result: AdminOrderBatchActionResult): string {
  if (result.status === 'invalid') return '批量请求不合法，请刷新后重试';
  if (result.status === 'error') return result.message;
  if (result.status === 'partial_failure') {
    return `${result.message}；成功 ${result.result.successCount} 张，业务跳过 ${result.result.skippedCount} 张，结果未知 ${result.result.failedCount} 张，未执行 ${result.result.notAttemptedCount} 张`;
  }
  const skipped = result.result.items.filter(
    (item) => item.status === 'skipped',
  );
  const summary = `成功 ${result.result.successCount} 张，跳过 ${result.result.skippedCount} 张`;
  if (skipped.length === 0) return summary;
  const details = skipped
    .slice(0, 2)
    .map((item) => `${item.code}：${item.message}`)
    .join('；');
  return `${summary}；${details}${skipped.length > 2 ? '；其余请单独检查' : ''}`;
}
