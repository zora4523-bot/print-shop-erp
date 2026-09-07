'use client';

import { useActionState, useRef, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setOrderSfCollectAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';
import { OrderStatus } from '@/generated/prisma/enums';
import { ZTO_PROVINCE_OPTIONS } from '@/lib/price/external-order-charges';
import { isFulfillmentPricingStatus } from '@/lib/order/fulfillment-pricing-policy';

type Props = {
  orderId: string;
  currentValue: boolean;
  status: OrderStatus;
  isExternalSales: boolean;
  mutationGuard?: {
    expectedOrderRevision: number;
    expectedEditVersion: number;
    expectedWorkOrderVersion: number;
    expectedPriceRevision: number;
  };
  shipments: Array<{
    id: string;
    sequence: number;
    destinationProvince: string | null;
    weightKg: string | null;
    shippingFee: string | null;
    customerChargeOverrideReason: string | null;
  }>;
};

export function SfCollectToggleForm({
  orderId,
  currentValue,
  status,
  isExternalSales,
  mutationGuard,
  shipments,
}: Props) {
  const bound = setOrderSfCollectAction.bind(null, orderId);
  const [state, action] = useActionState<OrderMutationResult | null, FormData>(
    bound,
    null,
  );
  const [pending, startTransition] = useTransition();
  const idempotencyKey = useRef<string | null>(null);
  const awaitsLogisticsReview = isExternalSales && isFulfillmentPricingStatus(status);
  const target = !currentValue;
  const requiresShippedChargeCorrection =
    currentValue &&
    isExternalSales &&
    status === OrderStatus.SHIPPED;

  const fieldError = (index: number, field: string) =>
    state?.status === 'invalid'
      ? state.fieldErrors[`shipments.${index}.${field}`]?.join('；')
      : undefined;

  return (
    <form
      action={(formData) => {
        if (pending) return;
        formData.set('isSfCollect', String(target));
        if (mutationGuard) {
          idempotencyKey.current ??= crypto.randomUUID();
          formData.set('idempotencyKey', idempotencyKey.current);
        }
        startTransition(() => action(formData));
      }}
      aria-busy={pending}
      className={
        requiresShippedChargeCorrection
          ? 'w-full space-y-4 rounded-lg border border-warning/40 bg-warning/5 p-3 sm:p-4'
          : 'flex flex-wrap items-center gap-2'
      }
      aria-label={
        requiresShippedChargeCorrection
          ? '取消顺丰到付并补录每票快递费'
          : undefined
      }
    >
      <input type="hidden" name="isSfCollect" value={String(target)} />
      {mutationGuard ? Object.entries(mutationGuard).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      )) : null}
      {requiresShippedChargeCorrection ? (
        <>
          <div>
            <p className="text-sm font-medium">
              已发货工单取消顺丰到付
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              快递费已终审，必须按每票补齐计费省份和最终重量。实际快递费留空时，系统使用该工单冻结的价目自动核价。
            </p>
          </div>
          <div className="space-y-3">
            {shipments.map((shipment, index) => {
              const provinceError = fieldError(index, 'destinationProvince');
              const weightError = fieldError(index, 'weightKg');
              const shippingError = fieldError(index, 'shippingFee');
              const reasonError = fieldError(
                index,
                'customerChargeOverrideReason',
              );
              const prefix = `sf-shipment-${shipment.id}`;

              return (
                <fieldset
                  key={shipment.id}
                  className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border bg-background p-3 sm:grid-cols-2"
                >
                  <legend className="px-1 text-sm font-medium">
                    地址 {shipment.sequence}
                  </legend>
                  <input type="hidden" name="sfShipmentId" value={shipment.id} />
                  <div className="min-w-0 space-y-1">
                    <label htmlFor={`${prefix}-province`} className="text-xs font-medium">
                      计费省份 <RequiredMark />
                    </label>
                    <select
                      id={`${prefix}-province`}
                      name="sfShipmentDestinationProvince"
                      defaultValue={shipment.destinationProvince ?? ''}
                      disabled={pending}
                      required
                      aria-required="true"
                      aria-invalid={Boolean(provinceError)}
                      aria-describedby={
                        provinceError ? `${prefix}-province-error` : undefined
                      }
                      className={selectClass}
                    >
                      <option value="">— 请选择 —</option>
                      {ZTO_PROVINCE_OPTIONS.map((province) => (
                        <option key={province} value={province}>
                          {province}
                        </option>
                      ))}
                    </select>
                    <FieldError
                      id={`${prefix}-province-error`}
                      message={provinceError}
                    />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <label htmlFor={`${prefix}-weight`} className="text-xs font-medium">
                      最终计费重量（kg） <RequiredMark />
                    </label>
                    <Input
                      id={`${prefix}-weight`}
                      name="sfShipmentWeightKg"
                      type="text"
                      inputMode="decimal"
                      defaultValue={shipment.weightKg ?? ''}
                      disabled={pending}
                      required
                      aria-required="true"
                      aria-invalid={Boolean(weightError)}
                      aria-describedby={
                        weightError ? `${prefix}-weight-error` : undefined
                      }
                      placeholder="例如 12.5"
                    />
                    <FieldError
                      id={`${prefix}-weight-error`}
                      message={weightError}
                    />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <label
                      htmlFor={`${prefix}-shipping-fee`}
                      className="text-xs font-medium"
                    >
                      实际对客快递费（元，选填）
                    </label>
                    <Input
                      id={`${prefix}-shipping-fee`}
                      name="sfShipmentShippingFee"
                      type="text"
                      inputMode="decimal"
                      defaultValue={shipment.shippingFee ?? ''}
                      disabled={pending}
                      aria-invalid={Boolean(shippingError)}
                      aria-describedby={
                        shippingError
                          ? `${prefix}-shipping-error`
                          : `${prefix}-shipping-hint`
                      }
                      placeholder="留空则按创建时价格自动核价"
                    />
                    <FieldError
                      id={`${prefix}-shipping-error`}
                      message={shippingError}
                    />
                    {!shippingError ? (
                      <p
                        id={`${prefix}-shipping-hint`}
                        className="text-xs text-muted-foreground"
                      >
                        手工填写表示以该金额为准；与系统建议不同时请说明原因。
                      </p>
                    ) : null}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <label htmlFor={`${prefix}-reason`} className="text-xs font-medium">
                      收费调整说明
                    </label>
                    <textarea
                      id={`${prefix}-reason`}
                      name="sfShipmentChargeOverrideReason"
                      defaultValue={
                        shipment.customerChargeOverrideReason ?? ''
                      }
                      disabled={pending}
                      rows={2}
                      maxLength={500}
                      aria-invalid={Boolean(reasonError)}
                      aria-describedby={
                        reasonError ? `${prefix}-reason-error` : undefined
                      }
                      className={`${selectClass} min-h-20 resize-y py-2`}
                      placeholder="人工收费与系统建议不同时必填"
                    />
                    <FieldError
                      id={`${prefix}-reason-error`}
                      message={reasonError}
                    />
                  </div>
                </fieldset>
              );
            })}
          </div>
        </>
      ) : null}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending
          ? '处理中…'
          : requiresShippedChargeCorrection
            ? '确认取消并重新核算应收'
            : currentValue
              ? '取消顺丰到付'
              : '标记顺丰到付'}
      </Button>
      {awaitsLogisticsReview ? (
        <p className="w-full text-xs text-muted-foreground">
          更正后需管理员确认物流费用，确认前不能发货或结算；已审核款式价格不变。
        </p>
      ) : null}
      {state?.status === 'error' ? (
        <span role="alert" className="text-xs text-destructive">
          {state.message}
        </span>
      ) : null}
      {state?.status === 'invalid' ? (
        <span role="alert" className="block text-xs text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </span>
      ) : null}
    </form>
  );
}

const selectClass =
  'flex min-h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}
