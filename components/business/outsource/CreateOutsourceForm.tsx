'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createOutsourceAction } from '@/actions/outsource';
import type { OutsourceMutationResult } from '@/actions/outsource.types';

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
};

export function CreateOutsourceForm({ orderId, orderNo, items }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [supplierName, setSupplierName] = useState('');
  const [supplierContact, setSupplierContact] = useState('');
  const [craftDescription, setCraftDescription] = useState('');
  const [specialRequirement, setSpecialRequirement] = useState('');
  const [totalQty, setTotalQty] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');

  const [state, action] = useActionState<OutsourceMutationResult | null, unknown>(
    createOutsourceAction,
    null,
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const chosenIds = useMemo(
    () =>
      items
        .filter((it) => selected[it.id])
        .map((it) => it.id),
    [items, selected],
  );

  // createOutsourceAction ends with redirect() on success, which throws
  // NEXT_REDIRECT — useActionState never sees a 'success' value. So no
  // need to useEffect on state.status here.
  void router;

  function handleSubmit() {
    const payload = {
      orderId,
      orderItemIds: chosenIds,
      supplierName,
      supplierContact: supplierContact || null,
      craftDescription: craftDescription || null,
      specialRequirement: specialRequirement || null,
      totalQty: totalQty === '' ? null : totalQty,
      expectedDate: expectedDate || null,
      amount: amount === '' ? null : amount,
      remark: remark || null,
    };
    startTransition(() => action(payload));
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold">
          选择款式（工单 <span className="font-mono">{orderNo}</span>）
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
                  onChange={(e) =>
                    setSelected((prev) => ({
                      ...prev,
                      [it.id]: e.target.checked,
                    }))
                  }
                  className="h-4 w-4"
                />
                <Label htmlFor={`item-${it.id}`} className="flex-1">
                  #{it.sequence} · {it.name} · 数量{' '}
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
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold">外协厂信息</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="外协厂名 *"
            value={supplierName}
            onChange={setSupplierName}
            errors={fieldErrors(state, 'supplierName')}
          />
          <Field
            label="联系方式"
            value={supplierContact}
            onChange={setSupplierContact}
            errors={fieldErrors(state, 'supplierContact')}
          />
          <Field
            label="工艺 / 内容"
            value={craftDescription}
            onChange={setCraftDescription}
            errors={fieldErrors(state, 'craftDescription')}
            full
          />
          <Field
            label="特殊要求"
            value={specialRequirement}
            onChange={setSpecialRequirement}
            errors={fieldErrors(state, 'specialRequirement')}
            full
          />
          <Field
            label="总数量"
            value={totalQty}
            onChange={setTotalQty}
            errors={fieldErrors(state, 'totalQty')}
            inputMode="numeric"
          />
          <Field
            label="金额 (元)"
            value={amount}
            onChange={setAmount}
            errors={fieldErrors(state, 'amount')}
            inputMode="decimal"
          />
          <Field
            label="预计回货"
            value={expectedDate}
            onChange={setExpectedDate}
            errors={fieldErrors(state, 'expectedDate')}
            type="date"
          />
          <Field
            label="备注"
            value={remark}
            onChange={setRemark}
            errors={fieldErrors(state, 'remark')}
            full
          />
        </div>
      </section>

      {state?.status === 'error' ? (
        <p className="text-sm text-destructive">{state.message}</p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={handleSubmit}
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
    </div>
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
  onChange,
  errors,
  full,
  type = 'text',
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  errors: string[];
  full?: boolean;
  type?: string;
  inputMode?: 'numeric' | 'decimal';
}) {
  return (
    <div className={full ? 'col-span-2' : undefined}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        className={`mt-1 ${errors.length > 0 ? 'border-destructive' : ''}`}
      />
      {errors.length > 0 ? (
        <p className="mt-1 text-xs text-destructive">{errors[0]}</p>
      ) : null}
    </div>
  );
}
