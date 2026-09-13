'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { requestBatchPrintAction } from '@/actions/order-batch-print';
import { BATCH_PRINT_MAX, type BatchPrintIssue, type BatchPrintStatus } from '@/lib/order/batch-print-contract';
import type { OrderListSelectionItem } from './OrderListBatchSelection';

type Task = { id: string; labels: string[]; orderIds: string[] };

export function BatchPrintControls({ selectedItems, disabled }: {
  selectedItems: readonly OrderListSelectionItem[];
  disabled?: boolean;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [status, setStatus] = useState<BatchPrintStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [issues, setIssues] = useState<BatchPrintIssue[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [pollKey, setPollKey] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!task) return;
    const jobId = task.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    async function poll() {
      try {
        const response = await fetch(`/api/orders/batch-print/${jobId}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Status unavailable');
        const next: BatchPrintStatus = await response.json();
        if (controller.signal.aborted) return;
        setStatus(next);
        setIssues(next.issues);
        if (next.status === 'pending' && Date.now() - startedAt < 120_000) {
          timer = setTimeout(poll, 2000);
        } else if (next.status === 'pending') {
          setMessage('生成仍在继续，已暂停自动刷新。请稍后查看进度。');
        } else if (next.status === 'unavailable') {
          setMessage('打印服务暂不可用，请稍后查看进度；如仍不可用，请联系管理员。');
        } else if (next.status === 'failed') {
          setMessage('未生成打印文件，请检查以下工单或减少所选数量后重试。');
        } else setMessage('打印文件已生成。');
      } catch {
        if (!controller.signal.aborted) setMessage('暂时无法查看生成进度，请稍后重试。');
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
    setTask(null);
    setStatus(null);
    setIssues([]);
    const selectedLabels = selectedItems.map((item) => item.orderNo);
    setLabels(selectedLabels);
    try {
      const result = await requestBatchPrintAction({ requestId: crypto.randomUUID(), orderIds: selectedItems.map((item) => item.id) });
      if (result.status === 'queued') {
        setStatus({ status: 'pending', total: selectedLabels.length, completed: 0, issues: [] });
        setTask({ id: result.jobId, labels: selectedLabels, orderIds: selectedItems.map((item) => item.id) });
      } else { setMessage(result.message); setIssues(result.issues); }
    } catch { setMessage('未能提交打印请求，请稍后重试。'); }
    finally { inFlight.current = false; setPending(false); }
  }

  const tooMany = selectedItems.length > BATCH_PRINT_MAX;
  const generating = task !== null && (status?.status === 'pending' || status?.status === 'unavailable');
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" className="min-h-11" disabled={disabled || pending || generating || tooMany || !selectedItems.length} onClick={() => void start()}>
        {pending ? '正在提交…' : `打印所选（${selectedItems.length}）`}
      </Button>
      {tooMany ? <span className="text-sm">每批最多打印 {BATCH_PRINT_MAX} 张，请减少所选工单。</span> : null}
      {task ? <>
        <span role="status" className="text-sm">已生成 {status?.completed ?? 0} / {status?.total ?? task.labels.length} 单</span>
        {status?.status === 'ready' ? <>
          <Button role="link" render={<a href={`/api/orders/batch-print/${task.id}?view=download`} />} nativeButton={false} variant="secondary" className="min-h-11">下载 PDF</Button>
          <Button role="link" render={<a href={`/api/orders/batch-print/${task.id}?view=inline`} target="_blank" rel="noopener noreferrer" />} nativeButton={false} variant="secondary" className="min-h-11">打开 PDF</Button>
        </> : <Button variant="secondary" className="min-h-11" onClick={() => { setMessage(''); setPollKey((value) => value + 1); }}>查看进度</Button>}
      </> : null}
      {task && task.orderIds.join(',') !== selectedItems.map((item) => item.id).join(',') ? <p className="basis-full text-sm">所选工单已变化，下方生成结果仍对应此前提交的 {task.labels.length} 单。</p> : null}
      {message ? <p role="status" className="basis-full text-sm">{message}</p> : null}
      {issues.length ? <ul className="basis-full space-y-1 text-sm">{issues.map((issue) => <li key={issue.position} className="break-all">{labels[issue.position - 1] ?? `第 ${issue.position} 单`}：{issue.message}</li>)}</ul> : null}
    </div>
  );
}
