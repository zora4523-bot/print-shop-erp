import Link from 'next/link';
import { createMaterialAction } from '@/actions/owner-materials';
import { MaterialForm } from '@/components/business/material/MaterialForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '新建物料 · 物料库存',
};

export default async function NewForemanMaterialPage() {
  await requirePermission('material:manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建物料"
        subtitle="新物料默认启用；库存数量通过出入库单独维护。"
        actions={
          <Link
            href="/foreman/materials"
            className={buttonVariants({ variant: 'outline' })}
          >
            返回库存
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <MaterialForm
          mode="create"
          action={createMaterialAction}
          routeBase="/foreman/materials"
        />
      </section>
    </div>
  );
}
