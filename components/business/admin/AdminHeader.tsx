import { LogoutButton } from '@/components/business/auth/LogoutButton';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { AdminBreadcrumb } from './AdminBreadcrumb';
import { UserMenu } from './UserMenu';
import { ThemeToggle } from './ThemeToggle';
import type { Role } from '@/generated/prisma/enums';

// 顶栏只承载当前位置与全局操作；页面入口统一在侧边栏，避免重复导航。
// 保持不透明与原有高度，滚动后文字对比度和页内 sticky 位置不变。

export type AdminHeaderProps = {
  displayName: string;
  roleLabel: string;
  environmentLabel: string;
  /** 面包屑按角色取同一路径的模块名（/orders：工单列表 / 我的工单）。 */
  role?: Role;
};

export function AdminHeader({
  displayName,
  roleLabel,
  environmentLabel,
  role,
}: AdminHeaderProps) {
  const environment = environmentLabel.trim().toLowerCase();
  const environmentText =
    environment === 'production' || environment === 'prod'
      ? null
      : environment === 'development' || environment === 'dev'
        ? '开发环境'
        : environment === 'test'
          ? '测试环境'
          : '预览环境';

  return (
    <header
      data-slot="admin-header"
      className="admin-safe-inline admin-safe-top sticky top-0 z-20 flex min-h-14 min-w-0 items-center gap-2 border-b bg-card py-1 sm:gap-3 [&>button]:min-h-[44px] [&>button]:min-w-[44px]"
    >
      {/* 图标操作保持 44px 点击区域，避免文字放大时挤出窄屏。 */}
      <SidebarTrigger className="size-[44px] min-h-[44px] min-w-[44px] shrink-0" />
      <div className="min-w-0 flex-1">
        <AdminBreadcrumb role={role} />
      </div>
      {environmentText ? (
        <span
          data-slot="admin-environment"
          className="hidden shrink-0 text-xs text-muted-foreground sm:inline"
        >
          {environmentText}
        </span>
      ) : null}
      <ThemeToggle />
      <UserMenu displayName={displayName} roleLabel={roleLabel} />
      <noscript><LogoutButton /></noscript>
    </header>
  );
}
