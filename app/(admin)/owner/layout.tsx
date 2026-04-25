import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Role } from '../../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';
import { roleLabel } from '@/lib/auth/role-labels';
import { LogoutButton } from '@/components/business/auth/LogoutButton';

// Defense-in-depth: every Server Action in actions/owner-accounts.ts
// re-checks `requirePermission('account:manage')` on its own. This layout
// just keeps non-OWNER sessions out of the UI shell entirely so unauthorized
// users don't see a skeleton page flash before hitting the action guard.
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.user.role !== Role.OWNER) redirect('/');

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold">
            红包印刷 ERP · 老板后台
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {session.user.displayName} · {roleLabel(session.user.role)}
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
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
