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
          </div>
          <nav aria-label="师傅工作台导航" className="mt-2 grid grid-cols-4 gap-2 text-sm">
            <Link href="/worker/tasks" className="inline-flex min-h-11 items-center justify-center rounded-md border px-2 text-center hover:bg-muted">
              我的任务
            </Link>
            <Link href="/worker/orders" className="inline-flex min-h-11 items-center justify-center rounded-md border px-2 text-center hover:bg-muted">
              我的工单
            </Link>
            <Link href="/worker/salary" className="inline-flex min-h-11 items-center justify-center rounded-md border px-2 text-center hover:bg-muted">
              我的工资
            </Link>
            <a href="#worker-account" className="inline-flex min-h-11 items-center justify-center rounded-md border px-2 text-center hover:bg-muted">
              我的
            </a>
          </nav>
        </div>
      </header>
      <main className="worker-safe-inline worker-safe-bottom mx-auto w-full max-w-xl pt-4">
        {children}
      </main>
      <footer
        id="worker-account"
        className="worker-safe-inline worker-safe-bottom mx-auto mt-2 w-full max-w-xl border-t pt-4"
      >
        <section
          aria-labelledby="worker-account-heading"
          className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm shadow-sm [&_button]:min-h-11"
        >
          <div className="min-w-0 flex-1">
            <h2 id="worker-account-heading" className="font-semibold">
              我的
            </h2>
            <p className="worker-wrap-anywhere text-muted-foreground">
              {user.displayName}（{roleLabel(user.role)}）
            </p>
          </div>
          <LogoutButton />
        </section>
      </footer>
    </div>
  );
}
