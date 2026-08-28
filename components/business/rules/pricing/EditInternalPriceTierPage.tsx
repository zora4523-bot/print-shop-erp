import { cache } from 'react';
import { notFound } from 'next/navigation';
import { updatePriceTierAction } from '@/actions/owner-prices';
import { PriceTierForm } from '@/components/business/price/PriceTierForm';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { getPriceTierSummary } from '@/lib/price';
import { listProductOptions } from '@/lib/product';
import { formatDateInputShanghai } from '@/lib/format/dates';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type PageProps = { params: Promise<{ id: string }> };

const loadPriceTier = cache(getPriceTierSummary);

function dateInput(value: Date | null): string {
  return formatDateInputShanghai(value);
}

export async function generateMetadata({ params }: PageProps) {
  const session = await getSession();
  if (!session || !hasPermission('dict:price:manage', session.user.role)) {
    return { title: '价格阶梯' };
  }

  const { id } = await params;
  const tier = await loadPriceTier(id);
  return {
    title: tier
      ? `编辑 ${externalPriceBusinessText(tier.product.name)} 价格阶梯`
      : '价格阶梯不存在',
  };
}

export default async function EditInternalPriceTierPage({ params }: PageProps) {
  await requirePermission('dict:price:manage');
  const { id } = await params;
  const tier = await loadPriceTier(id);
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
      <RuleCenterPageHeader
        title={`编辑价格阶梯：${externalPriceBusinessText(tier.product.name)}`}
        effect="effective-dated"
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
