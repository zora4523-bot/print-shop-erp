import { randomUUID } from 'node:crypto';
import { postInventoryCountAction } from '@/actions/owner-inventory';
import { InventoryCountClient } from '@/components/business/material/InventoryCountClient';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listInventoryCountMaterials } from '@/lib/inventory-count';

export const metadata = {
  title: '库存盘点',
};

export default async function OwnerMaterialInventoryCountPage() {
  await requirePermission('material:manage');
  // 首屏行由服务端给出，避免挂载后补请求把页面往下顶（CLS）。limit 与客户端检索一致。
  const initialRows = await listInventoryCountMaterials({ limit: 80 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存盘点"
        back={{ href: '/owner/warehouses', label: '返回仓库/库位' }}
        subtitle="按仓库库位录入实盘数，提交后生成盘点单和差异库存流水。"
      />

      <InventoryCountClient
        action={postInventoryCountAction}
        initialIdempotencyKey={randomUUID()}
        initialRows={initialRows}
      />
    </div>
  );
}
