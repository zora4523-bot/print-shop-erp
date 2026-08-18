import { redirect } from 'next/navigation';
import { Role } from '../../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';

// External SALES only. Parent (admin) layout already gates the shell;
// this keeps internal CUSTOMER_SERVICE accounts out of external-sales
// receivables. ADMIN hitting
// /sales/bills/<id> bounces to / (not /owner/bills — App Router
// layout can't get pathname, so a one-shot
// redirect to a list view would lose the deep-link id).
//
// Chrome lives in (admin)/layout.tsx; nothing else here.
export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { user } = session;
  if (user.role !== Role.SALES) redirect('/');

  return <>{children}</>;
}
