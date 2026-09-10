'use client';

import { useActionState, useId } from 'react';
import { recomputeHourlyPayrollAction } from '@/actions/owner-salary';
import type { RecomputeHourlyResult } from '@/actions/owner-salary.types';
import { Button } from '@/components/ui/button';
import {
  ActionNotice,
  BatchActionResult,
  ConfirmActionController, ConfirmActionDialog,
  FormErrorSummary,
  type FormErrorSummaryItem,
} from '@/components/ui-business';
import { formatMoney } from '@/lib/dashboard/format';

export type HourlyRecomputeContext = {
  existingRecordCount: number;
  unpaidRecordCount: number;
  paidRecordCount: number;
  unpaidTotal: string;
  sampleRows: Array<{
    workerName: string;
    totalSalary: string;
    isPaid: boolean;
  }>;
};

type Props = {
  month: string;
  /** 服务器渲染时的上海当前月；真正守卫仍在 lib/salary。 */
  maxMonth: string;
  context: HourlyRecomputeContext;
};

export function hourlyRecomputeImpactItems(
  month: string,
  context: HourlyRecomputeContext,
): string[] {
  const sampleItems = context.sampleRows.map(
    (row) =>
      `${row.workerName}：当前 ${formatMoney(row.totalSalary)}（${row.isPaid ? '已发，保护不改' : '未发，可能重算'}）。`,
  );
  const remainingSamples = Math.max(
    context.existingRecordCount - context.sampleRows.length,
    0,
  );

  return [
    `目标月期：${month}（上海日历）。`,
    `当前已有 ${context.existingRecordCount} 条月结：${context.unpaidRecordCount} 条未发、${context.paidRecordCount} 条已发。`,
    `当前未发记录合计 ${formatMoney(context.unpaidTotal)}；重算后金额可能改变。`,
    ...sampleItems,
    ...(remainingSamples > 0
      ? [`还有 ${remainingSamples} 条现有月结未在此预览中逐条展开。`]
      : []),
    '重算覆盖本月所有启用时薪工和有本月考勤的人员；尚无月结的人员可能新增记录。',
    '已发记录保持不变；未发记录按本月考勤和当前有效工资规则重算。',
    '逐人处理；部分人员失败不影响已完成的其他记录，结果会逐项列出。',
    '如处理意外中断，部分记录可能已生效；重试前请刷新核对。',
  ];
}

export function RecomputeHourlyForm({ month, maxMonth, context }: Props) {
  const formId = useId();
  const triggerId = `${formId}-trigger`;
  const [state, action, pending] = useActionState<
    RecomputeHourlyResult | null,
    FormData
  >(
    (previous, formData) =>
      recomputeHourlyPayrollAction(previous, {
        month: String(formData.get('month') ?? ''),
      }),
    null,
  );
  const visibleState = pending ? null : state;
  const futureMonth = month > maxMonth;
  const fieldErrors =
    visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const errorSummary: FormErrorSummaryItem[] = Object.values(fieldErrors)
    .flat()
    .map((message) => ({
      fieldId: triggerId,
      label: '重算月份',
      message,
    }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">当前重算月份：{month}</p>
          <p className="text-xs text-muted-foreground">
            如需更换月份，请先使用下方月份筛选，确保页面预览与提交月期一致。
          </p>
        </div>
        <form id={formId} action={action} aria-busy={pending}>
          <input type="hidden" name="month" value={month} />
        </form>
        {/* 时薪重算没有服务端 reason/审计字段，因此只做 L2 影响确认。 */}
        <ConfirmActionController level="L2"
          trigger={
            <Button
              id={triggerId}
              type="button"
              variant="outline"
              disabled={pending || futureMonth}
              aria-busy={pending}
              className="min-h-11 border-warning/50 text-warning-foreground"
            >
              {pending ? '重算中…' : `核对并重算 ${month} 全员月结`}
            </Button>
          }
          formId={formId}
          disabled={pending || futureMonth}>
          <ConfirmActionDialog action={`确认重算 ${month} 全员时薪月结？`} changes={[]} consequences={hourlyRecomputeImpactItems(month, context)} confirmText={`确认重算 ${month}`} />
        </ConfirmActionController>
      </div>

      {futureMonth ? (
        <ActionNotice
          tone="warning"
          title="不能重算未来月份"
          description={`当前上海日历月为 ${maxMonth}。未来月份考勤尚未发生，请更换筛选月份。`}
        />
      ) : null}

      {visibleState?.status === 'success' ? (
        <BatchActionResult
          status={
            visibleState.errorCount > 0
              ? visibleState.workerCount > 0
                ? 'partial'
                : 'failure'
              : 'complete'
          }
          succeededCount={visibleState.workerCount}
          failedCount={visibleState.errorCount}
          title={`${visibleState.month} 时薪月结重算结果`}
          items={visibleState.errors.map((error) => ({
            id: error.workerId,
            label: error.workerName,
            outcome: 'failure' as const,
            reason: error.message,
          }))}
        />
      ) : null}
      {visibleState?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="时薪月结重算未完成"
          description={visibleState.message}
        />
      ) : null}
      {visibleState?.status === 'invalid' ? (
        <FormErrorSummary errors={errorSummary} />
      ) : null}
    </div>
  );
}
