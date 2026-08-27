import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  createProductCategoryNodeAction,
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
import { PageHeader, StatusBadge } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import {
  getProductCategoryNodeSummary,
  listProductCategoryNodes,
} from '@/lib/product';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

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
      <PageHeader
        title="产品结构分类"
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
    .filter((node) => node.isActive)
    .map((node) => {
      const depth = Math.max(0, node.path.split('.').length - 2);
      return { id: node.id, label: `${'　'.repeat(depth)}${node.name}` };
    });
  const inRuleCenter = routeBase === RULE_CENTER_HREFS.productCategories;

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建产品结构分类"
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
          action={
            inRuleCenter
              ? createRuleCenterProductCategoryNodeAction
              : createProductCategoryNodeAction
          }
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

  const boundUpdate = updateProductCategoryNodeAction.bind(null, id);
  const formInitial = {
    name: node.name,
    legacyCategory: node.legacyCategory,
    sortOrder: node.sortOrder,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`编辑产品结构分类：${node.name}`}
        subtitle={`${node._count.products} 个报价 SKU`}
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
          routeBase={routeBase}
        />
      </section>

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
    </div>
  );
}
