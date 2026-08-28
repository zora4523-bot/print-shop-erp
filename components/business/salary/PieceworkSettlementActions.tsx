'use client';

import { useActionState, useId } from 'react';
import {
  lockPieceworkSettlementAction,
  lockPieceworkSettlementDayAction,
  markPieceworkSettlementPaidAction,
  type PieceworkSettlementMutationResult,
} from '@/actions/owner-piecework-settlement';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionDialog } from '@/components/ui-business';

function actionError(
  state: PieceworkSettlementMutationResult | null,
): string | null {
  if (state?.status === 'error') return state.message;
  if (state?.status === 'invalid') {
    return Object.values(state.fieldErrors).flat()[0] ?? '请刷新后重试';
  }
  return null;
}

export function LockPieceworkSettlementForm({
  reporterId,
  reporterName,
  workDate,
  reportCount,
  amount,
  returnTo,
}: {
  reporterId: string;
  reporterName: string;
  workDate: string;
  reportCount: number;
  amount: string;
  returnTo: string;
}) {
  const formId = useId();
  const bound = lockPieceworkSettlementAction.bind(
    null,
    reporterId,
    workDate,
  );
  const [state, action, pending] = useActionState<
    PieceworkSettlementMutationResult | null,
    FormData
  >(bound, null);
  const error = pending ? null : actionError(state);
  return (
    <div className="space-y-2">
      <form id={formId} action={action} aria-busy={pending}>
        <input type="hidden" name="returnTo" value={returnTo} />
      </form>
      <ConfirmActionDialog
        level="L2"
        trigger={
          <Button type="button" size="sm" disabled={pending}>
            {pending ? '锁定中…' : '锁定结算'}
          </Button>
        }
        title={`锁定 ${reporterName} ${workDate} 的计件结算？`}
        description="锁定后明细按当时的报工金额快照保存，不重算历史工价。"
        impactItems={[
          `${reporterName} · ${workDate} · ${reportCount} 条报工 · ¥ ${amount}。`,
          '只纳入尚未结算的 ProductionReport，不读取或叠加旧 ProductionTask 工资。',
          '锁定后不能删除或重建明细；更正须通过追加冲正报工处理。',
        ]}
        confirmLabel="确认锁定"
        formId={formId}
        disabled={pending}
      />
      {error ? (
        <ActionNotice tone="error" title="锁定失败" description={error} />
      ) : null}
    </div>
  );
}

export function LockPieceworkSettlementDayForm({
  workDate,
  candidateCount,
  returnTo,
}: {
  workDate: string;
  candidateCount: number;
  returnTo: string;
}) {
  const formId = useId();
  const [state, action, pending] = useActionState<
    PieceworkSettlementMutationResult | null,
    FormData
  >(lockPieceworkSettlementDayAction, null);
  const error = pending ? null : actionError(state);
  return (
    <div className="space-y-2">
      <form id={formId} action={action} aria-busy={pending}>
        <input type="hidden" name="workDate" value={workDate} />
        <input type="hidden" name="returnTo" value={returnTo} />
      </form>
      <ConfirmActionDialog
        level="L2"
        trigger={
          <Button type="button" disabled={pending || candidateCount === 0}>
            {pending ? '锁定中…' : `锁定当日全部（${candidateCount} 人）`}
          </Button>
        }
        title={`锁定 ${workDate} 的全部待结算报工？`}
        description="每位报工人独立锁定；任何失败都会明确列出，不会改算已锁定记录。"
        impactItems={[
          `本次最多产生 ${candidateCount} 条按人、按日的不可变结算。`,
          '金额直接汇总报工时已锁定的工价快照。',
        ]}
        confirmLabel="确认批量锁定"
        formId={formId}
        disabled={pending || candidateCount === 0}
      />
      {error ? (
        <ActionNotice tone="error" title="批量锁定失败" description={error} />
      ) : null}
    </div>
  );
}

export function MarkPieceworkSettlementPaidForm({
  settlementId,
  reporterName,
  workDate,
  amount,
  returnTo,
}: {
  settlementId: string;
  reporterName: string;
  workDate: string;
  amount: string;
  returnTo: string;
}) {
  const formId = useId();
  const bound = markPieceworkSettlementPaidAction.bind(null, settlementId);
  const [state, action, pending] = useActionState<
    PieceworkSettlementMutationResult | null,
    FormData
  >(bound, null);
  const error = pending ? null : actionError(state);
  return (
    <div className="space-y-2">
      <form id={formId} action={action} aria-busy={pending}>
        <input type="hidden" name="returnTo" value={returnTo} />
      </form>
      <ConfirmActionDialog
        level="L2"
        trigger={
          <Button type="button" size="sm" disabled={pending}>
            {pending ? '处理中…' : '标记已发'}
          </Button>
        }
        title={`确认 ${reporterName} 的这笔计件工资已发？`}
        description="请先核对线下付款。此操作只记录发放状态，不会自动发起转账。"
        impactItems={[
          `${reporterName} · ${workDate} · ¥ ${amount}。`,
          '已发放结算受数据库不可变约束保护，不提供撤销或覆盖入口。',
        ]}
        confirmLabel="确认标记已发"
        formId={formId}
        disabled={pending}
      />
      {error ? (
        <ActionNotice tone="error" title="标记发放失败" description={error} />
      ) : null}
    </div>
  );
}
