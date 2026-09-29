'use client';

import { forwardRef, useId } from 'react';
import type { ExternalSalesAccountOption } from '@/lib/order/external-sales-association';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { FieldError } from './order-form-b/OrderFieldPrimitives';
import { RequiredMark } from '@/components/business/form/RequiredMark';

/** 寄样品 / 打样的管理员代建入口：与普通建单同一个「关联外部销售」选择。 */
export const SampleExternalSalesField = forwardRef<HTMLSelectElement, {
  accounts: readonly ExternalSalesAccountOption[];
  value: string | null;
  error: string | null;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}>(function SampleExternalSalesField({ accounts, value, error, disabled, onChange }, ref) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-sales`}>关联外部销售<RequiredMark /></Label>
      <NativeSelect ref={ref} id={`${id}-sales`} required aria-required="true" disabled={disabled}
        aria-invalid={Boolean(error)} aria-describedby={`${id}-sales-hint`}
        value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">请选择外部销售</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>{account.displayName} · {account.username}</option>
        ))}
      </NativeSelect>
      <FieldError id={`${id}-sales-hint`} reservedLines={1} hint="工单归属所选外部销售并按外部销售结算。">
        {error ?? undefined}
      </FieldError>
    </div>
  );
});
