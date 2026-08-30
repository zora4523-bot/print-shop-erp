'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBundleAction } from '@/actions/foreman-cdr';
import type { CreateBundleResult } from '@/actions/foreman-cdr.types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DisabledReason,
  EmptyState,
  EnvNotice,
  LongTaskReceipt,
  PendingButton,
} from '@/components/ui-business';
import { formatDateTimeShanghai } from '@/lib/format/dates';

type EligibleOrder = {
  id: string;
  orderNo: string;
  customerRef: string | null;
  submittedAt: string; // ISO（server 端 toISOString 后传过来）
  cdrCount: number;
};

export function CreateBundleForm({
  from,
  to,
  eligible,
}: {
  from: string;
  to: string;
  eligible: readonly EligibleOrder[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<
    CreateBundleResult | null,
    FormData
  >(createBundleAction, null);

  // 全选 / 反选 / 单选状态。useState 初始化只跑一次，所以**外层用
  // `key={eligibleIdsKey}` 强制 remount**——日期 filter 变化 → 候选
  // 集换组 → form 重挂 → setSelected 拿新 allIds。比 useEffect+setState 更纯。
  const allIds = useMemo(() => eligible.map((o) => o.id), [eligible]);
  const [selected, setSelected] = useState<Set<string>>(new Set(allIds));

  useEffect(() => {
    if (state?.status !== 'queued') return;
    const timer = window.setInterval(() => router.refresh(), 3_000);
    const stop = window.setTimeout(() => window.clearInterval(timer), 120_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [router, state]);

  const allSelected = allIds.length > 0 && selected.size === allIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    if (selected.size === allIds.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }
  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const totalCdr = eligible
    .filter((o) => selected.has(o.id))
    .reduce((acc, o) => acc + o.cdrCount, 0);

  return (
    <form
      id="cdr-bundle-form"
      action={formAction}
      aria-busy={isPending}
      className="rounded-xl border bg-card p-4 shadow-sm space-y-4"
    >
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          候选工单（{from === to ? from : `${from} → ${to}`}）
        </h2>
        <div className="text-xs text-muted-foreground">
          已选 {selected.size} 单 · 共 {totalCdr} 个 CDR 文件
        </div>
      </div>

      {eligible.length === 0 ? (
        <EmptyState
          kind="no-result"
          noun="含 CDR 文件的工单"
          onClear={
            <Button
              render={<Link href="#cdr-filter" prefetch={false} />}
              nativeButton={false}
              variant="outline"
            >
              调整日期范围
            </Button>
          }
          className="py-6"
        />
      ) : (
        <div
          className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          role="region"
          aria-label="CDR 打包工单选择"
          tabIndex={0}
        >
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">
                  <Checkbox
                    // toggleAll 的语义是全选/全清，不是反选。
                    aria-label="全选 / 全不选"
                    // Base UI 同时会把部分选中暴露为 aria-checked="mixed"
                    // 并由共享 Indicator 画横线，语义与视觉保持一致。
                    indeterminate={someSelected}
                    checked={allSelected}
                    disabled={isPending}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-2 text-left">工单号</th>
                <th className="px-3 py-2 text-left">客户名称/简称</th>
                <th className="px-3 py-2 text-right">CDR 数</th>
                <th className="px-3 py-2 text-left">提交时间</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {eligible.map((o) => {
                const checked = selected.has(o.id);
                return (
                  <tr key={o.id}>
                    <td className="px-3 py-2">
                      <Checkbox
                        name="orderIds"
                        value={o.id}
                        aria-label={`选择工单 ${o.orderNo}`}
                        checked={checked}
                        disabled={isPending}
                        onCheckedChange={() => toggleOne(o.id)}
                      />
                    </td>
                    <td className="px-3 py-2 font-sans tabular-nums text-xs">
                      {o.orderNo}
                    </td>
                    <td className="px-3 py-2">{o.customerRef ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-sans tabular-nums">{o.cdrCount}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDateTimeShanghai(new Date(o.submittedAt))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/orders/${o.id}`}
                        className="text-xs underline-offset-2 hover:underline"
                      >
                        查看 →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        {selected.size === 0 ? (
          <DisabledReason cause="status" reason="先勾选至少一个工单">
            <PendingButton pending={isPending} disabled pendingLabel="生成中…">
              生成下载包
            </PendingButton>
          </DisabledReason>
        ) : (
          <PendingButton pending={isPending} pendingLabel="生成中…">
            生成下载包
          </PendingButton>
        )}
        {state?.status === 'error' ? (
          <p role="alert" className="text-sm text-destructive">{state.message}</p>
        ) : null}
        {state?.status === 'invalid' ? (
          <p role="alert" className="text-sm text-destructive">
            {Object.values(state.fieldErrors).flat()[0] ?? '表单校验失败'}
          </p>
        ) : null}
      </div>

      {state?.status === 'success' ? (
        <div className="space-y-3">
          <LongTaskReceipt
            taskId={state.bundleId}
            status="ready"
            title={`已生成 ${state.fileCount} 个 CDR 文件的下载包`}
            description="可以离开页面；之后仍可从下方“最近生成的下载包”取回。"
            expiresAt={state.expiresAt}
            action={
              <div className="min-w-0 space-y-2 text-sm">
                <p className="break-all font-mono text-xs">
                  <a
                    href={state.downloadUrl}
                    className="underline underline-offset-2"
                    rel="noreferrer"
                  >
                    {state.downloadUrl}
                  </a>
                </p>
                <Button
                  render={<a href={state.downloadUrl} rel="noreferrer" />}
                  nativeButton={false}
                  variant="outline"
                >
                  打开下载链接
                </Button>
                <p className="text-xs text-muted-foreground">
                  {formatDateTimeShanghai(new Date(state.expiresAt))} 过期。复制上方完整
                  URL 发给外协。
                </p>
              </div>
            }
          />
          {state.isMock ? (
            <EnvNotice>
              文件存储尚未启用，当前下载地址不可用。
            </EnvNotice>
          ) : null}
        </div>
      ) : null}

      {state?.status === 'queued' ? (
        <LongTaskReceipt
          taskId={state.jobId}
          status="accepted"
          title={`已受理：正在生成 ${state.fileCount} 个 CDR 文件`}
          description="可以离开页面；完成后会出现在下方“最近生成的下载包”。"
          action={
            <Button type="button" variant="outline" onClick={() => router.refresh()}>
              刷新进度
            </Button>
          }
        />
      ) : null}
    </form>
  );
}
