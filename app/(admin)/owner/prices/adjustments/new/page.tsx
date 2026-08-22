import Link from 'next/link';
import { createPriceAdjustmentAction } from '@/actions/owner-prices';
import { PriceAdjustmentForm } from '@/components/business/price/PriceAdjustmentForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listProductOptions } from '@/lib/product';
import { listCrafts } from '@/lib/craft';

export const metadata = {
  title: '新建加价规则 · 红包印刷 ERP',
};

export default async function NewPriceAdjustmentPage() {
  await requirePermission('dict:price:manage');
  const [products, crafts] = await Promise.all([
    listProductOptions(),
    listCrafts(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建加价规则"
        subtitle="新规则默认启用；请按产品、工艺、数量等业务条件设置适用范围。"
        actions={
          <Link href="/owner/prices" className={buttonVariants({ variant: 'outline' })}>
            返回报价管理
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PriceAdjustmentForm
          mode="create"
          action={createPriceAdjustmentAction}
          products={products.map((product) => ({
            id: product.id,
            label: `${product.code ? `${product.code} · ` : ''}${product.name}`,
          }))}
          crafts={crafts
            .filter((craft) => craft.isActive)
            .map((craft) => ({
              id: craft.id,
              label: `${craft.code ? `${craft.code} · ` : ''}${craft.name}`,
            }))}
        />
      </section>
    </div>
  );
}
