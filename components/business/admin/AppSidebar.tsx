'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link, { useLinkStatus } from 'next/link';
import { COMPANY_NAME } from '@/lib/app-brand';
import { usePathname, useSearchParams, type ReadonlyURLSearchParams } from 'next/navigation';
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
  flattenAdminMenuItems,
  getActiveAdminMenuHref,
  getAdminSidebarGroups,
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
const PINNED_HREFS = [
  '/owner',
  '/sales/overview',
  '/workbench',
  '/orders',
  '/owner/analytics',
] as const;
const LEGACY_GROUP_LABELS: Record<string, string> = {
  生产与采购: '业务',
  财务结算: '财务',
  基础资料: '字典',
  系统管理: '运维',
};

function savedGroupCollapse(preferences: Record<string, boolean>, label: string) {
  return preferences[label] ?? preferences[LEGACY_GROUP_LABELS[label]];
}
// 所有可点击菜单统一 14px / 20px 与 44px 行高；层级由缩进和字重表达。
const MENU_ROW_CLASS = 'h-11 text-sm leading-5';

type AppSidebarProps = {
  menuGroups: AdminMenuGroup[];
  roleBadge: string;
};

function isCurrentLocation(
  href: string,
  pathname: string,
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
): boolean {
  const target = new URL(href, 'http://local');
  return (
    target.pathname === pathname &&
    target.searchParams.toString() === new URLSearchParams(searchParams.toString()).toString()
  );
}

export function AppSidebar({ menuGroups, roleBadge }: AppSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setOpenMobile, isMobile, state } = useSidebar();
  // The sidebar can contain dozens of dynamic routes. Letting every visible
  // Link auto-prefetch floods the server with authenticated RSC requests.
  // Enable prefetch only for the latest link that shows real user intent.
  // Intent uses the default (null) mode, not `true`: for these dynamic routes it
  // prefetches only down to the nearest loading.tsx, so the click paints the
  // skeleton instantly and still fetches fresh data. `true` ran the whole page
  // (every query) on hover and served that snapshot for up to 5 minutes.
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
  const sidebarGroups = getAdminSidebarGroups(menuGroups);
  const allItems = flattenAdminMenuItems(
    sidebarGroups.flatMap((group) => group.items),
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

  // 手机端抽屉在地址真正变化后再关：点下去之后抽屉保持打开，被点项的加载
  // 指示（SidebarLinkPendingIndicator）一直可见，直到新页面接管。原来点击即
  // 关，抽屉连同唯一的 pending 指示一起消失，旧页面原样停到服务端返回。
  // 浏览器前进 / 后退同样会走到这里。
  const locationKey = `${pathname}?${searchParams.toString()}`;
  useEffect(() => {
    setOpenMobile(false);
  }, [locationKey, setOpenMobile]);

  function handleNavigate(href: string) {
    cancelIntentPrefetch(href);
    // 点当前页不会产生导航，也就等不到地址变化——立即收起。
    if (isCurrentLocation(href, pathname, searchParams)) setOpenMobile(false);
  }

  const compactMenu = allItems.length <= 5;
  const createItem = allItems.find((item) => item.href === '/orders/new');
  const pinnedItems = compactMenu
    ? allItems.filter((item) => item !== createItem)
    : PINNED_HREFS.flatMap((href) => allItems.filter((item) => item.href === href));
  const pinnedHrefs = new Set(pinnedItems.map((item) => item.href));
  const grouped = sidebarGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !compactMenu && item !== createItem && !pinnedHrefs.has(item.href),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const activeGroupLabel = grouped.find((group) =>
    group.collapsible && group.items.some((item) => item.href === activeHref),
  )?.label;

  // 进入分组里的页面时显露当前位置；用户仍可在当前页主动收起该组。
  // 仅在地址/所属组变化时恢复展开，不让偏好更新反过来撤销用户的收起操作。
  useEffect(() => {
    if (!activeGroupLabel) return;
    const preferences = getSidebarCollapseSnapshot();
    if (savedGroupCollapse(preferences, activeGroupLabel)) {
      writeSidebarCollapse({ ...preferences, [activeGroupLabel]: false });
    }
  }, [activeGroupLabel, locationKey]);

  const itemProps = {
    activeHref,
    intentHref,
    onEnter: scheduleIntentPrefetch,
    onLeave: cancelIntentPrefetch,
    onNavigate: handleNavigate,
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader role="complementary" aria-label="企业信息">
        <div className="flex flex-col gap-1 px-2 py-2 group-data-[collapsible=icon]:hidden">
          <span className="text-sm font-semibold leading-tight tracking-normal">
            {COMPANY_NAME}
          </span>
          <span className="text-xs text-sidebar-foreground/70">{roleBadge}</span>
        </div>
        <div
          aria-hidden="true"
          className="hidden size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sm font-bold group-data-[collapsible=icon]:flex"
        >
          印
        </div>
      </SidebarHeader>
      <nav aria-label="后台主导航" className="flex min-h-0 flex-1 flex-col">
        {createItem ? (
          <SidebarHeader className="pt-0">
            <SidebarMenu>
              <SidebarItem item={createItem} prominent {...itemProps} />
            </SidebarMenu>
          </SidebarHeader>
        ) : null}
        <SidebarContent>
          {pinnedItems.length > 0 ? (
            <SidebarGroup className="py-1.5">
              <SidebarGroupLabel>{compactMenu ? '工作台' : '常用'}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {pinnedItems.map((item) => (
                    <SidebarItem key={item.href} item={item} {...itemProps} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
          {grouped.map((group, idx) => {
            const label = group.label ?? `group-${idx}`;
            const containsActive = group.items.some((item) => item.href === activeHref);
            const collapsible = group.collapsible !== false;
            const collapsed = collapsible && (savedGroupCollapse(collapsedGroups, label) ?? !containsActive);
            // 图标模式没有分组箭头，仍展示全部模块入口以保持可达。
            const hideItems = collapsed && (isMobile || state !== 'collapsed');
            const contentId = `admin-menu-group-${idx}`;
            const GroupIcon = group.iconName ? ICONS[group.iconName] : undefined;
            const showLabel = group.label && (collapsible || group.label !== '规则');
            return (
              <SidebarGroup
                key={label}
                data-menu-level="group"
                data-menu-group={group.label}
                data-has-active-item={containsActive ? 'true' : undefined}
                className={cn(
                  'py-0 group-data-[collapsible=icon]:border-t group-data-[collapsible=icon]:border-sidebar-border/70 group-data-[collapsible=icon]:py-2',
                  group.label === '系统管理' && 'mt-auto border-t border-sidebar-border pt-2',
                )}
              >
                {showLabel ? (
                  collapsible ? (
                    <SidebarGroupLabel className="h-11 px-0 group-data-[collapsible=icon]:hidden">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          MENU_ROW_CLASS,
                          'w-full justify-start gap-2 rounded-md px-2 text-left font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                          containsActive && hideItems && 'text-primary',
                        )}
                        aria-expanded={!hideItems}
                        aria-controls={contentId}
                        onClick={() => {
                          // 按实际显示状态切换，同时兼容首次默认收起与旧分组偏好。
                          writeSidebarCollapse({ ...collapsedGroups, [label]: !collapsed });
                        }}
                      >
                        {GroupIcon ? <GroupIcon aria-hidden="true" className="size-4 shrink-0" /> : null}
                        <span className="min-w-0 flex-1 truncate">{group.label}</span>
                        <ChevronRight
                          aria-hidden="true"
                          className={cn('size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none', !hideItems && 'rotate-90')}
                        />
                        <span className="sr-only">{hideItems ? '展开' : '收起'}</span>
                      </Button>
                    </SidebarGroupLabel>
                  ) : (
                    <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">{group.label}</SidebarGroupLabel>
                  )
                ) : null}
                <SidebarGroupContent id={contentId} hidden={hideItems} data-menu-level="group-children">
                  <SidebarMenu className={cn('gap-0.5', collapsible && 'pl-6 group-data-[collapsible=icon]:pl-0')}>
                    {group.items.map((item) => (
                      <SidebarItem key={item.href} item={item} {...itemProps} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </SidebarContent>
      </nav>
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
  prominent = false,
}: {
  item: AdminMenuItem;
  activeHref: string | null;
  intentHref: string | null;
  onEnter: (href: string) => void;
  onLeave: (href?: string) => void;
  onNavigate: (href: string) => void;
  prominent?: boolean;
}) {
  const Icon = ICONS[item.iconName];
  const active = item.href === activeHref;
  if (item.href === '#') {
    return (
      <SidebarMenuItem data-menu-level="item">
        <SidebarMenuButton
          className={cn(MENU_ROW_CLASS, 'cursor-not-allowed font-normal text-muted-foreground')}
          tooltip={`${item.label}（未上线）`}
          disabled
        >
          <Icon />
          <span>{item.label}</span>
          <span className="ml-auto text-xs leading-4 group-data-[collapsible=icon]:hidden">未上线</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuItem data-menu-level={prominent ? 'action' : 'item'}>
      <SidebarMenuButton
        isActive={active}
        variant={prominent ? 'outline' : 'default'}
        tooltip={item.label}
        render={
          <Link
            href={item.href}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            prefetch={intentHref === item.href ? null : false}
            onMouseEnter={() => onEnter(item.href)}
            onMouseLeave={() => onLeave(item.href)}
            onClick={() => onNavigate(item.href)}
          />
        }
        className={cn(
          MENU_ROW_CLASS,
          'relative font-normal data-active:bg-primary/10 data-active:text-primary data-active:hover:bg-primary/15 data-active:hover:text-primary',
          prominent && 'font-medium',
          active && 'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary',
        )}
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
