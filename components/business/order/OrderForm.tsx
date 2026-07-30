'use client';

import { useState, useTransition } from 'react';
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
import { useRouter } from 'next/navigation';
import { createOrderSchema, type CreateOrderInput } from '@/lib/auth/schemas';
import { createOrderAction } from '@/actions/order';
import type { CreateOrderMutationResult } from '@/actions/order.types';
import type { CustomerPartyOption } from '@/lib/party';
import {
  PendingDesignImages,
  type PendingDesignImage,
} from './PendingDesignImages';
import { OrderItemChoiceField } from './OrderItemChoiceField';
import { OrderFoilColorsField } from './OrderFoilColorsField';
import {
  ORDER_PAPER_OPTIONS,
  ORDER_SPECIFICATION_OPTIONS,
} from './order-item-options';
import { uploadOrderItemDesignFile } from './design-upload-client';

export type CraftOption = {
  id: string;
  name: string;
  isOutsource: boolean;
  isLowFrequency: boolean;
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
  foilColors: [],
  isDoubleSided: false,
  isDoubleColor: false,
  unitPrice: null,
  suggestedPrice: null,
  remark: null,
};

export function OrderForm({ crafts, products, customerParties }: Props) {
  const router = useRouter();
  const form = useForm<CreateOrderInput>({
    // zodResolver's generics don't fully compose with preprocess-bearing
    // schemas (moneyOptionalField uses `z.preprocess`, which splits
    // z.input / z.output). The runtime contract still holds — we just
    // widen the compile-time seam.
    resolver: zodResolver(createOrderSchema) as never,
    mode: 'onBlur',
    defaultValues: {
      customName: null,
      customerRef: null,
      customerPartyId: null,
      receiverName: null,
      receiverPhone: null,
      receiverAddress: null,
      expressCode: null,
      packageRequirement: null,
      remark: null,
      promisedDate: null,
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
  const commonCrafts = crafts.filter((craft) => !craft.isLowFrequency);
  const lowFrequencyCrafts = crafts.filter((craft) => craft.isLowFrequency);

  const [state, setState] = useState<CreateOrderMutationResult | null>(null);
  const [pendingDesigns, setPendingDesigns] = useState<
    Record<string, PendingDesignImage[]>
  >({});
  const [createdDraft, setCreatedDraft] = useState<{
    orderId: string;
    itemIds: string[];
    fieldIds: string[];
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  async function uploadPendingDesigns(
    draft: NonNullable<typeof createdDraft>,
    queues: Record<string, PendingDesignImage[]>,
  ) {
    const total = draft.fieldIds.reduce(
      (sum, fieldId) => sum + (queues[fieldId]?.length ?? 0),
      0,
    );
    if (total === 0) {
      router.push(`/orders/${draft.orderId}`);
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadProgress({ completed: 0, total });
    const failed: Record<string, PendingDesignImage[]> = {};
    const failureMessages: string[] = [];
    let completed = 0;

    for (const [itemIndex, fieldId] of draft.fieldIds.entries()) {
      const itemId = draft.itemIds[itemIndex];
      const images = queues[fieldId] ?? [];
      if (!itemId) {
        if (images.length > 0) {
          failed[fieldId] = images;
          failureMessages.push(`款式 ${itemIndex + 1} 的数据库编号缺失`);
        }
        completed += images.length;
        setUploadProgress({ completed, total });
        continue;
      }

      for (const image of images) {
        const result = await uploadOrderItemDesignFile({
          orderId: draft.orderId,
          orderItemId: itemId,
          prepared: image.prepared,
        });
        completed += 1;
        setUploadProgress({ completed, total });
        if (!result.ok) {
          (failed[fieldId] ??= []).push(image);
          failureMessages.push(
            `款式 ${itemIndex + 1} · ${image.prepared.file.name}：${result.message}`,
          );
        }
      }
    }

    setPendingDesigns(failed);
    setUploading(false);
    if (failureMessages.length === 0) {
      router.push(`/orders/${draft.orderId}`);
      return;
    }
    setUploadError(
      `草稿已创建，但有 ${failureMessages.length} 张图片未上传：${failureMessages.join('；')}`,
    );
  }

  const onValid: SubmitHandler<CreateOrderInput> = (data) => {
    if (createdDraft) return;
    const fieldIds = itemsArray.fields.map((field) => field.id);
    const queueSnapshot = Object.fromEntries(
      fieldIds.map((fieldId) => [fieldId, pendingDesigns[fieldId] ?? []]),
    );

    setState(null);
    setUploadError(null);
    startSubmit(async () => {
      const result = await createOrderAction(null, data);
      setState(result);
      if (result.status !== 'success') return;

      const draft = {
        orderId: result.orderId,
        itemIds: result.itemIds,
        fieldIds,
      };
      setCreatedDraft(draft);
      await uploadPendingDesigns(draft, queueSnapshot);
    });
  };

  function updatePendingDesigns(fieldId: string, images: PendingDesignImage[]) {
    setPendingDesigns((current) => {
      if (images.length === 0) {
        const next = { ...current };
        delete next[fieldId];
        return next;
      }
      return { ...current, [fieldId]: images };
    });
  }

  function removeItem(index: number, fieldId: string) {
    itemsArray.remove(index);
    updatePendingDesigns(fieldId, []);
  }

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
      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">基本信息</h2>

        <div className="space-y-1">
          <Label htmlFor="customerPartyId">客户主数据（选填）</Label>
          <select
            id="customerPartyId"
            className={selectClass}
            aria-invalid={Boolean(errors.customerPartyId?.message)}
            aria-describedby={
              errors.customerPartyId?.message ? 'customerPartyId-error' : undefined
            }
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
            <p id="customerPartyId-error" role="alert" className="text-xs text-destructive">
              {errors.customerPartyId.message}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="工单自定义名称"
            hint="例如：王总中秋礼盒首批；最多 100 个字符"
            full
            registration={register('customName')}
            error={errors.customName?.message}
          />
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="承诺交期（选填）"
            type="date"
            registration={register('promisedDate')}
            error={errors.promisedDate?.message as string | undefined}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            {...register('isUrgent')}
            className="h-4 w-4 rounded border-input"
          />
          <span>急单（提交后会推送至排产群）</span>
        </label>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">款式（{itemsArray.fields.length}）</h2>
          <Button
            type="button"
            variant="outline"
            disabled={submitting || uploading || Boolean(createdDraft)}
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
            <li key={field.id} className="min-w-0 space-y-3 rounded-lg border p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">#{index + 1}</span>
                {itemsArray.fields.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting || uploading || Boolean(createdDraft)}
                    onClick={() => removeItem(index, field.id)}
                  >
                    删除
                  </Button>
                ) : null}
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <TextField
                  label="款式名"
                  required
                  registration={register(`items.${index}.name`)}
                  error={errors.items?.[index]?.name?.message}
                />
                <div className="space-y-1">
                  <Label htmlFor={`items.${index}.productId`}>产品（选填）</Label>
                  <select
                    id={`items.${index}.productId`}
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
              </div>

              <Controller
                control={control}
                name={`items.${index}.specification`}
                render={({ field: specificationField }) => (
                  <OrderItemChoiceField
                    id={`items.${index}.specification`}
                    label="规格"
                    value={specificationField.value}
                    options={ORDER_SPECIFICATION_OPTIONS}
                    customLabel="非标定制（自定义尺寸）"
                    customInputLabel="自定义尺寸 / 规格"
                    customPlaceholder="例如：9.5 × 17.2 cm、客户来样"
                    maxLength={64}
                    disabled={submitting || uploading || Boolean(createdDraft)}
                    error={errors.items?.[index]?.specification?.message}
                    onChange={specificationField.onChange}
                    onBlur={specificationField.onBlur}
                  />
                )}
              />

              <Controller
                control={control}
                name={`items.${index}.paperType`}
                render={({ field: paperField }) => (
                  <OrderItemChoiceField
                    id={`items.${index}.paperType`}
                    label="纸张"
                    value={paperField.value}
                    options={ORDER_PAPER_OPTIONS}
                    customLabel="其他纸张（自定义）"
                    customInputLabel="自定义纸张"
                    customPlaceholder="输入特殊纸张名称"
                    maxLength={32}
                    disabled={submitting || uploading || Boolean(createdDraft)}
                    error={errors.items?.[index]?.paperType?.message}
                    onChange={paperField.onChange}
                    onBlur={paperField.onBlur}
                  />
                )}
              />

              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
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
                  label="单价（选填）"
                  hint="整数部分 ≤ 6 位，小数 ≤ 4 位"
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

              <Controller
                control={control}
                name={`items.${index}.foilColors`}
                render={({ field: foilColorsField }) => (
                  <OrderFoilColorsField
                    id={`items.${index}.foilColors`}
                    value={foilColorsField.value}
                    disabled={submitting || uploading || Boolean(createdDraft)}
                    error={errors.items?.[index]?.foilColors?.message}
                    onChange={foilColorsField.onChange}
                    onBlur={foilColorsField.onBlur}
                  />
                )}
              />

              <div className="flex flex-wrap gap-4 sm:gap-6">
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

              <div className="space-y-2">
                <Controller
                  control={control}
                  name={`items.${index}.crafts`}
                  render={({ field }) => {
                    const selected = new Set(field.value ?? []);
                    const toggle = (craftId: string) => {
                      const next = new Set(selected);
                      if (next.has(craftId)) next.delete(craftId);
                      else next.add(craftId);
                      field.onChange([...next]);
                    };
                    const controlsDisabled =
                      submitting || uploading || Boolean(createdDraft);

                    return (
                      <fieldset
                        aria-invalid={Boolean(errors.items?.[index]?.crafts?.message)}
                        aria-describedby={
                          errors.items?.[index]?.crafts?.message
                            ? `items.${index}.crafts-error`
                            : undefined
                        }
                      >
                        <legend className="text-sm font-medium">
                          工艺（至少选一项，可多选）
                        </legend>
                        <p className="mt-1 text-xs text-muted-foreground">
                          点击卡片选择；外协工艺会在提交后进入外协流程
                        </p>
                        <CraftToggleGrid
                          crafts={commonCrafts}
                          selected={selected}
                          disabled={controlsDisabled}
                          onToggle={toggle}
                        />
                        {lowFrequencyCrafts.length > 0 ? (
                          <div className="mt-4 border-t pt-3">
                            <p className="mb-2 text-xs font-medium text-muted-foreground">
                              低频工艺
                            </p>
                            <CraftToggleGrid
                              crafts={lowFrequencyCrafts}
                              selected={selected}
                              disabled={controlsDisabled}
                              onToggle={toggle}
                              compact
                            />
                          </div>
                        ) : null}
                      </fieldset>
                    );
                  }}
                />
                {errors.items?.[index]?.crafts?.message ? (
                  <p
                    id={`items.${index}.crafts-error`}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {errors.items?.[index]?.crafts?.message}
                  </p>
                ) : null}
              </div>

              <TextareaField
                label="款式备注"
                hint="关键颜色、方向、工艺避坑等信息会在生产端高亮显示"
                tone="destructive"
                registration={register(`items.${index}.remark`)}
                error={errors.items?.[index]?.remark?.message}
                rows={2}
              />

              <PendingDesignImages
                itemNumber={index + 1}
                images={pendingDesigns[field.id] ?? []}
                disabled={submitting || uploading || Boolean(createdDraft)}
                onChange={(images) => updatePendingDesigns(field.id, images)}
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

      {createdDraft ? (
        <div
          className={
            uploadError
              ? 'rounded-lg border border-warning/50 bg-warning/10 p-4'
              : 'rounded-lg border border-primary/30 bg-primary/5 p-4'
          }
        >
          <p className="font-medium text-foreground">工单草稿已创建</p>
          {uploading && uploadProgress ? (
            <p role="status" aria-live="polite" className="mt-1 text-sm text-muted-foreground">
              正在上传设计图：{uploadProgress.completed} / {uploadProgress.total}
            </p>
          ) : null}
          {uploadError ? (
            <p role="alert" className="mt-1 break-words text-sm text-warning-foreground">
              {uploadError}
            </p>
          ) : null}
          {!uploading && uploadError ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void uploadPendingDesigns(createdDraft, pendingDesigns)}
              >
                重试未上传图片
              </Button>
              <Link
                href={`/orders/${createdDraft.orderId}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                打开草稿
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={submitting || uploading || Boolean(createdDraft)}>
          {createdDraft
            ? '草稿已创建'
            : submitting
              ? '创建中…'
              : '创建工单（草稿）'}
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
  'flex min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

function CraftToggleGrid({
  crafts,
  selected,
  disabled,
  onToggle,
  compact = false,
}: {
  crafts: CraftOption[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (craftId: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? 'grid grid-cols-2 gap-2 sm:grid-cols-4'
          : 'mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4'
      }
    >
      {crafts.map((craft) => {
        const checked = selected.has(craft.id);
        return (
          <Button
            key={craft.id}
            type="button"
            aria-pressed={checked}
            disabled={disabled}
            variant="outline"
            size="lg"
            className={
              checked
                ? 'min-h-11 min-w-0 shrink items-center justify-start gap-2 whitespace-normal rounded-lg border-primary bg-primary/10 px-3 py-2 text-left text-xs font-medium text-primary hover:bg-primary/15 hover:text-primary'
                : 'min-h-11 min-w-0 shrink items-center justify-start gap-2 whitespace-normal rounded-lg border-input bg-background px-3 py-2 text-left text-xs text-foreground hover:bg-muted'
            }
            onClick={() => onToggle(craft.id)}
          >
            <span
              aria-hidden="true"
              className={
                checked
                  ? 'flex size-4 shrink-0 items-center justify-center rounded border border-primary bg-primary text-[10px] text-primary-foreground'
                  : 'block size-4 shrink-0 rounded border border-input'
              }
            >
              {checked ? '✓' : ''}
            </span>
            <span className="min-w-0 flex-1 break-words">{craft.name}</span>
            {craft.isOutsource ? (
              <span className="shrink-0 rounded bg-warning/10 px-1 py-0.5 text-[10px] text-warning-foreground">
                外协
              </span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}

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
  full,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string | undefined;
  registration: Registration;
  type?: string;
  min?: number;
  step?: number;
  full?: boolean;
}) {
  const fieldId = registration.name;
  const messageId = `${fieldId}-message`;
  return (
    <div className={`min-w-0 space-y-1${full ? ' sm:col-span-2' : ''}`}>
      <Label htmlFor={fieldId}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        id={fieldId}
        type={type}
        min={min}
        step={step}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? messageId : undefined}
        {...registration}
      />
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function TextareaField({
  label,
  hint,
  tone = 'default',
  rows = 2,
  error,
  registration,
}: {
  label: string;
  hint?: string;
  tone?: 'default' | 'destructive';
  rows?: number;
  error?: string | undefined;
  registration: Registration;
}) {
  const fieldId = registration.name;
  const messageId = `${fieldId}-message`;
  const destructive = tone === 'destructive';
  return (
    <div
      className="min-w-0 space-y-1"
    >
      <Label htmlFor={fieldId}>{label}</Label>
      <textarea
        id={fieldId}
        rows={rows}
        className={
          destructive
            ? 'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-semibold text-destructive shadow-xs caret-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
            : 'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
        }
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? messageId : undefined}
        {...registration}
      />
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p
          id={messageId}
          className="text-xs text-muted-foreground"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
