'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { recomputeDailySalaryAction } from '@/actions/owner-salary';
import type { RecomputeDailyResult } from '@/actions/owner-salary.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ActionNotice,
  ConfirmActionDialog,
  FormErrorSummary,
  FormMessage,
  PendingButton,
  formMessageA11yProps,
  type FormErrorSummaryItem,
} from '@/components/ui-business';
import type { DailySalaryRecomputeImpact } from '@/lib/salary/daily-recompute-impact';

type Props = {
  defaultDate: string;
  // 上海日历的今天。纯浏览器层提示，真闸口在 lib/salary/daily.ts 的
  // assertNotFutureSalaryDate —— 客户端时钟不可信，这里只是少一次往返。
  maxDate: string;
};

/** 只把服务端预检返回的真实数字转换为 L3 影响清单。 */
export function dailyRecomputeImpactItems(
  impact: DailySalaryRecomputeImpact,
): string[] {
  return [
    `候选师傅：${impact.candidateWorkerCount} 位`,
    `实际受影响：${impact.affectedWorkerCount} 位`,
    `将新建日薪记录：${impact.createCount} 位`,
    `将覆盖未发放记录：${impact.overwriteUnpaidCount} 位`,
    `跳过已发放记录：${impact.paidSkippedCount} 位（不会修改）`,
  ];
}

export function canUseDailyRecomputePreview({
  previewDate,
  selectedDate,
  invalidated,
  pending,
}: {
  previewDate: string | null;
  selectedDate: string;
  invalidated: boolean;
  pending: boolean;
}): boolean {
  return (
    previewDate !== null &&
    previewDate === selectedDate &&
    !invalidated &&
    !pending
  );
}

export function RecomputeDailyForm({ defaultDate, maxDate }: Props) {
  const [state, action] = useActionState<RecomputeDailyResult | null, unknown>(
    recomputeDailySalaryAction,
    null,
  );
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(defaultDate);
  const [previewInvalidated, setPreviewInvalidated] = useState(false);
  const [submissionPhase, setSubmissionPhase] = useState<
    'preview' | 'confirm'
  >('preview');
  const id = useId();
  const dateId = `${id}-date`;
  const formId = `${id}-preview-form`;
  const confirmTriggerId = `${id}-confirm-trigger`;

  // 只接受当前 Server Action 返回的预检。日期一变，旧预检
  // 即使还在 action state 中也不再能触发写入。
  const preview = state?.status === 'confirm' ? state : null;
  const confirmationReady = canUseDailyRecomputePreview({
    previewDate: preview?.date ?? null,
    selectedDate: date,
    invalidated: previewInvalidated,
    pending,
  });
  const fieldErrors = state?.status === 'invalid' ? state.fieldErrors : {};
  const dateError = fieldErrors.date?.[0];
  const errorSummary: FormErrorSummaryItem[] = Object.entries(fieldErrors).flatMap(
    ([field, messages]) =>
      messages.map((message) => ({
        fieldId: field === 'date' ? dateId : confirmTriggerId,
        label: field === 'date' ? '重算日期' : '重算理由',
        message,
      })),
  );

  return (
    <div className="space-y-3">
      <form
        id={formId}
        action={(formData) => {
          const nextDate = String(formData.get('date') ?? '');
          setSubmissionPhase('preview');
          setPreviewInvalidated(false);
          startTransition(() =>
            action({ date: nextDate, reason: '', confirmed: false }),
          );
        }}
        aria-busy={pending}
        className="space-y-3"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor={dateId}>重算日期</Label>
          <Input
            id={dateId}
            type="date"
            name="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setPreviewInvalidated(true);
            }}
            max={maxDate}
            required
            className="min-h-11 max-w-[180px]"
            {...formMessageA11yProps(dateId, dateError ? 'error' : 'hint')}
          />
          <FormMessage fieldId={dateId} tone={dateError ? 'error' : 'hint'}>
            {dateError ?? '预检只读取影响范围，不会改动日薪记录。'}
          </FormMessage>
        </div>

        <PendingButton
          pending={pending}
          pendingLabel={
            submissionPhase === 'confirm'
              ? '正在确认重算…'
              : '正在核对影响…'
          }
          variant="outline"
          className="border-warning/50 text-warning-foreground"
          groupNote="先查看影响范围；确认时会按最新数据重新核对。"
        >
          查看影响
        </PendingButton>
      </form>

      <FormErrorSummary errors={errorSummary} />

      {confirmationReady && preview ? (
        <div data-risk-level="L3" className="space-y-2">
          <ActionNotice
            tone="warning"
            title={`已完成 ${preview.date} 影响预检`}
            description={`${preview.impact.affectedWorkerCount} 位师傅受影响。请核对清单并填写理由。`}
          />
          <ConfirmActionDialog
            level="L3"
            defaultOpen
            disabled={pending}
            trigger={
              <Button id={confirmTriggerId} type="button" variant="destructive">
                确认重算…
              </Button>
            }
            title={`确认重算 ${preview.date} 的日薪？`}
            description="确认后会按现行规则重算该日记录。已发放行始终跳过，新建与覆盖结果都会写入审计日志。"
            impactItems={dailyRecomputeImpactItems(preview.impact)}
            confirmLabel="填写理由并确认重算"
            reasonLabel="重算理由"
            reasonPlaceholder="例如：师傅补报工后重新核对"
            onConfirm={(reason) => {
              if (!reason || preview.date !== date) return;
              setSubmissionPhase('confirm');
              startTransition(() =>
                action({
                  date: preview.date,
                  reason,
                  confirmed: true,
                }),
              );
            }}
          />
        </div>
      ) : null}

      {!pending && state?.status === 'success' ? (
        <ActionNotice
          tone={state.errorCount > 0 ? 'warning' : 'success'}
          title={`${state.date} 日薪重算已完成`}
          description={
            <div className="space-y-1">
              <p>
                已处理 {state.workerCount} 位师傅，跳过已发放{' '}
                {state.impact.paidSkippedCount} 位
                {state.errorCount > 0 ? `，${state.errorCount} 项失败。` : '。'}
              </p>
              {state.errors.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {state.errors.map((error) => (
                    <li key={error.workerId}>
                      {error.workerName}：{error.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          }
        />
      ) : null}

      {!pending && state?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="日薪重算未完成"
          description={state.message}
        />
      ) : null}
    </div>
  );
}
