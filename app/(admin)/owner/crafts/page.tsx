import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { listCraftsPage } from '@/lib/craft';
import { CraftsTable } from '@/components/business/craft/CraftsTable';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import {
  AdminPagination,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import {
  parsePositiveInt,
  type TableHrefParams,
} from '@/lib/admin/table';

export const metadata = {
  title: '工艺字典 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{
    page?: string | string[];
    pageSize?: string | string[];
  }>;
};

const OWNER_CRAFTS_PATH = '/owner/crafts';

export default async function CraftsListPage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('dict:craft:manage');
  const sp = await searchParams;
  const page = parsePositiveInt(sp.page, { defaultValue: 1, min: 1 });
  const pageSize = parsePositiveInt(sp.pageSize, {
    defaultValue: 20,
    min: 5,
    max: 100,
  });
  const craftPage = await listCraftsPage({ page, pageSize });
  const queryParams: TableHrefParams = {
    page: craftPage.page,
    pageSize,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="工艺字典"
        subtitle="管理工艺清单（SPEC §6.1）。外协工艺不生成内部生产任务，只进外协单。停用只影响新录工单，历史工单记录保留。"
        actions={
          <Link
            href="/owner/crafts/new"
            prefetch={false}
            className={buttonVariants()}
          >
            新建工艺
          </Link>
        }
      />
      <AdminTableCard
        isEmpty={craftPage.rows.length === 0}
        emptyTitle="暂无工艺"
        footer={
          <AdminPagination
            basePath={OWNER_CRAFTS_PATH}
            page={craftPage.page}
            pageCount={craftPage.pageCount}
            total={craftPage.total}
            pageSize={craftPage.pageSize}
            queryParams={queryParams}
          />
        }
      >
        <CraftsTable crafts={craftPage.rows} />
      </AdminTableCard>
    </div>
  );
}
