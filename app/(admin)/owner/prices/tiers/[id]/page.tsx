import { notFound } from 'next/navigation';
import { updatePriceTierAction } from '@/actions/owner-prices';
import { PriceTierForm } from '@/components/business/price/PriceTierForm';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { getPriceTierSummary } from '@/lib/price';
import { listProductOptions } from '@/lib/product';

type PageProps = { params: Promise<{ id: string }> };

function dateInput(value: Date | null): string {
  if (!value) return '';
  return value.toISOString().slice(0, 10);
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const tier = await getPriceTierSummary(id);
  return {
    title: tier ? `编辑 ${tier.product.name} 价格阶梯` : '价格阶梯不存在',
  };
}

export default async function EditPriceTierPage({ params }: PageProps) {
  await requirePermission('dict:price:manage');
  const { id } = await params;
  const tier = await getPriceTierSummary(id);
  if (!tier) notFound();

  const products = await listProductOptions({
    includeInactiveIds: [tier.productId],
  });
  const boundUpdate = updatePriceTierAction.bind(null, id);
  const formInitial = {
    productId: tier.productId,
    minQty: String(tier.minQty),
    unitPrice: String(tier.unitPrice),
    effectiveFrom: dateInput(tier.effectiveFrom),
    effectiveTo: dateInput(tier.effectiveTo),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`编辑价格阶梯：${tier.product.name}`}
        subtitle={`起订量 ${tier.minQty} · 单价 ${String(tier.unitPrice)}`}
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PriceTierForm
          key={`${tier.id}-${tier.effectiveFrom.toISOString()}-${dateInput(tier.effectiveTo)}`}
          mode="edit"
          action={boundUpdate}
          initial={formInitial}
          products={products}
        />
      </section>
    </div>
  );
}
