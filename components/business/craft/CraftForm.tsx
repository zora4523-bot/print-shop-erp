'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { MachineType } from '../../../generated/prisma/enums';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CraftMutationResult } from '@/actions/owner-crafts.types';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';

type EditInitial = {
  name: string;
  code: string;
  isOutsource: boolean;
  defaultMachineType: MachineType | null;
  sortOrder: number;
  isActive: boolean;
};

type Props =
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
    };

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const MACHINE_TYPE_OPTIONS = [
  MachineType.HAND_PRESS,
  MachineType.WINDMILL,
  MachineType.GLUE,
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

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <TextField
        id="name"
        label="工艺名"
        hint="工艺的中文显示名，例如 专版单色平烫"
        required
        disabled={pending}
        error={errs.name?.[0]}
        defaultValue={initial?.name}
      />

      <TextField
        id="code"
        label="代码"
        hint="2–32 字符，大写字母/数字/下划线，字母开头（如 FLAT_FOIL_SINGLE）。作为历史工单的稳定标识，生效后谨慎修改。"
        required
        disabled={pending}
        error={errs.code?.[0]}
        defaultValue={initial?.code}
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
            勾选后，该工艺不创建内部生产任务，只加入外协清单（SPEC §6.1）。
          </span>
        </span>
      </label>

      <div className="space-y-2">
        <Label htmlFor="defaultMachineType">默认机器（派师傅推荐）</Label>
        <select
          id="defaultMachineType"
          name="defaultMachineType"
          className={selectClass}
          defaultValue={initial?.defaultMachineType ?? ''}
          disabled={pending}
        >
          <option value="">— 无（非机器工艺 / 纯外协）—</option>
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
        hint="数字越小越靠前，必须 ≥ 1。建议从 10 起每 10 留一档（10, 20, 30…）"
        type="number"
        required
        disabled={pending}
        error={errs.sortOrder?.[0]}
        // Create: no default (force explicit input so no accidental 0 that
        // would jump the new craft to the top). Edit: show the saved value.
        defaultValue={initial ? String(initial.sortOrder) : undefined}
      />

      {!isCreate ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={initial?.isActive}
            disabled={pending}
            className="h-4 w-4 rounded border-input"
          />
          <span>启用</span>
        </label>
      ) : null}

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-emerald-600">
          ✓ 已保存
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? '提交中…' : isCreate ? '创建工艺' : '保存修改'}
        </Button>
        <Link href="/owner/crafts" className={buttonVariants({ variant: 'outline' })}>
          返回列表
        </Link>
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
  ...inputProps
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  type?: string;
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
