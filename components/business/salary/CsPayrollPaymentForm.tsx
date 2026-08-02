'use client';

import { useActionState, useCallback, useRef, useState } from 'react';
import { recordCsPayrollPaymentAction } from '@/actions/owner-salary';
import type { CsPayrollPaymentResult } from '@/actions/owner-salary.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  periodId: string;
  remainingBase: string;
  remainingCommission: string;
  commissionAvailable: boolean;
  initialIdempotencyKey: string;
};

export function CsPayrollPaymentForm({
  periodId,
  remainingBase,
  remainingCommission,
  commissionAvailable,
  initialIdempotencyKey,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const submitPayment = useCallback(
    async (previous: CsPayrollPaymentResult | null, formData: FormData) => {
      const result = await recordCsPayrollPaymentAction(
        periodId,
        previous,
        formData,
      );
      if (result.status === 'success') {
        formRef.current?.reset();
        setIdempotencyKey(window.crypto.randomUUID());
      }
      return result;
    },
    [periodId],
  );
  const [state, action, pending] = useActionState<
    CsPayrollPaymentResult | null,
    FormData
  >(submitPayment, null);
  const fieldErrors = state?.status === 'invalid' ? state.fieldErrors : {};

  return (
    <form ref={formRef} action={action} className="space-y-4" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="cs-base-payment"
          name="baseAmount"
          label="本次发放底薪（元）"
          hint={`剩余可发 ¥ ${remainingBase}`}
          error={fieldErrors.baseAmount?.[0]}
          disabled={pending}
        />
        <Field
          id="cs-commission-payment"
          name="commissionAmount"
          label="本次发放提成（元）"
          hint={
            commissionAvailable
              ? `剩余可发 ¥ ${remainingCommission}`
              : '周期结算后才可发放提成'
          }
          error={fieldErrors.commissionAmount?.[0]}
          disabled={pending || !commissionAvailable}
        />
        <div className="space-y-1">
          <Label htmlFor="cs-payroll-paid-at">发放时间</Label>
          <Input
            id="cs-payroll-paid-at"
            type="datetime-local"
            name="paidAt"
            defaultValue={shanghaiDateTimeLocal(new Date())}
            disabled={pending}
            required
          />
          {fieldErrors.paidAt?.[0] ? (
            <p className="text-xs text-destructive">{fieldErrors.paidAt[0]}</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="cs-payroll-method">发放方式</Label>
          <Input
            id="cs-payroll-method"
            name="paymentMethod"
            maxLength={32}
            placeholder="微信 / 支付宝 / 银行"
            disabled={pending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cs-payroll-reference">流水号</Label>
          <Input
            id="cs-payroll-reference"
            name="referenceNo"
            maxLength={64}
            disabled={pending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cs-payroll-remark">备注</Label>
          <Input
            id="cs-payroll-remark"
            name="remark"
            maxLength={200}
            placeholder="例如：第 3 月底薪、周期提成"
            disabled={pending}
          />
        </div>
      </div>

      {state?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      {state?.status === 'invalid' ? (
        <p role="alert" className="text-sm text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
      {state?.status === 'success' ? (
        <p role="status" className="text-sm text-success">
          已记录发放；累计底薪 ¥ {state.paidBase}，累计提成 ¥{' '}
          {state.paidCommission}。
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="min-h-11">
        {pending ? '记录中…' : '记录工资发放'}
      </Button>
      <p className="text-xs text-muted-foreground">
        每次发放都会追加独立流水，不能覆盖或撤销。提交前请核对金额、时间和流水号。
      </p>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  hint,
  error,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  error?: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        inputMode="decimal"
        placeholder="0.00"
        disabled={disabled}
        aria-invalid={Boolean(error)}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function shanghaiDateTimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
