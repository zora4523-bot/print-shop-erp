import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Role } from '../../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';
import { roleLabel } from '@/lib/auth/role-labels';
import { LogoutButton } from '@/components/business/auth/LogoutButton';

// H5 shell for 师傅端. WORKER only — ADMIN has its own
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
    <div className="worker-viewport bg-muted/40">
      <header className="border-b bg-background">
        <div className="worker-safe-inline worker-safe-top mx-auto max-w-xl pb-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Link
              href="/worker/tasks"
              className="inline-flex min-h-11 shrink-0 items-center text-base font-semibold"
            >
              师傅工作台
            </Link>
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 text-sm [&_button]:min-h-11">
              <span className="worker-wrap-anywhere min-w-0 text-right text-muted-foreground">
                {user.displayName}（{roleLabel(user.role)}）
              </span>
              <LogoutButton />
            </div>
          </div>
          <nav aria-label="师傅工作台导航" className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <Link href="/worker/tasks" className="inline-flex min-h-11 items-center justify-center rounded-md border px-2 text-center hover:bg-muted">
              我的任务
            </Link>
            <Link href="/worker/orders" className="inline-flex min-h-11 items-center justify-center rounded-md border px-2 text-center hover:bg-muted">
              我的工单
            </Link>
            <Link href="/worker/salary" className="inline-flex min-h-11 items-center justify-center rounded-md border px-2 text-center hover:bg-muted">
              我的工资
            </Link>
          </nav>
        </div>
      </header>
      <main className="worker-safe-inline worker-safe-bottom mx-auto w-full max-w-xl pt-4">
        {children}
      </main>
    </div>
  );
}
