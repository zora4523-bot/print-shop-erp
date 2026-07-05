import Link from 'next/link';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { AdminBreadcrumb } from './AdminBreadcrumb';
import { UserMenu } from './UserMenu';
import type { AdminMenuItem } from '@/lib/navigation/admin-menu';

// Admin shell 顶栏——sidebar 触发器 + breadcrumb（移动端隐藏、占空间）+
// 右侧 UserMenu。Server Component，从 (admin)/layout.tsx 接收 user 数据。
//
// 之前 (admin)/layout.tsx 是 inline 写的 header（55-69 行）；抽出来便于：
//   - 后续加 NotificationBell / 全局搜索 / 帮助按钮等模块化扩展
//   - 主题/品牌色 token 化后只改这里一处
//
// 设计：sticky top-0，背景 card 而不是 background，与 sidebar 形成层次感。

export type AdminHeaderProps = {
  displayName: string;
  roleLabel: string;
  environmentLabel: string;
  quickLinks: AdminMenuItem[];
};

export function AdminHeader({
  displayName,
  roleLabel,
  environmentLabel,
  quickLinks,
}: AdminHeaderProps) {
  return (
    <header
      data-slot="admin-header"
      className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <SidebarTrigger />
      <div className="min-w-0 flex-1">
        <AdminBreadcrumb />
      </div>
      <nav
        aria-label="快捷导航"
        className="hidden items-center gap-1 xl:flex"
      >
        {quickLinks.slice(0, 4).map((item) => (
          <Link
            key={`${item.label}-${item.href}`}
            href={item.href}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <Badge
        variant="outline"
        className="hidden rounded-md font-mono uppercase text-muted-foreground sm:inline-flex"
      >
        {environmentLabel}
      </Badge>
      <UserMenu displayName={displayName} roleLabel={roleLabel} />
    </header>
  );
}
