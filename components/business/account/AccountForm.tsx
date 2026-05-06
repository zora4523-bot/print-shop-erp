'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
// Browser-safe enum imports — /client pulls @prisma/client runtime (needs
// `node:module`) which Turbopack refuses to bundle for the client graph.
// /enums is pure const objects + string-literal types.
import {
  Role,
  WorkerType,
  MachineType,
} from '../../../generated/prisma/enums';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AccountMutationResult } from '@/actions/owner-accounts.types';
import {
  ROLE_LABELS,
  WORKER_TYPE_LABELS,
  MACHINE_TYPE_LABELS,
} from '@/lib/auth/role-labels';

type EditInitial = {
  username: string;
  displayName: string;
  phone: string | null;
  role: Role;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  isActive: boolean;
};

type Props =
  | {
      mode: 'create';
      action: (
        prev: AccountMutationResult | null,
        fd: FormData,
      ) => Promise<AccountMutationResult>;
    }
  | {
      mode: 'edit';
      action: (
        prev: AccountMutationResult | null,
        fd: FormData,
      ) => Promise<AccountMutationResult>;
      initial: EditInitial;
    };

// Simple native <select> styled to match shadcn Input — keeps the bundle
// small and works without JS hydration for the non-cascading selects.
const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const ROLE_OPTIONS = [
  Role.SALES,
  Role.CUSTOMER_SERVICE,
  Role.FOREMAN,
  Role.WORKER,
  Role.OWNER,
] as const;

const WORKER_TYPE_OPTIONS = [
  WorkerType.MACHINE,
  WorkerType.PACKER,
  WorkerType.CLEANER,
  WorkerType.COOK,
] as const;

const MACHINE_TYPE_OPTIONS = [
  MachineType.HAND_PRESS,
  MachineType.WINDMILL,
  MachineType.GLUE,
] as const;

export function AccountForm(props: Props) {
  const [state, formAction, pending] = useActionState<AccountMutationResult | null, FormData>(
    props.action,
    null,
  );
  const isCreate = props.mode === 'create';
  const initial = props.mode === 'edit' ? props.initial : undefined;

  const [role, setRole] = useState<Role>(initial?.role ?? Role.SALES);
  const [workerType, setWorkerType] = useState<WorkerType | ''>(initial?.workerType ?? '');
  const [machineType, setMachineType] = useState<MachineType | ''>(
    initial?.machineType ?? '',
  );

  // Cascade cleanup happens inline in the onChange handlers (not in a
  // useEffect) so we don't trip react-hooks/set-state-in-effect and so the
  // reset is observable to the same render that flipped the select.
  function onRoleChange(next: Role) {
    setRole(next);
    if (next !== Role.WORKER) {
      setWorkerType('');
      setMachineType('');
    }
  }
  function onWorkerTypeChange(next: WorkerType | '') {
    setWorkerType(next);
    if (next !== WorkerType.MACHINE) setMachineType('');
  }

  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {isCreate ? (
        <>
          <TextField
            id="username"
            label="用户名"
            hint="3–64 字符，字母/数字/下划线/连字符"
            required
            disabled={pending}
            error={errs.username?.[0]}
            autoComplete="off"
          />
          <TextField
            id="password"
            label="初始密码"
            hint="至少 8 位；最多 72 字符（bcrypt 限制）"
            type="password"
            required
            disabled={pending}
            error={errs.password?.[0]}
            autoComplete="new-password"
          />
        </>
      ) : null}

      <TextField
        id="displayName"
        label="姓名"
        required
        disabled={pending}
        error={errs.displayName?.[0]}
        defaultValue={initial?.displayName}
      />
      <TextField
        id="phone"
        label="电话（选填）"
        type="tel"
        disabled={pending}
        error={errs.phone?.[0]}
        defaultValue={initial?.phone ?? ''}
      />

      <div className="space-y-2">
        <Label htmlFor="role">角色</Label>
        <select
          id="role"
          name="role"
          className={selectClass}
          value={role}
          onChange={(e) => onRoleChange(e.target.value as Role)}
          disabled={pending}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        {errs.role?.[0] ? (
          <p className="text-sm text-destructive">{errs.role[0]}</p>
        ) : null}
      </div>

      {role === Role.WORKER ? (
        <div className="space-y-2">
          <Label htmlFor="workerType">岗位类型</Label>
          <select
            id="workerType"
            name="workerType"
            className={selectClass}
            value={workerType}
            onChange={(e) => onWorkerTypeChange(e.target.value as WorkerType | '')}
            disabled={pending}
          >
            <option value="">— 请选择 —</option>
            {WORKER_TYPE_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {WORKER_TYPE_LABELS[w]}
              </option>
            ))}
          </select>
          {errs.workerType?.[0] ? (
            <p className="text-sm text-destructive">{errs.workerType[0]}</p>
          ) : null}
        </div>
      ) : null}

      {role === Role.WORKER && workerType === WorkerType.MACHINE ? (
        <div className="space-y-2">
          <Label htmlFor="machineType">机器类型</Label>
          <select
            id="machineType"
            name="machineType"
            className={selectClass}
            value={machineType}
            onChange={(e) => setMachineType(e.target.value as MachineType | '')}
            disabled={pending}
          >
            <option value="">— 请选择 —</option>
            {MACHINE_TYPE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {MACHINE_TYPE_LABELS[m]}
              </option>
            ))}
          </select>
          {errs.machineType?.[0] ? (
            <p className="text-sm text-destructive">{errs.machineType[0]}</p>
          ) : null}
        </div>
      ) : null}

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success">
          ✓ 已保存
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? '提交中…' : isCreate ? '创建账号' : '保存修改'}
        </Button>
        <Link href="/owner/accounts" className={buttonVariants({ variant: 'outline' })}>
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
  autoComplete?: string;
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
