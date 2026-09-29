'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import {
  requestAgentMonthlyBillExportAction,
  type AgentMonthlyBillExportActionResult,
} from '@/actions/agent-monthly-bill-export';
import {
  AgentMonthlyBillExportStatus,
  type AgentMonthlyBillStatus,
} from '@/generated/prisma/enums';
import { Button, buttonVariants } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui-business';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { AGENT_MONTHLY_BILL_EXPORT_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { cn } from '@/lib/utils';

export type AgentMonthlyBillExportView = {
  id: string;
  status: AgentMonthlyBillExportStatus;
  fileName: string;
  matchedBillCount: number;
  byteSize: string | null;
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
  lastErrorCode: string | null;
};

export function AgentMonthlyBillExportControls({
  requestKey,
  filter,
  filteredTotal,
  recent,
}: {
  requestKey: string;
  filter: {
    period?: string;
    status?: AgentMonthlyBillStatus;
    agentUserId?: string;
  };
  filteredTotal: number;
  recent: readonly AgentMonthlyBillExportView[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    AgentMonthlyBillExportActionResult | null,
    FormData
  >(requestAgentMonthlyBillExportAction, null);
  const pendingIds = recent
    .filter((item) => item.status === AgentMonthlyBillExportStatus.PENDING)
    .map((item) => item.id)
    .sort();
  const pendingSignature = pendingIds.join(',');
  const [liveMessage, setLiveMessage] = useState('');
  const lastActionRef = useRef<AgentMonthlyBillExportActionResult | null>(null);

  useEffect(() => {
    if (state === lastActionRef.current) return;
    lastActionRef.current = state;
    if (state?.status === 'queued' || state?.status === 'success') {
      router.refresh();
    }
  }, [router, state]);

  useEffect(() => {
    if (!pendingSignature) return;
    const ids = pendingSignature.split(',');
    let cancelled = false;
    const poll = async () => {
      const results = await Promise.all(
        ids.map(async (id) => {
          const response = await fetch(
            `/api/owner/agent-bills/exports/${encodeURIComponent(id)}/status`,
            { cache: 'no-store' },
          );
          if (!response.ok) return null;
          const body = (await response.json()) as {
            export?: { status?: AgentMonthlyBillExportStatus };
          };
          return body.export?.status ?? null;
        }),
      );
      if (
        !cancelled &&
        results.some(
          (status) =>
            status !== null && status !== AgentMonthlyBillExportStatus.PENDING,
        )
      ) {
        setLiveMessage('月账单导出状态已更新。');
        router.refresh();
      }
    };
    const interval = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pendingSignature, router]);

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <FileSpreadsheet aria-hidden="true" className="size-4" />
            异步导出
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            导出当前筛选结果。下载文件保留 24 小时。
          </p>
        </div>
        <form action={action} aria-busy={pending}>
          <input type="hidden" name="requestKey" value={requestKey} />
          <input type="hidden" name="period" value={filter.period ?? ''} />
          <input type="hidden" name="status" value={filter.status ?? ''} />
          <input
            type="hidden"
            name="agentUserId"
            value={filter.agentUserId ?? ''}
          />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? '正在提交…' : `导出当前结果（${filteredTotal} 张）`}
          </Button>
        </form>
      </div>
      {state ? <ActionFeedback state={state} /> : null}

      {recent.length > 0 ? (
        <div className="border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">最近导出</h3>
            {pendingIds.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => router.refresh()}
              >
                <RefreshCw aria-hidden="true" />
                刷新
              </Button>
            ) : null}
          </div>
          <ul className="mt-2 grid gap-2" aria-label="月账单最近导出">
            {recent.map((item) => {
              const definition =
                AGENT_MONTHLY_BILL_EXPORT_STATUS_REGISTRY[item.status];
              return (
                <li
                  key={item.id}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="admin-wrap-anywhere font-medium">
                      {item.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTimeShanghai(new Date(item.createdAt))} ·{' '}
                      {item.status === AgentMonthlyBillExportStatus.READY
                        ? `${item.matchedBillCount} 张账单`
                        : definition.label}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge tone={definition.tone} dot={definition.dot}>
                      {definition.label}
                    </StatusBadge>
                    {item.status === AgentMonthlyBillExportStatus.READY ? (
                      <a
                        href={`/api/owner/agent-bills/exports/${item.id}`}
                        download
                        className={cn(
                          buttonVariants({ variant: 'outline', size: 'sm' }),
                          'min-h-11',
                        )}
                      >
                        <Download aria-hidden="true" />
                        下载
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ActionFeedback({
  state,
}: {
  state: AgentMonthlyBillExportActionResult;
}) {
  if (state.status === 'queued') {
    return (
      <p role="status" className="text-xs text-success-foreground">
        已进入大文件队列，生成后会显示下载按钮。
      </p>
    );
  }
  if (state.status === 'success') {
    return (
      <p role="status" className="text-xs text-success-foreground">
        导出已生成。
      </p>
    );
  }
  return (
    <p role="alert" className="text-xs text-destructive">
      {state.message}
    </p>
  );
}
