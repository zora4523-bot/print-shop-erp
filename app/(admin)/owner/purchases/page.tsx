import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import {
  AdminListToolbar,
  AdminPagination,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import { PurchaseOrdersTable } from '@/components/business/purchase/PurchaseOrdersTable';
import { PageHeader } from '@/components/ui-business';
import {
  firstSearchParam,
  parsePositiveInt,
  parseSortDirection,
  parseSortKey,
  type TableHrefParams,
} from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import {
  listPurchaseOrdersPage,
  PURCHASE_ORDER_LIST_SORT_KEYS,
} from '@/lib/purchase';

export const metadata = {
  title: '采购单',
};

type PageProps = {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    pageSize?: string | string[];
    sort?: string | string[];
    dir?: string | string[];
  }>;
};

const OWNER_PURCHASES_PATH = '/owner/purchases';

export default async function OwnerPurchasesPage({ searchParams }: PageProps) {
  await requirePermission('purchase:manage');
  const sp = await searchParams;
  const q = firstSearchParam(sp.q).trim();
  const page = parsePositiveInt(sp.page, { defaultValue: 1, min: 1 });
  const pageSize = parsePositiveInt(sp.pageSize, {
    defaultValue: 20,
    min: 5,
    max: 100,
  });
  const sort = parseSortKey(sp.sort, PURCHASE_ORDER_LIST_SORT_KEYS, 'default');
  const direction = parseSortDirection(sp.dir);
  const purchasePage = await listPurchaseOrdersPage({
    q,
    page,
    pageSize,
    sort,
    direction,
  });
  const queryParams: TableHrefParams = {
    q: q || undefined,
    page: purchasePage.page,
    pageSize,
    sort: sort === 'default' ? undefined : sort,
    dir: sort === 'default' ? undefined : direction,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="采购单"
        actions={
          <Link href="/owner/purchases/new" className={buttonVariants()}>
            新建采购单
          </Link>
        }
      />

      <AdminListToolbar
        action={OWNER_PURCHASES_PATH}
        query={q}
        placeholder="搜索采购单号、供应商、物料"
        clearHref={OWNER_PURCHASES_PATH}
        hiddenParams={{
          pageSize,
          sort: sort === 'default' ? undefined : sort,
          dir: sort === 'default' ? undefined : direction,
        }}
      />

      <AdminTableCard
        isEmpty={purchasePage.rows.length === 0}
        emptyTitle="暂无采购单"
        emptyDescription={q ? '没有匹配当前搜索条件的采购单。' : undefined}
        footer={
          <AdminPagination
            basePath={OWNER_PURCHASES_PATH}
            page={purchasePage.page}
            pageCount={purchasePage.pageCount}
            total={purchasePage.total}
            pageSize={purchasePage.pageSize}
            queryParams={queryParams}
          />
        }
      >
        <PurchaseOrdersTable
          orders={purchasePage.rows}
          tableBase={OWNER_PURCHASES_PATH}
          queryParams={queryParams}
          sort={sort}
          direction={direction}
        />
      </AdminTableCard>
    </div>
  );
}
