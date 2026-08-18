import Link from 'next/link';
import { createPriceTierAction } from '@/actions/owner-prices';
import { PriceTierForm } from '@/components/business/price/PriceTierForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listProductOptions } from '@/lib/product';

export const metadata = {
  title: '新建价格阶梯 · 红包印刷 ERP',
};

export default async function NewPriceTierPage() {
  await requirePermission('dict:price:manage');
  const products = await listProductOptions();

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建价格阶梯"
        subtitle="同一产品、同一起订量不能创建重叠有效期。"
        actions={
          <Link href="/owner/prices" className={buttonVariants({ variant: 'outline' })}>
            返回报价管理
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PriceTierForm
          mode="create"
          action={createPriceTierAction}
          products={products}
        />
      </section>
    </div>
  );
}
