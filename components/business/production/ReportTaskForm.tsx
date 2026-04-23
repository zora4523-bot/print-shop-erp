'use client';

import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reportTaskAction } from '@/actions/production';
import type { TaskMutationResult } from '@/actions/production.types';

type Props = {
  taskId: string;
  plannedQty: number;
};

export function ReportTaskForm({ taskId, plannedQty }: Props) {
  const bound = reportTaskAction.bind(null, taskId);
  const [state, formAction] = useActionState<TaskMutationResult | null, FormData>(
    bound,
    null,
  );
  const [pending, startTransition] = useTransition();
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
    <form
      action={(fd) => startTransition(() => formAction(fd))}
      className="space-y-4"
    >
      <div className="grid grid-cols-3 gap-3">
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

      <p className="text-xs text-muted-foreground">
        计划数量 {plannedQty.toLocaleString()}。合格 + 不良 + 返工 合计需
        &gt; 0；计件金额按&ldquo;合计压片 × 单价&rdquo;算。
      </p>

      {state?.status === 'error' ? (
        <p className="text-sm text-destructive">{state.message}</p>
      ) : null}

      <Button type="submit" disabled={pending} size="lg" className="w-full">
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
  return (
    <div>
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
        className={`mt-1 text-lg ${errors.length > 0 ? 'border-destructive' : ''}`}
      />
      {errors.length > 0 ? (
        <p className="mt-1 text-xs text-destructive">{errors[0]}</p>
      ) : null}
    </div>
  );
}
