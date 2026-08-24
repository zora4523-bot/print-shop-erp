'use client';

import { useActionState, useId } from 'react';
import { setDailySalaryPaidAction } from '@/actions/owner-salary';
import type { SalaryMutationResult } from '@/actions/owner-salary.types';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionDialog } from '@/components/ui-business';

type Props = {
  id: string;
  currentPaid: boolean;
  workerName: string;
  salaryDate: string;
  amount: string;
  // 当前列表的完整 URL（含筛选）。成功后 action 会 redirect 回这里并
  // 附上确认信息——「仅未发」筛选下这一行会消失，组件跟着卸载，内联
  // 提示根本没机会渲染。
  returnTo: string;
};

export function dailyPaidImpactItems({
  currentPaid,
  workerName,
  salaryDate,
  amount,
}: Pick<Props, 'currentPaid' | 'workerName' | 'salaryDate' | 'amount'>) {
  if (currentPaid) {
    return [
      `${workerName} · ${salaryDate} · 当前记录金额 ¥ ${amount}。`,
      '撤销后会清空系统内的“已发放”标记和发放时间。',
      '该日记录将重新允许重算和人工调整；撤销本身不会立即改变当前金额。',
      '这只是撤销系统状态，不会冲销银行、微信或现金付款，也不会生成退款流水。',
    ];
  }

  return [
    `${workerName} · ${salaryDate} · 将标记已发 ¥ ${amount}。`,
    '服务器会记录当前发放时间，并把该日工资锁定为财务记录。',
    '锁定后不能重算或新增人工调整；如需更正，必须先明确撤销发放。',
    '这只记录系统发放状态，不会自动发起银行、微信或现金付款。',
  ];
}

export function MarkPaidForm({
  id,
  currentPaid,
  workerName,
  salaryDate,
  amount,
  returnTo,
}: Props) {
  const formId = useId();
  const bound = setDailySalaryPaidAction.bind(null, id);
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
        <input type="hidden" name="returnTo" value={returnTo} />
      </form>
      {/* 服务端只持久 isPaid / paidAt，没有理由或操作审计字段。
          因此这里只能做 L2 影响确认，不能伪造 L3 reason。 */}
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
            {pending
              ? '处理中…'
              : currentPaid
                ? '撤销发放'
                : '标记已发'}
          </Button>
        }
        title={
          currentPaid
            ? `撤销 ${workerName} 的这笔发放标记？`
            : `确认 ${workerName} 的这笔日薪已发？`
        }
        description={
          currentPaid
            ? '这不是退款操作。请先确认线下资金状态，再解除系统锁定。'
            : '标记已发后会锁定这条财务记录。请核对人员、日期和金额，并确认线下已完成付款。'
        }
        impactItems={dailyPaidImpactItems({
          currentPaid,
          workerName,
          salaryDate,
          amount,
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
