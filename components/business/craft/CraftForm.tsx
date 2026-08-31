'use client';

import { useActionState } from 'react';
import { MachineType, WorkerType } from '../../../generated/prisma/enums';
import { Button, buttonVariants } from '@/components/ui/button';
import { PendingLink } from '@/components/ui-business';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CraftMutationResult } from '@/actions/owner-crafts.types';
import {
  MACHINE_TYPE_LABELS,
  WORKER_TYPE_LABELS,
} from '@/lib/auth/role-labels';

type EditInitial = {
  name: string;
  isOutsource: boolean;
  defaultWorkerType: WorkerType | null;
  defaultMachineType: MachineType | null;
  sortOrder: number;
  isActive: boolean;
};

export type CraftRouteBase = '/owner/crafts' | '/owner/rules/crafts';

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

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const MACHINE_TYPE_OPTIONS = [
  MachineType.HAND_PRESS,
  MachineType.WINDMILL,
  MachineType.GLUE,
] as const;

const PRODUCTION_WORKER_TYPE_OPTIONS = [
  WorkerType.MACHINE,
  WorkerType.PACKER,
  WorkerType.CLEANER,
] as const;

export function CraftForm(props: Props) {
  const [state, formAction, pending] = useActionState<CraftMutationResult | null, FormData>(
    props.action,
    null,
  );
  const isCreate = props.mode === 'create';
  const initial = props.mode === 'edit' ? props.initial : undefined;

  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';
  const routeBase = props.routeBase ?? '/owner/crafts';
  const hasUnassignedFieldError = Object.entries(errs).some(
    ([field, messages]) =>
      ![
        'name',
        'defaultWorkerType',
        'defaultMachineType',
        'sortOrder',
      ].includes(field) && Boolean(messages?.length),
  );

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5" noValidate>
      <input type="hidden" name="routeBase" value={routeBase} />
      <TextField
        id="name"
        label="工艺名"
        hint="例如：专版单色平烫。"
        required
        disabled={pending}
        error={errs.name?.[0]}
        defaultValue={initial?.name}
      />

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="isOutsource"
          defaultChecked={initial?.isOutsource}
          disabled={pending}
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <span className="space-y-1">
          <span className="block">外协工艺</span>
          <span className="block text-xs text-muted-foreground">
            勾选后，该工艺不创建内部生产任务，只加入外协清单。
          </span>
        </span>
      </label>

      <div className="space-y-2">
        <Label htmlFor="defaultWorkerType">接单岗位</Label>
        <select
          id="defaultWorkerType"
          name="defaultWorkerType"
          className={selectClass}
          defaultValue={initial?.defaultWorkerType ?? ''}
          disabled={pending}
        >
          <option value="">— 外协工艺无需选择 —</option>
          {PRODUCTION_WORKER_TYPE_OPTIONS.map((workerType) => (
            <option key={workerType} value={workerType}>
              {WORKER_TYPE_LABELS[workerType]}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          自产工艺必选，排产时只会显示岗位匹配的师傅。
        </p>
        {errs.defaultWorkerType?.[0] ? (
          <p className="text-sm text-destructive">{errs.defaultWorkerType[0]}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="defaultMachineType">机型（开机岗位 / 外协参考）</Label>
        <select
          id="defaultMachineType"
          name="defaultMachineType"
          className={selectClass}
          defaultValue={initial?.defaultMachineType ?? ''}
          disabled={pending}
        >
          <option value="">— 非开机工艺无需选择 —</option>
          {MACHINE_TYPE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {MACHINE_TYPE_LABELS[m]}
            </option>
          ))}
        </select>
        {errs.defaultMachineType?.[0] ? (
          <p className="text-sm text-destructive">{errs.defaultMachineType[0]}</p>
        ) : null}
      </div>

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
          {pending ? '提交中…' : isCreate ? '创建工艺' : '保存修改'}
        </Button>
        <PendingLink
          href={routeBase}
          pending={pending}
          className={buttonVariants({ variant: 'outline' })}
        >
          返回列表
        </PendingLink>
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
