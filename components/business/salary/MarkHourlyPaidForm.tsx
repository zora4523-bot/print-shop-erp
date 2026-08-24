'use client';

import { useActionState, useId } from 'react';
import { setHourlyPayrollPaidAction } from '@/actions/owner-salary';
import type { SalaryMutationResult } from '@/actions/owner-salary.types';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionDialog } from '@/components/ui-business';

type Props = {
  id: string;
  currentPaid: boolean;
  workerName: string;
  month: string;
  totalSalary: string;
};

export function hourlyPaidImpactItems({
  currentPaid,
  workerName,
  month,
  totalSalary,
}: Omit<Props, 'id'>) {
  if (currentPaid) {
    return [
      `${workerName} · ${month} · 当前月结金额 ¥ ${totalSalary}。`,
      '撤销后会清空系统内的“已发放”标记和发放时间。',
      '该月结将重新允许重算；撤销本身不会立即改变工资金额。',
      '这不会冲销外部付款，也不会生成退款流水。',
    ];
  }

  return [
    `${workerName} · ${month} · 将标记已发 ¥ ${totalSalary}。`,
    '服务器会记录当前发放时间，并锁定该月结记录。',
    '锁定后不能重算；如需更正考勤或规则结果，必须先撤销发放。',
    '这只记录系统发放状态，不会自动发起外部付款。',
  ];
}

export function MarkHourlyPaidForm({
  id,
  currentPaid,
  workerName,
  month,
  totalSalary,
}: Props) {
  const formId = useId();
  const bound = setHourlyPayrollPaidAction.bind(null, id);
  const [state, action, pending] = useActionState<
    SalaryMutationResult | null,
    FormData
  >(bound, null);
  const target = !currentPaid;
  const visibleState = pending ? null : state;
  const error =
    visibleState?.status === 'error'
      ? visibleState.message
      : visibleState?.status === 'invalid'
        ? Object.values(visibleState.fieldErrors).flat()[0] ??
          '请刷新后重试'
        : null;

  return (
    <div className="space-y-2">
      <form id={formId} action={action} aria-busy={pending}>
        <input type="hidden" name="isPaid" value={String(target)} />
      </form>
      {/* 当前 mutation 只存 isPaid / paidAt，不接收审计理由。
          这里必须停在 L2，不能为了 UI 自行添加假 reason。 */}
      <ConfirmActionDialog
        level="L2"
        trigger={
          <Button
            type="button"
            size="sm"
            variant={currentPaid ? 'outline' : 'default'}
            disabled={pending}
            aria-busy={pending}
            className="min-h-11"
          >
            {pending ? '处理中…' : currentPaid ? '撤销发放' : '标记已发'}
          </Button>
        }
        title={
          currentPaid
            ? `撤销 ${workerName} ${month} 的发放标记？`
            : `确认 ${workerName} ${month} 的月结已发？`
        }
        description={
          currentPaid
            ? '这不是退款操作。请先核对线下资金状态。'
            : '标记已发后会锁定该月结，请确认线下已完成付款。'
        }
        impactItems={hourlyPaidImpactItems({
          currentPaid,
          workerName,
          month,
          totalSalary,
        })}
        confirmLabel={currentPaid ? '确认撤销发放标记' : '确认标记已发'}
        formId={formId}
        disabled={pending}
      />
      {error ? (
        <ActionNotice
          tone="error"
          title={currentPaid ? '撤销发放失败' : '标记发放失败'}
          description={error}
        />
      ) : null}
      {visibleState?.status === 'success' ? (
        <ActionNotice
          tone="success"
          title={currentPaid ? '已撤销发放标记' : '已标记发放'}
        />
      ) : null}
    </div>
  );
}
