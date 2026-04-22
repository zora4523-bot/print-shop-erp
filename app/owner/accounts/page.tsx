import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { listUsers } from '@/lib/account';
import { AccountsTable } from '@/components/business/account/AccountsTable';

export const metadata = {
  title: '账号管理 · 红包印刷 ERP',
};

export default async function AccountsListPage() {
  // Permission check is done at the /owner layout; this page just renders.
  const accounts = await listUsers();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">账号管理</h1>
          <p className="text-sm text-muted-foreground">
            新增、编辑、停用员工账号。至少保留一位活跃 OWNER。
          </p>
        </div>
        <Link href="/owner/accounts/new" className={buttonVariants()}>
          新建账号
        </Link>
      </div>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <AccountsTable accounts={accounts} />
      </div>
    </div>
  );
}
