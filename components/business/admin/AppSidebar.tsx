'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { Button } from '@/components/ui/button';
import {
  getActiveAdminMenuHref,
  type AdminMenuGroup,
  type AdminMenuItem,
  type IconName,
} from '@/lib/navigation/admin-menu';
import {
  IntentPrefetchScheduler,
  type IntentPrefetchTarget,
} from '@/lib/navigation/intent-prefetch';

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

const SIDEBAR_COLLAPSE_KEY = 'print-shop-erp:admin-sidebar-collapsed';
const EMPTY_COLLAPSE: Record<string, boolean> = {};
const sidebarCollapseListeners = new Set<() => void>();
let cachedCollapseRaw = '';
let cachedCollapseValue: Record<string, boolean> = EMPTY_COLLAPSE;

function parseCollapse(raw: string): Record<string, boolean> {
  if (!raw) return EMPTY_COLLAPSE;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, boolean>)
      : EMPTY_COLLAPSE;
  } catch {
    return EMPTY_COLLAPSE;
  }
}

function writeSidebarCollapse(next: Record<string, boolean>) {
  const raw = JSON.stringify(next);
  window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, raw);
  cachedCollapseRaw = raw;
  cachedCollapseValue = next;
  sidebarCollapseListeners.forEach((listener) => listener());
}

function subscribeSidebarCollapse(listener: () => void) {
  sidebarCollapseListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    sidebarCollapseListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function getSidebarCollapseSnapshot() {
  const raw = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) ?? '';
  if (raw === cachedCollapseRaw) return cachedCollapseValue;
  cachedCollapseRaw = raw;
  cachedCollapseValue = parseCollapse(raw);
  return cachedCollapseValue;
}

function getSidebarCollapseServerSnapshot(): Record<string, boolean> {
  return EMPTY_COLLAPSE;
}
const PINNED_HREFS = new Set([
  '/owner',
  '/orders',
  '/orders/new',
  '/foreman/scheduling',
]);

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
  const [intent, setIntent] = useState<IntentPrefetchTarget | null>(null);
  const collapsedGroups = useSyncExternalStore(
    subscribeSidebarCollapse,
    getSidebarCollapseSnapshot,
    getSidebarCollapseServerSnapshot,
  );
  const intentSchedulerRef = useRef<IntentPrefetchScheduler | null>(null);
  if (intentSchedulerRef.current === null) {
    intentSchedulerRef.current = new IntentPrefetchScheduler(setIntent);
  }
  // 最长路径匹配只返回一个 href，避免父子入口同时高亮。
  const allItems = menuGroups.flatMap((group) => group.items);
  const activeHref = getActiveAdminMenuHref(pathname, allItems);
  const intentHref = intent?.pathname === pathname ? intent.href : null;

  function cancelIntentPrefetch(href?: string) {
    intentSchedulerRef.current?.cancel();
    setIntent((current) =>
      !href || current?.href === href ? null : current,
    );
  }

  function scheduleIntentPrefetch(href: string) {
    if (href === activeHref || intentHref === href) return;

    cancelIntentPrefetch();
    intentSchedulerRef.current?.schedule({ href, pathname });
  }

  useEffect(() => {
    return () => intentSchedulerRef.current?.dispose();
  }, [pathname]);

  function toggleGroup(label: string) {
    const next = { ...collapsedGroups, [label]: !collapsedGroups[label] };
    writeSidebarCollapse(next);
  }

  const pinnedItems = allItems.filter((item) => PINNED_HREFS.has(item.href));
  const grouped = menuGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !PINNED_HREFS.has(item.href)),
  }));

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
        {pinnedItems.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>常用</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {pinnedItems.map((item) => (
                  <SidebarItem
                    key={`pinned-${item.label}-${item.href}`}
                    item={item}
                    activeHref={activeHref}
                    intentHref={intentHref}
                    onEnter={scheduleIntentPrefetch}
                    onLeave={cancelIntentPrefetch}
                    onNavigate={() => {
                      cancelIntentPrefetch(item.href);
                      setOpenMobile(false);
                    }}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        {grouped.map((group, idx) => {
          const label = group.label ?? `group-${idx}`;
          const collapsed = Boolean(group.label && collapsedGroups[group.label]);
          const containsActive = group.items.some((item) => item.href === activeHref);
          const hideItems = collapsed && !containsActive;
          return (
          <SidebarGroup key={label}>
            {group.label ? (
              <SidebarGroupLabel>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-between px-0 text-left font-medium"
                  aria-expanded={!hideItems}
                  onClick={() => toggleGroup(group.label!)}
                >
                  <span>{group.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {hideItems ? '展开' : '收起'}
                  </span>
                </Button>
              </SidebarGroupLabel>
            ) : null}
            {hideItems ? null : (
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarItem
                      key={item.label + item.href}
                      item={item}
                      activeHref={activeHref}
                      intentHref={intentHref}
                      onEnter={scheduleIntentPrefetch}
                      onLeave={cancelIntentPrefetch}
                      onNavigate={() => {
                        cancelIntentPrefetch(item.href);
                        setOpenMobile(false);
                      }}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}

function SidebarItem({
  item,
  activeHref,
  intentHref,
  onEnter,
  onLeave,
  onNavigate,
}: {
  item: AdminMenuItem;
  activeHref: string | null;
  intentHref: string | null;
  onEnter: (href: string) => void;
  onLeave: (href?: string) => void;
  onNavigate: () => void;
}) {
  const Icon = ICONS[item.iconName];
  const active = item.href === activeHref;
  if (item.href === '#') {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={false}
          className="cursor-not-allowed text-muted-foreground"
          tooltip={`${item.label}（未上线）`}
          disabled
        >
          <Icon />
          <span>{item.label}</span>
          <span className="ml-auto text-[10px] group-data-[collapsible=icon]:hidden">
            未上线
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={item.label}
        render={
          <Link
            href={item.href}
            prefetch={intentHref === item.href ? true : false}
            onMouseEnter={() => onEnter(item.href)}
            onMouseLeave={() => onLeave(item.href)}
            onClick={onNavigate}
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
