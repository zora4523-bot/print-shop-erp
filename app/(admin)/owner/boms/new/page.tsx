import { createBomAction } from '@/actions/owner-boms';
import { BomForm } from '@/components/business/bom/BomForm';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listMaterials } from '@/lib/material';
import { listProductCategoryOptions, listProductOptions } from '@/lib/product';

export const metadata = {
  title: '新建 BOM · 红包印刷 ERP',
};

export default async function NewBomPage() {
  await requirePermission('bom:manage');
  const [products, categories, materials] = await Promise.all([
    listProductOptions(),
    listProductCategoryOptions(),
    listMaterials(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建 BOM"
        subtitle="同一产品或同一产品分类只能有一个启用 BOM；旧版本可停用保留。"
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <BomForm
          action={createBomAction}
          products={products.map((product) => ({
            id: product.id,
            code: product.code,
            name: product.name,
            categoryName: product.categoryNode.name,
          }))}
          categories={categories
            .filter((category) => category.isActive)
            .map((category) => ({
              id: category.id,
              path: category.path,
              name: category.name,
            }))}
          materials={materials
            .filter((material) => material.isActive)
            .map((material) => ({
              id: material.id,
              code: material.code,
              name: material.name,
              unit: material.unit,
            }))}
        />
      </section>
    </div>
  );
}
