import { FormPage } from '@/app/_components/FormPage';
import { PageHeader } from '@/components/ui-business';
import { createUserAction } from '@/actions/owner-accounts';
import { AccountForm } from '@/components/business/account/AccountForm';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '新建用户',
};

export default async function NewAccountPage() {
  // Page-level server-side authz (defense-in-depth; the create action
  // also re-checks). Layout gate doesn't re-run on soft navigation.
  await requirePermission('account:manage');
  return (
    <FormPage>
      <PageHeader
        title="新建用户"
        subtitle="新账号默认启用；师傅需选岗位，开机师傅还需选机器类型。"
        back={{ href: '/owner/accounts', label: '返回用户管理' }}
      />
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <AccountForm mode="create" action={createUserAction} />
      </div>
    </FormPage>
  );
}
