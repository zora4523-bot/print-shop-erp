import { pieceworkScheduleCancellationEnabled } from '@/lib/salary/piecework-cancellation';
import { PieceworkPriceBookForm } from '@/components/business/salary/PieceworkPriceBookForm';
import { listPieceworkAdminBooks } from '@/lib/salary/piecework-admin';
import { listPersonalPieceworkBooks } from '@/lib/salary/personal-piecework-admin';
import { operationTypeForReporterAccount } from '@/lib/production/reporter-operation-lane';
import { notFound } from 'next/navigation';
import { PageHeader, ReceiptNotice } from '@/components/ui-business';
import { FormPage } from '@/app/_components/FormPage';
import { ActiveStatusBadge } from '@/components/business/master-data/ActiveStatusBadge';
import { readReceipt } from '@/lib/admin/receipt';
import { getUserSummary } from '@/lib/account';
import { updateUserAction } from '@/actions/owner-accounts';
import { AccountForm } from '@/components/business/account/AccountForm';
import { ResetPasswordForm } from '@/components/business/account/ResetPasswordForm';
import { ToggleActiveButton } from '@/components/business/account/ToggleActiveButton';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission('account:manage', session.user.role)) {
    return { title: '用户管理' };
  }
  const account = await getUserSummary(id);
  return {
    title: account ? `编辑 ${account.displayName} · 用户管理` : '账号不存在',
  };
}

export default async function EditAccountPage({ params, searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('account:manage');
  const { id } = await params;
  const account = await getUserSummary(id);
  if (!account) notFound();

  const personalBooks = account.role === 'WORKER' ? await listPersonalPieceworkBooks(id) : [];
  const lane = operationTypeForReporterAccount(account);
  const unifiedBooks = account.role === 'WORKER' ? await listPieceworkAdminBooks() : [];

  // Bind the id once so the form only has to pass (prev, fd).
  const boundUpdate = updateUserAction.bind(null, id);

  const receipt = readReceipt(await searchParams);

  return (
    <FormPage>
      <ReceiptNotice receipt={receipt} noun="账号" />
      <PageHeader
        title={`编辑用户：${account.displayName}`}
        subtitle={<>用户名 <span className="font-mono">{account.username}</span></>}
        status={<ActiveStatusBadge active={account.isActive} />}
        back={{ href: '/owner/accounts', label: '返回用户管理' }}
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        {/*
          Key on updatedAt so the client component remounts after a successful
          save (revalidatePath brings a fresh `account` with a newer timestamp).
          Without this, useState seeded from `initial` keeps the pre-submit
          value and the form can drift away from the DB on subsequent edits
          — React's canonical "reset state when the underlying row changes"
          pattern. Accepted trade-off: the inline "✓ 已保存" banner is very
          short-lived because the form unmounts as soon as the revalidated
          render arrives.
        */}
        <AccountForm
          key={`${account.id}-${account.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          initial={account}
        />
      </section>

      {account.role === 'WORKER' && <PieceworkPriceBookForm cancellationEnabled={pieceworkScheduleCancellationEnabled()} books={personalBooks} now={new Date().toISOString()} personal={{ workerId: id, lane, canEdit: Boolean(lane), unifiedBooks }} />}

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">重置密码</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          直接为该用户设置新密码，无需输入旧密码；建议用户登录后自行修改。
        </p>
        <ResetPasswordForm userId={account.id} />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">
          {account.isActive ? '停用账号' : '激活账号'}
        </h2>
        <ToggleActiveButton userId={account.id} currentlyActive={account.isActive} />
      </section>
    </FormPage>
  );
}
