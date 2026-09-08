'use client';

import { useActionState, useId } from 'react';
import { settleReadyCsPeriodsAction } from '@/actions/owner-salary';
import type { SettleReadyCsResult } from '@/actions/owner-salary.types';
import { Button } from '@/components/ui/button';
import {
  ActionNotice,
  BatchActionResult,
  ConfirmActionController, ConfirmActionDialog,
} from '@/components/ui-business';

export type CsReadySettlementPreview = {
  duePeriodCount: number;
  csUserCount: number;
  tierSalesTotal: string;
  baseTotal: string;
  earliestPeriodEnd: string | null;
  latestPeriodEnd: string | null;
  samplePeriods: Array<{
    periodId: string;
    csUserName: string;
    periodLabel: string;
    tierSalesTotal: string;
    baseTotal: string;
  }>;
};

export function readyCsSettlementImpactItems(
  preview: CsReadySettlementPreview,
): string[] {
  const sampleItems = preview.samplePeriods.map(
    (period) =>
      `${period.csUserName} · ${period.periodLabel}：算档业绩 ¥ ${period.tierSalesTotal}，底薪合计 ¥ ${period.baseTotal}。`,
  );
  const remaining = Math.max(
    preview.duePeriodCount - preview.samplePeriods.length,
    0,
  );

  return [
    preview.duePeriodCount > 0
      ? `页面加载时发现 ${preview.duePeriodCount} 个已到期周期，涉及 ${preview.csUserCount} 位客服。`
      : '页面加载时未发现已到期周期；确认后仍会按最新数据扫描一次。',
    ...(preview.earliestPeriodEnd && preview.latestPeriodEnd
      ? [
          `当前到期日范围：${preview.earliestPeriodEnd} ~ ${preview.latestPeriodEnd}。`,
          `当前初始候选的算档业绩合计 ¥ ${preview.tierSalesTotal}，底薪合计 ¥ ${preview.baseTotal}。`,
        ]
      : []),
    ...sampleItems,
    ...(remaining > 0
      ? [`还有 ${remaining} 个初始候选周期未在此预览中逐条展开。`]
      : []),
    '每个周期按结算时有效档位生成提成并锁定；仅启用客服会开始下一周期。',
    '批处理会继续扫描自动开启但仍已过期的后续周期，所以最终结算数可能大于当前初始预览数。',
    '逐周期处理；后续周期失败不影响已完成的结算，结果会列出对应客服、周期和原因。',
    '如处理意外中断，部分周期可能已结算；重试前请刷新核对。',
  ];
}

export function SettleReadyCsButton({
  preview,
}: {
  preview: CsReadySettlementPreview;
}) {
  const formId = useId();
  const [state, action, pending] = useActionState<
    SettleReadyCsResult | null,
    FormData
  >(async () => settleReadyCsPeriodsAction(), null);
  const visibleState = pending ? null : state;

  return (
    <div className="space-y-3">
      <form id={formId} action={action} aria-busy={pending} />
      {/* 批量结算当前不持久 reason，因此保持 L2，不新增未授权审计字段。 */}
      <ConfirmActionController level="L2"
        trigger={
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            aria-busy={pending}
            className="min-h-11"
          >
            {pending ? '扫描结算中…' : '核对并结算已到期周期'}
          </Button>
        }
        formId={formId}
        disabled={pending}>
        <ConfirmActionDialog action={
          preview.duePeriodCount > 0
            ? `确认扫描并结算 ${preview.duePeriodCount} 个当前到期周期？`
            : '确认按最新数据扫描已到期周期？'
        } changes={[]} consequences={readyCsSettlementImpactItems(preview)} confirmText="确认扫描并批量结算" />
      </ConfirmActionController>

      {visibleState?.status === 'success' ? (
        <BatchActionResult
          status={
            visibleState.errorCount > 0
              ? visibleState.settledCount > 0
                ? 'partial'
                : 'failure'
              : 'complete'
          }
          succeededCount={visibleState.settledCount}
          failedCount={visibleState.errorCount}
          title="客服工资周期批量结算结果"
          items={visibleState.errors.map((error) => {
            const period = preview.samplePeriods.find(
              (candidate) => candidate.periodId === error.periodId,
            );
            return {
              id: error.periodId,
              label:
                error.periodId === 'batch-limit'
                  ? '批处理上限'
                  : period
                    ? `${period.csUserName} · ${period.periodLabel}`
                    : '未完成周期',
              outcome: 'failure' as const,
              reason: error.message,
            };
          })}
        />
      ) : null}
      {visibleState?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="客服工资周期扫描未完成"
          description={visibleState.message}
        />
      ) : null}
    </div>
  );
}
