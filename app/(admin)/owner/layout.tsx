import { redirect } from 'next/navigation';
import { Role } from '../../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';

// Defense-in-depth role gate: parent (admin) layout already requires
// a back-office role; this nested layout narrows to ADMIN for /owner/*.
// Server Actions re-check via `requirePermission` (CLAUDE.md §4.6);
// this just keeps non-admin users from seeing administrator pages before the
// action layer rejects them.
//
// Chrome (sidebar / breadcrumb / header bar) lives in the parent
// (admin) layout — don't duplicate it here.
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.user.role !== Role.ADMIN) redirect('/');

  return <>{children}</>;
}
