import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getProductSummary, listProductCategoryOptions } from '@/lib/product';
import { updateProductAction } from '@/actions/owner-products';
import { ProductForm } from '@/components/business/product/ProductForm';
import { ToggleActiveButton } from '@/components/business/product/ToggleActiveButton';
import { requirePermission } from '@/lib/auth/permissions';

type PageProps = { params: Promise<{ id: string }> };

// generateMetadata 与页面组件是同一请求里两次独立执行，Next 只自动 memo
// fetch()、不 memo Prisma，所以这里本来是实打实查两遍。React cache()
// 把同一请求内的重复调用收敛成一次（Next 文档 14-metadata-and-og-images.md
// 「Memoizing data requests」）。参数是 primitive，缓存命中；换成对象
// 字面量就永远 miss（cache 对对象参数用 WeakMap 引用相等）。
const loadProduct = cache(getProductSummary);

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const p = await loadProduct(id);
  return { title: p ? `编辑 ${p.name} · 产品字典` : '产品不存在' };
}

export default async function EditProductPage({ params }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('dict:product:manage');
  const { id } = await params;
  const product = await loadProduct(id);
  if (!product) notFound();
  const categoryOptions = await listProductCategoryOptions({
    includeInactiveIds: [product.categoryNodeId],
  });

  const boundUpdate = updateProductAction.bind(null, id);
  const formInitial = {
    code: product.code,
    categoryNodeId: product.categoryNodeId,
    name: product.name,
    specification: product.specification,
    paperType: product.paperType,
    baseUnitPrice:
      product.baseUnitPrice === null || product.baseUnitPrice === undefined
        ? null
        : String(product.baseUnitPrice),
    minOrderQty: product.minOrderQty,
    isActive: product.isActive,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">编辑产品：{product.name}</h1>
        <p className="text-sm text-muted-foreground">
          {product.categoryNode.name}
          {product.isActive ? ' · 启用' : ' · 停用'}
        </p>
      </div>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        <ProductForm
          key={`${product.id}-${product.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          initial={formInitial}
          categoryNodes={categoryOptions}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">
          {product.isActive ? '停用产品' : '启用产品'}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {product.isActive
            ? '停用后该产品不再出现在录单页的产品选择器里；历史工单里已经引用的记录全部保留。'
            : '启用后该产品会重新出现在录单页的选择器里。'}
        </p>
        <ToggleActiveButton productId={product.id} currentlyActive={product.isActive} />
      </section>
    </div>
  );
}
