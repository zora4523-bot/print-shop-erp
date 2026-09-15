import { randomUUID } from 'node:crypto';
import { postInventoryCountAction } from '@/actions/owner-inventory';
import { InventoryCountClient } from '@/components/business/material/InventoryCountClient';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '库存盘点',
};

export default async function OwnerMaterialInventoryCountPage() {
  await requirePermission('material:manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存盘点"
        subtitle="按仓库库位录入实盘数，提交后生成盘点单和差异库存流水。"
      />

      <InventoryCountClient
        action={postInventoryCountAction}
        initialIdempotencyKey={randomUUID()}
      />
    </div>
  );
}
