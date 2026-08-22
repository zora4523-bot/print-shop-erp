'use client';

import { useState } from 'react';
import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  BookOpen,
  Boxes,
  Calculator,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Clock,
  Database,
  FileArchive,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  PackageOpen,
  PlusCircle,
  Settings,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  getActiveAdminMenuHref,
  type AdminMenuGroup,
  type IconName,
} from '@/lib/navigation/admin-menu';

// IconName → Lucide 组件映射。新增 IconName 时同时改这里。
// 以静态 map 而非动态 require 实现：保留 tree-shaking + 编译期检查。
const ICONS: Record<IconName, LucideIcon> = {
  LayoutDashboard,
  ClipboardList,
  PlusCircle,
  Wallet,
  CalendarDays,
  Calculator,
  BookOpen,
  Users,
  CalendarClock,
  PackageOpen,
  Boxes,
  Clock,
  FileText,
  TrendingUp,
  Sparkles,
  Bell,
  FileArchive,
  Database,
  Settings,
};

type AppSidebarProps = {
  menuGroups: AdminMenuGroup[];
  roleBadge: string;
};

export function AppSidebar({ menuGroups, roleBadge }: AppSidebarProps) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  // The sidebar can contain dozens of dynamic routes. Letting every visible
  // Link auto-prefetch floods the server with authenticated RSC requests.
  // Enable prefetch only for the latest link that shows real user intent.
  const [intentHref, setIntentHref] = useState<string | null>(null);
  // 最长路径匹配只返回一个 href，避免父子入口同时高亮。
  const allItems = menuGroups.flatMap((group) => group.items);
  const activeHref = getActiveAdminMenuHref(pathname, allItems);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex flex-col gap-1 px-2 py-2">
          <span className="text-sm font-semibold leading-tight tracking-normal">
            红包印刷 ERP
          </span>
          <span className="w-fit rounded-md bg-sidebar-accent px-1.5 py-0.5 text-xs text-sidebar-accent-foreground">
            {roleBadge}
          </span>
        </div>
      </SidebarHeader>
      {/* nav 地标：侧边栏是后台的主导航，但 SidebarContent 渲染的是
          裸 div，整个 (admin) 外壳因此没有 navigation 地标——而师傅端
          有。aria-label 是必要的：同页还有面包屑和快捷入口两个 nav。 */}
      <SidebarContent aria-label="后台主导航" role="navigation">
        {menuGroups.map((group, idx) => (
          <SidebarGroup key={group.label ?? `group-${idx}`}>
            {group.label ? (
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = ICONS[item.iconName];
                  const active = item.href === activeHref;
                  // 占位 # 的项保留按钮形态但不跳转（disabled 视觉）。
                  if (item.href === '#') {
                    return (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          isActive={false}
                          className="cursor-not-allowed opacity-50"
                          tooltip={item.label + '（待实现）'}
                          disabled
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }
                  return (
                    <SidebarMenuItem key={item.label + item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        render={
                          <Link
                            href={item.href}
                            prefetch={intentHref === item.href ? null : false}
                            onMouseEnter={() => setIntentHref(item.href)}
                            onFocus={() => setIntentHref(item.href)}
                            onTouchStart={() => setIntentHref(item.href)}
                            onClick={() => setOpenMobile(false)}
                          />
                        }
                        className={
                          active
                            ? 'border-l-2 border-primary bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                            : undefined
                        }
                      >
                        <Icon />
                        <span>{item.label}</span>
                        <SidebarLinkPendingIndicator />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}

function SidebarLinkPendingIndicator() {
  const { pending } = useLinkStatus();

  return (
    <LoaderCircle
      aria-hidden="true"
      data-pending={pending ? 'true' : 'false'}
      className={`ml-auto size-3.5 shrink-0 transition-opacity duration-150 group-data-[collapsible=icon]:hidden motion-reduce:animate-none ${
        pending
          ? 'visible animate-spin opacity-70 delay-100'
          : 'invisible opacity-0 delay-0'
      }`}
    />
  );
}
