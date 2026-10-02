'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, FolderDown } from 'lucide-react';
import { createWorkbenchBundleAction, getWorkbenchBundleProgressAction } from '@/actions/cdr-workbench';
import type { CreateBundleResult } from '@/actions/foreman-cdr.types';
import type { CdrWorkbenchOrder } from '@/lib/cdr/workbench-model';
import { cdrClientProgress, shouldAutoDownload, cdrPollExpired, CDR_POLL_INTERVAL_MS } from '@/lib/cdr/client-progress';
import type { CdrHistoryRow } from '@/lib/cdr/history';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { CDR_FILE_PACKAGE_STATUS_REGISTRY, DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY, ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import type { OrderStatus } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Disclosure, DisclosureIndicator, DisclosureSummary } from '@/components/ui/disclosure';
import { ActionNotice, EmptyState, EnvNotice, LongTaskReceipt, PendingButton, StatusBadge, useCopyToClipboard } from '@/components/ui-business';
import { RevokeBundleForm } from './RevokeBundleForm';

export function CdrWorkbench({ orders, bundles, mock, now }: {
  orders: CdrWorkbenchOrder[]; bundles: CdrHistoryRow[]; mock: boolean; now: string;
}) {
  const router = useRouter();
  const [clientNow, setClientNow] = useState(now);
  useEffect(() => {
    const update = () => setClientNow(new Date().toISOString());
    const timer = setInterval(update, 1_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const [state, action, pending] = useActionState<CreateBundleResult | null, FormData>(createWorkbenchBundleAction, null);
  const [selected, setSelected] = useState<string[]>([]);
  const attempted = useRef<string | null>(null);
  const available = orders.filter((o) => !o.issue);
  const issues = orders.filter((o) => !!o.issue);
  const chosen = available.filter((o) => selected.includes(o.id));
  const groups = new Map<string, CdrWorkbenchOrder[]>();
  for (const order of available) groups.set(order.salesId, [...(groups.get(order.salesId) ?? []), order]);
  const serialize = (rows: CdrWorkbenchOrder[]) => JSON.stringify(rows.map(({ id, version }) => ({ id, version })));
  const [polled, setPolled] = useState<CdrHistoryRow | null>(null);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [pollWarning, setPollWarning] = useState<{ state: CreateBundleResult; epoch: number; message: string } | null>(null);
  const pollMessage = !pending && pollWarning?.state === state && pollWarning.epoch === pollEpoch ? pollWarning.message : null;
  const { current, url, bundleId } = cdrClientProgress(state, bundles, polled, clientNow);
  useEffect(() => {
    if (state?.status !== 'queued') return;
    const requestedId = state.bundleId;
    const submission = state;
    const setPollMessage = (message: string | null) => setPollWarning(message ? { state: submission, epoch: pollEpoch, message } : null);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    async function poll() {
      try {
        const result = await getWorkbenchBundleProgressAction(requestedId);
        if (stopped) return;
        setPolled(result);
        if (!result) { setPollMessage('下载记录不存在，请刷新工单后重试'); return; }
        setPollMessage(null);
        if (result.status !== 'PENDING') { router.refresh(); return; }
        if (cdrPollExpired(started, Date.now())) { setPollMessage('文件仍在生成，可稍后刷新进度'); return; }
        timer = setTimeout(poll, CDR_POLL_INTERVAL_MS);
      } catch {
        if (!stopped) setPollMessage('进度读取失败，请刷新进度重试');
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [state, pollEpoch, router]);
  useEffect(() => {
    if (!shouldAutoDownload(url, bundleId, attempted.current)) return;
    attempted.current = bundleId;
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = ''; anchor.rel = 'noreferrer';
    document.body.append(anchor); anchor.click(); anchor.remove();
  }, [url, bundleId]);
  function toggle(ids: string[], on: boolean) {
    setSelected((previous) => on ? [...new Set([...previous, ...ids])] : previous.filter((id) => !ids.includes(id)));
  }
  return <div className="min-w-0 space-y-4">

    {mock && <EnvNotice>文件存储尚未启用，当前可查看工单和生成记录，暂不能下载文件。</EnvNotice>}
    <form action={action} aria-busy={pending} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox checked={available.length > 0 && chosen.length === available.length} indeterminate={chosen.length > 0 && chosen.length < available.length}
            disabled={pending || !available.length} onCheckedChange={(checked) => toggle(available.map((o) => o.id), !!checked)} />
          全选本页 · {available.length} 单可下载
        </label>
        <div className="flex flex-wrap gap-2">
          <PendingButton name="selection" value={serialize(chosen)} pending={pending} pendingLabel="正在生成…" disabled={!chosen.length} variant="outline">下载所选（{chosen.length}）</PendingButton>
          <PendingButton name="selection" value={serialize(available)} pending={pending} pendingLabel="正在生成…" disabled={!available.length}>
            <Download aria-hidden className="size-4" />一键下载本页
          </PendingButton>
        </div>
      </div>
      {!orders.length && <EmptyState kind="no-result" noun="CDR 工单" className="py-4" />}
      {[...groups].map(([id, rows]) => <div key={id} className="min-w-0 rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/30 p-3">
          <label className="flex min-h-11 w-full min-w-0 items-center gap-2 text-sm font-medium sm:w-auto sm:flex-1">
            <Checkbox aria-label={`选择 ${rows[0].salesLabel}`} checked={rows.every((o) => chosen.includes(o))}
              indeterminate={rows.some((o) => chosen.includes(o)) && !rows.every((o) => chosen.includes(o))}
              disabled={pending} onCheckedChange={(on) => toggle(rows.map((o) => o.id), !!on)} />
            <span className="min-w-0 break-words">{rows[0].salesLabel}</span>
          </label>
          <span className="text-xs text-muted-foreground">{rows.length} 单 · {rows.reduce((n, o) => n + o.fileCount, 0)} 个 CDR</span>
          <PendingButton name="selection" value={serialize(rows)} pending={pending} pendingLabel="正在生成…" variant="outline" aria-label={`下载 ${rows[0].salesLabel} 本页文件`}>
            <FolderDown className="size-4" aria-hidden />下载本组
          </PendingButton>
        </div>
        <Disclosure>
          <DisclosureSummary className="gap-2 px-3">工单明细<DisclosureIndicator /></DisclosureSummary>
          <div className="divide-y border-t px-3">
            {rows.map((order) => <div key={order.id} className="flex flex-wrap items-center gap-3 py-2">
              <label className="flex min-h-11 w-full min-w-0 items-center gap-2 md:w-auto md:flex-1">
                <Checkbox aria-label={`选择工单 ${order.orderNo}`} checked={chosen.includes(order)} disabled={pending} onCheckedChange={(on) => toggle([order.id], !!on)} />
                <span className="min-w-0 text-sm"><span className="block break-words">{order.name}</span><span className="text-xs text-muted-foreground">{order.orderNo} · {order.fileCount} 个 CDR</span></span>
              </label>
              <StatusBadge tone={CDR_FILE_PACKAGE_STATUS_REGISTRY[order.packageState].tone}>{CDR_FILE_PACKAGE_STATUS_REGISTRY[order.packageState].label}</StatusBadge>
              <span className="text-xs text-muted-foreground">{ORDER_STATUS_REGISTRY[order.status as OrderStatus]?.label ?? order.status}</span>
              <Button nativeButton={false} render={<Link href={`/orders/${order.id}`} />} variant="ghost">查看工单</Button>
            </div>)}
          </div>
        </Disclosure>
      </div>)}
      {state?.status === 'error' && <ActionNotice tone="error" title={state.message} action={<Button type="button" variant="outline" onClick={() => router.refresh()}>刷新工单</Button>} />}
      {pollMessage && <ActionNotice tone="warning" title={pollMessage} />}
      {bundleId && <LongTaskReceipt taskId={bundleId} status={current?.status === 'FAILED' ? 'failed' : url ? 'ready' : 'accepted'}
        title={current?.status === 'FAILED' ? '文件打包失败' : url ? '下载包已就绪' : state?.status === 'success' || current?.status === 'READY' ? '打包记录已生成' : '正在生成下载包'}
        description={current?.status === 'FAILED' ? current.failureMessage ?? undefined : url ? '已尝试开始下载；若浏览器未开始，请点击下载。' : '可在下载记录中查看结果。'}
        action={url ? <Button nativeButton={false} render={<a href={url} download rel="noreferrer" />}>下载 ZIP</Button> : <Button type="button" variant="outline" onClick={() => { setPollEpoch((n) => n + 1); router.refresh(); }}>刷新进度</Button>} />}
      {current?.status === 'FAILED' && <PendingButton pending={pending} name="bundleId" value={current.id} pendingLabel="正在重试…" variant="outline">按原工单重新生成</PendingButton>}
    </form>
    {!!issues.length && <Disclosure open className="rounded-lg border border-warning/40 p-3">
      <DisclosureSummary className="gap-2">待处理（{issues.length} 单，不含在下载中）<DisclosureIndicator /></DisclosureSummary>
      <div className="divide-y">{issues.map((o) => <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <div className="min-w-0 flex-1 break-words"><p>{o.salesLabel} · {o.name}</p><p className="text-xs text-muted-foreground">{o.orderNo} · {o.issue}</p></div>
        <Button nativeButton={false} render={<Link href={`/orders/${o.id}`} />} variant="outline">核对工单</Button>
      </div>)}</div>
    </Disclosure>}
    <p className="text-xs text-muted-foreground">ZIP 按外部销售账号 / 工单 / 款式归档。打包记录不代表已排版或已打印。</p>
    <Disclosure className="border-t pt-2">
      <DisclosureSummary>下载记录（最近 {bundles.length} 条）<DisclosureIndicator /></DisclosureSummary>
      <Button type="button" variant="outline" onClick={() => router.refresh()}>刷新记录</Button>
      <div className="divide-y">{bundles.map((bundle) => <BundleHistory key={bundle.id} bundle={bundle} now={clientNow} action={action} pending={pending} />)}</div>
      {!bundles.length && <EmptyState kind="no-data" noun="下载记录" />}
    </Disclosure>
  </div>;
}

function BundleHistory({ bundle, now, action, pending }: {
  bundle: CdrHistoryRow; now: string; action: (formData: FormData) => void; pending: boolean;
}) {
  const { copy, feedback } = useCopyToClipboard();
  const expired = new Date(bundle.expiresAt).getTime() <= new Date(now).getTime();
  const ready = bundle.status === 'READY' && !expired && !bundle.revokedAt && !bundle.isMock && !!bundle.downloadUrl;
  const display = DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY[bundle.revokedAt ? 'REVOKED' : bundle.status === 'FAILED' ? 'FAILED' : bundle.status === 'PENDING' ? 'PENDING' : expired ? 'EXPIRED' : bundle.isMock ? 'MOCK' : 'READY'];
  return <div className="space-y-2 py-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><p>{formatDateTimeShanghai(new Date(bundle.createdAt))} · {bundle.createdByName}</p><StatusBadge tone={display.tone}>{display.label}</StatusBadge></div>
    <p className="text-xs text-muted-foreground">{bundle.orderCount} 单 · {bundle.fileCount} 个 CDR · 下载 {bundle.downloadCount} 次 · 有效至 {formatDateTimeShanghai(new Date(bundle.expiresAt))}</p>
    {bundle.status === 'FAILED' && <p className="text-destructive">{bundle.failureMessage}</p>}
    {ready ? <><div className="flex flex-wrap gap-2"><Button nativeButton={false} render={<a href={bundle.downloadUrl} download rel="noreferrer" />}>下载 ZIP</Button><Button type="button" variant="outline" onClick={() => copy(bundle.downloadUrl, '下载链接')}>复制分享链接</Button></div>
      <RevokeBundleForm bundleId={bundle.id} />{feedback && <ActionNotice tone={feedback.tone} title={feedback.message} />}</> : bundle.status !== 'PENDING' && <form action={action}>
      <input type="hidden" name="bundleId" value={bundle.id} />
      <PendingButton pending={pending} pendingLabel="正在重新生成…" variant="outline">按原工单重新生成</PendingButton>
      <p className="mt-1 text-xs text-muted-foreground">使用这些工单当前的 CDR 文件。</p>
    </form>}
  </div>;
}
