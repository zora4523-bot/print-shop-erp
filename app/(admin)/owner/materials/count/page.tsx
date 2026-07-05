import { InventoryCountClient } from '@/components/business/material/InventoryCountClient';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '库存盘点 · 红包印刷 ERP',
};

export default async function OwnerMaterialInventoryCountPage() {
  await requirePermission('material:manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存盘点"
        subtitle="客户端局部数据层 POC：通过 /api/admin/inventory-count/materials 读取库存，浏览器内录入实盘数并计算差异；当前不自动写库存流水。"
      />

      <InventoryCountClient />
    </div>
  );
}
