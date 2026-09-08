'use client';

import { useActionState, useId } from 'react';
import { settleCsPeriodAction } from '@/actions/owner-salary';
import type { SettleCsPeriodResult } from '@/actions/owner-salary.types';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';

export type CsPeriodSettlementContext = {
  csUserName: string;
  periodLabel: string;
  tierSalesTotal: string;
  baseTotal: string;
  paidBase: string;
  paidCommission: string;
  willStartNextPeriod: boolean;
};

export function csPeriodSettlementImpactItems(
  context: CsPeriodSettlementContext,
): string[] {
  return [
    `客服：${context.csUserName}；周期：${context.periodLabel}。`,
    `当前算档业绩（本期累计 + 期初）：¥ ${context.tierSalesTotal}。`,
    `周期底薪合计：¥ ${context.baseTotal}；已发底薪 ¥ ${context.paidBase}，已发提成 ¥ ${context.paidCommission}。`,
    '结算时按当前有效提成档位重新计算，生成提成记录，并锁定本周期。',
    context.willStartNextPeriod
      ? '该人员当前仍是启用客服；结算后会自动开始或沿用下一周期。'
      : '该人员已停用或不再是客服；结算历史周期后不会新建下一周期。',
    '已有工资发放流水会保留；如果已发金额超过应发上限，本次结算不会生效。',
    '结算会同时生成“客服周期已结算”通知；送达结果可在推送配置中查看。',
  ];
}

export function SettleCsPeriodButton({
  periodId,
  context,
}: {
  periodId: string;
  context: CsPeriodSettlementContext;
}) {
  const formId = useId();
  const [state, action, pending] = useActionState<
    SettleCsPeriodResult | null,
    FormData
  >(async () => settleCsPeriodAction(periodId), null);
  const visibleState = pending ? null : state;

  return (
    <div className="space-y-3">
      <form id={formId} action={action} aria-busy={pending} />
      {/* 结算 action 没有可持久的 reason 字段，所以不能伪造 L3。 */}
      <ConfirmActionController level="L2"
        trigger={
          <Button
            type="button"
            disabled={pending}
            aria-busy={pending}
            className="min-h-11"
          >
            {pending ? '结算中…' : '核对并立即结算'}
          </Button>
        }
        formId={formId}
        disabled={pending}>
        <ConfirmActionDialog action={`确认结算 ${context.csUserName} 的这个工资周期？`} changes={[]} consequences={csPeriodSettlementImpactItems(context)} confirmText="确认生成提成并结算" />
      </ConfirmActionController>

      {visibleState?.status === 'success' ? (
        <ActionNotice
          tone="success"
          title="客服工资周期已结算"
          description={
            <span>
              业绩 ¥ {visibleState.totalSales} × 档位{' '}
              {(Number(visibleState.tierRate) * 100).toFixed(2)}% = 提成 ¥{' '}
              {visibleState.commissionAmount}；周期总收入 ¥{' '}
              {visibleState.totalIncome}。
              {visibleState.nextPeriodId
                ? '下一周期已开启或复用。'
                : '未开启下一周期。'}
            </span>
          }
        />
      ) : null}
      {visibleState?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="客服工资周期未结算"
          description={visibleState.message}
        />
      ) : null}
      {visibleState?.status === 'invalid' ? (
        <ActionNotice
          tone="error"
          title="客服工资周期未结算"
          description={Object.values(visibleState.fieldErrors).flat().join('；')}
        />
      ) : null}
    </div>
  );
}
