import { redirect } from 'next/navigation';
import { Role } from '../../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';

// FOREMAN + OWNER only. Parent (admin) layout already gated to
// admin roles; this narrows for /foreman/*. Server Actions on
// every entry point still re-check their own permission
// (CLAUDE.md §4.6).
//
// Chrome (sidebar / breadcrumb / header bar) lives in
// (admin)/layout.tsx — don't duplicate it here.
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

  return <>{children}</>;
}
