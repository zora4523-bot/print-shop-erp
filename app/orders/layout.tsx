import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Role } from '../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';
import { roleLabel } from '@/lib/auth/role-labels';
import { LogoutButton } from '@/components/business/auth/LogoutButton';

// /orders is open to every authenticated role — SALES / CUSTOMER_SERVICE
// submit and track their own, OWNER / FOREMAN see everything, WORKER sees
// orders they have tasks on. Middleware already enforces auth; this layout
// just renders the shared shell + nav.
export default async function OrdersLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { user } = session;
  const showOwnerBackstage = user.role === Role.OWNER;

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold">
              红包印刷 ERP
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/orders" className="font-medium">
                工单
              </Link>
              {showOwnerBackstage ? (
                <Link
                  href="/owner/accounts"
                  className="text-muted-foreground hover:text-foreground"
                >
                  老板后台
                </Link>
              ) : null}
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
