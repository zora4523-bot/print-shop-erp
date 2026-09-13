'use client';

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link, { useLinkStatus } from 'next/link';
import { COMPANY_NAME } from '@/lib/app-brand';
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
  '/workbench',
  '/orders',
  '/orders/new',
]);
// 所有可点击菜单统一 14px / 20px 与 44px 行高；层级由缩进和字重表达。
const MENU_ROW_CLASS = 'h-11 text-sm leading-5';

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

  // 少量、没有子菜单的角色入口直接平铺；不让唯一的账单入口再套一层财务。
  // 管理员的多项分组与规则子菜单仍保留，权限继续由 menuGroups 决定。
  const compactMenu =
    allItems.length <= 5 && allItems.every((item) => !item.children?.length);
  const pinnedItems = allItems.filter(
    (item) => compactMenu || PINNED_HREFS.has(item.href),
  );
  const grouped = menuGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !compactMenu && !PINNED_HREFS.has(item.href),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex flex-col gap-1 px-2 py-2 group-data-[collapsible=icon]:hidden">
          <span className="text-sm font-semibold leading-tight tracking-normal">
            {COMPANY_NAME}
          </span>
          <span className="text-xs text-sidebar-foreground/70">
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
          有。aria-label 用于区分主导航与顶栏面包屑。 */}
      <SidebarContent aria-label="后台主导航" role="navigation">
        {pinnedItems.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>{compactMenu ? '工作台' : '常用'}</SidebarGroupLabel>
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
          // 单个父级入口直接承担分组导航与折叠，不再重复渲染分组标题。
          const singleParent = Boolean(
            group.label &&
              group.items.length === 1 &&
              group.items[0].href !== '#' &&
              group.items[0].children?.length,
          );
          const containsActive = group.items.some((item) =>
            menuItemContainsHref(item, activeHref),
          );
          const hideItems = collapsed && !singleParent;
          const contentId = `admin-menu-group-${idx}`;
          return (
            <SidebarGroup
              key={label}
              data-menu-level="group"
              data-menu-group={group.label}
              data-has-active-item={containsActive ? 'true' : undefined}
              className="py-1.5 group-data-[collapsible=icon]:border-t group-data-[collapsible=icon]:border-sidebar-border/70 group-data-[collapsible=icon]:py-2"
            >
              {group.label && !singleParent ? (
                <SidebarGroupLabel className="h-11 px-0 group-data-[collapsible=icon]:hidden">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      MENU_ROW_CLASS,
                      'w-full justify-between rounded-md px-2 text-left font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
                      containsActive &&
                        'bg-sidebar-accent/60 text-sidebar-accent-foreground',
                    )}
                    aria-expanded={!hideItems}
                    aria-controls={contentId}
                    onClick={() => toggleGroup(group.label!)}
                  >
                    <span className="truncate">{group.label}</span>
                    <ChevronRight
                      aria-hidden="true"
                      className={cn(
                        'size-4 shrink-0 transition-transform duration-200',
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
                        disclosure={singleParent ? {
                          collapsed,
                          contentId: `${contentId}-submenu`,
                          onToggle: () => toggleGroup(label),
                        } : undefined}
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
  disclosure,
}: {
  item: AdminMenuItem;
  activeHref: string | null;
  intentHref: string | null;
  onEnter: (href: string) => void;
  onLeave: (href?: string) => void;
  onNavigate: (href: string) => void;
  disclosure?: {
    collapsed: boolean;
    contentId: string;
    onToggle: () => void;
  };
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
          className={cn(MENU_ROW_CLASS, 'cursor-not-allowed font-normal text-muted-foreground')}
          tooltip={`${item.label}（未上线）`}
          disabled
        >
          <Icon />
          <span>{item.label}</span>
          <span className="ml-auto text-xs leading-4 group-data-[collapsible=icon]:hidden">
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
      <div className="flex items-center">
        <SidebarMenuButton
          isActive={active}
          tooltip={item.label}
          data-has-active-child={hasActiveChild ? 'true' : undefined}
          render={
            <Link
              href={item.href}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              prefetch={intentHref === item.href ? true : false}
              onMouseEnter={() => onEnter(item.href)}
              onMouseLeave={() => onLeave(item.href)}
              onClick={() => onNavigate(item.href)}
            />
          }
          className={cn(
            MENU_ROW_CLASS,
            hasChildren ? 'font-medium' : 'font-normal',
            disclosure && 'min-w-0 flex-1',
            hasActiveChild &&
              'text-sidebar-accent-foreground group-data-[collapsible=icon]:bg-sidebar-accent',
            active &&
              'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
          )}
        >
          <Icon />
          <span>{item.label}</span>
          <SidebarLinkPendingIndicator />
        </SidebarMenuButton>
        {disclosure ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
            aria-label={`${disclosure.collapsed ? '展开' : '收起'}${item.label}子菜单`}
            aria-expanded={!disclosure.collapsed}
            aria-controls={disclosure.contentId}
            onClick={disclosure.onToggle}
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                'size-4 transition-transform duration-200 motion-reduce:transition-none',
                !disclosure.collapsed && 'rotate-90',
              )}
            />
          </Button>
        ) : null}
      </div>
      {item.children?.length && !disclosure?.collapsed ? (
        <SidebarMenuSub
          id={disclosure?.contentId}
          aria-label={`${item.label}子菜单`}
          data-menu-level="children"
        >
          {groupSidebarChildren(item.children).map((group, groupIndex) => {
            return (
              <Fragment key={group.label ?? `ungrouped-${groupIndex}`}>
                {group.items.map((child, childIndex) => (
                  <SidebarSubItem
                    key={`${child.label}-${child.href}`}
                    item={child}
                    activeHref={activeHref}
                    intentHref={intentHref}
                    onEnter={onEnter}
                    onLeave={onLeave}
                    onNavigate={onNavigate}
                    subgroupLabel={group.label}
                    startsSubgroup={groupIndex > 0 && childIndex === 0}
                  />
                ))}
              </Fragment>
            );
          })}
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
  subgroupLabel,
  startsSubgroup,
}: {
  item: AdminMenuItem;
  activeHref: string | null;
  intentHref: string | null;
  onEnter: (href: string) => void;
  onLeave: (href?: string) => void;
  onNavigate: (href: string) => void;
  subgroupLabel: string | null;
  startsSubgroup: boolean;
}) {
  const active = item.href === activeHref;

  return (
    <SidebarMenuSubItem data-menu-level="child">
      <SidebarMenuSubButton
        isActive={active}
        data-menu-subgroup={subgroupLabel ?? undefined}
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
          MENU_ROW_CLASS,
          'font-normal text-sidebar-foreground/75',
          startsSubgroup &&
            'mt-1 border-t border-sidebar-border/70',
          active &&
            'font-medium text-sidebar-accent-foreground before:absolute before:-left-[11px] before:h-4 before:w-0.5 before:rounded-full before:bg-sidebar-primary',
        )}
      >
        <span>{item.label}</span>
        <SidebarLinkPendingIndicator />
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function groupSidebarChildren(
  children: readonly AdminMenuItem[],
): { label: string | null; items: AdminMenuItem[] }[] {
  const groups: { label: string | null; items: AdminMenuItem[] }[] = [];

  for (const child of children) {
    const label = child.menuGroupLabel ?? null;
    const current = groups.at(-1);
    if (current?.label === label) {
      current.items.push(child);
    } else {
      groups.push({ label, items: [child] });
    }
  }

  return groups;
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
