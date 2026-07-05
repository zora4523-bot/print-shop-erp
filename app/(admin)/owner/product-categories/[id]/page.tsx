import { notFound } from 'next/navigation';
import { updateProductCategoryNodeAction } from '@/actions/owner-product-categories';
import { ProductCategoryForm } from '@/components/business/product-category/ProductCategoryForm';
import { ToggleProductCategoryActiveButton } from '@/components/business/product-category/ToggleProductCategoryActiveButton';
import { PageHeader, StatusBadge } from '@/components/ui-business';
import { PRODUCT_CATEGORY_LABELS } from '@/lib/auth/role-labels';
import { requirePermission } from '@/lib/auth/permissions';
import { getProductCategoryNodeSummary } from '@/lib/product';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const node = await getProductCategoryNodeSummary(id);
  return {
    title: node ? `编辑 ${node.name} · 产品分类` : '产品分类不存在',
  };
}

export default async function EditProductCategoryPage({ params }: PageProps) {
  await requirePermission('dict:product:manage');
  const { id } = await params;
  const node = await getProductCategoryNodeSummary(id);
  if (!node) notFound();

  const boundUpdate = updateProductCategoryNodeAction.bind(null, id);
  const formInitial = {
    path: node.path,
    name: node.name,
    legacyCategory: node.legacyCategory,
    sortOrder: node.sortOrder,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`编辑产品分类：${node.name}`}
        subtitle={`${node.path} · ${PRODUCT_CATEGORY_LABELS[node.legacyCategory]} · ${node._count.products} 个产品`}
        actions={
          <StatusBadge tone={node.isActive ? 'success' : 'neutral'}>
            {node.isActive ? '启用' : '停用'}
          </StatusBadge>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        <ProductCategoryForm
          key={`${node.id}-${node.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          initial={formInitial}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">
          {node.isActive ? '停用分类' : '启用分类'}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {node.isActive
            ? '停用后该分类不再出现在新产品分类选择器里；已经引用它的产品仍可显示并保留该分类。'
            : '启用后该分类会重新出现在新产品分类选择器里。'}
        </p>
        <ToggleProductCategoryActiveButton
          nodeId={node.id}
          currentlyActive={node.isActive}
        />
      </section>
    </div>
  );
}
