import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import {
  AdminListToolbar,
  AdminPagination,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import {
  firstSearchParam,
  parsePositiveInt,
  parseSortDirection,
  parseSortKey,
  type TableHrefParams,
} from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import {
  listMaterialsPage,
  MATERIAL_LIST_SORT_KEYS,
} from '@/lib/material';
import { MaterialsTable } from '@/components/business/material/MaterialsTable';
import { PageHeader } from '@/components/ui-business';

export const metadata = {
  title: '物料字典 · 红包印刷 ERP',
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

const OWNER_MATERIALS_PATH = '/owner/materials';

export default async function OwnerMaterialsPage({ searchParams }: PageProps) {
  await requirePermission('material:manage');
  const sp = await searchParams;
  const q = firstSearchParam(sp.q).trim();
  const page = parsePositiveInt(sp.page, { defaultValue: 1, min: 1 });
  const pageSize = parsePositiveInt(sp.pageSize, {
    defaultValue: 20,
    min: 5,
    max: 100,
  });
  const sort = parseSortKey(sp.sort, MATERIAL_LIST_SORT_KEYS, 'default');
  const direction = parseSortDirection(sp.dir);
  const materialPage = await listMaterialsPage({
    q,
    page,
    pageSize,
    sort,
    direction,
  });
  const queryParams: TableHrefParams = {
    q: q || undefined,
    page: materialPage.page,
    pageSize,
    sort: sort === 'default' ? undefined : sort,
    dir: sort === 'default' ? undefined : direction,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="物料字典"
        subtitle="维护纸张、烫金纸、包装袋和成品现货等物料，并进入库存出入库操作。"
        actions={
          <>
            <Link
              href="/owner/materials/count"
              className={buttonVariants({ variant: 'outline' })}
            >
              库存盘点
            </Link>
            <Link href="/owner/materials/new" className={buttonVariants()}>
              新建物料
            </Link>
          </>
        }
      />

      <AdminListToolbar
        action={OWNER_MATERIALS_PATH}
        query={q}
        placeholder="搜索物料编码、名称、规格、单位、拼音"
        clearHref={OWNER_MATERIALS_PATH}
        hiddenParams={{
          pageSize,
          sort: sort === 'default' ? undefined : sort,
          dir: sort === 'default' ? undefined : direction,
        }}
      />

      <AdminTableCard
        isEmpty={materialPage.rows.length === 0}
        emptyTitle="暂无物料"
        emptyDescription={q ? '没有匹配当前搜索条件的物料。' : undefined}
        footer={
          <AdminPagination
            basePath={OWNER_MATERIALS_PATH}
            page={materialPage.page}
            pageCount={materialPage.pageCount}
            total={materialPage.total}
            pageSize={materialPage.pageSize}
            queryParams={queryParams}
          />
        }
      >
        <MaterialsTable
          materials={materialPage.rows}
          editBase="/owner/materials"
          tableBase={OWNER_MATERIALS_PATH}
          queryParams={queryParams}
          sort={sort}
          direction={direction}
        />
      </AdminTableCard>
    </div>
  );
}
