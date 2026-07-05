'use client';

import { useActionState, useTransition } from 'react';
import {
  useForm,
  useFieldArray,
  Controller,
  type SubmitHandler,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { createOrderSchema, type CreateOrderInput } from '@/lib/auth/schemas';
import { createOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';
import type { CustomerPartyOption } from '@/lib/party';

export type CraftOption = {
  id: string;
  name: string;
  isOutsource: boolean;
};

export type ProductOption = {
  id: string;
  name: string;
  category: string;
};

type Props = {
  crafts: CraftOption[];
  products: ProductOption[];
  customerParties: CustomerPartyOption[];
};

const BLANK_ITEM: CreateOrderInput['items'][number] = {
  name: '',
  productId: null,
  specification: null,
  paperType: null,
  quantity: 1000,
  crafts: [],
  foilColor: null,
  isDoubleSided: false,
  isDoubleColor: false,
  unitPrice: null,
  suggestedPrice: null,
  remark: null,
};

export function OrderForm({ crafts, products, customerParties }: Props) {
  const form = useForm<CreateOrderInput>({
    // zodResolver's generics don't fully compose with preprocess-bearing
    // schemas (moneyOptionalField uses `z.preprocess`, which splits
    // z.input / z.output). The runtime contract still holds — we just
    // widen the compile-time seam.
    resolver: zodResolver(createOrderSchema) as never,
    mode: 'onBlur',
    defaultValues: {
      customerRef: null,
      customerPartyId: null,
      receiverName: null,
      receiverPhone: null,
      receiverAddress: null,
      expressCode: null,
      packageRequirement: null,
      remark: null,
      isUrgent: false,
      items: [{ ...BLANK_ITEM }],
    },
  });
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
    setValue,
  } = form;
  const itemsArray = useFieldArray({ control, name: 'items' });
  const partySelectRegistration = register('customerPartyId', {
    setValueAs: (v) => (v === '' ? null : v),
  });

  // createOrderAction succeeds by throwing NEXT_REDIRECT — useActionState
  // returns state on non-redirect outcomes (invalid / error) only.
  const [state, dispatch] = useActionState<OrderMutationResult | null, CreateOrderInput>(
    async (_prev, payload) => createOrderAction(_prev, payload),
    null,
  );
  const [submitting, startSubmit] = useTransition();

  const onValid: SubmitHandler<CreateOrderInput> = (data) => {
    startSubmit(() => {
      dispatch(data);
    });
  };

  const applyCustomerParty = (partyId: string) => {
    const selected = customerParties.find((party) => party.id === partyId);
    if (!selected) {
      setValue('customerPartyId', null, { shouldDirty: true });
      return;
    }

    setValue('customerPartyId', selected.id, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue('customerRef', selected.code, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue('receiverName', selected.receiverName ?? selected.contactName, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue('receiverPhone', selected.receiverPhone ?? selected.contactPhone, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue('receiverAddress', selected.receiverAddress, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  // Zod produces dotted paths like `items.0.quantity` on the action side
  // (actions/order.ts collectFieldErrors). Those don't apply here because
  // RHF's client-side validation renders field errors via its own tree.
  // `state?.fieldErrors` from the server still captures backend-only
  // checks (craft id existence, product deactivated) that client Zod
  // doesn't know about.
  const serverFieldErrors =
    state?.status === 'invalid' ? state.fieldErrors : undefined;
  const serverGeneralError =
    state?.status === 'error' ? state.message : null;

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-6" noValidate>
      <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold">基本信息</h2>

        <div className="space-y-1">
          <Label>客户主数据（选填）</Label>
          <select
            className={selectClass}
            {...partySelectRegistration}
            onChange={(event) => {
              partySelectRegistration.onChange(event);
              applyCustomerParty(event.target.value);
            }}
          >
            <option value="">— 不关联 —</option>
            {customerParties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.code} · {party.shortName ?? party.name}
              </option>
            ))}
          </select>
          {errors.customerPartyId?.message ? (
            <p className="text-xs text-destructive">
              {errors.customerPartyId.message}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="客户代号"
            registration={register('customerRef')}
            error={errors.customerRef?.message}
          />
          <TextField
            label="快递代码"
            registration={register('expressCode')}
            error={errors.expressCode?.message}
          />
          <TextField
            label="收货人"
            registration={register('receiverName')}
            error={errors.receiverName?.message}
          />
          <TextField
            label="收货电话"
            registration={register('receiverPhone')}
            error={errors.receiverPhone?.message}
          />
        </div>

        <TextareaField
          label="收货地址"
          registration={register('receiverAddress')}
          error={errors.receiverAddress?.message}
          rows={2}
        />
        <TextareaField
          label="包装要求"
          registration={register('packageRequirement')}
          error={errors.packageRequirement?.message}
          rows={2}
        />
        <TextareaField
          label="工单备注"
          registration={register('remark')}
          error={errors.remark?.message}
          rows={2}
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            {...register('isUrgent')}
            className="h-4 w-4 rounded border-input"
          />
          <span>急单（提交后会推送至排产群）</span>
        </label>
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">款式（{itemsArray.fields.length}）</h2>
          <Button
            type="button"
            variant="outline"
            onClick={() => itemsArray.append({ ...BLANK_ITEM })}
          >
            添加款式
          </Button>
        </div>

        {errors.items?.message ? (
          <p className="text-sm text-destructive">{errors.items.message}</p>
        ) : null}

        <ol className="space-y-4">
          {itemsArray.fields.map((field, index) => (
            <li key={field.id} className="rounded-lg border p-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">#{index + 1}</span>
                {itemsArray.fields.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => itemsArray.remove(index)}
                  >
                    删除
                  </Button>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="款式名"
                  required
                  registration={register(`items.${index}.name`)}
                  error={errors.items?.[index]?.name?.message}
                />
                <div className="space-y-1">
                  <Label>产品（选填）</Label>
                  <select
                    className={selectClass}
                    {...register(`items.${index}.productId`, {
                      setValueAs: (v) => (v === '' ? null : v),
                    })}
                  >
                    <option value="">— 不关联 —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <TextField
                  label="规格"
                  registration={register(`items.${index}.specification`)}
                  error={errors.items?.[index]?.specification?.message}
                />
                <TextField
                  label="纸张"
                  registration={register(`items.${index}.paperType`)}
                  error={errors.items?.[index]?.paperType?.message}
                />
                <TextField
                  label="数量"
                  required
                  type="number"
                  min={1}
                  step={1}
                  registration={register(`items.${index}.quantity`, {
                    valueAsNumber: true,
                  })}
                  error={errors.items?.[index]?.quantity?.message}
                />
                <TextField
                  label="烫金色"
                  registration={register(`items.${index}.foilColor`)}
                  error={errors.items?.[index]?.foilColor?.message}
                />
                <TextField
                  label="单价（选填）"
                  hint="Decimal(10,4)：整数部分 ≤ 6 位，小数 ≤ 4 位"
                  registration={register(`items.${index}.unitPrice`, {
                    setValueAs: (v) => (v === '' ? null : v),
                  })}
                  error={errors.items?.[index]?.unitPrice?.message}
                />
                <TextField
                  label="建议单价（选填）"
                  registration={register(`items.${index}.suggestedPrice`, {
                    setValueAs: (v) => (v === '' ? null : v),
                  })}
                  error={errors.items?.[index]?.suggestedPrice?.message}
                />
              </div>

              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...register(`items.${index}.isDoubleSided`)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>双面</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...register(`items.${index}.isDoubleColor`)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>双色</span>
                </label>
              </div>

              <div className="space-y-1">
                <Label>工艺（至少选一项）</Label>
                <Controller
                  control={control}
                  name={`items.${index}.crafts`}
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-3">
                      {crafts.map((c) => {
                        const checked = field.value?.includes(c.id) ?? false;
                        return (
                          <label
                            key={c.id}
                            className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set(field.value ?? []);
                                if (e.target.checked) next.add(c.id);
                                else next.delete(c.id);
                                field.onChange([...next]);
                              }}
                              className="h-3.5 w-3.5 rounded border-input"
                            />
                            <span>{c.name}</span>
                            {c.isOutsource ? (
                              <span className="text-[10px] text-muted-foreground">
                                （外协）
                              </span>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  )}
                />
                {errors.items?.[index]?.crafts?.message ? (
                  <p className="text-sm text-destructive">
                    {errors.items?.[index]?.crafts?.message}
                  </p>
                ) : null}
              </div>

              <TextareaField
                label="款式备注"
                registration={register(`items.${index}.remark`)}
                error={errors.items?.[index]?.remark?.message}
                rows={2}
              />
            </li>
          ))}
        </ol>
      </section>

      {serverGeneralError ? (
        <p role="alert" className="text-sm text-destructive">
          {serverGeneralError}
        </p>
      ) : null}
      {serverFieldErrors ? (
        <p role="alert" className="text-sm text-destructive">
          服务端校验失败：{Object.entries(serverFieldErrors)
            .flatMap(([k, v]) => v.map((m) => `${k}: ${m}`))
            .join('；')}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? '提交中…' : '创建工单（草稿）'}
        </Button>
        <Link href="/orders" className={buttonVariants({ variant: 'outline' })}>
          返回列表
        </Link>
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Field primitives — keep the big form body readable
// ──────────────────────────────────────────────────────────────────────

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

type Registration = ReturnType<ReturnType<typeof useForm<CreateOrderInput>>['register']>;

function TextField({
  label,
  hint,
  required,
  error,
  registration,
  type = 'text',
  min,
  step,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string | undefined;
  registration: Registration;
  type?: string;
  min?: number;
  step?: number;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        type={type}
        min={min}
        step={step}
        aria-invalid={Boolean(error)}
        {...registration}
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function TextareaField({
  label,
  rows = 2,
  error,
  registration,
}: {
  label: string;
  rows?: number;
  error?: string | undefined;
  registration: Registration;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <textarea
        rows={rows}
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-invalid={Boolean(error)}
        {...registration}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
