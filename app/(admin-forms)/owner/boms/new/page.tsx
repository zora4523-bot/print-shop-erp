import { FormPendingScope, ScopedPageHeader } from '@/components/business/form/FormPendingScope';
import { readReceipt } from '@/lib/admin/receipt';
import { readSupplementContext } from '@/lib/form-drafts/return-context';
import { randomUUID } from 'node:crypto';
import { newFormDraftContext } from '@/lib/form-drafts/server-context';
import { createBomAction } from '@/actions/owner-boms';
import { BomForm } from '@/components/business/bom/BomForm';
import { ReceiptNotice } from '@/components/ui-business';
import { FormPage } from '@/app/_components/FormPage';
import { requirePermission } from '@/lib/auth/permissions';
import { listBomProductOptions } from '@/lib/bom';
import { listMaterials } from '@/lib/material';
import {
  categoryChainLabelMap,
  listProductCategoryOptions,
} from '@/lib/product';

export const metadata = {
  title: '新建用料清单',
};

export default async function NewBomPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePermission('bom:manage');
  const query = await searchParams;
  const receipt = readReceipt(query);
  const returned = readSupplementContext(query);
  const [products, categories, materials] = await Promise.all([
    listBomProductOptions(),
    listProductCategoryOptions(),
    listMaterials(),
  ]);

  return (
    <FormPendingScope>
    <FormPage>
      <ReceiptNotice receipt={receipt} noun={returned?.entityType === 'CATEGORY' ? '分类' : '物料'} />
      <ScopedPageHeader
        title="新建用料清单"
        back={{ href: '/owner/boms', label: '返回用料清单' }}
        subtitle="同一用料对象只能有一个启用版本。"
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <BomForm
          key={`${actor.id}:${actor.draftSessionScope ?? 'legacy'}`}
          draftContext={newFormDraftContext('bom-new', actor)}
          initialRowId={randomUUID()}
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
    </FormPage>
    </FormPendingScope>
  );
}
