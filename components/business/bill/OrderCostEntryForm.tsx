'use client';

import { useActionState, useCallback, useRef, useState } from 'react';
import { createOrderCostEntryAction } from '@/actions/bill';
import type { OrderCostMutationResult } from '@/actions/bill.types';
import { OrderCostCategory } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';

const MANUAL_CATEGORY_OPTIONS = [
  { value: OrderCostCategory.MATERIAL, label: '材料' },
  { value: OrderCostCategory.SETUP, label: '上板/装板' },
  { value: OrderCostCategory.SHIPPING, label: '物流' },
  { value: OrderCostCategory.MEAL, label: '伙食费' },
  { value: OrderCostCategory.ELECTRICITY, label: '电费' },
  { value: OrderCostCategory.CUSTOM, label: '其他自定义' },
  { value: OrderCostCategory.ADJUSTMENT, label: '成本调整' },
] as const;

export function OrderCostEntryForm({
  orderId,
  initialIdempotencyKey,
  isSfCollect,
}: {
  orderId: string;
  initialIdempotencyKey: string;
  isSfCollect: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const [category, setCategory] = useState<OrderCostCategory>(
    OrderCostCategory.MATERIAL,
  );
  const submitCost = useCallback(
    async (previous: OrderCostMutationResult | null, formData: FormData) => {
      const result = await createOrderCostEntryAction(previous, formData);
      if (result.status === 'success') {
        formRef.current?.reset();
        setCategory(OrderCostCategory.MATERIAL);
        setIdempotencyKey(window.crypto.randomUUID());
      }
      return result;
    },
    [],
  );
  const [state, action, pending] = useActionState<
    OrderCostMutationResult | null,
    FormData
  >(submitCost, null);
  const categoryOptions = isSfCollect
    ? MANUAL_CATEGORY_OPTIONS.filter(
        (option) => option.value !== OrderCostCategory.SHIPPING,
      )
    : MANUAL_CATEGORY_OPTIONS;
  const selectedCategory =
    isSfCollect && category === OrderCostCategory.SHIPPING
      ? OrderCostCategory.MATERIAL
      : category;
  const isAdjustment = selectedCategory === OrderCostCategory.ADJUSTMENT;

  return (
    <form ref={formRef} action={action} aria-busy={pending} className="space-y-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="orderId" value={orderId} />
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span>成本类型</span>
          <NativeSelect
            name="category"
            value={selectedCategory}
            disabled={pending}
            onChange={(event) =>
              setCategory(event.target.value as OrderCostCategory)
            }
            className="w-full"
          >
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm lg:col-span-2">
          <span>成本名称</span>
          <Input
            name="description"
            required
            disabled={pending}
            maxLength={100}
            placeholder={
              isSfCollect ? '例如：补录纸张耗用' : '例如：快递重量 12.5kg'
            }
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>金额（元）</span>
          <Input
            name="amount"
            required
            disabled={pending}
            inputMode="decimal"
            step="0.01"
            min={isAdjustment ? undefined : '0.01'}
            placeholder={isAdjustment ? '正数或负数冲正' : '必须大于 0'}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>数量</span>
          <Input
            name="quantity"
            disabled={pending}
            inputMode="decimal"
            min="0"
            max="999999999.999"
            step="0.001"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>单位</span>
          <Input
            name="unit"
            disabled={pending}
            maxLength={20}
            placeholder="kg / 度 / 餐"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>单价</span>
          <Input
            name="unitPrice"
            disabled={pending}
            inputMode="decimal"
            min="0"
            max="99999999.9999"
            step="0.0001"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>备注</span>
          <Input name="remark" disabled={pending} maxLength={200} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {/* 「计件和外协无需录入」已在分区标题下说明，这里只写填写条件（ui-规范 §7 第 4、7 律）。 */}
        {isSfCollect ? '顺丰到付工单不可录入物流费。' : ''}
        普通成本填正数；更正已记成本用“成本调整”，可填负数。填写数量和单价时，金额须等于两者乘积。
      </p>
      <Button type="submit" disabled={pending} className="min-h-11">
        {pending ? '正在保存…' : '添加成本明细'}
      </Button>
      {state?.status === 'success' ? (
        <p role="status" className="text-sm text-success-foreground">
          成本明细已记录。
        </p>
      ) : null}
      {state?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      {state?.status === 'invalid' ? (
        <p role="alert" className="text-sm text-destructive">
          {Object.values(state.fieldErrors).flat().join('；')}
        </p>
      ) : null}
    </form>
  );
}
