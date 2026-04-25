import { redirect } from 'next/navigation';
import { Role } from '../../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';

// SALES + CUSTOMER_SERVICE only. Parent (admin) layout already
// gated to admin roles; this narrows further. OWNER hitting
// /sales/bills/<id> bounces to / (not /owner/bills, see Codex
// round 62 — App Router layout can't get pathname, so a one-shot
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
  if (user.role !== Role.SALES && user.role !== Role.CUSTOMER_SERVICE) {
    redirect('/');
  }

  return <>{children}</>;
}
