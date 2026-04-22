import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { roleLabel } from '@/lib/auth/role-labels';
import { LogoutButton } from '@/components/business/auth/LogoutButton';

export default async function Home() {
  const { user } = await requireSession();

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold">红包印刷 ERP</h1>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {user.displayName} · {roleLabel(user.role)}
            </span>
            <Link
              href="/account/password"
              className="text-muted-foreground hover:text-foreground underline"
            >
              修改密码
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="rounded-xl border bg-card p-8 shadow-sm">
          <h2 className="mb-2 text-xl font-semibold">欢迎回来，{user.displayName}</h2>
          <p className="text-sm text-muted-foreground">
            这是 P0 阶段的最小登录壳。后续几个切片会按 SPEC §9.1 P0
            清单逐步补齐：工单核心、生产流程、薪资、推送、CDR、账单、Dashboard。
          </p>
        </div>
      </main>
    </div>
  );
}
