'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { requestBatchPrintAction } from '@/actions/order-batch-print';
import { recordBatchPrintAction } from '@/actions/order-print-record';
import { navigateToPrintFile, openBlankPrintTab } from './print-file-navigation';
import { announcePrintRecorded } from './use-refresh-after-print';
import { BATCH_PRINT_MAX, type BatchPrintIssue, type BatchPrintStatus } from '@/lib/order/batch-print-contract';
import type { OrderListSelectionItem } from './OrderListBatchSelection';

type Task = { id: string; labels: string[]; orderIds: string[] };
type Delivery = 'download' | 'inline';
type PrintRecord = { status: 'saving' } | { status: 'saved'; marked: number } | { status: 'failed'; message: string; delivery: Delivery };

export function BatchPrintControls({ selectedItems, disabled, renderLayout }: {
  selectedItems: readonly OrderListSelectionItem[];
  disabled?: boolean;
  renderLayout?: (action: ReactNode, result: ReactNode) => ReactNode;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [status, setStatus] = useState<BatchPrintStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [issues, setIssues] = useState<BatchPrintIssue[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [pollKey, setPollKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState('');
  const refreshInFlight = useRef(false);
  const inFlight = useRef(false);
  const router = useRouter();
  const [printRecord, setPrintRecord] = useState<PrintRecord | null>(null);
  const recordInFlight = useRef(false);

  // 业主 2026-10-02：打开或下载打印文件即记已打印。先确认文件可取、内容未变并整批记录，成功后才
  // 打开 / 下载（下载接口本身只读）；失败留在本页说明原因，可重试，不会出现没拿到文件却已记录。
  function deliver(delivery: Delivery, printTask: Task) {
    if (recordInFlight.current) return;
    recordInFlight.current = true;
    // 新标签页须在点击当下打开，等记录完成再导航，避免被浏览器当作弹窗拦截。
    const tab = delivery === 'inline' ? openBlankPrintTab() : null;
    setPrintRecord({ status: 'saving' });
    void (async () => {
      try {
        const result = await recordBatchPrintAction(printTask.id);
        if (result.status !== 'success') {
          tab?.close();
          setPrintRecord({ status: 'failed', message: result.message, delivery });
          return;
        }
        setPrintRecord({ status: 'saved', marked: result.marked });
        navigateToPrintFile(`/api/orders/batch-print/${printTask.id}?view=${delivery}`, tab);
        announcePrintRecorded(printTask.orderIds);
        router.refresh();
      } catch {
        tab?.close();
        setPrintRecord({ status: 'failed', message: '网络异常', delivery });
      } finally {
        recordInFlight.current = false;
      }
    })();
  }

  useEffect(() => {
    if (!task) return;
    const jobId = task.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let manualRefresh = pollKey > 0;
    async function poll() {
      try {
        const response = await fetch(`/api/orders/batch-print/${jobId}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error('Status unavailable');
        const next: BatchPrintStatus = await response.json();
        if (controller.signal.aborted) return;
        setStatus(next);
        setIssues(next.issues);
        setRefreshFeedback(manualRefresh ? '进度已刷新。' : '');
        if (next.status === 'pending') {
          setMessage(next.phase === 'queued' ? '正在排队，请勿重复提交。' : next.phase === 'merging' ? '正在合并打印文件，请稍候。' : '正在准备打印文件，完成后可打开打印或下载。');
          timer = setTimeout(poll, Date.now() - startedAt < 120_000 ? 2000 : 10_000);
        } else if (next.status === 'unavailable') {
          setMessage('等待打印服务恢复，将自动更新进度；如长时间未恢复，请联系管理员。');
          timer = setTimeout(poll, 10_000);
        } else if (next.status === 'failed') {
          setMessage('未生成打印文件，请检查以下工单或减少所选数量后重试。');
        } else setMessage('打印文件已生成。');
      } catch {
        if (!controller.signal.aborted) {
          setMessage('暂时无法获取进度，将自动重试，也可点击刷新进度。');
          if (manualRefresh) setRefreshFeedback('刷新未成功，请稍后重试。');
          timer = setTimeout(poll, 10_000);
        }
      } finally {
        if (!controller.signal.aborted && manualRefresh) {
          setRefreshing(false);
          refreshInFlight.current = false;
          manualRefresh = false;
        }
      }
    }
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [task, pollKey]);

  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage('');
    setRefreshFeedback('');
    setRefreshing(false);
    refreshInFlight.current = false;
    setPollKey(0);
    setTask(null);
    setStatus(null);
    setIssues([]);
    setPrintRecord(null);
    const selectedLabels = selectedItems.map((item) => item.orderNo);
    setLabels(selectedLabels);
    try {
      const result = await requestBatchPrintAction({ requestId: crypto.randomUUID(), orderIds: selectedItems.map((item) => item.id) });
      if (result.status === 'queued') {
        setStatus({ status: 'pending', phase: 'queued', total: selectedLabels.length, completed: 0, issues: [] });
        setTask({ id: result.jobId, labels: selectedLabels, orderIds: selectedItems.map((item) => item.id) });
      } else { setMessage(result.message); setIssues(result.issues); }
    } catch { setMessage('未能提交打印请求，请稍后重试。'); }
    finally { inFlight.current = false; setPending(false); }
  }

  const tooMany = selectedItems.length > BATCH_PRINT_MAX;
  const generating = task !== null && (status?.status === 'pending' || status?.status === 'unavailable');
  const action = (
    <Button type="button" variant="secondary" className="min-h-11" disabled={disabled || pending || generating || tooMany || !selectedItems.length} onClick={() => void start()}>
      {pending ? '正在提交…' : status?.status === 'unavailable' ? '等待打印服务恢复' : generating ? '正在准备打印…' : `打印所选（${selectedItems.length}）`}
    </Button>
  );
  const result = tooMany || task || message || issues.length ? (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-current/20 pt-2 [overflow-wrap:anywhere]">
      {tooMany ? <span className="text-sm">每批最多打印 {BATCH_PRINT_MAX} 张，请减少所选工单。</span> : null}
      {task ? <>
        <span role="status" className="text-sm">已生成 {status?.completed ?? 0} / {status?.total ?? task.labels.length} 单</span>
        {status?.status === 'ready' ? <>
          <Button role="link" render={<a href={`/api/orders/batch-print/${task.id}?view=download`} onClick={(event) => { event.preventDefault(); deliver('download', task); }} />} nativeButton={false} variant="secondary" className="min-h-11">下载 PDF</Button>
          <Button role="link" render={<a href={`/api/orders/batch-print/${task.id}?view=inline`} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); deliver('inline', task); }} />} nativeButton={false} variant="secondary" className="min-h-11">打开 PDF</Button>
          {printRecord?.status === 'saving' ? <span role="status" className="text-sm">正在记为已打印…</span> : null}
          {printRecord?.status === 'saved' && printRecord.marked > 0 ? <span role="status" className="text-sm">已记为已打印 {printRecord.marked} 单。</span> : null}
          {printRecord?.status === 'failed' ? <>
            <span role="alert" className="text-sm text-destructive">未能取得打印文件：{printRecord.message}</span>
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => deliver(printRecord.delivery, task)}>{printRecord.delivery === 'inline' ? '重试打开' : '重试下载'}</Button>
          </> : null}
        </> : status?.status !== 'failed' ? (
          <Button type="button" variant="secondary" className="min-h-11" disabled={refreshing} aria-busy={refreshing} onClick={() => {
            if (refreshInFlight.current) return;
            refreshInFlight.current = true;
            setRefreshing(true);
            setRefreshFeedback('');
            setPollKey((value) => value + 1);
          }}>
            {refreshing ? '正在刷新…' : '刷新进度'}
          </Button>
        ) : null}
      </> : null}
      {task && task.orderIds?.join(',') !== selectedItems.map((item) => item.id).join(',') ? <p className="basis-full text-sm">所选工单已变化，下方生成结果仍对应此前提交的 {task.labels.length} 单。</p> : null}
      {refreshFeedback ? <p role="status" className="basis-full text-sm">{refreshFeedback}</p> : null}
      {message ? <p role="status" className="basis-full text-sm">{message}</p> : null}
      {issues.length ? <ul className="basis-full space-y-1 text-sm">{issues.map((issue) => <li key={issue.position} className="break-all">{labels[issue.position - 1] ?? `第 ${issue.position} 单`}：{issue.message}</li>)}</ul> : null}
    </div>
  ) : null;
  return renderLayout ? renderLayout(action, result) : (
    <div className="flex min-w-0 flex-col gap-2">
      <div>{action}</div>
      {result}
    </div>
  );
}
