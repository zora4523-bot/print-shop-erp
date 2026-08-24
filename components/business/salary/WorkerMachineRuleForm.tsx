'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import type { MachineType } from '@/generated/prisma/enums';
import { createWorkerMachineSalaryRuleAction } from '@/actions/owner-salary';
import type { PieceworkRuleMutationResult } from '@/actions/owner-salary.types';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormMessage } from '@/components/ui-business';

type RuleDefaults = {
  dailyBase: string;
  pieceRate: string;
  boardRate: string;
  smallOrderThreshold: string;
  smallOrderFlatPrice: string;
  smallOrderInclusive: boolean;
  largeOrderSetupFee: string;
  multiplierFactors: string[];
};

export function WorkerMachineRuleForm({
  workers,
  defaultsByMachine,
  defaultEffectiveFrom,
}: {
  workers: Array<{
    id: string;
    displayName: string;
    username: string;
    machineType: MachineType;
    optionKey: string;
  }>;
  defaultsByMachine: Partial<Record<MachineType, RuleDefaults>>;
  defaultEffectiveFrom: string;
}) {
  const [selectedOptionKey, setSelectedOptionKey] = useState(
    workers[0]?.optionKey ?? '',
  );
  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.optionKey === selectedOptionKey),
    [selectedOptionKey, workers],
  );
  const machineType = selectedWorker?.machineType;
  const defaults = machineType ? defaultsByMachine[machineType] : undefined;
  const [state, action] = useActionState<
    PieceworkRuleMutationResult | null,
    FormData
  >(createWorkerMachineSalaryRuleAction, null);
  const [pending, startTransition] = useTransition();

  if (!selectedWorker || !machineType) {
    return <p className="text-sm text-muted-foreground">暂无启用中的开机师傅</p>;
  }

  return (
    <form
      key={`${selectedWorker.id}:${machineType}:${defaultEffectiveFrom}`}
      action={(formData) => startTransition(() => action(formData))}
      aria-busy={pending}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="师傅">
          <select
            value={selectedOptionKey}
            onChange={(event) => setSelectedOptionKey(event.target.value)}
            aria-label="师傅与机型"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            {workers.map((worker) => (
              <option key={worker.optionKey} value={worker.optionKey}>
                {worker.displayName}（{worker.username} ·{' '}
                {MACHINE_TYPE_LABELS[worker.machineType]}）
              </option>
            ))}
          </select>
          <input type="hidden" name="workerId" value={selectedWorker.id} />
        </Field>
        <Field label="机型">
          <Input value={MACHINE_TYPE_LABELS[machineType]} readOnly />
          <input type="hidden" name="machineType" value={machineType} />
        </Field>
        <Field label="生效时间">
          <Input
            name="effectiveFrom"
            type="datetime-local"
            defaultValue={defaultEffectiveFrom}
            required
          />
        </Field>
        <Field label="每日保底（元）">
          <Input
            name="dailyBase"
            inputMode="decimal"
            defaultValue={defaults?.dailyBase ?? ''}
            required
          />
        </Field>
        <Field label="每下单价（元）">
          <Input
            name="pieceRate"
            inputMode="decimal"
            defaultValue={defaults?.pieceRate ?? ''}
            required
          />
        </Field>
        <Field label="每板单价（元）">
          <Input
            name="boardRate"
            inputMode="decimal"
            defaultValue={defaults?.boardRate ?? ''}
            required
          />
        </Field>
        <Field label="小单阈值（留空=不启用）">
          <Input
            name="smallOrderThreshold"
            inputMode="numeric"
            defaultValue={defaults?.smallOrderThreshold ?? ''}
          />
        </Field>
        <Field label="小单固定金额（元）">
          <Input
            name="smallOrderFlatPrice"
            inputMode="decimal"
            defaultValue={defaults?.smallOrderFlatPrice ?? '0'}
            required
          />
        </Field>
        <Field label="大单一次性装板费（元）">
          <Input
            name="largeOrderSetupFee"
            inputMode="decimal"
            defaultValue={defaults?.largeOrderSetupFee ?? '0'}
            required
          />
        </Field>
        <Field label="备注">
          <Input name="remark" placeholder="例如：2026 年个人议价" maxLength={200} />
        </Field>
      </div>
      <fieldset className="flex flex-wrap gap-5 text-sm">
        <legend className="mb-2 text-xs text-muted-foreground">计数倍率</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="multiplierFactors"
            value="DOUBLE_SIDED"
            defaultChecked={defaults?.multiplierFactors.includes('DOUBLE_SIDED')}
          />
          双面 ×2
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="smallOrderInclusive"
            value="true"
            defaultChecked={defaults?.smallOrderInclusive ?? false}
          />
          小单阈值包含等于（≤）
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="multiplierFactors"
            value="DOUBLE_COLOR"
            defaultChecked={defaults?.multiplierFactors.includes('DOUBLE_COLOR')}
          />
          双色 ×2
        </label>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? '保存中…' : '新增规则版本'}
        </Button>
        <span className="text-xs text-muted-foreground">
          新版本会自动结束上一版本；已报工任务仍保留原规则快照。
        </span>
      </div>
      {state?.status === 'invalid' ? (
        <p role="alert" className="text-xs text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
      {state?.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">{state.message}</p>
      ) : null}
      {state?.status === 'success' ? (
        <FormMessage
          fieldId="worker-machine-rule-status"
          tone="success"
          className="text-xs"
        >
          规则版本已生效。
        </FormMessage>
      ) : null}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
