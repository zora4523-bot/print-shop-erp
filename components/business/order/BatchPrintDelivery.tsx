'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { recordBatchPrintAction } from '@/actions/order-print-record';
import { deliverPrintFile, fetchPrintFile, openBlankPrintTab } from './print-file-navigation';
import { announcePrintRecorded, refreshPageAfterPrint } from './use-refresh-after-print';

export type BatchPrintTask = { id: string; labels: string[]; orderIds: string[] };
type Delivery = 'download' | 'inline';
/**
 * 一次失败交付的重试依据：沿用同一任务与打印尝试。记录时网络中断（结果未知）则文件已交付、
 * 保留尝试，重试只补记录（同一尝试重放，不会重复记录）。
 */
type DeliveryRetry = { delivery: Delivery; task: BatchPrintTask; attemptId: string; blob: Blob | null; delivered: boolean };
type DeliveryState =
  | { status: 'saving'; phase: 'fetching' | 'recording'; count: number }
  | { status: 'saved'; marked: number; downloadedInstead: boolean }
  | { status: 'failed'; message: string; retry: DeliveryRetry };

const BatchPrintDeliveryContext = createContext<{
  busy: boolean;
  deliver: (delivery: Delivery, task: BatchPrintTask) => void;
} | null>(null);

/**
 * 批量打印文件的交付（业主 2026-10-02 点打印即记已打印）：先取得文件，再整批记录，记录成功才把
 * 已取得的文件交给管理员；任一步失败都留在原处说明原因，可重试，不会出现没拿到文件却已记录。
 *
 * 放在列表外、不随选择与队列刷新重建：记录成功后已打印的工单移出待打印队列、勾选清空，交付进度
 * 与失败重试仍在这里。离开列表时中止尚未取完的文件；记录成功或结果未知（网络中断）时照样把已
 * 取得的文件交给管理员——预览标签页被拦截就改为下载——所以不会出现记上了却拿不到文件；只有明确
 * 没记上（内容已变、文件过期等）才不交付。
 */
export function BatchPrintDeliveryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<DeliveryState | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const fetchAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; fetchAbort.current?.abort(); };
  }, []);

  const run = useCallback((delivery: Delivery, task: BatchPrintTask, retry?: Pick<DeliveryRetry, 'attemptId' | 'blob' | 'delivered'>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const attemptId = retry?.attemptId ?? crypto.randomUUID();
    // 预览的新标签页须在点击当下打开，避免文件取得后再开被浏览器当作弹窗拦截；只补记录时不开。
    const tab = delivery === 'inline' && !retry?.delivered ? openBlankPrintTab() : null;
    const controller = new AbortController();
    fetchAbort.current = controller;
    const show = (next: DeliveryState) => { if (mounted.current) setState(next); };
    let delivered = retry?.delivered ?? false;
    const fail = (message: string, blob: Blob | null) => {
      // 文件已交付到预览标签页时不能关掉它。
      if (!delivered) tab?.close();
      show({ status: 'failed', message, retry: { delivery, task, attemptId, blob, delivered } });
    };
    const handOver = (blob: Blob) => {
      if (delivered) return false;
      delivered = true;
      return deliverPrintFile(blob, delivery, tab, `orders-${task.id}.pdf`) === 'downloaded-instead';
    };
    show({ status: 'saving', phase: retry?.blob ? 'recording' : 'fetching', count: task.orderIds.length });
    void (async () => {
      try {
        let blob = retry?.blob ?? null;
        if (!blob) {
          const file = await fetchPrintFile(`/api/orders/batch-print/${task.id}?view=${delivery}`, controller.signal);
          if (!file.ok) return fail(file.message, null);
          blob = file.blob;
          show({ status: 'saving', phase: 'recording', count: task.orderIds.length });
        }
        let result: Awaited<ReturnType<typeof recordBatchPrintAction>>;
        try {
          result = await recordBatchPrintAction({ jobId: task.id, attemptId });
        } catch {
          // 结果未知：可能已记上，照样交付文件，保留尝试供只补记录的重试。
          handOver(blob);
          return fail('打印记录结果未知（网络异常）', blob);
        }
        if (result.status !== 'success') return fail(result.message, null);
        const downloadedInstead = handOver(blob);
        show({ status: 'saved', marked: result.marked, downloadedInstead });
        announcePrintRecorded(task.orderIds);
        if (mounted.current) refreshPageAfterPrint(router);
      } finally {
        if (fetchAbort.current === controller) fetchAbort.current = null;
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    })();
  }, [router]);

  const deliver = useCallback((delivery: Delivery, task: BatchPrintTask) => run(delivery, task), [run]);

  return (
    <BatchPrintDeliveryContext.Provider value={{ busy, deliver }}>
      {children}
      {state ? (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 [overflow-wrap:anywhere]" data-slot="batch-print-delivery">
          {state.status === 'saving' ? <>
            <span role="status" className="text-sm">
              {state.phase === 'fetching' ? `正在取得打印文件（${state.count} 单）…` : `正在记为已打印（${state.count} 单）…`}
            </span>
            {state.phase === 'fetching' ? <Button type="button" variant="secondary" className="min-h-11" onClick={() => fetchAbort.current?.abort()}>取消</Button> : null}
          </> : null}
          {state.status === 'saved' && state.marked > 0 ? <span role="status" className="text-sm">已记为已打印 {state.marked} 单。</span> : null}
          {state.status === 'saved' && state.downloadedInstead ? <span className="text-sm">浏览器未能打开新标签页，已改为下载打印文件。</span> : null}
          {state.status === 'failed' ? <>
            <span role="alert" className="text-sm text-destructive">
              {state.retry.delivered ? `打印文件已交付，${state.message}` : `未能取得打印文件：${state.message}`}
            </span>
            <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => run(state.retry.delivery, state.retry.task, state.retry)}>
              {state.retry.delivered ? '重试记录' : state.retry.delivery === 'inline' ? '重试打开' : '重试下载'}
            </Button>
          </> : null}
        </div>
      ) : null}
    </BatchPrintDeliveryContext.Provider>
  );
}

export function useBatchPrintDelivery() {
  const context = useContext(BatchPrintDeliveryContext);
  if (!context) throw new Error('BatchPrintDeliveryProvider is required');
  return context;
}
