import Link from 'next/link';
import { createUserAction } from '@/actions/owner-accounts';
import { AccountForm } from '@/components/business/account/AccountForm';
import { requirePermission } from '@/lib/auth/permissions';
import { listWorkerCapabilityCrafts } from '@/lib/account';

export const metadata = {
  title: '新建账号 · 红包印刷 ERP',
};

export default async function NewAccountPage() {
  // Page-level server-side authz (defense-in-depth; the create action
  // also re-checks). Layout gate doesn't re-run on soft navigation.
  await requirePermission('account:manage');
  const capabilityCrafts = await listWorkerCapabilityCrafts();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">新建账号</h1>
        <p className="text-sm text-muted-foreground">
          新账号默认启用；师傅需选岗位，开机师傅还需选机器类型。
          <Link href="/owner/accounts" className="ml-2 text-primary underline hover:no-underline">
            返回列表
          </Link>
        </p>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <AccountForm
          mode="create"
          action={createUserAction}
          capabilityCrafts={capabilityCrafts}
        />
      </div>
    </div>
  );
}
