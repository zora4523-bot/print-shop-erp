import { createMaterialAction } from '@/actions/owner-materials';
import { MaterialForm } from '@/components/business/material/MaterialForm';
import { FormPage } from '@/app/_components/FormPage';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '新建物料 · 车间用料',
};

export default async function NewForemanMaterialPage() {
  await requirePermission('material:manage');

  return (
    <FormPage>
      <PageHeader
        back={{ href: '/foreman/materials', label: '返回车间用料' }}
        title="新建物料"
        subtitle="新物料默认启用；库存数量通过出入库单独维护。"

      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <MaterialForm
          mode="create"
          action={createMaterialAction}
          routeBase="/foreman/materials"
        />
      </section>
    </FormPage>
  );
}
