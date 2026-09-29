'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CraftMutationResult } from '@/actions/owner-crafts.types';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { useReportFormPending } from '@/components/business/form/FormPendingScope';

type EditInitial = {
  name: string;
  isOutsource: boolean;
  sortOrder: number;
  isActive: boolean;
};

export type CraftRouteBase = typeof RULE_CENTER_HREFS.crafts;

type CommonProps = { routeBase?: CraftRouteBase };

type Props = CommonProps &
  (
    | {
      mode: 'create';
      action: (
        prev: CraftMutationResult | null,
        fd: FormData,
      ) => Promise<CraftMutationResult>;
      }
    | {
      mode: 'edit';
      action: (
        prev: CraftMutationResult | null,
        fd: FormData,
      ) => Promise<CraftMutationResult>;
      initial: EditInitial;
      }
  );

export function CraftForm(props: Props) {
  const [state, formAction, pending] = useActionState<CraftMutationResult | null, FormData>(
    props.action,
    null,
  );
  useReportFormPending(pending);
  const isCreate = props.mode === 'create';
  const initial = props.mode === 'edit' ? props.initial : undefined;

  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';
  const hasUnassignedFieldError = Object.entries(errs).some(
    ([field, messages]) =>
      !['name', 'sortOrder'].includes(field) && Boolean(messages?.length),
  );

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5" noValidate>
      <TextField
        id="name"
        label="工艺名"
        hint="例如：专版单色平烫。"
        required
        disabled={pending}
        error={errs.name?.[0]}
        defaultValue={initial?.name}
      />

      <label className="flex min-h-11 cursor-pointer items-start gap-1 rounded-lg border bg-background pr-3 text-sm has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
        <Checkbox
          name="isOutsource"
          defaultChecked={initial?.isOutsource}
          disabled={pending}
          aria-label="外协工艺"
        />
        <span className="min-w-0 space-y-1 py-2.5">
          <span className="block">外协工艺</span>
          <span className="block text-xs text-muted-foreground">
            勾选后，该工艺进入外协清单；内部工序由工单收费项固定生成。
          </span>
        </span>
      </label>

      <TextField
        id="sortOrder"
        label="排序"
        hint="正整数；数值越小越靠前。"
        type="number"
        min={1}
        step={1}
        required
        disabled={pending}
        error={errs.sortOrder?.[0]}
        defaultValue={initial ? String(initial.sortOrder) : undefined}
      />

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {hasUnassignedFieldError ? (
        <p role="alert" className="text-sm text-destructive">
          部分设置无法保存，请刷新后重试。
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success-foreground">
          ✓ 已保存
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? '正在提交…' : isCreate ? '创建工艺' : '保存修改'}
        </Button>
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  hint,
  error,
  type = 'text',
  min,
  step,
  ...inputProps
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  type?: string;
  min?: number;
  step?: number;
  required?: boolean;
  disabled?: boolean;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        min={min}
        step={step}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...inputProps}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
