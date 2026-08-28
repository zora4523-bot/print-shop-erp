import Link from 'next/link';
import { createPriceAdjustmentAction } from '@/actions/owner-prices';
import { PriceAdjustmentForm } from '@/components/business/price/PriceAdjustmentForm';
import { buttonVariants } from '@/components/ui/button';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { requirePermission } from '@/lib/auth/permissions';
import { listProductOptions } from '@/lib/product';
import { listCrafts } from '@/lib/craft';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

export const metadata = {
  title: '新建加价规则 · 红包印刷 ERP',
};

export default async function NewInternalPriceAdjustmentPage() {
  await requirePermission('dict:price:manage');
  const [products, crafts] = await Promise.all([
    listProductOptions(),
    listCrafts(),
  ]);

  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title="新建加价规则"
        effect="effective-dated"
        subtitle="新规则默认启用。"
        actions={
          <Link
            href={RULE_CENTER_HREFS.internalPricing}
            className={buttonVariants({ variant: 'outline' })}
          >
            返回内部直单价格
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PriceAdjustmentForm
          mode="create"
          action={createPriceAdjustmentAction}
          products={products.map((product) => ({
            id: product.id,
            label: `${product.code ? `${product.code} · ` : ''}${externalPriceBusinessText(product.name)}`,
          }))}
          crafts={crafts
            .filter((craft) => craft.isActive)
            .map((craft) => ({
              id: craft.id,
              label: craft.name,
            }))}
        />
      </section>
    </div>
  );
}
