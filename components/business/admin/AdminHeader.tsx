import { LogoutButton } from '@/components/business/auth/LogoutButton';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { AdminBreadcrumb } from './AdminBreadcrumb';
import { UserMenu } from './UserMenu';
import { ThemeToggle } from './ThemeToggle';

// 顶栏只承载当前位置与全局操作；页面入口统一在侧边栏，避免重复导航。
// 保持不透明与原有高度，滚动后文字对比度和页内 sticky 偏移不变。

export type AdminHeaderProps = {
  displayName: string;
  roleLabel: string;
  environmentLabel: string;
};

export function AdminHeader({
  displayName,
  roleLabel,
  environmentLabel,
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
      className="admin-safe-inline admin-safe-top sticky top-0 z-10 flex min-h-14 min-w-0 items-center gap-2 border-b bg-card py-1 sm:gap-3"
    >
      <SidebarTrigger className="size-11 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <AdminBreadcrumb />
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
