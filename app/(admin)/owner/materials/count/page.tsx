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
  let initialRows: Awaited<ReturnType<typeof listInventoryCountMaterials>> | undefined;
  try {
    initialRows = await listInventoryCountMaterials({ limit: 80 });
  } catch {
    // Keep the page usable: the client fetch owns its inline error and retry UI.
    initialRows = undefined;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存盘点"
        back={{ href: '/owner/warehouses', label: '返回仓库/库位' }}
      />

      <InventoryCountClient
        action={postInventoryCountAction}
        initialIdempotencyKey={randomUUID()}
        initialRows={initialRows}
      />
    </div>
  );
}
