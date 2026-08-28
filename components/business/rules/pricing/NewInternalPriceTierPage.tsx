import Link from 'next/link';
import { createPriceTierAction } from '@/actions/owner-prices';
import { PriceTierForm } from '@/components/business/price/PriceTierForm';
import { buttonVariants } from '@/components/ui/button';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { requirePermission } from '@/lib/auth/permissions';
import { listProductOptions } from '@/lib/product';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export const metadata = {
  title: '新建价格阶梯 · 红包印刷 ERP',
};

export default async function NewInternalPriceTierPage() {
  await requirePermission('dict:price:manage');
  const products = await listProductOptions();

  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title="新建价格阶梯"
        effect="effective-dated"
        subtitle="同一报价产品、同一起订量的有效期不能重叠。"
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
        <PriceTierForm
          mode="create"
          action={createPriceTierAction}
          products={products}
        />
      </section>
    </div>
  );
}
