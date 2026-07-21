import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { listUsers } from '@/lib/account';
import { AccountsTable } from '@/components/business/account/AccountsTable';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '账号管理 · 红包印刷 ERP',
};

export default async function AccountsListPage() {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('account:manage');
  // Permission check is done at the /owner layout; this page just renders.
  const accounts = await listUsers();

  return (
    <div className="space-y-6">
      <PageHeader
        title="账号管理"
        subtitle="新增、编辑、停用员工账号。系统至少保留一位活跃管理员。"
        actions={
          <Link href="/owner/accounts/new" className={buttonVariants()}>
            新建账号
          </Link>
        }
      />
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <AccountsTable accounts={accounts} />
      </div>
    </div>
  );
}
