import Link from 'next/link';
import { createPriceAdjustmentAction } from '@/actions/owner-prices';
import { PriceAdjustmentForm } from '@/components/business/price/PriceAdjustmentForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '新建加价规则 · 红包印刷 ERP',
};

export default async function NewPriceAdjustmentPage() {
  await requirePermission('dict:price:manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建加价规则"
        subtitle="新规则默认启用；触发条件必须是 JSON object 或留空。"
        actions={
          <Link href="/owner/prices" className={buttonVariants({ variant: 'outline' })}>
            返回价格字典
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <PriceAdjustmentForm mode="create" action={createPriceAdjustmentAction} />
      </section>
    </div>
  );
}
