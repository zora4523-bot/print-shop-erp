'use client';

import { useActionState, useState } from 'react';
// Browser-safe enum imports — /client pulls @prisma/client runtime (needs
// `node:module`) which Turbopack refuses to bundle for the client graph.
// /enums is pure const objects + string-literal types.
import {
  Role,
  WorkerType,
  MachineType,
  EmploymentType,
} from '../../../generated/prisma/enums';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ActionNotice,
  FormErrorSummary,
  FormMessage,
  PendingButton,
  formMessageA11yProps,
  type FormErrorSummaryItem,
} from '@/components/ui-business';
import type { AccountMutationResult } from '@/actions/owner-accounts.types';
import {
  ROLE_LABELS,
  WORKER_TYPE_LABELS,
  MACHINE_TYPE_LABELS,
} from '@/lib/auth/role-labels';
import { formatDateInputShanghai } from '@/lib/format/dates';

type EditInitial = {
  username: string;
  displayName: string;
  phone: string | null;
  role: Role;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  isActive: boolean;
  employmentType: EmploymentType | null;
  employmentStartDate: Date | null;
  employmentEndDate: Date | null;
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
  Role.ADMIN,
  Role.SALES,
  Role.WORKER,
] as const;

const WORKER_TYPE_OPTIONS = [
  WorkerType.MACHINE,
  WorkerType.PACKER,
] as const;

const MACHINE_TYPE_OPTIONS = [
  MachineType.HAND_PRESS,
  MachineType.WINDMILL,
  MachineType.GLUE,
] as const;

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  [EmploymentType.FULL_TIME]: '正式员工',
  [EmploymentType.PART_TIME]: '兼职',
  [EmploymentType.TEMPORARY]: '临时工',
};

const ACCOUNT_FIELD_LABELS: Record<string, string> = {
  username: '用户名',
  password: '初始密码',
  displayName: '姓名',
  phone: '电话',
  role: '角色',
  workerType: '岗位类型',
  machineType: '主机型',
  employmentType: '用工类型',
  employmentStartDate: '入职日期',
  employmentEndDate: '离职日期',
};

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
  const [employmentType, setEmploymentType] = useState<EmploymentType | ''>(
    initial?.employmentType ??
      (initial?.role === Role.WORKER
        ? EmploymentType.FULL_TIME
        : ''),
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
    if (next === Role.WORKER) {
      if (!employmentType) setEmploymentType(EmploymentType.FULL_TIME);
    } else {
      setEmploymentType('');
    }
  }
  function onWorkerTypeChange(next: WorkerType | '') {
    setWorkerType(next);
    if (next !== WorkerType.MACHINE) {
      setMachineType('');
    }
  }

  const visibleState = pending ? null : state;
  const errs = visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const generalError = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';
  const summaryErrors = toAccountErrorSummary(errs);

  return (
    <form
      action={formAction}
      aria-busy={pending}
      className="space-y-5"
      noValidate
    >
      <FormErrorSummary errors={summaryErrors} />

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
            hint="8–72 位"
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
          {...(errs.role?.[0] ? formMessageA11yProps('role', 'error') : {})}
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
          <FormMessage fieldId="role" tone="error">
            {errs.role[0]}
          </FormMessage>
        ) : null}
      </div>

      {role === Role.WORKER ? (
        <div className="space-y-2">
          <Label htmlFor="workerType">岗位类型</Label>
          <select
            id="workerType"
            name="workerType"
            {...(errs.workerType?.[0]
              ? formMessageA11yProps('workerType', 'error')
              : {})}
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
            <FormMessage fieldId="workerType" tone="error">
              {errs.workerType[0]}
            </FormMessage>
          ) : null}
        </div>
      ) : null}

      {role === Role.WORKER && workerType === WorkerType.MACHINE ? (
        <div className="space-y-2">
          <Label htmlFor="machineType">主机型</Label>
          <select
            id="machineType"
            name="machineType"
            {...formMessageA11yProps(
              'machineType',
              errs.machineType?.[0] ? 'error' : 'hint',
            )}
            className={selectClass}
            value={machineType}
            onChange={(e) =>
              setMachineType(e.target.value as MachineType | '')
            }
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
            <FormMessage fieldId="machineType" tone="error">
              {errs.machineType[0]}
            </FormMessage>
          ) : (
            <FormMessage fieldId="machineType" tone="hint" className="text-xs">
              主机型用于标识该账号所属的固定生产工序。
            </FormMessage>
          )}
        </div>
      ) : null}

      {role === Role.WORKER ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="employmentType">用工类型</Label>
            <select
              id="employmentType"
              name="employmentType"
              {...(errs.employmentType?.[0]
                ? formMessageA11yProps('employmentType', 'error')
                : {})}
              className={selectClass}
              value={employmentType}
              onChange={(event) =>
                setEmploymentType(event.target.value as EmploymentType)
              }
              disabled={pending}
            >
              {Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {errs.employmentType?.[0] ? (
              <FormMessage fieldId="employmentType" tone="error">
                {errs.employmentType[0]}
              </FormMessage>
            ) : null}
          </div>
          <TextField
            id="employmentStartDate"
            label="入职日期"
            type="date"
            disabled={pending}
            error={errs.employmentStartDate?.[0]}
            defaultValue={
              initial?.employmentStartDate
                ? formatDateInputShanghai(initial.employmentStartDate)
                : formatDateInputShanghai(new Date())
            }
          />
          <TextField
            id="employmentEndDate"
            label="离职日期（选填）"
            type="date"
            disabled={pending}
            error={errs.employmentEndDate?.[0]}
            defaultValue={
              initial?.employmentEndDate
                ? formatDateInputShanghai(initial.employmentEndDate)
                : ''
            }
          />
        </div>
      ) : null}

      {generalError ? (
        <ActionNotice
          tone="error"
          title="账号保存失败"
          description={generalError}
        />
      ) : null}
      {success ? (
        <ActionNotice tone="success" title="账号已保存" />
      ) : null}

      <div className="flex gap-3">
        <PendingButton pending={pending} pendingLabel="正在保存账号…">
          {isCreate ? '创建账号' : '保存修改'}
        </PendingButton>
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
        {...(error
          ? formMessageA11yProps(id, 'error')
          : hint
            ? formMessageA11yProps(id, 'hint')
            : {})}
        {...inputProps}
      />
      {error ? (
        <FormMessage fieldId={id} tone="error">
          {error}
        </FormMessage>
      ) : hint ? (
        <FormMessage fieldId={id} tone="hint" className="text-xs">
          {hint}
        </FormMessage>
      ) : null}
    </div>
  );
}

function toAccountErrorSummary(
  fieldErrors: Record<string, string[]>,
): FormErrorSummaryItem[] {
  return Object.entries(fieldErrors).flatMap(([fieldId, messages]) =>
    messages.map((message) => ({
      fieldId,
      label: ACCOUNT_FIELD_LABELS[fieldId] ?? '表单内容',
      message,
    })),
  );
}
