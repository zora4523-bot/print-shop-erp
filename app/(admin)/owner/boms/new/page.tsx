import { createBomAction } from '@/actions/owner-boms';
import { BomForm } from '@/components/business/bom/BomForm';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listBomProductOptions } from '@/lib/bom';
import { listMaterials } from '@/lib/material';
import {
  categoryChainLabelMap,
  listProductCategoryOptions,
} from '@/lib/product';

export const metadata = {
  title: '新建 BOM',
};

export default async function NewBomPage() {
  await requirePermission('bom:manage');
  const [products, categories, materials] = await Promise.all([
    listBomProductOptions(),
    listProductCategoryOptions(),
    listMaterials(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建 BOM"
        subtitle="同一用料对象只能有一个启用版本。"
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
          papers={materials.filter((material) => material.category === 'PAPER' && material.isActive).map((paper) => ({ id: paper.id, name: paper.name, specification: paper.specification }))}
          categories={(() => {
            // 名称链标签（"定制 / 平面烫金"）消歧跨父级重名；链用全量
            // 节点算（父级可能已停用），选项只列激活节点。
            const chainLabels = categoryChainLabelMap(categories);
            return categories
              .filter((category) => category.isActive)
              .map((category) => ({
                id: category.id,
                path: category.path,
                name: chainLabels.get(category.id) ?? category.name,
              }));
          })()}
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
