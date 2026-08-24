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
  EmploymentType,
} from '../../../generated/prisma/enums';
import { buttonVariants } from '@/components/ui/button';
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
import type { WorkerCapabilityCraft } from '@/lib/account';

type EditInitial = {
  username: string;
  displayName: string;
  phone: string | null;
  role: Role;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  machineCapabilities: MachineType[];
  craftCapabilities: Array<{ craftId: string }>;
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
      capabilityCrafts: WorkerCapabilityCraft[];
    }
  | {
      mode: 'edit';
      action: (
        prev: AccountMutationResult | null,
        fd: FormData,
      ) => Promise<AccountMutationResult>;
      initial: EditInitial;
      capabilityCrafts: WorkerCapabilityCraft[];
    };

// Simple native <select> styled to match shadcn Input — keeps the bundle
// small and works without JS hydration for the non-cascading selects.
const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const ROLE_OPTIONS = [
  Role.ADMIN,
  Role.SALES,
  Role.CUSTOMER_SERVICE,
  Role.WORKER,
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
  machineCapabilities: '可操作机器',
  craftCapabilities: '熟练工艺',
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
  const [machineCapabilities, setMachineCapabilities] = useState<
    Set<MachineType>
  >(
    () =>
      new Set(
        initial?.machineCapabilities.length
          ? initial.machineCapabilities
          : initial?.machineType
            ? [initial.machineType]
            : [],
      ),
  );
  const [craftCapabilities, setCraftCapabilities] = useState<Set<string>>(
    () =>
      new Set(
        initial?.craftCapabilities.map((capability) => capability.craftId) ??
          [],
      ),
  );
  const [employmentType, setEmploymentType] = useState<EmploymentType | ''>(
    initial?.employmentType ??
      (initial?.role === Role.CUSTOMER_SERVICE || initial?.role === Role.WORKER
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
      setMachineCapabilities(new Set());
      setCraftCapabilities(new Set());
    }
    if (next === Role.CUSTOMER_SERVICE || next === Role.WORKER) {
      if (!employmentType) setEmploymentType(EmploymentType.FULL_TIME);
    } else {
      setEmploymentType('');
    }
  }
  function onWorkerTypeChange(next: WorkerType | '') {
    setWorkerType(next);
    setCraftCapabilities(new Set());
    if (next !== WorkerType.MACHINE) {
      setMachineType('');
      setMachineCapabilities(new Set());
    }
  }
  function onPrimaryMachineChange(next: MachineType | '') {
    setMachineType(next);
    if (!next) return;
    setMachineCapabilities((current) => new Set([...current, next]));
  }
  function toggleMachineCapability(machine: MachineType) {
    if (machine === machineType) return;
    setMachineCapabilities((current) => {
      const next = new Set(current);
      if (next.has(machine)) next.delete(machine);
      else next.add(machine);
      setCraftCapabilities((selected) =>
        new Set(
          [...selected].filter((craftId) => {
            const craft = props.capabilityCrafts.find(
              (candidate) => candidate.id === craftId,
            );
            return craft
              ? craftMatchesWorker(craft, workerType, next)
              : false;
          }),
        ),
      );
      return next;
    });
  }
  function toggleCraftCapability(craftId: string) {
    setCraftCapabilities((current) => {
      const next = new Set(current);
      if (next.has(craftId)) next.delete(craftId);
      else next.add(craftId);
      return next;
    });
  }

  const eligibleCapabilityCrafts = props.capabilityCrafts.filter((craft) =>
    craftMatchesWorker(craft, workerType, machineCapabilities),
  );

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
              onPrimaryMachineChange(e.target.value as MachineType | '')
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
              默认优先使用主机型；实际派工会按工艺与可操作机器的交集锁定计薪机型。
            </FormMessage>
          )}
        </div>
      ) : null}

      {role === Role.WORKER && workerType === WorkerType.MACHINE ? (
        <fieldset
          id="machineCapabilities"
          {...(errs.machineCapabilities?.[0]
            ? formMessageA11yProps('machineCapabilities', 'error')
            : {})}
          className="space-y-2 rounded-lg border p-3"
        >
          <legend className="px-1 text-sm font-medium">可操作机器</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {MACHINE_TYPE_OPTIONS.map((machine) => (
              <label
                key={machine}
                className="flex min-h-11 items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
              >
                {machine === machineType ? (
                  <input
                    type="hidden"
                    name="machineCapabilities"
                    value={machine}
                  />
                ) : null}
                <input
                  type="checkbox"
                  name={
                    machine === machineType
                      ? undefined
                      : 'machineCapabilities'
                  }
                  value={machine}
                  checked={machineCapabilities.has(machine)}
                  disabled={pending || machine === machineType}
                  onChange={() => toggleMachineCapability(machine)}
                  className="size-4"
                />
                <span>
                  {MACHINE_TYPE_LABELS[machine]}
                  {machine === machineType ? '（主机型）' : ''}
                </span>
              </label>
            ))}
          </div>
          {errs.machineCapabilities?.[0] ? (
            <FormMessage fieldId="machineCapabilities" tone="error">
              {errs.machineCapabilities[0]}
            </FormMessage>
          ) : null}
        </fieldset>
      ) : null}

      {role === Role.WORKER && workerType ? (
        <fieldset
          id="craftCapabilities"
          {...(errs.craftCapabilities?.[0]
            ? formMessageA11yProps('craftCapabilities', 'error')
            : {})}
          className="space-y-2 rounded-lg border p-3"
        >
          <legend className="px-1 text-sm font-medium">熟练工艺（推荐项）</legend>
          <p className="text-xs text-muted-foreground">
            勾选后排产时优先推荐。管理员仍可把设备和岗位匹配的其他工艺派给该师傅，但必须填写原因。
          </p>
          {eligibleCapabilityCrafts.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {eligibleCapabilityCrafts.map((craft) => (
                <label
                  key={craft.id}
                  className="flex min-h-11 items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="craftCapabilities"
                    value={craft.id}
                    checked={craftCapabilities.has(craft.id)}
                    disabled={pending}
                    onChange={() => toggleCraftCapability(craft.id)}
                    className="size-4"
                  />
                  <span className="break-words">{craft.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-warning-foreground">
              当前岗位或机器能力没有可配置的内部工艺。
            </p>
          )}
          {errs.craftCapabilities?.[0] ? (
            <FormMessage fieldId="craftCapabilities" tone="error">
              {errs.craftCapabilities[0]}
            </FormMessage>
          ) : null}
        </fieldset>
      ) : null}

      {role === Role.CUSTOMER_SERVICE || role === Role.WORKER ? (
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
                ? initial.employmentStartDate.toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10)
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
                ? initial.employmentEndDate.toISOString().slice(0, 10)
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
        <Link href="/owner/accounts" className={buttonVariants({ variant: 'outline' })}>
          返回列表
        </Link>
      </div>
    </form>
  );
}

function craftMatchesWorker(
  craft: WorkerCapabilityCraft,
  workerType: WorkerType | '',
  machineCapabilities: Set<MachineType>,
): boolean {
  if (
    !workerType ||
    craft.defaultWorkerType !== workerType ||
    (craft.isOutsource && craft.inHouseMachineTypes.length === 0)
  ) {
    return false;
  }
  if (workerType !== WorkerType.MACHINE) return true;
  const allowedMachines =
    craft.inHouseMachineTypes.length > 0
      ? craft.inHouseMachineTypes
      : craft.defaultMachineType
        ? [craft.defaultMachineType]
        : [];
  return allowedMachines.some((machine) => machineCapabilities.has(machine));
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
      label: ACCOUNT_FIELD_LABELS[fieldId] ?? fieldId,
      message,
    })),
  );
}
