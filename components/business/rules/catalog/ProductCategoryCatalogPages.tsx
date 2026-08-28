import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  createRuleCenterProductCategoryNodeAction,
  updateProductCategoryNodeAction,
} from '@/actions/owner-product-categories';
import { AdminTableCard } from '@/components/business/admin/AdminDataTable';
import {
  ProductCategoryForm,
  type ProductCategoryRouteBase,
} from '@/components/business/product-category/ProductCategoryForm';
import { ProductCategoryNodesTable } from '@/components/business/product-category/ProductCategoryNodesTable';
import { ToggleProductCategoryActiveButton } from '@/components/business/product-category/ToggleProductCategoryActiveButton';
import { buttonVariants } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui-business';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import {
  getProductCategoryNodeSummary,
  isRetiredProductCategory,
  listProductCategoryNodes,
} from '@/lib/product';

export type ProductCategoryCatalogDetailProps = {
  params: Promise<{ id: string }>;
  routeBase: ProductCategoryRouteBase;
};

export async function getProductCategoryCatalogMetadata({
  params,
  titleScope = '产品结构分类',
}: Pick<ProductCategoryCatalogDetailProps, 'params'> & {
  titleScope?: string;
}) {
  const session = await getSession();
  if (!session || !hasPermission('dict:product:manage', session.user.role)) {
    return { title: titleScope };
  }

  const { id } = await params;
  const node = await getProductCategoryNodeSummary(id);
  return {
    title: node ? `编辑 ${node.name} · ${titleScope}` : `${titleScope}不存在`,
  };
}

export async function ProductCategoryCatalogList({
  routeBase,
}: {
  routeBase: ProductCategoryRouteBase;
}) {
  await requirePermission('dict:product:manage');
  const nodes = await listProductCategoryNodes();

  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title="产品结构分类"
        effect="immediate"
        subtitle="分类树同时服务报价产品与 BOM；历史引用不会因停用而删除。"
        actions={
          <Link href={`${routeBase}/new`} className={buttonVariants()}>
            新建产品结构分类
          </Link>
        }
      />

      <AdminTableCard
        isEmpty={nodes.length === 0}
        emptyTitle="暂无产品结构分类"
      >
        <ProductCategoryNodesTable nodes={nodes} editBase={routeBase} />
      </AdminTableCard>
    </div>
  );
}

export async function NewProductCategoryCatalogItem({
  routeBase,
}: {
  routeBase: ProductCategoryRouteBase;
}) {
  await requirePermission('dict:product:manage');
  const nodes = await listProductCategoryNodes();
  const parentOptions = nodes
    .filter((node) => node.isActive && !isRetiredProductCategory(node))
    .map((node) => {
      const depth = Math.max(0, node.path.split('.').length - 2);
      return { id: node.id, label: `${'　'.repeat(depth)}${node.name}` };
    });
  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title="新建产品结构分类"
        effect="immediate"
        actions={
          <Link
            href={routeBase}
            className={buttonVariants({ variant: 'outline' })}
          >
            返回分类列表
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <ProductCategoryForm
          mode="create"
          action={createRuleCenterProductCategoryNodeAction}
          parentOptions={parentOptions}
          routeBase={routeBase}
        />
      </section>
    </div>
  );
}

export async function EditProductCategoryCatalogItem({
  params,
  routeBase,
}: ProductCategoryCatalogDetailProps) {
  await requirePermission('dict:product:manage');
  const { id } = await params;
  const node = await getProductCategoryNodeSummary(id);
  if (!node) notFound();
  const isRetired = isRetiredProductCategory(node);

  const boundUpdate = updateProductCategoryNodeAction.bind(null, id);
  const formInitial = {
    name: node.name,
    legacyCategory: node.legacyCategory,
    sortOrder: node.sortOrder,
  };

  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title={`编辑产品结构分类：${node.name}`}
        effect="immediate"
        subtitle={`${node._count.products} 个报价产品`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone={node.isActive ? 'success' : 'neutral'}>
              {node.isActive ? '启用' : '停用'}
            </StatusBadge>
            {isRetired ? (
              <StatusBadge tone="warning">历史 / 已退役</StatusBadge>
            ) : null}
          </div>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        <ProductCategoryForm
          key={`${node.id}-${node.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          initial={formInitial}
          routeBase={routeBase}
        />
      </section>

      {node.isActive || !isRetired ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-2 text-base font-semibold">
            {node.isActive ? '停用分类' : '启用分类'}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {node.isActive
              ? '停用后，新建 SKU 和 BOM 不可选择；已有引用保留。'
              : '启用后会重新进入新 SKU 和新 BOM 的分类选择器。'}
          </p>
          <ToggleProductCategoryActiveButton
            nodeId={node.id}
            currentlyActive={node.isActive}
          />
        </section>
      ) : null}
    </div>
  );
}
