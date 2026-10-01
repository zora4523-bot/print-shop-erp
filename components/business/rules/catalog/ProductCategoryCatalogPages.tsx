import type { SupplementContext } from '@/lib/form-drafts/model';
import { supplementReturnHref } from '@/lib/form-drafts/return-context';
import { SupplementOwnership } from '@/components/business/form-drafts/FormDraftControls';
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
import { StatusBadge, ReceiptNotice, FormPageContainer } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import {
  getProductCategoryNodeSummary,
  isRetiredProductCategory,
  listProductCategoryNodes,
} from '@/lib/product';
import { ActiveStatusBadge } from '@/components/business/master-data/ActiveStatusBadge';
import { FormPendingScope } from '@/components/business/form/FormPendingScope';

export type ProductCategoryCatalogDetailProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
  const user = await requirePermission('dict:product:manage');
  const nodes = await listProductCategoryNodes();

  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title="产品结构分类 / 用料清单分类"
        effect="immediate"
        actions={
          <>
          {hasPermission('bom:manage', user.role) ? (
            <Link href="/owner/boms" className={buttonVariants({ variant: 'outline' })}>用料清单</Link>
          ) : null}
          <Link href="/owner/rules/product-categories/items" className={buttonVariants({ variant: 'outline' })}>产品资料</Link>
          <Link href={`${routeBase}/new`} className={buttonVariants()}>
            新建产品结构分类
          </Link>
          </>
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
  supplement,
}: {
  routeBase: ProductCategoryRouteBase;
  supplement?: SupplementContext | null;
}) {
  const actor = await requirePermission('dict:product:manage');
  if (supplement) await requirePermission(supplement.origin === 'purchase-new' ? 'purchase:manage' : 'bom:manage');
  const backHref = supplement ? supplementReturnHref(supplement) : routeBase;
  const nodes = await listProductCategoryNodes();
  const parentOptions = nodes
    .filter((node) => node.isActive && !isRetiredProductCategory(node))
    .map((node) => {
      const depth = Math.max(0, node.path.split('.').length - 2);
      return { id: node.id, label: `${'　'.repeat(depth)}${node.name}` };
    });
  return (
    <FormPendingScope>
    <FormPageContainer>
      <SupplementOwnership actorId={actor.id} context={supplement ?? null} />
      <RuleCenterPageHeader
        lockBackWhilePending
        title="新建产品结构分类"
        effect="immediate"
        back={{ href: backHref, label: supplement ? '返回原录入' : '返回产品结构分类' }}
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <ProductCategoryForm
          mode="create"
          supplement={supplement}
          action={createRuleCenterProductCategoryNodeAction}
          parentOptions={parentOptions}
          routeBase={routeBase}
        />
      </section>
    </FormPageContainer>
    </FormPendingScope>
  );
}

export async function EditProductCategoryCatalogItem({
  params,
  searchParams,
  routeBase,
}: ProductCategoryCatalogDetailProps) {
  await requirePermission('dict:product:manage');
  const { id } = await params;
  const receipt = readReceipt(await searchParams);
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
    <FormPendingScope>
    <div className="space-y-6">
      <ReceiptNotice receipt={receipt} noun="产品结构分类" />
      <RuleCenterPageHeader
        lockBackWhilePending
        title={`编辑产品结构分类：${node.name}`}
        effect="immediate"
        subtitle={`${node._count.products} 个产品资料`}
        back={{ href: routeBase, label: '返回产品结构分类' }}
        status={
          <>
            <ActiveStatusBadge active={node.isActive} />
            {isRetired ? <StatusBadge tone="warning">历史 / 已退役</StatusBadge> : null}
          </>
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
          <ToggleProductCategoryActiveButton
            nodeId={node.id}
            currentlyActive={node.isActive}
          />
        </section>
      ) : null}
    </div>
    </FormPendingScope>
  );
}
