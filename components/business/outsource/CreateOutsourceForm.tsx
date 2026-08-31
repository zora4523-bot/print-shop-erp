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
import { Button } from '@/components/ui/button';
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
    <form onSubmit={handleSubmit} aria-busy={pending} className="space-y-6">
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
              <li key={it.id} className="flex items-center gap-3 text-sm">
                <input
                  id={`item-${it.id}`}
                  type="checkbox"
                  checked={!!selected[it.id]}
                  disabled={pending}
                  onChange={(e) =>
                    setSelected((prev) => ({
                      ...prev,
                      [it.id]: e.target.checked,
                    }))
                  }
                  className="h-4 w-4"
                />
                <Label htmlFor={`item-${it.id}`} className="flex-1">
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
          <span className="ml-2 text-xs text-muted-foreground">
            （由系统根据所选款式计算，不可手工修改）
          </span>
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
          供应商应付按外协报价或合同人工确认，不套用客户报价、员工计件工资或销售提成规则；金额未知时可留空，回货后再补录。
        </p>
      </section>

      {state?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive" aria-live="polite">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={pending || chosenIds.length === 0 || supplierName === ''}
        >
          {pending ? '提交中…' : '创建外协单'}
        </Button>
        <a
          href={`/orders/${orderId}`}
          className="text-sm text-muted-foreground underline"
        >
          返回工单详情
        </a>
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
