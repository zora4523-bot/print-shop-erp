import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import {
  AdminPagination,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import { BomsTable } from '@/components/business/bom/BomsTable';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listBomsPage } from '@/lib/bom';
import {
  parsePositiveInt,
  type TableHrefParams,
} from '@/lib/admin/table';
import {
  categoryChainLabelMap,
  listProductCategoryNodes,
} from '@/lib/product';

export const metadata = {
  title: '用料清单',
};

type PageProps = {
  searchParams: Promise<{
    page?: string | string[];
    pageSize?: string | string[];
  }>;
};

const OWNER_BOMS_PATH = '/owner/boms';

export default async function OwnerBomsPage({ searchParams }: PageProps) {
  await requirePermission('bom:manage');
  const sp = await searchParams;
  const page = parsePositiveInt(sp.page, { defaultValue: 1, min: 1 });
  const pageSize = parsePositiveInt(sp.pageSize, {
    defaultValue: 20,
    min: 5,
    max: 100,
  });
  const [bomPage, categoryNodes] = await Promise.all([
    listBomsPage({ page, pageSize }),
    listProductCategoryNodes(),
  ]);
  // 分类目标用名称链消歧（分类名允许跨父级重名）
  const categoryLabelById = Object.fromEntries(
    categoryChainLabelMap(categoryNodes),
  );
  const queryParams: TableHrefParams = {
    page: bomPage.page,
    pageSize,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="用料清单"
        subtitle="产品或产品结构的物料用量；不会自动扣减库存。"
        actions={
          <Link href="/owner/boms/new" className={buttonVariants()}>
            新建用料清单
          </Link>
        }
      />

      <AdminTableCard
        isEmpty={bomPage.rows.length === 0}
        emptyTitle="暂无用料清单"
        footer={
          <AdminPagination
            basePath={OWNER_BOMS_PATH}
            page={bomPage.page}
            pageCount={bomPage.pageCount}
            total={bomPage.total}
            pageSize={bomPage.pageSize}
            queryParams={queryParams}
          />
        }
      >
        <BomsTable boms={bomPage.rows} categoryLabelById={categoryLabelById} />
      </AdminTableCard>
    </div>
  );
}
