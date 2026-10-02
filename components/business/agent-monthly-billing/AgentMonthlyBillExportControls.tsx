'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, RefreshCw } from 'lucide-react';
import {
  requestAgentMonthlyBillExportAction,
  type AgentMonthlyBillExportActionResult,
} from '@/actions/agent-monthly-bill-export';
import {
  AgentMonthlyBillExportStatus,
  type AgentMonthlyBillStatus,
} from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { SalesBillExportButton } from '@/components/business/billing/SalesBillExportButton';
import { StatusBadge } from '@/components/ui-business';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { AGENT_MONTHLY_BILL_EXPORT_STATUS_REGISTRY } from '@/lib/ui/status-registry';

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

class ExportPollingError extends Error {}

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
  const [pollingIssue, setPollingIssue] = useState<{ signature: string; message: string } | null>(null);
  const pollingPaused = pollingIssue?.signature === pendingSignature;
  const [pollingAttempt, setPollingAttempt] = useState(0);
  const lastActionRef = useRef<AgentMonthlyBillExportActionResult | null>(null);
  const feedback = currentExportFeedback(state, recent);

  // queued / success / error all return after the action's revalidatePath,
  // so the response already carries the fresh export list; only the polling
  // loop and the manual refresh button re-read it (DECISIONS 2026-08-27).
  useEffect(() => {
    lastActionRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!pendingSignature || pollingPaused) return;
    const ids = pendingSignature.split(',');
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();
    function pause(message: string) {
      if (cancelled) return;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      controller.abort();
      setPollingIssue({ signature: pendingSignature, message });
      setLiveMessage(message);
    }
    const poll = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            const response = await fetch(
              `/api/owner/agent-bills/exports/${encodeURIComponent(id)}/status`,
              { cache: 'no-store', signal: controller.signal },
            );
            if (response.status === 401 || response.status === 403) throw new ExportPollingError('登录已失效，请重新登录后查看导出记录。');
            if (!response.ok) throw new ExportPollingError('暂时无法查看导出进度，请手动刷新。');
            const body = (await response.json()) as {
              export?: { status?: AgentMonthlyBillExportStatus };
            };
            const status = body.export?.status;
            if (!status || !Object.values(AgentMonthlyBillExportStatus).includes(status)) throw new ExportPollingError('暂时无法查看导出进度，请手动刷新。');
            return status;
          }),
        );
        if (
          !cancelled &&
          results.some(
            (status) =>
              status !== null && status !== AgentMonthlyBillExportStatus.PENDING,
          )
        ) {
          // The current request's terminal feedback announces its specific result.
          // Older pending exports have no action feedback, so announce them here.
          const requested = lastActionRef.current;
          const hasCurrentResult = requested?.status === 'queued' && ids.some(
            (id, index) => id === requested.exportId && results[index] !== AgentMonthlyBillExportStatus.PENDING,
          );
          if (!hasCurrentResult) setLiveMessage('月账单导出状态已更新。');
          router.refresh();
        }
      } catch (error) {
        if (!controller.signal.aborted) pause(error instanceof ExportPollingError ? error.message : '网络连接失败，请手动刷新导出进度。');
      } finally {
        inFlight = false;
      }
    };
    const interval = window.setInterval(() => void poll(), 3_000);
    const timeout = window.setTimeout(() => {
      pause('导出仍可能在后台生成，自动检查已暂停。可手动刷新，无需重复提交。');
      controller.abort();
    }, 120_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [pendingSignature, pollingAttempt, pollingPaused, router]);

  function refresh() {
    setPollingIssue(null);
    setLiveMessage('');
    setPollingAttempt((value) => value + 1);
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <FileSpreadsheet aria-hidden="true" className="size-4" />
            导出账单
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
      {feedback ? <ActionFeedback state={feedback} /> : null}
      {pendingIds.length > 0 && pollingIssue?.signature === pendingSignature ? <p className="text-sm text-muted-foreground">{pollingIssue.message}</p> : null}
      {recent.length === 0 && feedback?.status === 'error' ? <Button type="button" variant="outline" onClick={refresh}>刷新导出记录</Button> : null}

      {recent.length > 0 ? (
        <div className="border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">最近导出</h3>
            {pendingIds.length > 0 || feedback?.status === 'error' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={refresh}
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
                      <SalesBillExportButton
                        href={`/api/owner/agent-bills/exports/${item.id}`}
                        label="下载"
                      />
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

function currentExportFeedback(
  state: AgentMonthlyBillExportActionResult | null,
  recent: readonly AgentMonthlyBillExportView[],
): AgentMonthlyBillExportActionResult | null {
  if (state?.status !== 'queued') return state;
  const current = recent.find((item) => item.id === state.exportId);
  if (current?.status === AgentMonthlyBillExportStatus.READY) {
    return { status: 'success', exportId: state.exportId };
  }
  if (current?.status === AgentMonthlyBillExportStatus.FAILED) {
    return { status: 'error', message: '导出文件生成失败，请重新导出。' };
  }
  if (current?.status === AgentMonthlyBillExportStatus.EXPIRED) {
    return { status: 'error', message: '导出文件已过期，请重新导出。' };
  }
  return state;
}

function ActionFeedback({
  state,
}: {
  state: AgentMonthlyBillExportActionResult;
}) {
  if (state.status === 'queued') {
    return (
      <p role="status" className="text-xs text-success-foreground">
        正在生成导出文件，完成后会显示下载按钮。
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
