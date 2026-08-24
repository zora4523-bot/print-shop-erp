'use client';

import { useActionState, useId } from 'react';
import { settleCsPeriodAction } from '@/actions/owner-salary';
import type { SettleCsPeriodResult } from '@/actions/owner-salary.types';
import { Button } from '@/components/ui/button';
import { ActionNotice, ConfirmActionDialog } from '@/components/ui-business';

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
    '服务器会在同一事务内按结算时有效的提成档位重新计算，生成提成记录，并把本周期转为已结算终态。',
    context.willStartNextPeriod
      ? '根据页面加载时的真实账号状态，该人员仍是启用客服；服务器复核后会自动新建或复用衔接的下一周期。'
      : '根据页面加载时的真实账号状态，该人员已停用或不再是客服；结算历史周期后不会新建下一周期。',
    '已有工资发放流水会保留；如果已发金额超过本次结算应发上限，整笔结算会原子拒绝。',
    '结算与“客服周期已结算”通知任务共享事务边界；实际送达以后台任务结果为准。',
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
      <ConfirmActionDialog
        level="L2"
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
        title={`确认结算 ${context.csUserName} 的这个工资周期？`}
        description="结算会锁定周期业绩和提成档位，并把周期转为已结算终态。请核对人员、月期、金额和下一周期影响。"
        impactItems={csPeriodSettlementImpactItems(context)}
        confirmLabel="确认生成提成并结算"
        formId={formId}
        disabled={pending}
      />

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
