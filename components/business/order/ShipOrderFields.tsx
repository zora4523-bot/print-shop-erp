import type { OrderMutationResult } from '@/actions/order.types';
import { Input } from '@/components/ui/input';
import { ZTO_PROVINCE_OPTIONS } from '@/lib/price/external-order-charges';

import type { ShipmentInput } from '@/lib/order/shipping-fields';
import { RequiredMark } from '@/components/business/form/RequiredMark';
export type { ShipmentInput } from '@/lib/order/shipping-fields';

export function ShipOrderVersionFields({
  expectedRevision,
  expectedEditVersion,
  expectedWorkOrderVersion,
  expectedPriceRevision,
  initialIdempotencyKey,
}: {
  expectedRevision: number;
  expectedEditVersion: number;
  expectedWorkOrderVersion: number;
  expectedPriceRevision: number;
  initialIdempotencyKey: string;
}) {
  return (
    <>
      <input
        type="hidden"
        name="expectedRevision"
        value={String(expectedRevision)}
      />
      <input
        type="hidden"
        name="expectedEditVersion"
        value={String(expectedEditVersion)}
      />
      <input
        type="hidden"
        name="expectedWorkOrderVersion"
        value={String(expectedWorkOrderVersion)}
      />
      <input
        type="hidden"
        name="expectedPriceRevision"
        value={String(expectedPriceRevision)}
      />
      <input
        type="hidden"
        name="idempotencyKey"
        value={initialIdempotencyKey}
      />
    </>
  );
}

export function ShipOrderShipmentFields({
  shipments,
  isExternalSales,
  isSfCollect,
  result,
}: {
  shipments: readonly ShipmentInput[];
  isExternalSales: boolean;
  isSfCollect: boolean;
  result: OrderMutationResult | null;
}) {
  return (
    <ol className="space-y-3">
      {shipments.map((shipment, index) => (
        <ShipmentFieldsRow
          key={shipment.id}
          shipment={shipment}
          index={index}
          isExternalSales={isExternalSales}
          isSfCollect={isSfCollect}
          result={result}
        />
      ))}
    </ol>
  );
}

function ShipmentFieldsRow({
  shipment,
  index,
  isExternalSales,
  isSfCollect,
  result,
}: {
  shipment: ShipmentInput;
  index: number;
  isExternalSales: boolean;
  isSfCollect: boolean;
  result: OrderMutationResult | null;
}) {
  const fieldError = (field: string) =>
    result?.status === 'invalid'
      ? result.fieldErrors[`shipments.${index}.${field}`]?.join('；')
      : undefined;
  const trackingError = fieldError('trackingNo');
  const weightError = fieldError('weightKg');

  return (
    <li className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2">
      <div className="admin-wrap-anywhere min-w-0 text-sm sm:col-span-2">
        <p className="font-medium">地址 {shipment.sequence}</p>
        <p className="text-xs text-muted-foreground">
          {shipment.receiverName ?? '未填收货人'} ·{' '}
          {shipment.receiverAddress ?? '未填地址'}
        </p>
      </div>
      <div>
        <label
          htmlFor={`shipment-${shipment.id}-tracking`}
          className="mb-1 block text-xs font-medium"
        >
          运单号（选填）
        </label>
        <input type="hidden" name="shipmentId" value={shipment.id} />
        <Input
          id={`shipment-${shipment.id}-tracking`}
          type="text"
          name="shipmentTrackingNo"
          defaultValue={shipment.trackingNo ?? ''}
          placeholder="填写该地址的运单号"
          maxLength={64}
          aria-invalid={Boolean(trackingError)}
          aria-describedby={
            trackingError ? `shipment-${shipment.id}-tracking-error` : undefined
          }
        />
        <FieldError
          id={`shipment-${shipment.id}-tracking-error`}
          message={trackingError}
        />
      </div>
      <div>
        <label
          htmlFor={`shipment-${shipment.id}-weight`}
          className="mb-1 block text-xs font-medium"
        >
          {isExternalSales ? '承运商计费重量（kg）' : '快递重量（kg）'}{' '}
          {isExternalSales && !isSfCollect ? (
            <RequiredMark />
          ) : null}
        </label>
        {isSfCollect ? (
          <input type="hidden" name="shipmentWeightKg" value="" />
        ) : null}
        <Input
          id={`shipment-${shipment.id}-weight`}
          type="text"
          inputMode="decimal"
          name={isSfCollect ? undefined : 'shipmentWeightKg'}
          defaultValue={isSfCollect ? '' : shipment.weightKg ?? ''}
          disabled={isSfCollect}
          required={isExternalSales && !isSfCollect}
          aria-required={isExternalSales && !isSfCollect}
          placeholder={isSfCollect ? '顺丰到付无需填写' : '例如 12.5'}
          aria-invalid={Boolean(weightError)}
          aria-describedby={
            weightError
              ? `shipment-${shipment.id}-weight-error`
              : `shipment-${shipment.id}-weight-hint`
          }
        />
        <FieldError
          id={`shipment-${shipment.id}-weight-error`}
          message={weightError}
        />
        {!weightError ? (
          <p
            id={`shipment-${shipment.id}-weight-hint`}
            className="mt-1 text-xs text-muted-foreground"
          >
            {isSfCollect
              ? '顺丰到付的计费重量不计入工单应收。'
              : '填写承运商最终计费重量。'}
          </p>
        ) : null}
      </div>
      {isExternalSales ? (
        <ExternalSalesShipmentFields
          shipment={shipment}
          isSfCollect={isSfCollect}
          fieldError={fieldError}
        />
      ) : null}
    </li>
  );
}

function ExternalSalesShipmentFields({
  shipment,
  isSfCollect,
  fieldError,
}: {
  shipment: ShipmentInput;
  isSfCollect: boolean;
  fieldError: (field: string) => string | undefined;
}) {
  const provinceError = fieldError('destinationProvince');
  const shippingError = fieldError('shippingFee');
  const packingError = fieldError('packingMaterialFee');
  const reasonError = fieldError('customerChargeOverrideReason');

  return (
    <>
      <div>
        <label
          htmlFor={`shipment-${shipment.id}-province`}
          className="mb-1 block text-xs font-medium"
        >
          中通计费省份
        </label>
        <select
          id={`shipment-${shipment.id}-province`}
          name={isSfCollect ? undefined : 'shipmentDestinationProvince'}
          defaultValue={isSfCollect ? '' : shipment.destinationProvince ?? ''}
          disabled={isSfCollect}
          aria-invalid={Boolean(provinceError)}
          aria-describedby={
            provinceError
              ? `shipment-${shipment.id}-province-error`
              : `shipment-${shipment.id}-province-hint`
          }
          className="flex min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">— 人工确认 —</option>
          {ZTO_PROVINCE_OPTIONS.map((province) => (
            <option key={province} value={province}>
              {province}
            </option>
          ))}
        </select>
        {isSfCollect ? (
          <input type="hidden" name="shipmentDestinationProvince" value="" />
        ) : null}
        <FieldError
          id={`shipment-${shipment.id}-province-error`}
          message={provinceError}
        />
        {!provinceError ? (
          <p
            id={`shipment-${shipment.id}-province-hint`}
            className="mt-1 text-xs text-muted-foreground"
          >
            {isSfCollect
              ? '顺丰到付无需选择中通计费省份。'
              : '不在价目表内时留空并人工确认。'}
          </p>
        ) : null}
      </div>
      <div>
        <label
          htmlFor={`shipment-${shipment.id}-shipping-fee`}
          className="mb-1 block text-xs font-medium"
        >
          对客快递费（元）{' '}
          {!isSfCollect ? (
            <RequiredMark />
          ) : null}
        </label>
        {isSfCollect ? (
          <input type="hidden" name="shipmentShippingFee" value="0.00" />
        ) : null}
        <Input
          id={`shipment-${shipment.id}-shipping-fee`}
          type="text"
          inputMode="decimal"
          name={isSfCollect ? undefined : 'shipmentShippingFee'}
          defaultValue={isSfCollect ? '0.00' : shipment.shippingFee ?? ''}
          disabled={isSfCollect}
          required={!isSfCollect}
          aria-required={!isSfCollect}
          placeholder={isSfCollect ? '顺丰到付固定为 0' : '确认实际收费'}
          aria-invalid={Boolean(shippingError)}
          aria-describedby={
            shippingError
              ? `shipment-${shipment.id}-shipping-error`
              : `shipment-${shipment.id}-shipping-hint`
          }
        />
        <FieldError
          id={`shipment-${shipment.id}-shipping-error`}
          message={shippingError}
        />
        {!shippingError ? (
          <p
            id={`shipment-${shipment.id}-shipping-hint`}
            className="mt-1 text-xs text-muted-foreground"
          >
            {isSfCollect
              ? '顺丰到付固定提交 0 元。'
              : '必填；以实际对客收费为准。'}
          </p>
        ) : null}
      </div>
      <div>
        <label
          htmlFor={`shipment-${shipment.id}-packing-fee`}
          className="mb-1 block text-xs font-medium"
        >
          打包耗材费（元）{' '}
          <RequiredMark />
        </label>
        <Input
          id={`shipment-${shipment.id}-packing-fee`}
          type="text"
          inputMode="decimal"
          name="shipmentPackingMaterialFee"
          defaultValue={shipment.packingMaterialFee ?? ''}
          required
          aria-required="true"
          placeholder="确认纸箱等耗材收费"
          aria-invalid={Boolean(packingError)}
          aria-describedby={
            packingError
              ? `shipment-${shipment.id}-packing-error`
              : `shipment-${shipment.id}-packing-hint`
          }
        />
        <FieldError
          id={`shipment-${shipment.id}-packing-error`}
          message={packingError}
        />
        {!packingError ? (
          <p
            id={`shipment-${shipment.id}-packing-hint`}
            className="mt-1 text-xs text-muted-foreground"
          >
            顺丰到付也需单独确认纸箱等打包耗材费。
          </p>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <label
          htmlFor={`shipment-${shipment.id}-charge-reason`}
          className="mb-1 block text-xs font-medium"
        >
          收费调整说明
        </label>
        <textarea
          id={`shipment-${shipment.id}-charge-reason`}
          name="shipmentChargeOverrideReason"
          defaultValue={shipment.customerChargeOverrideReason ?? ''}
          rows={2}
          className="flex min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder="实际收费与报价建议不同时必填"
          aria-invalid={Boolean(reasonError)}
          aria-describedby={
            reasonError ? `shipment-${shipment.id}-reason-error` : undefined
          }
        />
        <FieldError
          id={`shipment-${shipment.id}-reason-error`}
          message={reasonError}
        />
      </div>
    </>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-destructive">
      {message}
    </p>
  );
}
