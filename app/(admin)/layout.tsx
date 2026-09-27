import { AuthenticatedDraftCleanup } from '@/components/business/form-drafts/FormDraftControls';
import { hasPermission } from '@/lib/auth/permissions-dict';
import type { FormKind } from '@/lib/form-drafts/model';
import { redirect } from 'next/navigation';
import { Role } from '../../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/business/admin/AppSidebar';
import { AdminHeader } from '@/components/business/admin/AdminHeader';
import { BreadcrumbEntityProvider } from '@/components/business/admin/breadcrumb-entity';
import {
  getAdminMenuItems,
  ADMIN_ROLE_BADGE,
} from '@/lib/navigation/admin-menu';

// (admin) route group shell — administrator / sales / customer-
// service all live underneath. Worker has its own (worker) shell
// because the H5 task UI doesn't share the sidebar/breadcrumb chrome.
//
// Defense-in-depth posture: this layout gates the UI shell. Per-role
// inner layouts (app/(admin)/owner/layout.tsx etc) keep their own
// fine-grained role check (ADMIN-only / SALES+CS).
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
  const ALLOWED: readonly Role[] = [Role.ADMIN, Role.SALES];
  if (!ALLOWED.includes(user.role)) redirect('/');

  const menuGroups = getAdminMenuItems(user);
  const roleBadge = ADMIN_ROLE_BADGE[user.role] ?? user.role;
  const environmentLabel =
    process.env.NEXT_PUBLIC_APP_ENV ??
    process.env.APP_ENV ??
    process.env.NODE_ENV ??
    'dev';

  const allowedDrafts: FormKind[] = [];
  if (hasPermission('purchase:manage', user.role)) allowedDrafts.push('purchase-new');
  if (hasPermission('bom:manage', user.role)) allowedDrafts.push('bom-new');

  return (
    <SidebarProvider className="admin-viewport">
      <AuthenticatedDraftCleanup actorId={user.id} allowed={allowedDrafts} />
      <a
        href="#admin-main"
        className="fixed left-3 top-3 z-50 inline-flex min-h-11 -translate-y-20 items-center rounded-md bg-background px-3 py-2 text-sm font-medium shadow-lg focus:translate-y-0"
      >
        跳到主要内容
      </a>
      <AppSidebar menuGroups={menuGroups} roleBadge={roleBadge} />
      <SidebarInset id="admin-main" tabIndex={-1} className="min-w-0">
        {/* Provider 只提供 context、不渲染 DOM 节点，SidebarInset 的
            flex 布局不受影响。header 消费、children 生产，两边必须在
            同一个 Provider 下。 */}
        <BreadcrumbEntityProvider>
          <AdminHeader
            displayName={user.displayName}
            roleLabel={roleBadge}
            environmentLabel={environmentLabel}
          />
          <div className="admin-safe-inline admin-safe-bottom min-w-0 flex-1 py-4 sm:py-6">
            {children}
          </div>
        </BreadcrumbEntityProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
