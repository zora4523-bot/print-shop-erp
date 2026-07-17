import Link from 'next/link';
import { createPurchaseOrderAction } from '@/actions/owner-purchases';
import { PurchaseOrderForm } from '@/components/business/purchase/PurchaseOrderForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { firstSearchParam } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { listMaterials } from '@/lib/material';
import { listSupplierPartyOptions } from '@/lib/party';

export const metadata = {
  title: '新建采购单 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{
    supplierPartyId?: string | string[];
  }>;
};

export default async function NewOwnerPurchasePage({ searchParams }: PageProps) {
  await requirePermission('purchase:manage');
  const requestedSupplierPartyId = firstSearchParam(
    (await searchParams).supplierPartyId,
  );
  const [suppliers, materials] = await Promise.all([
    listSupplierPartyOptions(),
    listMaterials(),
  ]);
  const initialSupplierPartyId = suppliers.some(
    (supplier) => supplier.id === requestedSupplierPartyId,
  )
    ? requestedSupplierPartyId
    : '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建采购单"
        subtitle="选择供应商和物料后创建采购单；采购单不直接改库存，到货时在详情页分批收货过账。"
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
          initialSupplierPartyId={initialSupplierPartyId}
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
