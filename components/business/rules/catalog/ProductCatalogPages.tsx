import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  createProductAction,
  createQuoteProductAction,
  setQuoteProductActiveAction,
  updateProductAction,
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
import { PageHeader } from '@/components/ui-business';
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
  }>;
  routeBase: ProductRouteBase;
  categories?: readonly ProductCategory[];
};

export type ProductCatalogDetailProps = {
  params: Promise<{ id: string }>;
  routeBase: ProductRouteBase;
  categories?: readonly ProductCategory[];
};

// generateMetadata and the page are evaluated independently. React cache keeps
// the Prisma lookup request-local while metadata remains permission-safe.
const loadProduct = cache(getProductSummary);

export async function getProductCatalogMetadata({
  params,
  titleScope = '报价 SKU',
}: Pick<ProductCatalogDetailProps, 'params'> & { titleScope?: string }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission('dict:product:manage', session.user.role)) {
    return { title: titleScope };
  }
  const product = await loadProduct(id);
  return {
    title: product
      ? `编辑 ${externalPriceBusinessText(product.name) || '未命名 SKU'} · ${titleScope}`
      : '报价 SKU 不存在',
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
  };
  const inRuleCenter = routeBase === RULE_CENTER_HREFS.stockSkus;

  return (
    <div className="space-y-6">
      <PageHeader
        title={inRuleCenter ? '报价 SKU' : '产品字典'}
        actions={
          <Link
            href={`${routeBase}/new`}
            prefetch={false}
            className={buttonVariants()}
          >
            新建报价 SKU
          </Link>
        }
      />

      <AdminListToolbar
        action={routeBase}
        query={q}
        placeholder="搜索编码、名称、规格、纸张"
        clearHref={buildTableHref(routeBase, {}, { status, pageSize })}
        hiddenParams={{ pageSize, status }}
        filters={
          <div
            role="group"
            aria-label="报价 SKU 状态筛选"
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
                aria-current={status === value ? 'page' : undefined}
                className={buttonVariants({
                  variant: status === value ? 'secondary' : 'ghost',
                  size: 'sm',
                })}
              >
                {label}
              </Link>
            ))}
          </div>
        }
      />

      <AdminTableCard
        isEmpty={productPage.rows.length === 0}
        emptyTitle={inRuleCenter ? '暂无报价 SKU' : '暂无产品'}
        emptyDescription={
          q
            ? '没有匹配当前搜索与状态条件的记录。'
            : status === 'inactive'
              ? '暂无已停用记录。'
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
          label={inRuleCenter ? '报价 SKU 列表' : '产品字典列表'}
          categoryHeading={inRuleCenter ? '产品结构' : '分类'}
          showInternalPrice={!inRuleCenter}
        />
      </AdminTableCard>
    </div>
  );
}

export async function NewProductCatalogItem({
  routeBase,
  categories,
}: Omit<ProductCatalogListProps, 'searchParams'>) {
  await requirePermission('dict:product:manage');
  const allCategoryNodes = await listProductCategoryOptions();
  const categoryNodes = categories?.length
    ? allCategoryNodes.filter((node) => categories.includes(node.legacyCategory))
    : allCategoryNodes;
  const inRuleCenter = routeBase === RULE_CENTER_HREFS.stockSkus;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">新建报价 SKU</h1>
        <p className="text-sm text-muted-foreground">
          <Link
            href={routeBase}
            className="text-primary underline hover:no-underline"
          >
            返回列表
          </Link>
        </p>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <ProductForm
          mode="create"
          action={inRuleCenter ? createQuoteProductAction : createProductAction}
          categoryNodes={categoryNodes}
          routeBase={routeBase}
          categoryManagementHref={RULE_CENTER_HREFS.productCategories}
          showInternalPrice={!inRuleCenter}
        />
      </div>
    </div>
  );
}

export async function EditProductCatalogItem({
  params,
  routeBase,
  categories,
}: ProductCatalogDetailProps) {
  await requirePermission('dict:product:manage');
  const { id } = await params;
  const [product, referenceImpact] = await Promise.all([
    loadProduct(id),
    getProductReferenceImpact(id),
  ]);
  if (!product) notFound();

  const isLegacyCompatibilityObject = Boolean(
    categories?.length && !categories.includes(product.category),
  );
  const allCategoryOptions = await listProductCategoryOptions({
    includeInactiveIds: [product.categoryNodeId],
  });
  const categoryOptions = categories?.length
    ? allCategoryOptions.filter(
        (node) =>
          node.id === product.categoryNodeId ||
          categories.includes(node.legacyCategory),
      )
    : allCategoryOptions;
  const inRuleCenter = routeBase === RULE_CENTER_HREFS.stockSkus;
  const boundUpdate = (
    inRuleCenter ? updateQuoteProductAction : updateProductAction
  ).bind(null, id);
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
        <h1 className="text-xl font-semibold">
          编辑报价 SKU：
          {externalPriceBusinessText(product.name) || '未命名 SKU'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {externalPriceBusinessText(product.categoryNode.name) || '未命名分类'}
          {product.isActive ? ' · 启用' : ' · 停用'}
          {isLegacyCompatibilityObject
            ? ' · 不可用于新报价'
            : ''}
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
          routeBase={routeBase}
          categoryManagementHref={RULE_CENTER_HREFS.productCategories}
          showInternalPrice={!inRuleCenter}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">被引用 / 停用影响</h2>
        <ProductReferenceImpact impact={referenceImpact} />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">
          {product.isActive ? '停用报价 SKU' : '启用报价 SKU'}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {product.isActive
            ? '停用后不再出现在新工单选择器中；已有工单和价格保留。'
            : '启用后会重新进入新工单的可选规格。'}
        </p>
        <ToggleActiveButton
          key={`${product.id}-${product.isActive}`}
          productId={product.id}
          currentlyActive={product.isActive}
          impact={referenceImpact}
          action={
            inRuleCenter ? setQuoteProductActiveAction : undefined
          }
        />
      </section>
    </div>
  );
}
