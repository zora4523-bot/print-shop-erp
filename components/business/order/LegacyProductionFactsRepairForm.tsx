'use client';

import { useActionState } from 'react';
import { OrderCraft, OrderPackagingMode } from '@/generated/prisma/enums';
import { repairLegacyProductionFactsAction } from '@/actions/order-production-facts';
import { adminOrderCraftTags } from '@/lib/order/admin-list-presentation';
import { PACKAGING_MODE_LABELS } from '@/lib/order/packaging-mode';
import { isValidPackagingUnitsPerBag } from '@/lib/order/packaging-units';
import { PendingButton } from '@/components/ui-business';
import { Input } from '@/components/ui/input';
import type { getLegacyProductionFactsRepair } from '@/lib/order/legacy-production-facts-presentation';
import { ProductionReadinessWarning } from './ProductionReadinessWarning';

type Props = { canRepair: boolean; facts: NonNullable<Awaited<ReturnType<typeof getLegacyProductionFactsRepair>>> };
export function LegacyProductionFactsRepairForm({ facts, canRepair }: Props) {
  const [state, action, pending] = useActionState(repairLegacyProductionFactsAction, null);
  if (!canRepair) return null;
  const errors = state?.status === 'invalid' ? state.fieldErrors : {};
  const fieldError = (path: string) => errors[path]?.length ? <p id={`${facts.orderId}-${path}-error`} className="text-sm text-destructive">{errors[path].join('；')}</p> : null;
  return <form action={action} className="space-y-4 rounded-xl border p-4">
    <h2 className="text-base font-semibold">补录生产资料</h2>
    <input type="hidden" name="orderId" value={facts.orderId} />
    <input type="hidden" name="expectedOrderRevision" value={facts.expectedOrderRevision} />
    <fieldset disabled={pending} className="space-y-4">
      {facts.items.map((item, index) => <div key={item.id} className="space-y-2">
        <p className="text-sm font-medium">款式 #{item.sequence} · {item.name}</p>
        <input type="hidden" name={`items.${index}.itemId`} value={item.id} />
        {item.craft === null ? <label className="block space-y-1 text-sm">工艺
          <select className="h-11 w-full rounded-md border bg-background px-3" name={`items.${index}.craft`} required defaultValue="" aria-invalid={!!errors[`items.${index}.craft`]} aria-describedby={errors[`items.${index}.craft`]?.length ? `${facts.orderId}-items.${index}.craft-error` : undefined}>
            <option value="" disabled>请选择工艺</option>
            {Object.values(OrderCraft).map((craft) => <option key={craft} value={craft}>{adminOrderCraftTags([craft])[0]}</option>)}
          </select>{fieldError(`items.${index}.craft`)}
        </label> : null}
        {facts.needsPackaging ? <label className="block space-y-1 text-sm">每包数量
          <Input name={isValidPackagingUnitsPerBag(item.pack) ? undefined : `items.${index}.unitsPerBag`} type="number" min={1} max={9999999} step={1} required readOnly={isValidPackagingUnitsPerBag(item.pack)} defaultValue={item.pack ?? ''} aria-invalid={!!errors[`items.${index}.unitsPerBag`]} aria-describedby={errors[`items.${index}.unitsPerBag`]?.length ? `${facts.orderId}-items.${index}.unitsPerBag-error` : undefined} />
          {fieldError(`items.${index}.unitsPerBag`)}
        </label> : null}
      </div>)}
      {facts.needsPackaging ? <label className="block space-y-1 text-sm">包装方式
        <select className="h-11 w-full rounded-md border bg-background px-3" name="packagingMode" defaultValue={facts.packagingMode ?? ''} required aria-invalid={!!errors.packagingMode}>
          <option value="" disabled>请选择包装方式</option>
          {Object.values(OrderPackagingMode).map((mode) => <option key={mode} value={mode}>{PACKAGING_MODE_LABELS[mode]}</option>)}
        </select>{fieldError('packagingMode')}
      </label> : null}
      <PendingButton pending={pending} pendingLabel="保存中…">保存生产资料</PendingButton>
    </fieldset>
    {state?.status === 'error' ? <p role="alert" className="text-sm text-destructive">{state.message}</p> : null}
    {state?.status === 'invalid' ? <p role="alert" className="text-sm text-destructive">{Object.values(errors).flat().join('；')}</p> : null}
    {state?.status === 'success' ? <><p role="status" className="text-sm">生产资料已保存</p><ProductionReadinessWarning readiness={state.result} title="工单仍需补齐以下资料：" /></> : null}
  </form>;
}
