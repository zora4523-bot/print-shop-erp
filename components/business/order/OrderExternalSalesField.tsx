'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { OrderExternalSalesAssociation } from '@/lib/order/external-sales-association';

export function OrderExternalSalesField({ association, disabled, error }: {
  association: OrderExternalSalesAssociation;
  disabled: boolean;
  error?: string;
}) {
  const { current, options, blockedReason } = association;
  const [value, setValue] = useState(current?.id ?? '');
  const currentUnavailable = current && !options.some((option) => option.id === current.id);
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor="externalSalesUserId">关联外部销售</Label>
      <NativeSelect
        id="externalSalesUserId"
        name="externalSalesUserId"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={disabled || Boolean(blockedReason)}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={`external-sales-hint${error ? ' external-sales-error' : ''}`}
        className="w-full"
      >
        {!current ? <option value="">不适用</option> : null}
        {currentUnavailable ? (
          <option value={current.id} disabled={!blockedReason}>
            {current.displayName} · {current.username}{!blockedReason ? '（已停用或已变更角色）' : ''}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.displayName} · {option.username}
          </option>
        ))}
      </NativeSelect>
      <p id="external-sales-hint" className="text-xs text-muted-foreground">
        {blockedReason ?? '保存后工单及后续对账归属所选账号，原账号将无法查看此工单。'}
      </p>
      {error ? <p id="external-sales-error" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
