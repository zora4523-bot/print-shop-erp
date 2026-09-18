'use client';

import { useActionState } from 'react';
import { ProductionTaskDisputeStatus } from '@/generated/prisma/enums';
import { reviewTaskDisputeAction } from '@/actions/task-disputes';
import type { TaskDisputeMutationResult } from '@/actions/task-disputes.types';
import { Button } from '@/components/ui/button';
import { ActionNotice } from '@/components/ui-business';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { TaskDisputeStatusBadge } from './TaskDisputeStatusBadge';
import { formatMoney } from '@/lib/dashboard/format';

export type AdminTaskDisputeRow = {
  id: string;
  status: ProductionTaskDisputeStatus;
  reason: string;
  resolution: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  workerName: string;
  resolvedByName: string | null;
  task: {
    id: string;
    itemSequence: number;
    itemName: string;
    craftName: string;
    plannedQty: number;
    completedQty: number;
    pieceworkAmount: string;
  };
};

export function TaskDisputeAdminPanel({
  disputes,
}: {
  disputes: AdminTaskDisputeRow[];
}) {
  const pendingCount = disputes.filter(
    (dispute) => dispute.status === ProductionTaskDisputeStatus.PENDING,
  ).length;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <div>
        <h2 className="text-base font-semibold">师傅任务 / 计件异议</h2>
        {pendingCount > 0 ? <p className="mt-1 text-xs text-muted-foreground">待处理 {pendingCount} 条</p> : null}
      </div>
      {disputes.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无师傅异议</p>
      ) : (
        <ol className="space-y-3">
          {disputes.map((dispute) => (
            <li key={dispute.id} className="min-w-0 rounded-lg border p-3 text-sm">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <TaskDisputeStatusBadge status={dispute.status} />
                <span className="font-medium">
                  #{dispute.task.itemSequence} · {dispute.task.itemName}
                </span>
                <span className="text-muted-foreground">
                  {dispute.task.craftName} · {dispute.workerName}
                </span>
              </div>
              <p className="admin-wrap-anywhere mt-2 whitespace-pre-wrap">
                {dispute.reason}
              </p>
              <dl className="mt-2 grid gap-2 rounded-md bg-muted/30 p-2 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">计划 / 合格</dt>
                  <dd className="font-sans tabular-nums">
                    {dispute.task.plannedQty} / {dispute.task.completedQty}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">当前计件</dt>
                  <dd className="font-sans tabular-nums">
                    {formatMoney(dispute.task.pieceworkAmount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">提交时间</dt>
                  <dd>{formatDateTimeShanghai(dispute.createdAt)}</dd>
                </div>
              </dl>
              {/* 审核表单在异议处理后仍保持挂载：revalidate 之后 status 变成终态，
                  若按 status 卸载，useActionState 里的成功回执会跟着一起丢掉
                  （同 foreman/materials 页 StockTransactionForm 的注释）。 */}
              <TaskDisputeReviewForm
                disputeId={dispute.id}
                open={dispute.status === ProductionTaskDisputeStatus.PENDING}
              />
              {dispute.status === ProductionTaskDisputeStatus.PENDING ? null : (
                <div className="mt-3 border-t pt-3 text-xs">
                  <p className="font-medium">处理回复</p>
                  <p className="admin-wrap-anywhere mt-1 whitespace-pre-wrap">
                    {dispute.resolution}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {dispute.resolvedByName ?? '管理员'} ·{' '}
                    {formatDateTimeShanghai(dispute.resolvedAt)}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TaskDisputeReviewForm({
  disputeId,
  open,
}: {
  disputeId: string;
  /** 异议仍待处理时渲染表单；终态只保留成功回执。 */
  open: boolean;
}) {
  const bound = reviewTaskDisputeAction.bind(null, disputeId);
  const [state, action, pending] = useActionState<
    TaskDisputeMutationResult | null,
    FormData
  >(bound, null);

  if (state?.status === 'success') {
    return (
      <div className="mt-3 border-t pt-3">
        <ActionNotice tone="success" title={state.message} />
      </div>
    );
  }
  if (!open) return null;

  const resolutionError =
    state?.status === 'invalid' ? state.fieldErrors.resolution?.[0] : null;
  const decisionError =
    state?.status === 'invalid' ? state.fieldErrors.decision?.[0] : null;
  return (
    <form action={action} aria-busy={pending} className="mt-3 space-y-2 border-t pt-3">
      <label className="block text-xs font-medium">
        处理回复
        <textarea
          name="resolution"
          minLength={2}
          maxLength={1000}
          rows={3}
          required
          disabled={pending}
          className="mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="说明核对结果、处理依据和后续操作"
        />
      </label>
      {resolutionError || decisionError ? (
        <p role="alert" className="text-xs text-destructive">
          {resolutionError ?? decisionError}
        </p>
      ) : null}
      {state?.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">本次只保存处理回复，不调整报工和工资。</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="decision"
          value="RESOLVED"
          disabled={pending}
          size="sm"
        >
          {pending ? '处理中…' : '确认已解决'}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="REJECTED"
          disabled={pending}
          size="sm"
          variant="outline"
        >
          驳回异议
        </Button>
      </div>
    </form>
  );
}
