'use client';

import { useActionState, useState } from 'react';
import type { CustomerPartyOption } from '@/lib/party';
import type { EditableShipment } from '@/lib/order/edit-shipment-fields';
import { OrderReceiverContactFields } from './OrderReceiverContactFields';
import { ActionNotice } from '@/components/ui-business';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateOrderAction } from '@/actions/order';
import type { OrderMutationResult } from '@/actions/order.types';

export type EditableFieldset = 'FULL' | 'SHIPPING_ONLY';

export type EditOrderInitialValues = {
  customName: string | null;
  customerRef: string | null;
  customerPartyId?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress: string | null;
  expressCode: string | null;
  packageRequirement: string | null;
  remark: string | null;
  // YYYY-MM-DD（页面层从 Date 转好）
  promisedDate: string | null;
  isUrgent: boolean;
};

type Props = {
  orderId: string;
  expectedEditVersion: number;
  fieldset: EditableFieldset;
  initial: EditOrderInitialValues;
  customers?: readonly CustomerPartyOption[];
  shipments?: readonly EditableShipment[];
  isExternalSales?: boolean;
  isSfCollect?: boolean;
  blocked?: boolean;
};

const FULL_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'customName',
  'customerRef',
  'isUrgent',
]);

export function EditOrderForm({
  orderId,
  expectedEditVersion,
  fieldset,
  initial,
  customers = [],
  shipments,
  isExternalSales = false,
  isSfCollect = false,
  blocked = false,
}: Props) {
  const boundAction = updateOrderAction.bind(null, orderId);
  const [state, formAction, pending] = useActionState<
    OrderMutationResult | null,
    FormData
  >(boundAction, null);

  const isShippingOnly = fieldset === 'SHIPPING_ONLY';
  const [customerId, setCustomerId] = useState(initial.customerPartyId ?? '');
  const [urgent, setUrgent] = useState(initial.isUrgent);
  const [delivery, setDelivery] = useState(() =>
    shipments?.map((row) => ({
      ...row,
      expectedDestinationProvince: row.destinationProvince,
      sameDestination: false,
    })),
  );
  const pendingLocked = pending || blocked;
  const unknownCustomer =
    initial.customerPartyId &&
    !customers.some((customer) => customer.id === initial.customerPartyId);
  function changeDelivery(
    index: number,
    key: 'receiverName' | 'receiverPhone' | 'receiverAddress' | 'expressCode',
    value: string,
  ) {
    setDelivery((rows) =>
      rows?.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [key]: value,
              ...(key === 'receiverAddress' ? { sameDestination: false } : {}),
            }
          : row,
      ),
    );
  }

  return (
    <form action={formAction} aria-busy={pending} className="space-y-6">
      <input
        type="hidden"
        name="expectedEditVersion"
        value={expectedEditVersion}
      />
      {delivery ? (
        <input
          type="hidden"
          name="shipments"
          value={JSON.stringify(
            delivery.map(
              ({
                id,
                receiverName,
                receiverPhone,
                receiverAddress,
                expressCode,
                expectedDestinationProvince,
                sameDestination,
              }) => ({
                id,
                receiverName,
                receiverPhone,
                receiverAddress,
                expressCode,
                expectedDestinationProvince,
                sameDestination,
              }),
            ),
          )}
        />
      ) : null}
      {blocked ? (
        <ActionNotice
          tone="warning"
          title="存在待审批申请"
          description="处理当前申请后再修改工单。"
        />
      ) : null}
      {isShippingOnly && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
          工单已进入排产 / 生产，仅可修改收货信息与备注。
        </div>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">基本信息</h2>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            name="customName"
            label="工单名称"
            full
            disabled={
              pendingLocked ||
              (FULL_ONLY_FIELDS.has('customName') && isShippingOnly)
            }
            initial={initial.customName}
            errors={fieldErrors(state, 'customName')}
          />
          <Field
            name="customerRef"
            label="客户名称/简称（选填）"
            disabled={
              pendingLocked ||
              (FULL_ONLY_FIELDS.has('customerRef') && isShippingOnly)
            }
            initial={initial.customerRef}
            errors={fieldErrors(state, 'customerRef')}
          />
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="customerPartyId">关联客户</Label>
            <select
              id="customerPartyId"
              name="customerPartyId"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              disabled={pendingLocked || isShippingOnly}
              className="min-h-11 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">未关联客户</option>
              {unknownCustomer ? (
                <option value={initial.customerPartyId!}>
                  当前客户（已停用）
                </option>
              ) : null}
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {customer.shortName ? ` · ${customer.shortName}` : ''}
                </option>
              ))}
            </select>
            {fieldErrors(state, 'customerPartyId')[0] ? (
              <p role="alert" className="text-xs text-destructive">
                {fieldErrors(state, 'customerPartyId')[0]}
              </p>
            ) : null}
          </div>
          {delivery === undefined ? (
            <>
              <div className="sm:col-span-2">
                <OrderReceiverContactFields
                  receiverName={initial.receiverName ?? null}
                  receiverPhone={initial.receiverPhone ?? null}
                  disabled={pendingLocked}
                  required={isExternalSales}
                  errors={{
                    receiverName: fieldErrors(state, 'receiverName')[0],
                    receiverPhone: fieldErrors(state, 'receiverPhone')[0],
                  }}
                />
              </div>
              <Field
                name="expressCode"
                label="快递代码"
                disabled={pendingLocked}
                initial={initial.expressCode}
                errors={fieldErrors(state, 'expressCode')}
              />
              <Field
                name="receiverAddress"
                label="收货地址"
                full
                multiline
                required
                disabled={pendingLocked}
                initial={initial.receiverAddress}
                errors={fieldErrors(state, 'receiverAddress')}
              />
            </>
          ) : null}
          <Field
            name="packageRequirement"
            label="包装要求"
            full
            disabled={pendingLocked}
            initial={initial.packageRequirement}
            errors={fieldErrors(state, 'packageRequirement')}
          />
          <Field
            name="remark"
            label="工单备注"
            full
            multiline
            disabled={pendingLocked}
            initial={initial.remark}
            errors={fieldErrors(state, 'remark')}
          />
          {!isShippingOnly && (
            <Field
              name="promisedDate"
              label="承诺交期"
              type="date"
              disabled={pendingLocked}
              initial={initial.promisedDate}
              errors={fieldErrors(state, 'promisedDate')}
            />
          )}
          {!isShippingOnly && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 sm:col-span-2 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
              <Checkbox
                id="isUrgent"
                name="isUrgent"
                value="on"
                checked={urgent}
                onCheckedChange={(value) => setUrgent(value === true)}
                disabled={pendingLocked}
                aria-label="标记为急单"
              />
              <span className="text-sm">标记为急单</span>
              <input type="hidden" name="isUrgent" value="false" />
            </label>
          )}
        </CardContent>
      </Card>

      {delivery ? (
        <Card aria-label="配送信息">
          <CardHeader>
            <h2 className="text-base font-semibold">
              配送信息 · {delivery.length} 票
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            {delivery.length === 0 ? (
              <ActionNotice
                tone="warning"
                title="未记录配送信息"
                description="这张工单缺少创建时的配送记录，不能直接录入发货或核定运费。"
              />
            ) : null}
            {delivery.map((row, index) => {
              const addressChanged =
                row.receiverAddress !== shipments?.[index]?.receiverAddress;
              const disabled = pendingLocked || row.status === 'SHIPPED';
              return (
                <fieldset
                  key={row.id}
                  disabled={disabled}
                  className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4"
                >
                  <legend className="px-1 text-sm font-medium">
                    第 {row.sequence} 票
                    {row.sequence === 1 ? ' · 主收货地址' : ''}
                    {row.status === 'SHIPPED' ? ' · 已发货' : ''}
                  </legend>
                  <OrderReceiverContactFields
                    idPrefix={`edit-shipment-${index}`}
                    receiverName={row.receiverName}
                    receiverPhone={row.receiverPhone}
                    disabled={disabled}
                    required={isExternalSales}
                    onNameChange={(value) =>
                      changeDelivery(index, 'receiverName', value)
                    }
                    onPhoneChange={(value) =>
                      changeDelivery(index, 'receiverPhone', value)
                    }
                    errors={{
                      receiverName: fieldErrors(
                        state,
                        `shipments.${index}.receiverName`,
                      )[0],
                      receiverPhone: fieldErrors(
                        state,
                        `shipments.${index}.receiverPhone`,
                      )[0],
                    }}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor={`shipment-address-${index}`}>
                      收货地址
                      <span aria-hidden="true" className="text-destructive">
                        *
                      </span>
                    </Label>
                    <textarea
                      id={`shipment-address-${index}`}
                      disabled={disabled}
                      value={row.receiverAddress ?? ''}
                      maxLength={256}
                      required
                      aria-required="true"
                      className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                      onChange={(event) =>
                        changeDelivery(
                          index,
                          'receiverAddress',
                          event.target.value,
                        )
                      }
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`shipment-express-${index}`}>
                        快递代码
                      </Label>
                      <Input
                        id={`shipment-express-${index}`}
                        disabled={disabled}
                        value={row.expressCode ?? ''}
                        maxLength={32}
                        className="min-h-11"
                        onChange={(event) =>
                          changeDelivery(
                            index,
                            'expressCode',
                            event.target.value,
                          )
                        }
                      />
                    </div>
                    <div className="self-center text-sm">
                      <span className="text-muted-foreground">计费省份：</span>
                      {isSfCollect
                        ? '顺丰到付'
                        : (row.destinationProvince ?? '未核定')}
                    </div>
                  </div>
                  {addressChanged && !isSfCollect ? (
                    <div className="rounded-md border border-warning/40 p-3">
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <Checkbox
                          checked={row.sameDestination}
                          disabled={
                            pendingLocked ||
                            disabled ||
                            !row.destinationProvince
                          }
                          onCheckedChange={(checked) =>
                            setDelivery((rows) =>
                              rows?.map((candidate, candidateIndex) =>
                                candidateIndex === index
                                  ? {
                                      ...candidate,
                                      sameDestination: checked === true,
                                    }
                                  : candidate,
                              ),
                            )
                          }
                        />
                        配送省份仍为{row.destinationProvince ?? '未核定'}
                        ，运费计费条件未变
                      </label>
                      <p className="text-xs text-muted-foreground">
                        跨省或计费条件变化时，请先核对物流费用，再保存收货地址。
                      </p>
                    </div>
                  ) : null}
                </fieldset>
              );
            })}
            {state?.status === 'invalid' &&
            Object.entries(state.fieldErrors).some(([key]) =>
              key.startsWith('shipments'),
            ) ? (
              <ActionNotice
                tone="error"
                title="请检查配送信息"
                description={Object.entries(state.fieldErrors)
                  .filter(([key]) => key.startsWith('shipments'))
                  .flatMap(([, messages]) => messages)
                  .join('；')}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {state?.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" className="min-h-11" disabled={pendingLocked}>
          {pending ? '保存中…' : '保存'}
        </Button>
        <Link
          href={`/orders/${orderId}`}
          className={buttonVariants({
            variant: 'outline',
            className: 'min-h-11',
          })}
        >
          取消
        </Link>
      </div>
    </form>
  );
}

function fieldErrors(
  state: OrderMutationResult | null,
  name: string,
): string[] {
  if (!state || state.status !== 'invalid') return [];
  return state.fieldErrors[name] ?? [];
}

function Field({
  name,
  label,
  initial,
  errors,
  full,
  multiline,
  required,
  disabled,
  type = 'text',
}: {
  name: string;
  label: string;
  initial: string | null;
  errors: string[];
  full?: boolean;
  multiline?: boolean;
  required?: boolean;
  disabled?: boolean;
  type?: string;
}) {
  const [value, setValue] = useState(initial ?? '');
  const hasError = errors.length > 0;
  const errorId = `${name}-error`;
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <Label htmlFor={name} className="text-sm text-muted-foreground">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </Label>
      {multiline ? (
        <textarea
          id={name}
          name={name}
          disabled={disabled}
          required={required}
          aria-required={required ? true : undefined}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
          rows={3}
        />
      ) : (
        <Input
          id={name}
          name={name}
          type={type}
          disabled={disabled}
          required={required}
          aria-required={required ? true : undefined}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          className="mt-1 min-h-11"
        />
      )}
      {hasError && (
        // 不用 role="alert"：逐字段错误靠 aria-describedby 与控件关联，
        // 用户聚焦到该字段时读屏器自然读出来。标 alert 会在每次校验时
        // 抢播报。
        <p id={errorId} className="mt-1 text-xs text-destructive">
          {errors[0]}
        </p>
      )}
    </div>
  );
}
