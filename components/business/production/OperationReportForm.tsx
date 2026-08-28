'use client';

import { useActionState } from 'react';
import { reportProductionOperationAction } from '@/actions/production-operations';
import type { ReportProductionOperationActionResult } from '@/actions/production-operations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function OperationReportForm({
  operationId,
  idempotencyKey,
  remainingQty,
}: {
  operationId: string;
  idempotencyKey: string;
  remainingQty: string;
}) {
  const action = reportProductionOperationAction.bind(null, operationId);
  const [state, formAction, pending] = useActionState<
    ReportProductionOperationActionResult | null,
    FormData
  >(action, null);

  return (
    <form action={formAction} aria-busy={pending} className="space-y-4" noValidate>
      <fieldset disabled={pending} className="space-y-4 border-0 p-0">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <QuantityField
          id="completedQty"
          label="本次合格完成数"
          defaultValue={remainingQty}
          disabled={pending}
        />
        <div className="grid grid-cols-2 gap-3">
          <QuantityField
            id="defectQty"
            label="缺陷数"
            defaultValue="0"
            disabled={pending}
          />
          <QuantityField
            id="reworkQty"
            label="返工数"
            defaultValue="0"
            disabled={pending}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          只有合格完成数计入计件；缺陷数与返工数只留作生产记录。
        </p>
        {state?.status === 'invalid' || state?.status === 'error' ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}
        {state?.status === 'success' ? (
          <p role="status" className="text-sm text-success-foreground">
            已记录本次报工，计件金额 ¥ {state.amount}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="min-h-13 w-full">
          {pending ? '提交中…' : '提交扫码报工'}
        </Button>
      </fieldset>
    </form>
  );
}

function QuantityField({
  id,
  label,
  defaultValue,
  disabled,
}: {
  id: string;
  label: string;
  defaultValue: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        required
        disabled={disabled}
        defaultValue={defaultValue}
      />
    </div>
  );
}
