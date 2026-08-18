'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reportTaskAction } from '@/actions/production';
import type { TaskMutationResult } from '@/actions/production.types';

type Props = {
  taskId: string;
  plannedQty: number;
  isPiecework: boolean;
};

export function ReportTaskForm({ taskId, plannedQty, isPiecework }: Props) {
  // `bind` on a Server Action keeps the $$FORM_ACTION marker, so React can
  // emit the native form action + hidden $ACTION_ID at SSR time. Passing
  // `formAction` straight to <form action> (rather than wrapping it in an
  // arrow) is what preserves the zero-JS submit path — 车间弱网/hydration
  // 失败时师傅仍能报工。See DECISIONS.md 2026-08-17.
  const bound = reportTaskAction.bind(null, taskId);
  const [state, formAction, pending] = useActionState<
    TaskMutationResult | null,
    FormData
  >(bound, null);
  const router = useRouter();

  // On success, kick the router to refresh server state — the task
  // page itself will re-render showing the completed view. We don't
  // navigate away since the worker might want to look at the payoff
  // breakdown.
  if (state?.status === 'success' && !pending) {
    // Defer to microtask so React finishes committing before refresh.
    queueMicrotask(() => router.refresh());
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <NumberField
          name="completedQty"
          label="合格数"
          defaultValue={plannedQty}
          errors={fieldErrors(state, 'completedQty')}
          autoFocus
        />
        <NumberField
          name="defectQty"
          label="不良数"
          defaultValue={0}
          errors={fieldErrors(state, 'defectQty')}
        />
        <NumberField
          name="reworkQty"
          label="返工数"
          defaultValue={0}
          errors={fieldErrors(state, 'reworkQty')}
        />
      </div>

      <p className="worker-wrap-anywhere text-xs text-muted-foreground">
        计划数量 {plannedQty.toLocaleString()}。合格 + 不良 + 返工 合计需
        &gt; 0；{isPiecework
          ? '计件金额按机台薪资规则计算。'
          : '本任务只记录完工数量，工资按考勤时薪结算。'}
      </p>

      {state?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={pending}
        size="lg"
        className="min-h-11 w-full bg-foreground text-background hover:bg-foreground/80"
      >
        {pending ? '提交中…' : '完工报工'}
      </Button>
    </form>
  );
}

function fieldErrors(
  state: TaskMutationResult | null,
  name: string,
): string[] {
  if (!state || state.status !== 'invalid') return [];
  return state.fieldErrors[name] ?? [];
}

function NumberField({
  name,
  label,
  defaultValue,
  errors,
  autoFocus,
}: {
  name: string;
  label: string;
  defaultValue: number;
  errors: string[];
  autoFocus?: boolean;
}) {
  const errorId = `${name}-error`;

  return (
    <div className="min-w-0">
      <Label htmlFor={name} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={name}
        name={name}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        aria-invalid={errors.length > 0}
        aria-describedby={errors.length > 0 ? errorId : undefined}
        className={`mt-1 min-h-11 text-lg ${errors.length > 0 ? 'border-destructive' : ''}`}
      />
      {errors.length > 0 ? (
        <p id={errorId} className="mt-1 text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}
