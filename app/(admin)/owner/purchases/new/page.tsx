import Link from 'next/link';
import { createPurchaseOrderAction } from '@/actions/owner-purchases';
import { PurchaseOrderForm } from '@/components/business/purchase/PurchaseOrderForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listMaterials } from '@/lib/material';
import { listSupplierPartyOptions } from '@/lib/party';

export const metadata = {
  title: '新建采购单 · 红包印刷 ERP',
};

export default async function NewOwnerPurchasePage() {
  await requirePermission('purchase:manage');
  const [suppliers, materials] = await Promise.all([
    listSupplierPartyOptions(),
    listMaterials(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建采购单"
        subtitle="选择供应商和物料后创建采购单；到货时在详情页分批入库。"
        actions={
          <Link
            href="/owner/purchases"
            className={buttonVariants({ variant: 'outline' })}
          >
            返回列表
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PurchaseOrderForm
          action={createPurchaseOrderAction}
          suppliers={suppliers}
          materials={materials
            .filter((material) => material.isActive)
            .map((material) => ({
              id: material.id,
              code: material.code,
              name: material.name,
              unit: material.unit,
            }))}
        />
      </section>
    </div>
  );
}
