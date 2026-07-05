import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { BomsTable } from '@/components/business/bom/BomsTable';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listBoms } from '@/lib/bom';

export const metadata = {
  title: 'BOM/用料 · 红包印刷 ERP',
};

export default async function OwnerBomsPage() {
  await requirePermission('bom:manage');
  const boms = await listBoms();

  return (
    <div className="space-y-6">
      <PageHeader
        title="BOM/用料"
        subtitle="维护产品或产品分类的物料用量版本；当前阶段只做估算，不自动扣库存。"
        actions={
          <Link href="/owner/boms/new" className={buttonVariants()}>
            新建 BOM
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <BomsTable boms={boms} />
      </section>
    </div>
  );
}
