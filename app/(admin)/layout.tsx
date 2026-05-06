import { redirect } from 'next/navigation';
import { Role } from '../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/business/admin/AppSidebar';
import { AdminHeader } from '@/components/business/admin/AdminHeader';
import {
  getAdminMenuItems,
  ADMIN_ROLE_BADGE,
} from '@/lib/navigation/admin-menu';

// (admin) route group shell — owner / foreman / sales / customer-
// service all live underneath. Worker has its own (worker) shell
// because the H5 task UI doesn't share the sidebar/breadcrumb chrome.
//
// Defense-in-depth posture: this layout gates the UI shell. Per-role
// inner layouts (app/(admin)/owner/layout.tsx etc) keep their own
// fine-grained role check (OWNER-only / FOREMAN+OWNER / SALES+CS).
// Server Actions still call requirePermission() on every entry point
// (CLAUDE.md §4.6). UI gating just keeps unauthorized roles from
// seeing the wrong nav before the action layer rejects them.
export default async function AdminShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { user } = session;
  // WORKER goes to /(worker), not here. Anything else means a bad
  // session or a future role we haven't planned for — bounce home.
  const ALLOWED: readonly Role[] = [
    Role.OWNER,
    Role.FOREMAN,
    Role.SALES,
    Role.CUSTOMER_SERVICE,
  ];
  if (!ALLOWED.includes(user.role)) redirect('/');

  const menuGroups = getAdminMenuItems(user);
  const roleBadge = ADMIN_ROLE_BADGE[user.role] ?? user.role;

  return (
    <SidebarProvider>
      <AppSidebar menuGroups={menuGroups} roleBadge={roleBadge} />
      <SidebarInset>
        <AdminHeader displayName={user.displayName} roleLabel={roleBadge} />
        <main className="flex-1 px-6 py-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
