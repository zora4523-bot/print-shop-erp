import { cache } from 'react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  createQuoteProductAction,
  updateQuoteProductAction,
} from '@/actions/owner-products';
import {
  AdminListToolbar,
  AdminPagination,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import {
  ProductForm,
  type ProductRouteBase,
} from '@/components/business/product/ProductForm';
import { ProductReferenceImpact } from '@/components/business/product/ProductReferenceImpact';
import { ProductsTable } from '@/components/business/product/ProductsTable';
import { ToggleActiveButton } from '@/components/business/product/ToggleActiveButton';
import { buttonVariants } from '@/components/ui/button';
import { StatusBadge, ReceiptNotice, FormPageContainer, LinkPendingHint } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';
import { ActiveStatusBadge } from '@/components/business/master-data/ActiveStatusBadge';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { RuleSpecWorkspace } from '@/components/business/rules/catalog/RuleSpecWorkspace';
import type { ProductCategory } from '@/generated/prisma/enums';
import {
  buildTableHref,
  firstSearchParam,
  parsePositiveInt,
  type TableHrefParams,
} from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import {
  getProductReferenceImpact,
  getProductSummary,
  isRetiredProductCategory,
  listProductCategoryOptions,
  listProductsPage,
  type ProductActiveStatusFilter,
} from '@/lib/product';

export type ProductCatalogListProps = {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    pageSize?: string | string[];
    status?: string | string[];
    section?: string | string[];
  }>;
  routeBase: ProductRouteBase;
  categories?: readonly ProductCategory[];
};

export type ProductCatalogDetailProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  routeBase: ProductRouteBase;
  categories?: readonly ProductCategory[];
};

// generateMetadata and the page are evaluated independently. React cache keeps
// the Prisma lookup request-local while metadata remains permission-safe.
const loadProduct = cache(getProductSummary);

export async function getProductCatalogMetadata({
  params,
  titleScope = '产品资料',
}: Pick<ProductCatalogDetailProps, 'params'> & { titleScope?: string }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission('dict:product:manage', session.user.role)) {
    return { title: titleScope };
  }
  const product = await loadProduct(id);
  return {
    title: product
      ? `编辑 ${externalPriceBusinessText(product.name) || '未命名产品'} · ${titleScope}`
      : '产品资料不存在',
  };
}

export async function ProductCatalogList({
  searchParams,
  routeBase,
  categories,
}: ProductCatalogListProps) {
  await requirePermission('dict:product:manage');
  const sp = await searchParams;
  const q = firstSearchParam(sp.q).trim();
  const specWorkspace =
    routeBase === RULE_CENTER_HREFS.productReferences &&
    firstSearchParam(sp.section) === 'specs';
  const rawStatus = firstSearchParam(sp.status);
  const status: ProductActiveStatusFilter =
    rawStatus === 'all' || rawStatus === 'inactive' ? rawStatus : 'active';
  const page = parsePositiveInt(sp.page, { defaultValue: 1, min: 1 });
  const pageSize = parsePositiveInt(sp.pageSize, {
    defaultValue: 20,
    min: 5,
    max: 100,
  });
  const productPage = await listProductsPage({
    q,
    status,
    page,
    pageSize,
    categories,
  });
  const queryParams: TableHrefParams = {
    q: q || undefined,
    page: productPage.page,
    pageSize,
    status,
    section: specWorkspace ? 'specs' : undefined,
  };
  return (
    <div className="space-y-6">
      <RuleCenterPageHeader
        title={specWorkspace ? '规格 · 烫金颜色' : '产品资料'}
        effect="immediate"
        subtitle={
          specWorkspace
            ? '规格和纸张来自产品资料；烫金颜色当前随工单事实维护。'
            : '维护专版和彩印等路线的产品资料；空白封在单价表直接配置。'
        }
        actions={
          <Link
            href={`${routeBase}/new`}
            prefetch={false}
            className={buttonVariants()}
          >
            新建产品资料
          </Link>
        }
      />

      {specWorkspace ? (
        <RuleSpecWorkspace
          products={productPage.rows}
          routeBase={routeBase}
          query={q}
          status={status}
          hiddenSearchParams={{ section: 'specs', pageSize, status }}
          pagination={{
            page: productPage.page,
            pageCount: productPage.pageCount,
            total: productPage.total,
            pageSize: productPage.pageSize,
            queryParams,
          }}
        />
      ) : (
        <>
          <AdminListToolbar
            action={routeBase}
            query={q}
            placeholder="搜索编码、名称、规格、纸张"
            clearHref={buildTableHref(routeBase, {}, { status, pageSize })}
            hiddenParams={{ pageSize, status }}
            filters={
              <div
                role="group"
                aria-label="产品资料状态筛选"
                className="flex flex-wrap gap-1 rounded-lg border bg-muted/20 p-1"
              >
                {(
                  [
                    ['all', '全部'],
                    ['active', '已启用'],
                    ['inactive', '已停用'],
                  ] as const
                ).map(([value, label]) => (
                  <Link
                    key={value}
                    href={buildTableHref(routeBase, queryParams, {
                      status: value,
                      page: null,
                    })}
                    prefetch={false}
                    scroll={false}
                    aria-current={status === value ? 'page' : undefined}
                    className={cn(
                      buttonVariants({
                        variant: status === value ? 'selected' : 'ghost',
                        size: 'sm',
                      }),
                      'relative',
                    )}
                  >
                    {label}
                    <LinkPendingHint />
                  </Link>
                ))}
              </div>
            }
          />

          <AdminTableCard
            isEmpty={productPage.rows.length === 0}
            emptyTitle="暂无产品资料"
            emptyDescription={
              q
                ? '没有匹配当前搜索与状态条件的记录。'
                : status === 'inactive'
                  ? '暂无已停用记录'
                  : status === 'active'
                    ? '暂无已启用记录，可切换到“全部”查看。'
                    : undefined
            }
            footer={
              <AdminPagination
                basePath={routeBase}
                page={productPage.page}
                pageCount={productPage.pageCount}
                total={productPage.total}
                pageSize={productPage.pageSize}
                queryParams={queryParams}
              />
            }
          >
            <ProductsTable
              products={productPage.rows}
              editBase={routeBase}
              label="产品资料列表"
              categoryHeading="产品结构"
            />
          </AdminTableCard>
        </>
      )}
    </div>
  );
}

export async function NewProductCatalogItem({
  routeBase,
  categories,
}: Omit<ProductCatalogListProps, 'searchParams'>) {
  await requirePermission('dict:product:manage');
  const allCategoryNodes = await listProductCategoryOptions();
  const activeCategoryNodes = allCategoryNodes.filter(
    (node) => !isRetiredProductCategory(node),
  );
  const categoryNodes = categories?.length
    ? activeCategoryNodes.filter((node) =>
        categories.includes(node.legacyCategory),
      )
    : activeCategoryNodes;
  return (
    <FormPageContainer>
      <RuleCenterPageHeader
        title="新建产品资料"
        effect="immediate"
        subtitle="本页维护专版和彩印等路线的产品资料。价格及数量档在客户计价规则中维护。"
        back={{ href: routeBase, label: '返回产品资料' }}
      />
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <ProductForm
          mode="create"
          action={createQuoteProductAction}
          categoryNodes={categoryNodes}
          routeBase={routeBase}
          categoryManagementHref={RULE_CENTER_HREFS.productCategories}
        />
      </div>
    </FormPageContainer>
  );
}

export async function EditProductCatalogItem({
  params,
  searchParams,
  routeBase,
  categories,
}: ProductCatalogDetailProps) {
  await requirePermission('dict:product:manage');
  const { id } = await params;
  const receipt = readReceipt(await searchParams);
  const [product, referenceImpact] = await Promise.all([
    loadProduct(id),
    getProductReferenceImpact(id),
  ]);
  if (!product) notFound();
  const isRetired = isRetiredProductCategory(product.categoryNode);

  const isLegacyCompatibilityObject = Boolean(
    categories?.length && !categories.includes(product.category),
  );
  const allCategoryOptions = await listProductCategoryOptions({
    includeInactiveIds: [product.categoryNodeId],
  });
  const currentAndActiveCategoryOptions = allCategoryOptions.filter(
    (node) =>
      node.id === product.categoryNodeId || !isRetiredProductCategory(node),
  );
  const categoryOptions = categories?.length
    ? currentAndActiveCategoryOptions.filter(
        (node) =>
          node.id === product.categoryNodeId ||
          categories.includes(node.legacyCategory),
      )
    : currentAndActiveCategoryOptions;
  const boundUpdate = updateQuoteProductAction.bind(null, id);
  const formInitial = {
    code: product.code,
    categoryNodeId: product.categoryNodeId,
    name: product.name,
    specification: product.specification,
    paperType: product.paperType,
  };

  return (
    <div className="space-y-6">
      <ReceiptNotice receipt={receipt} noun="产品资料" />
      <RuleCenterPageHeader
        title={`编辑产品资料：${
          externalPriceBusinessText(product.name) || '未命名产品'
        }`}
        effect="immediate"
        back={{ href: routeBase, label: '返回产品资料' }}
        status={
          <>
            <ActiveStatusBadge active={product.isActive} />
            {isRetired ? <StatusBadge tone="warning">历史 / 已退役</StatusBadge> : null}
          </>
        }
        subtitle={
          <>
            {externalPriceBusinessText(product.categoryNode.name) ||
              '未命名分类'}
            {isLegacyCompatibilityObject ? ' · 仅保留历史引用' : ''}
          </>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        <ProductForm
          key={`${product.id}-${product.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          identityReadOnly={product.category === 'BLANK_STOCK' || product.category === 'COLOR_PRINT'}
          initial={formInitial}
          categoryNodes={categoryOptions}
          routeBase={routeBase}
          categoryManagementHref={RULE_CENTER_HREFS.productCategories}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">被引用 / 停用影响</h2>
        <ProductReferenceImpact impact={referenceImpact} />
      </section>

      {product.isActive || !isRetired ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-2 text-base font-semibold">
            {product.isActive ? '停用产品资料' : '启用产品资料'}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {product.isActive
              ? '停用后不再参与新建工单的隐式匹配；已有工单、BOM 和已发布价格不会被改写。'
              : '启用后会重新参与新建工单的产品结构、纸张与规格匹配。'}
          </p>
          <ToggleActiveButton
            key={`${product.id}-${product.isActive}`}
            productId={product.id}
            currentlyActive={product.isActive}
            impact={referenceImpact}
          />
        </section>
      ) : null}
    </div>
  );
}
