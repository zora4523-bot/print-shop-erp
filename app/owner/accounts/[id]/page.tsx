import { notFound } from 'next/navigation';
import { getUserSummary } from '@/lib/account';
import { updateUserAction } from '@/actions/owner-accounts';
import { AccountForm } from '@/components/business/account/AccountForm';
import { ResetPasswordForm } from '@/components/business/account/ResetPasswordForm';
import { ToggleActiveButton } from '@/components/business/account/ToggleActiveButton';

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const account = await getUserSummary(id);
  return {
    title: account ? `编辑 ${account.displayName} · 账号管理` : '账号不存在',
  };
}

export default async function EditAccountPage({ params }: PageProps) {
  const { id } = await params;
  const account = await getUserSummary(id);
  if (!account) notFound();

  // Bind the id once so the form only has to pass (prev, fd).
  const boundUpdate = updateUserAction.bind(null, id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          编辑账号：{account.displayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          用户名 <span className="font-mono">{account.username}</span>
          {account.isActive ? ' · 活跃' : ' · 停用'}
        </p>
      </div>

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
        <p className="mb-3 text-sm text-muted-foreground">
          {account.isActive
            ? '停用后该账号无法登录；历史记录全部保留。不能停用自己，也不能停用最后一位活跃 OWNER。'
            : '激活后该账号可重新登录。'}
        </p>
        <ToggleActiveButton userId={account.id} currentlyActive={account.isActive} />
      </section>
    </div>
  );
}
