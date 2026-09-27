'use client';

import { useActionState, useId } from 'react';
import { maintainWarehouseAction } from '@/actions/owner-warehouses';
import { ActiveStateConfirmButton } from '@/components/business/master-data/ActiveStateConfirmButton';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ActionNotice, FormMessage, PendingButton, formMessageA11yProps } from '@/components/ui-business';

type Props = {
  kind: 'warehouse' | 'location'; id: string; name: string;
  isActive: boolean; isDefault: boolean; updatedAt: string; parentActive?: boolean;
};

export function WarehouseMaintenance(props: Props) {
  const formId = useId();
  const [state, action, pending] = useActionState(maintainWarehouseAction, null);
  const visible = pending ? null : state;
  const label = props.kind === 'warehouse' ? '仓库' : '库位';
  const error = visible?.status === 'invalid' ? Object.values(visible.fieldErrors).flat().join('；') : null;
  const identity = <>
    <input type="hidden" name="kind" value={props.kind} />
    <input type="hidden" name="id" value={props.id} />
    <input type="hidden" name="expectedUpdatedAt" value={props.updatedAt} />
  </>;
  return <div className="space-y-3" aria-label={`${props.name}维护`}>
    <div className="flex flex-wrap items-start gap-3">
      <Disclosure className="min-w-0 flex-1 rounded-lg border p-3">
        <DisclosureSummary>改名</DisclosureSummary>
        <form action={action} onReset={(event) => event.preventDefault()} aria-busy={pending} className="mt-3 space-y-3">
          {identity}<input type="hidden" name="operation" value="rename" />
          <Label htmlFor={`${formId}-name`}>{label}名称</Label>
          <Input key={props.updatedAt} id={`${formId}-name`} name="name" defaultValue={props.name} maxLength={64} disabled={pending} {...(error ? formMessageA11yProps(`${formId}-name`, 'error') : {})} />
          {error ? <FormMessage fieldId={`${formId}-name`} tone="error">{error}</FormMessage> : null}
          <PendingButton pending={pending} pendingLabel="正在保存…">保存名称</PendingButton>
        </form>
      </Disclosure>
      {props.isDefault ? <p className="py-3 text-sm text-muted-foreground">默认{label}不能停用</p> : <>
        <form id={formId} action={action} aria-busy={pending}>
          {identity}<input type="hidden" name="operation" value={props.isActive ? 'disable' : 'restore'} />
        </form>
        <ActiveStateConfirmButton entityLabel={label} currentlyActive={props.isActive} pending={pending} formId={formId} activateVerb="恢复使用"
          deactivateImpactItems={[`停止使用“${props.name}”，已有库存需先处理至零`, ...(props.kind === 'warehouse' ? ['所属库位将一并不可用于出入库，恢复仓库后仍保留各库位原状态'] : []), '历史流水保留；需要取消历史收货时，须先恢复使用']}
          activateImpactItems={[`恢复使用“${props.name}”`, props.kind === 'location' && props.parentActive === false ? '所属仓库仍已停用，请再恢复所属仓库后办理出入库' : '原有业务记录保持不变']} />
      </>}
    </div>
    {props.kind === 'location' && props.parentActive === false ? <p className="text-sm text-muted-foreground">所属仓库已停用，此库位当前不可用于出入库</p> : null}
    {visible?.status === 'error' ? <ActionNotice tone="error" title="未能完成修改" description={visible.message} /> : null}
    {visible?.status === 'success' ? <ActionNotice tone="success" title={visible.message ?? '已保存'} /> : null}
  </div>;
}
