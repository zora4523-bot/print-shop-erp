'use client';

import {
  useActionState,
  useCallback,
  useId,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { DisabledReason, PendingLink } from '@/components/ui-business';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createOutsourceAction } from '@/actions/outsource';
import type { OutsourceMutationResult } from '@/actions/outsource.types';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { nextOutsourceIdempotencyKey } from './idempotency';

export type OutsourceFormItem = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
};

type Props = {
  orderId: string;
  orderNo: string;
  items: OutsourceFormItem[];
  initialIdempotencyKey: string;
};

export function CreateOutsourceForm({
  orderId,
  orderNo,
  items,
  initialIdempotencyKey,
}: Props) {
  const router = useRouter();
  const [idempotencyKey, setIdempotencyKey] = useState(
    initialIdempotencyKey,
  );
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [supplierName, setSupplierName] = useState('');
  const [supplierContact, setSupplierContact] = useState('');
  const [craftDescription, setCraftDescription] = useState('');
  const [specialRequirement, setSpecialRequirement] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');

  const submitOutsource = useCallback(
    async (previous: OutsourceMutationResult | null, raw: unknown) => {
      const result = await createOutsourceAction(previous, raw);
      setIdempotencyKey((current) =>
        nextOutsourceIdempotencyKey(
          current,
          result,
          () => window.crypto.randomUUID(),
        ),
      );
      if (result.status === 'success') {
        router.push(`/foreman/outsource/${result.id}`);
      }
      return result;
    },
    [router],
  );
  const [state, action] = useActionState<OutsourceMutationResult | null, unknown>(
    submitOutsource,
    null,
  );
  const [pending, startTransition] = useTransition();

  const chosenIds = useMemo(
    () =>
      items
        .filter((it) => selected[it.id])
        .map((it) => it.id),
    [items, selected],
  );
  const chosenTotalQty = useMemo(
    () =>
      items.reduce(
        (sum, item) => sum + (selected[item.id] ? item.quantity : 0),
        0,
      ),
    [items, selected],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const payload = {
      idempotencyKey,
      orderId,
      orderItemIds: chosenIds,
      supplierName,
      supplierContact: supplierContact || null,
      craftDescription: craftDescription || null,
      specialRequirement: specialRequirement || null,
      // The server always derives and verifies this value from the selected
      // order items. It is sent only as a stale-page/tamper guard.
      totalQty: chosenTotalQty,
      expectedDate: expectedDate || null,
      amount: amount === '' ? null : amount,
      remark: remark || null,
    };
    startTransition(() => action(payload));
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={pending} className="admin-wrap-anywhere min-w-0 space-y-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold">
          选择款式（工单 <span className="font-sans tabular-nums">{orderNo}</span>）
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">该工单没有可外协的款式。</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="flex min-w-0 items-start gap-1 text-sm">
                <Checkbox
                  className="-ml-3"
                  id={`item-${it.id}`}
                  checked={!!selected[it.id]}
                  disabled={pending}
                  aria-label={`#${it.sequence} · ${externalPriceBusinessText(it.name)} · 数量 ${it.quantity.toLocaleString()}`}
                  onCheckedChange={(checked) =>
                    setSelected((prev) => ({
                      ...prev,
                      [it.id]: checked,
                    }))
                  }
                />
                <Label htmlFor={`item-${it.id}`} className="block min-w-0 flex-1 pt-3 leading-5">
                  #{it.sequence} · {externalPriceBusinessText(it.name)} · 数量{' '}
                  {it.quantity.toLocaleString()}
                </Label>
              </li>
            ))}
          </ul>
        )}
        {fieldErrors(state, 'orderItemIds').length > 0 ? (
          <p className="text-xs text-destructive">
            {fieldErrors(state, 'orderItemIds')[0]}
          </p>
        ) : null}
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">已选款式合计：</span>{' '}
          <output aria-live="polite" className="font-medium tabular-nums">
            {chosenTotalQty.toLocaleString()} 个
          </output>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold">外协厂信息</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="外协厂名 *"
            value={supplierName}
            disabled={pending}
            onChange={setSupplierName}
            errors={fieldErrors(state, 'supplierName')}
          />
          <Field
            label="联系方式"
            value={supplierContact}
            disabled={pending}
            onChange={setSupplierContact}
            errors={fieldErrors(state, 'supplierContact')}
          />
          <Field
            label="工艺 / 内容"
            value={craftDescription}
            disabled={pending}
            onChange={setCraftDescription}
            errors={fieldErrors(state, 'craftDescription')}
            full
          />
          <Field
            label="特殊要求"
            value={specialRequirement}
            disabled={pending}
            onChange={setSpecialRequirement}
            errors={fieldErrors(state, 'specialRequirement')}
            full
          />
          <Field
            label="供应商应付金额（人工确认，元）"
            value={amount}
            disabled={pending}
            onChange={setAmount}
            errors={fieldErrors(state, 'amount')}
            inputMode="decimal"
          />
          <Field
            label="预计回货"
            value={expectedDate}
            disabled={pending}
            onChange={setExpectedDate}
            errors={fieldErrors(state, 'expectedDate')}
            type="date"
          />
          <Field
            label="备注"
            value={remark}
            disabled={pending}
            onChange={setRemark}
            errors={fieldErrors(state, 'remark')}
            full
          />
        </div>
        <p className="text-xs text-muted-foreground">
          外协金额选填，回货后可补录。
        </p>
      </section>

      {state?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive" aria-live="polite">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {!pending && (chosenIds.length === 0 || supplierName === '') ? (
          <DisabledReason
            cause="prerequisite"
            reason={chosenIds.length === 0 ? '先勾选要外协的款式。' : '先选择外协厂。'}
          >
            <Button type="submit" disabled={pending || chosenIds.length === 0 || supplierName === ''}>创建并标记已发出</Button>
          </DisabledReason>
        ) : (
          <Button type="submit" disabled={pending}>
            {pending ? '正在创建外协单…' : '创建并标记已发出'}
          </Button>
        )}
        <PendingLink
          pending={pending}
          href={`/orders/${orderId}`}
          className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
        >
          返回工单详情
        </PendingLink>
      </div>
    </form>
  );
}

function fieldErrors(
  state: OutsourceMutationResult | null,
  name: string,
): string[] {
  if (!state || state.status !== 'invalid') return [];
  return state.fieldErrors[name] ?? [];
}

function Field({
  label,
  value,
  disabled,
  onChange,
  errors,
  full,
  type = 'text',
  inputMode,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  errors: string[];
  full?: boolean;
  type?: string;
  inputMode?: 'numeric' | 'decimal';
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={inputId}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        aria-invalid={errors.length > 0}
        aria-describedby={errors.length > 0 ? errorId : undefined}
        className={`mt-1 ${errors.length > 0 ? 'border-destructive' : ''}`}
      />
      {errors.length > 0 ? (
        <p
          id={errorId}
          className="mt-1 text-xs text-destructive"
          aria-live="polite"
        >
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}
