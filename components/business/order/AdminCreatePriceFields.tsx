'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import { formatRate } from '@/lib/format/unit-price';

type Price = NonNullable<CreateOrderInput['items'][number]['adminPrice']>;

export function AdminCreatePriceFields({
  value,
  amountId,
  factsKey,
  onChange,
  disabled,
  suggestedAmount,
  error,
  title = '款式加工费',
  priceLabel = '本款加工费（元）',
  note = '包装费、版费和运费另列。',
}: {
  value: Price | undefined;
  amountId?: string;
  factsKey: string;
  onChange: (value: Price | undefined) => void;
  disabled: boolean;
  suggestedAmount?: string | null;
  error?: string;
  title?: string;
  priceLabel?: string;
  note?: string;
}) {
  const id = useId();
  const stale = value !== undefined && value.factsKey !== factsKey;
  return (
    <fieldset disabled={disabled} className="space-y-3 border-t pt-4">
      <legend className="text-sm font-semibold">{title}</legend>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="min-h-11"
          type="button"
          variant={value ? 'outline' : 'default'}
          aria-pressed={!value}
          onClick={() => onChange(undefined)}
        >
          自动计价
        </Button>
        <Button
          className="min-h-11"
          type="button"
          variant={value ? 'default' : 'outline'}
          aria-pressed={Boolean(value)}
          onClick={() =>
            onChange(
              value ?? { amount: suggestedAmount ?? '', reason: '', factsKey },
            )
          }
        >
          人工定价
        </Button>
        {suggestedAmount != null ? (
          <span className="text-sm text-muted-foreground">
            自动报价 {formatRate(suggestedAmount)}
          </span>
        ) : null}
      </div>
      {value ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={amountId ?? `${id}-amount`}>{priceLabel}</Label>
            <Input
              className="min-h-11"
              id={amountId ?? `${id}-amount`}
              inputMode="decimal"
              maxLength={13}
              value={value.amount}
              onChange={(event) =>
                onChange({ ...value, amount: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-reason`}>定价原因</Label>
            <Input
              className="min-h-11"
              id={`${id}-reason`}
              maxLength={200}
              value={value.reason}
              onChange={(event) =>
                onChange({ ...value, reason: event.target.value })
              }
            />
          </div>
          {note ? (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              {note}
            </p>
          ) : null}
          <div role="status" className="min-h-5 space-y-2 sm:col-span-2">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {stale ? (
              <Button
                className="min-h-11"
                type="button"
                variant="outline"
                onClick={() => onChange({ ...value, factsKey })}
              >
                确认当前人工价格
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
