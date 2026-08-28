'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link, { useLinkStatus } from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Bell,
  BookOpen,
  Boxes,
  Calculator,
  CalendarClock,
  CalendarDays,
  ChevronRight,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import {
  flattenAdminMenuItems,
  getActiveAdminMenuHref,
  type AdminMenuGroup,
  type AdminMenuItem,
  type IconName,
} from '@/lib/navigation/admin-menu';
import {
  IntentPrefetchScheduler,
  type IntentPrefetchTarget,
} from '@/lib/navigation/intent-prefetch';
import { cn } from '@/lib/utils';

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
  const searchParams = useSearchParams();
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
  const allItems = flattenAdminMenuItems(
    menuGroups.flatMap((group) => group.items),
  );
  const activeHref = getActiveAdminMenuHref(pathname, allItems, searchParams);
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
  const grouped = menuGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !PINNED_HREFS.has(item.href)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex flex-col gap-1 px-2 py-2 group-data-[collapsible=icon]:hidden">
          <span className="text-sm font-semibold leading-tight tracking-normal">
            红包印刷 ERP
          </span>
          <span className="w-fit rounded-md bg-sidebar-accent px-1.5 py-0.5 text-xs text-sidebar-accent-foreground">
            {roleBadge}
          </span>
        </div>
        <div
          aria-hidden="true"
          className="hidden size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sm font-bold text-sidebar-accent-foreground group-data-[collapsible=icon]:flex"
        >
          印
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
                    onNavigate={(href) => {
                      cancelIntentPrefetch(href);
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
          const containsActive = group.items.some((item) =>
            menuItemContainsHref(item, activeHref),
          );
          const hideItems = collapsed;
          const contentId = `admin-menu-group-${idx}`;
          return (
          <SidebarGroup
            key={label}
            data-menu-level="group"
            data-menu-group={group.label}
            data-has-active-item={containsActive ? 'true' : undefined}
            className="py-1.5 group-data-[collapsible=icon]:border-t group-data-[collapsible=icon]:border-sidebar-border/70 group-data-[collapsible=icon]:py-2"
          >
            {group.label ? (
              <SidebarGroupLabel className="h-10 px-1 group-data-[collapsible=icon]:hidden md:h-9">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-10 w-full justify-between rounded-lg px-2 text-left text-xs font-semibold text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground md:h-9',
                    containsActive &&
                      'bg-sidebar-accent/60 text-sidebar-accent-foreground',
                  )}
                  aria-expanded={!hideItems}
                  aria-controls={contentId}
                  onClick={() => toggleGroup(group.label!)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-2 shrink-0 rounded-full border border-sidebar-border bg-sidebar',
                        containsActive && 'border-sidebar-primary bg-sidebar-primary',
                      )}
                    />
                    <span className="truncate">{group.label}</span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      'size-3.5 shrink-0 transition-transform duration-200',
                      !hideItems && 'rotate-90',
                    )}
                  />
                  <span className="sr-only">
                    {hideItems ? '展开' : '收起'}
                  </span>
                </Button>
              </SidebarGroupLabel>
            ) : null}
            {hideItems ? null : (
              <SidebarGroupContent
                id={contentId}
                data-menu-level="group-children"
                className="pl-2 group-data-[collapsible=icon]:pl-0"
              >
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => (
                    <SidebarItem
                      key={item.label + item.href}
                      item={item}
                      activeHref={activeHref}
                      intentHref={intentHref}
                      onEnter={scheduleIntentPrefetch}
                      onLeave={cancelIntentPrefetch}
                      onNavigate={(href) => {
                        cancelIntentPrefetch(href);
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
  onNavigate: (href: string) => void;
}) {
  const Icon = ICONS[item.iconName];
  const active = item.href === activeHref;
  const hasChildren = Boolean(item.children?.length);
  const hasActiveChild = Boolean(
    item.children?.some((child) => menuItemContainsHref(child, activeHref)),
  );
  if (item.href === '#') {
    return (
      <SidebarMenuItem data-menu-level={hasChildren ? 'parent' : 'item'}>
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
    <SidebarMenuItem
      data-menu-level={hasChildren ? 'parent' : 'item'}
      data-has-active-child={hasActiveChild ? 'true' : undefined}
    >
      <SidebarMenuButton
        isActive={active}
        tooltip={item.label}
        data-has-active-child={hasActiveChild ? 'true' : undefined}
        render={
          <Link
            href={item.href}
            aria-current={active ? 'page' : undefined}
            prefetch={intentHref === item.href ? true : false}
            onMouseEnter={() => onEnter(item.href)}
            onMouseLeave={() => onLeave(item.href)}
            onClick={() => onNavigate(item.href)}
          />
        }
        className={cn(
          hasChildren && 'h-10 font-semibold',
          hasActiveChild &&
            'text-sidebar-accent-foreground group-data-[collapsible=icon]:bg-sidebar-accent',
          active &&
            'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-sm ring-1 ring-sidebar-border',
        )}
      >
        <Icon />
        <span>{item.label}</span>
        <SidebarLinkPendingIndicator />
      </SidebarMenuButton>
      {item.children?.length ? (
        <SidebarMenuSub
          aria-label={`${item.label}子菜单`}
          data-menu-level="children"
        >
          {item.children.map((child) => (
            <SidebarSubItem
              key={`${child.label}-${child.href}`}
              item={child}
              activeHref={activeHref}
              intentHref={intentHref}
              onEnter={onEnter}
              onLeave={onLeave}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

function SidebarSubItem({
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
  onNavigate: (href: string) => void;
}) {
  const active = item.href === activeHref;

  return (
    <SidebarMenuSubItem data-menu-level="child">
      <SidebarMenuSubButton
        isActive={active}
        render={
          <Link
            href={item.href}
            aria-current={active ? 'page' : undefined}
            prefetch={intentHref === item.href ? true : false}
            onMouseEnter={() => onEnter(item.href)}
            onMouseLeave={() => onLeave(item.href)}
            onClick={() => onNavigate(item.href)}
          />
        }
        className={cn(
          'h-10 text-sidebar-foreground/75 md:h-8',
          active &&
            'font-semibold text-sidebar-accent-foreground shadow-sm before:absolute before:-left-[11px] before:h-4 before:w-0.5 before:rounded-full before:bg-sidebar-primary',
        )}
      >
        <span>{item.label}</span>
        <SidebarLinkPendingIndicator />
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function menuItemContainsHref(
  item: AdminMenuItem,
  href: string | null,
): boolean {
  if (!href) return false;
  if (item.href === href) return true;
  return Boolean(
    item.children?.some((child) => menuItemContainsHref(child, href)),
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
