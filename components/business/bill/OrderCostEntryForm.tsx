'use client';

import { useActionState, useCallback, useRef, useState } from 'react';
import { createOrderCostEntryAction } from '@/actions/bill';
import type { OrderCostMutationResult } from '@/actions/bill.types';
import { OrderCostCategory } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
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
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="orderId" value={orderId} />
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span>成本类型</span>
          <select
            name="category"
            value={selectedCategory}
            onChange={(event) =>
              setCategory(event.target.value as OrderCostCategory)
            }
            className="min-h-11 w-full rounded-md border bg-background px-3"
          >
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm lg:col-span-2">
          <span>成本名称</span>
          <Input
            name="description"
            required
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
            inputMode="decimal"
            min="0"
            max="999999999.999"
            step="0.001"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>单位</span>
          <Input name="unit" maxLength={20} placeholder="kg / 度 / 餐" />
        </label>
        <label className="space-y-1 text-sm">
          <span>单价</span>
          <Input
            name="unitPrice"
            inputMode="decimal"
            min="0"
            max="99999999.9999"
            step="0.0001"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>备注</span>
          <Input name="remark" maxLength={200} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        计件和外协成本由业务流水自动计入，这里不重复录入。
        {isSfCollect ? '顺丰到付工单不可录入物流费。' : ''}
        普通成本必须为正数；更正时新增“成本调整”正数或负数，保留完整审计流水。同时填写数量和单价时，金额必须与两者乘积一致。
      </p>
      <Button type="submit" disabled={pending} className="min-h-11">
        {pending ? '保存中…' : '新增成本明细'}
      </Button>
      {state?.status === 'success' ? (
        <p role="status" className="text-sm text-success">
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
