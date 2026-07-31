'use client';

import { useActionState, useTransition } from 'react';
import { createOrderCostEntryAction } from '@/actions/bill';
import type { OrderCostMutationResult } from '@/actions/bill.types';
import { OrderCostCategory } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CATEGORY_LABELS: Record<OrderCostCategory, string> = {
  [OrderCostCategory.MATERIAL]: '材料',
  [OrderCostCategory.PIECEWORK]: '计件',
  [OrderCostCategory.SETUP]: '上板/装板',
  [OrderCostCategory.OUTSOURCE]: '外协',
  [OrderCostCategory.SHIPPING]: '物流',
  [OrderCostCategory.MEAL]: '伙食费',
  [OrderCostCategory.ELECTRICITY]: '电费',
  [OrderCostCategory.CUSTOM]: '其他自定义',
  [OrderCostCategory.ADJUSTMENT]: '成本调整',
};

export function OrderCostEntryForm({ orderId }: { orderId: string }) {
  const [state, action] = useActionState<
    OrderCostMutationResult | null,
    FormData
  >(createOrderCostEntryAction, null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => startTransition(() => action(formData))}
      className="space-y-3"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span>成本类型</span>
          <select
            name="category"
            className="min-h-11 w-full rounded-md border bg-background px-3"
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm lg:col-span-2">
          <span>成本名称</span>
          <Input name="description" required maxLength={100} placeholder="例如：快递重量 12.5kg" />
        </label>
        <label className="space-y-1 text-sm">
          <span>金额（元）</span>
          <Input name="amount" required inputMode="decimal" placeholder="可填负数冲正" />
        </label>
        <label className="space-y-1 text-sm">
          <span>数量</span>
          <Input name="quantity" inputMode="decimal" />
        </label>
        <label className="space-y-1 text-sm">
          <span>单位</span>
          <Input name="unit" maxLength={20} placeholder="kg / 度 / 餐" />
        </label>
        <label className="space-y-1 text-sm">
          <span>单价</span>
          <Input name="unitPrice" inputMode="decimal" />
        </label>
        <label className="space-y-1 text-sm">
          <span>备注</span>
          <Input name="remark" maxLength={200} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        已入账记录不覆盖；更正时新增“成本调整”正数或负数，保留完整审计流水。
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
