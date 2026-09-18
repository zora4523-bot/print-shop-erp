import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Role } from '../../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';
import { WorkerBottomNavigation } from '@/components/business/production/WorkerBottomNavigation';

// H5 shell for 师傅端. WORKER only — ADMIN has its own
// overrides in the action layer but view the worker tasks through the
// foreman side. Keep a readable 768px content width on larger displays.
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
    <div className="worker-viewport worker-bottom-nav-space bg-muted/40">
      <header className="border-b bg-background">
        <div className="worker-safe-inline worker-safe-top mx-auto flex max-w-3xl items-center justify-between gap-3 pb-3">
          <Link
            href="/worker/tasks"
            className="inline-flex min-h-11 shrink-0 items-center text-base font-semibold"
          >
            师傅工作台
          </Link>
          <Link href="/worker/account" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm">我的账号</Link>
        </div>
      </header>
      <main className="worker-safe-inline mx-auto w-full max-w-3xl py-5">
        {children}
      </main>
      <WorkerBottomNavigation />
    </div>
  );
}
