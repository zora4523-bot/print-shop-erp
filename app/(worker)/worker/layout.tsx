import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Role } from '../../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';
import { roleLabel } from '@/lib/auth/role-labels';
import { LogoutButton } from '@/components/business/auth/LogoutButton';

// H5 shell for 师傅端. WORKER only — OWNER / FOREMAN have their own
// overrides in the action layer but view the worker tasks through the
// foreman side. Tighter max-width (640) because this is designed for
// phones in portrait, not desktop.
export default async function WorkerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { user } = session;
  if (user.role !== Role.WORKER) redirect('/');

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/worker/tasks" className="text-base font-semibold">
              师傅工作台
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {user.displayName}（{roleLabel(user.role)}）
              </span>
              <LogoutButton />
            </div>
          </div>
          <nav aria-label="师傅工作台导航" className="mt-3 flex gap-2 text-sm">
            <Link href="/worker/tasks" className="rounded-md border px-3 py-1.5 hover:bg-muted">
              我的任务
            </Link>
            <Link href="/worker/orders" className="rounded-md border px-3 py-1.5 hover:bg-muted">
              我的工单
            </Link>
            <Link href="/worker/salary" className="rounded-md border px-3 py-1.5 hover:bg-muted">
              我的计件工资
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-4">{children}</main>
    </div>
  );
}
