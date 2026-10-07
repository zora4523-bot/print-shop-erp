'use client';

import { useActionState, useId } from 'react';
import {
  lockPieceworkSettlementAction,
  lockPieceworkSettlementDayAction,
  markPieceworkSettlementPaidAction,
  type PieceworkSettlementMutationResult,
} from '@/actions/owner-piecework-settlement';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import { formatMoney } from '@/lib/dashboard/format';

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
      <ConfirmActionController level="L2"
        trigger={
          <Button type="button" size="sm" disabled={pending}>
            {pending ? '正在锁定…' : '锁定结算'}
          </Button>
        }
        formId={formId}
        disabled={pending}>
        <ConfirmActionDialog action={`结算 ${reporterName} ${workDate} 的工资`} changes={[{label: reportCount ? `${reportCount} 条报工及适用日薪` : '出勤日薪', old: "未结算", new: formatMoney(amount)}]} consequences={[
          '锁定后当日考勤和结算明细不可修改，补登记须核对补发差额。',
        ]} confirmText="锁定结算" />
      </ConfirmActionController>
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
      <ConfirmActionController level="L2"
        trigger={
          <Button type="button" disabled={pending || candidateCount === 0}>
            {pending ? '正在锁定…' : `锁定当日全部（${candidateCount} 人）`}
          </Button>
        }
        formId={formId}
        disabled={pending || candidateCount === 0}>
        <ConfirmActionDialog action={`锁定 ${workDate} 的全部待结算报工？`} changes={[]} consequences={[
          `结算 ${candidateCount} 人的当日报工，结算明细不可修改。`,
          '当日提成合计后，按适用日薪规则补足；仅有出勤的师傅也会结算。',
        ]} confirmText="确认批量锁定" />
      </ConfirmActionController>
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
      <ConfirmActionController level="L2"
        trigger={
          <Button type="button" size="sm" disabled={pending}>
            {pending ? '正在处理…' : '标记已发'}
          </Button>
        }
        formId={formId}
        disabled={pending}>
        <ConfirmActionDialog action={`标记 ${reporterName} ${workDate} 的工资已发`} changes={[{label: formatMoney(amount), old: "未发放", new: "已发放"}]} consequences={[
          '发放记录不能撤销。',
        ]} confirmText="标记已发" />
      </ConfirmActionController>
      {error ? (
        <ActionNotice tone="error" title="标记发放失败" description={error} />
      ) : null}
    </div>
  );
}
