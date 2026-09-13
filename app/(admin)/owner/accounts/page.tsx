import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import {
  AdminListToolbar,
  AdminPagination,
} from '@/components/business/admin/AdminDataTable';
import { listUsersPage } from '@/lib/account';
import { AccountsTable } from '@/components/business/account/AccountsTable';
import { PageHeader } from '@/components/ui-business';
import {
  buildTableHref,
  firstSearchParam,
  parsePositiveInt,
  type TableHrefParams,
} from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '账号管理',
};

type PageProps = {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    pageSize?: string | string[];
  }>;
};

const OWNER_ACCOUNTS_PATH = '/owner/accounts';

export default async function AccountsListPage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('account:manage');
  const sp = await searchParams;
  const q = firstSearchParam(sp.q).trim();
  const page = parsePositiveInt(sp.page, { defaultValue: 1, min: 1 });
  const pageSize = parsePositiveInt(sp.pageSize, {
    defaultValue: 20,
    min: 5,
    max: 100,
  });
  const accountPage = await listUsersPage({ q, page, pageSize });
  const queryParams: TableHrefParams = {
    q: q || undefined,
    page: accountPage.page,
    pageSize,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="账号管理"
        actions={
          <Link href="/owner/accounts/new" className={buttonVariants()}>
            新建账号
          </Link>
        }
      />

      <AdminListToolbar
        action={OWNER_ACCOUNTS_PATH}
        query={q}
        placeholder="搜索用户名、姓名或电话"
        clearHref={buildTableHref(OWNER_ACCOUNTS_PATH, {}, {})}
        hiddenParams={{ pageSize }}
      />

      <div className="min-w-0 rounded-xl border bg-card shadow-sm">
        <div className="min-w-0 p-3 sm:p-4">
          <AccountsTable
            accounts={accountPage.rows}
            hasFilters={Boolean(q)}
          />
        </div>
        {accountPage.total > 0 ? (
          <div className="border-t px-4 py-3">
            <AdminPagination
              basePath={OWNER_ACCOUNTS_PATH}
              page={accountPage.page}
              pageCount={accountPage.pageCount}
              total={accountPage.total}
              pageSize={accountPage.pageSize}
              queryParams={queryParams}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
