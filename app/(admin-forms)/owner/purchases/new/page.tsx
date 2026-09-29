import { readSupplementContext } from '@/lib/form-drafts/return-context';
import { newFormDraftContext } from '@/lib/form-drafts/server-context';
import { createPurchaseOrderAction } from '@/actions/owner-purchases';
import { PurchaseOrderForm } from '@/components/business/purchase/PurchaseOrderForm';
import { FormPage } from '@/app/_components/FormPage';
import { PageHeader, ReceiptNotice } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';
import { firstSearchParam } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { listMaterials } from '@/lib/material';
import { listSupplierPartyOptions } from '@/lib/party';

export const metadata = {
  title: '新建采购单',
};

type PageProps = {
  searchParams: Promise<{
    supplierPartyId?: string | string[];
    created?: string | string[];
  }>;
};

export default async function NewOwnerPurchasePage({ searchParams }: PageProps) {
  const actor = await requirePermission('purchase:manage');
  const sp = await searchParams;
  const requestedSupplierPartyId = firstSearchParam(sp.supplierPartyId);
  const receipt = readReceipt(sp);
  const returned = readSupplementContext(sp);
  const receiptNoun = returned?.entityType === 'MATERIAL' ? '物料' : '供应商';
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
    <FormPage>
      <ReceiptNotice receipt={receipt} noun={receiptNoun} />
      <PageHeader
        title="新建采购单"
        subtitle="创建采购单不会增加库存；到货后可分批收货。"
        back={{ href: '/owner/purchases', label: '返回采购单' }}
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PurchaseOrderForm
          key={`${actor.id}:${actor.draftSessionScope ?? 'legacy'}`}
          draftContext={newFormDraftContext('purchase-new', actor)}
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
    </FormPage>
  );
}
