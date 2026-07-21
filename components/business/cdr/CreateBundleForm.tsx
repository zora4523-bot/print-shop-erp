'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBundleAction } from '@/actions/foreman-cdr';
import type { CreateBundleResult } from '@/actions/foreman-cdr.types';
import { Button } from '@/components/ui/button';
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
      action={formAction}
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
        <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          所选日期窗口内没有含 CDR 文件的工单。
        </div>
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
                  <input
                    type="checkbox"
                    aria-label="全选 / 反选"
                    checked={
                      selected.size === allIds.length && allIds.length > 0
                    }
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-2 text-left">工单号</th>
                <th className="px-3 py-2 text-left">客户</th>
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
                      <input
                        type="checkbox"
                        name="orderIds"
                        value={o.id}
                        checked={checked}
                        onChange={() => toggleOne(o.id)}
                      />
                    </td>
                    <td className="px-3 py-2 font-sans tabular-nums text-xs">
                      {o.orderNo}
                    </td>
                    <td className="px-3 py-2">{o.customerRef ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{o.cdrCount}</td>
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

      <div className="flex items-center justify-between">
        <Button
          type="submit"
          disabled={isPending || selected.size === 0}
        >
          {isPending ? '生成中…' : '生成下载包'}
        </Button>
        {state?.status === 'error' ? (
          <p className="text-sm text-destructive">{state.message}</p>
        ) : null}
        {state?.status === 'invalid' ? (
          <p className="text-sm text-destructive">
            {Object.values(state.fieldErrors).flat()[0] ?? '表单校验失败'}
          </p>
        ) : null}
      </div>

      {state?.status === 'success' ? (
        <div className="rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm text-success-foreground">
          ✅ 已生成 {state.fileCount} 个 CDR 文件的下载包。
          {state.isMock ? (
            <span className="ml-2 text-xs">
              (mock-mode：URL 是占位，OSS 配齐后才能真下载)
            </span>
          ) : null}
          {/* href 用绝对 URL（不是 relativePath）—— owner 在 admin
              host 上右键&ldquo;复制链接地址&rdquo;时拿到的是 APP_PUBLIC_URL 域，
              而不是当前 admin 域（split-origin 部署：staff 走内网域，
              外协拿公网域）。 */}
          <div className="mt-2 break-all font-mono text-xs">
            <a
              href={state.downloadUrl}
              className="underline underline-offset-2"
              // 同源时 fallback 到正常导航；跨源会被浏览器当外链打开。
              rel="noreferrer"
            >
              {state.downloadUrl}
            </a>
          </div>
          <div className="mt-1 text-xs text-success-foreground/80">
            链接 24 小时有效（{formatDateTimeShanghai(new Date(state.expiresAt))} 过期）。复制
            上方完整 URL 发给外协。
          </div>
        </div>
      ) : null}

      {state?.status === 'queued' ? (
        <div className="rounded-md border border-info/40 bg-info/10 px-4 py-3 text-sm">
          已将 {state.fileCount} 个 CDR 文件加入重任务队列。打包在独立进程中进行，
          完成后会出现在下方列表。
          <span className="ml-2 font-mono text-xs text-muted-foreground">
            任务 {state.jobId}
          </span>
        </div>
      ) : null}
    </form>
  );
}
