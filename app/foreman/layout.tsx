import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Role } from '../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';
import { roleLabel } from '@/lib/auth/role-labels';
import { LogoutButton } from '@/components/business/auth/LogoutButton';

// Every server action under /foreman re-checks its own permission
// (`order:schedule`, `task:assign`, etc.); this layout is UI-shell
// gating only — keep non-FOREMAN / OWNER sessions from seeing the nav
// before the action layer rejects them.
export default async function ForemanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { user } = session;
  if (user.role !== Role.FOREMAN && user.role !== Role.OWNER) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold">
              红包印刷 ERP · 车间
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/foreman/scheduling" className="font-medium">
                排产
              </Link>
              <Link
                href="/foreman/outsource"
                className="text-muted-foreground hover:text-foreground"
              >
                外协
              </Link>
              <Link
                href="/foreman/attendance"
                className="text-muted-foreground hover:text-foreground"
              >
                考勤
              </Link>
              <Link
                href="/orders"
                className="text-muted-foreground hover:text-foreground"
              >
                工单列表
              </Link>
            </nav>
          </div>
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
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
