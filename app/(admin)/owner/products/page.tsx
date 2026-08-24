import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import {
  AdminListToolbar,
  AdminPagination,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import { listProductsPage } from '@/lib/product';
import type { ProductActiveStatusFilter } from '@/lib/product';
import { ProductsTable } from '@/components/business/product/ProductsTable';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import {
  firstSearchParam,
  buildTableHref,
  parsePositiveInt,
  type TableHrefParams,
} from '@/lib/admin/table';

export const metadata = {
  title: '产品字典 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    pageSize?: string | string[];
    status?: string | string[];
  }>;
};

const OWNER_PRODUCTS_PATH = '/owner/products';

export default async function ProductsListPage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
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
  const productPage = await listProductsPage({ q, status, page, pageSize });
  const queryParams: TableHrefParams = {
    q: q || undefined,
    page: productPage.page,
    pageSize,
    status,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="产品字典"
        subtitle="管理产品、规格和纸张等基础信息。基础单价仅供内部销售和工厂直单使用；外部销售必须使用独立、版本化的报价管理。停用只影响新录工单。"
        actions={
          <>
            <Link
              href="/owner/prices/external-sales/items"
              prefetch={false}
              className={buttonVariants({ variant: 'outline' })}
            >
              外部销售报价管理
            </Link>
            <Link
              href="/owner/product-categories"
              prefetch={false}
              className={buttonVariants({ variant: 'outline' })}
            >
              管理分类
            </Link>
            <Link
              href="/owner/products/new"
              prefetch={false}
              className={buttonVariants()}
            >
              新建产品
            </Link>
          </>
        }
      />
      <AdminListToolbar
        action={OWNER_PRODUCTS_PATH}
        query={q}
        placeholder="搜索产品编码、产品名、规格、纸张"
        clearHref={buildTableHref(OWNER_PRODUCTS_PATH, {}, { status, pageSize })}
        hiddenParams={{ pageSize, status }}
        filters={
          <div
            role="group"
            aria-label="产品状态筛选"
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
                href={buildTableHref(OWNER_PRODUCTS_PATH, queryParams, {
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
        emptyTitle="暂无产品"
        emptyDescription={
          q
            ? '没有匹配当前搜索与状态条件的产品。'
            : status === 'inactive'
              ? '暂无已停用产品。'
              : status === 'active'
                ? '暂无已启用产品，可切换到“全部”查看。'
                : undefined
        }
        footer={
          <AdminPagination
            basePath={OWNER_PRODUCTS_PATH}
            page={productPage.page}
            pageCount={productPage.pageCount}
            total={productPage.total}
            pageSize={productPage.pageSize}
            queryParams={queryParams}
          />
        }
      >
        <ProductsTable products={productPage.rows} />
      </AdminTableCard>
    </div>
  );
}
