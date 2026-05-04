'use client';

import Link from 'next/link';
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
  FileText,
  LayoutDashboard,
  PackageOpen,
  PlusCircle,
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
} from '@/components/ui/sidebar';
import type {
  AdminMenuGroup,
  IconName,
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
};

type AppSidebarProps = {
  menuGroups: AdminMenuGroup[];
  roleBadge: string;
};

// Active state must be UNIQUE per sidebar render — otherwise a child
// route highlights both the child item and any ancestor (e.g.
// /orders/new lights up both "创建工单" and "我的工单"). The fix is
// "longest matching href wins": collect every candidate href that
// could be active for the current pathname, pick the longest, then
// only the item whose href equals that gets `active=true`.
// Codex round 78 / P2.
function pickActiveHref(
  pathname: string,
  candidates: readonly string[],
): string | null {
  let best: string | null = null;
  for (const href of candidates) {
    if (href === '#' || href === '/') continue; // root/placeholder never wins
    const matches = pathname === href || pathname.startsWith(href + '/');
    if (!matches) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}

export function AppSidebar({ menuGroups, roleBadge }: AppSidebarProps) {
  const pathname = usePathname();
  // Flatten all hrefs once per render; pick the single best match.
  const allHrefs = menuGroups.flatMap((g) => g.items.map((i) => i.href));
  const activeHref = pickActiveHref(pathname, allHrefs);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex flex-col gap-0.5 px-2 py-1.5">
          <span className="text-sm font-semibold leading-tight">
            红包印刷 ERP
          </span>
          <span className="text-xs text-muted-foreground">{roleBadge}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
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
                        render={<Link href={item.href} />}
                      >
                        <Icon />
                        <span>{item.label}</span>
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
