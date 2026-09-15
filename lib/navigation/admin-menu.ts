import { Role } from '../../generated/prisma/enums';
import {
  PERMISSIONS,
  type Permission,
} from '../auth/permissions-dict';
import {
  getAdminModulesForRole,
  type AdminMenuSection,
  type AdminModuleStatus,
  type IconName,
} from './admin-modules';

export type { IconName } from './admin-modules';

export type AdminMenuItem = {
  label: string;
  href: string;
  menuGroupLabel?: string;
  activeRouteBase?: string;
  activeQuery?: readonly Readonly<Record<string, string | null>>[];
  iconName: IconName;
  breadcrumbLabel: string;
  status: AdminModuleStatus;
  requiredPermission?: Permission;
  roles?: readonly Role[];
  children?: AdminMenuItem[];
};

export type AdminMenuGroup = {
  label?: string;
  collapsible?: boolean;
  items: AdminMenuItem[];
};

const SECTION_LABELS: Record<AdminMenuSection, string> = {
  workflow: '业务',
  rules: '规则',
  finance: '财务',
  dictionary: '字典',
  operations: '运维',
  account: '账号',
};

function isVisible(
  item: { requiredPermission?: Permission; roles?: readonly Role[] },
  role: Role,
): boolean {
  if (item.requiredPermission) {
    // PERMISSIONS remains the authorization source of truth. The module
    // registry only declares menu metadata and role-specific placement.
    const allowed = PERMISSIONS[item.requiredPermission] as readonly Role[];
    return allowed.includes(role);
  }
  if (item.roles) {
    return item.roles.includes(role);
  }
  return false;
}

function toMenuItem(
  module: ReturnType<typeof getAdminModulesForRole>[number],
  childrenByParent: ReadonlyMap<
    string,
    ReturnType<typeof getAdminModulesForRole>
  >,
): AdminMenuItem {
  const children = (childrenByParent.get(module.id) ?? []).map((child) =>
    toMenuItem(child, childrenByParent),
  );

  return {
    label: module.label,
    href: module.routeBase,
    menuGroupLabel: module.menuGroupLabel,
    activeRouteBase: module.activeRouteBase,
    activeQuery: module.activeQuery,
    iconName: module.iconName,
    breadcrumbLabel: module.breadcrumbLabel,
    status: module.status,
    requiredPermission: module.requiredPermission,
    roles: module.roles,
    ...(children.length > 0 ? { children } : {}),
  };
}

function sectionLabel(section: AdminMenuSection): string {
  return SECTION_LABELS[section];
}

/**
 * 返回当前用户在 (admin) 壳内可见的菜单分组。
 *
 * 权限继续走 PERMISSIONS 字典；ADMIN_MODULES 只声明 label、route、icon、
 * breadcrumb、section 和 placeholder/implemented 状态。
 */
export function getAdminMenuItems(user: { role: Role }): AdminMenuGroup[] {
  const modules = getAdminModulesForRole(user.role).filter((module) =>
    isVisible(module, user.role),
  );
  const visibleModuleIds = new Set(modules.map((module) => module.id));
  const childrenByParent = new Map<
    string,
    ReturnType<typeof getAdminModulesForRole>
  >();
  const rootModules: typeof modules = [];

  for (const adminModule of modules) {
    if (
      adminModule.menuParentId &&
      visibleModuleIds.has(adminModule.menuParentId)
    ) {
      const siblings = childrenByParent.get(adminModule.menuParentId) ?? [];
      siblings.push(adminModule);
      childrenByParent.set(adminModule.menuParentId, siblings);
    } else {
      // A visible child must not disappear merely because its parent is hidden
      // for the current role. Promote such an orphan to the section root.
      rootModules.push(adminModule);
    }
  }

  const groups: AdminMenuGroup[] = [];
  for (const adminModule of rootModules) {
    const label = sectionLabel(adminModule.menuSection);
    const group = groups.find((candidate) => candidate.label === label);
    const item = toMenuItem(adminModule, childrenByParent);
    if (group) {
      group.items.push(item);
    } else {
      groups.push({ label, items: [item], collapsible: adminModule.menuSection !== 'account' });
    }
  }
  return groups;
}

/**
 * 按菜单的显示顺序展平任意深度的父子树。
 *
 * 高亮、快捷入口和侧边栏派生列表共用同一展平逻辑，避免子项
 * 只显示但不参与路由匹配或权限检查。
 */
export function flattenAdminMenuItems(
  items: readonly AdminMenuItem[],
): AdminMenuItem[] {
  const flattened: AdminMenuItem[] = [];

  for (const item of items) {
    flattened.push(item);
    if (item.children?.length) {
      flattened.push(...flattenAdminMenuItems(item.children));
    }
  }

  return flattened;
}

/**
 * 返回当前 URL 应唯一高亮的菜单 href。
 *
 * `activeRouteBase` 可以把多个同属一个业务模块的页面归到同一入口，
 * `activeQuery` 只声明区分稳定视图所需的 query 条件，不会被搜索、
 * 分页等临时参数干扰。条件中的 `null` 表示该 query 必须缺省。
 * 有多个匹配时使用最长路径，避免父子入口同时高亮。
 */
export function getActiveAdminMenuHref(
  pathname: string,
  items: readonly AdminMenuItem[],
  searchParams?: Pick<URLSearchParams, 'get'>,
): string | null {
  let bestHref: string | null = null;
  let bestMatchLength = -1;
  let bestQuerySpecificity = -1;

  for (const item of flattenAdminMenuItems(items)) {
    const matchBase = item.activeRouteBase ?? item.href;
    if (matchBase === '#' || matchBase === '/') continue;
    const matches =
      pathname === matchBase || pathname.startsWith(`${matchBase}/`);
    const querySpecificity = activeQuerySpecificity(item, searchParams);
    if (
      !matches ||
      querySpecificity === null ||
      matchBase.length < bestMatchLength ||
      (matchBase.length === bestMatchLength &&
        querySpecificity <= bestQuerySpecificity)
    ) {
      continue;
    }
    bestHref = item.href;
    bestMatchLength = matchBase.length;
    bestQuerySpecificity = querySpecificity;
  }

  return bestHref;
}

function activeQuerySpecificity(
  item: AdminMenuItem,
  searchParams?: Pick<URLSearchParams, 'get'>,
): number | null {
  if (!item.activeQuery?.length) return 0;
  if (!searchParams) return null;

  const matchingConditions = item.activeQuery.filter((condition) =>
    Object.entries(condition).every(
      ([key, expected]) => searchParams.get(key) === expected,
    ),
  );
  if (matchingConditions.length === 0) return null;
  return Math.max(
    ...matchingConditions.map((condition) => Object.keys(condition).length),
  );
}

export function getAdminQuickLinks(user: { role: Role }): AdminMenuItem[] {
  const preferredByRole: Partial<Record<Role, readonly string[]>> = {
    [Role.ADMIN]: [
      '/orders',
      '/foreman/outsource',
      '/owner/purchases',
      '/owner/warehouses',
    ],
    [Role.SALES]: ['/orders/new', '/orders', '/sales/bills'],
    [Role.CUSTOMER_SERVICE]: ['/orders/new', '/orders'],
  };
  const visible = flattenAdminMenuItems(
    getAdminMenuItems(user).flatMap((group) => group.items),
  );
  const preferred = preferredByRole[user.role] ?? [];
  return preferred
    .map((href) => visible.find((item) => item.href === href))
    .filter((item): item is AdminMenuItem => Boolean(item))
    .filter((item) => item.status === 'implemented' && item.href !== '#');
}

// Role-specific 标题，渲染在 sidebar 顶部 / 顶部条 role badge。
export const ADMIN_ROLE_BADGE: Record<Role, string> = {
  [Role.ADMIN]: '管理员后台',
  [Role.SALES]: '外部销售',
  [Role.CUSTOMER_SERVICE]: '客服',
  [Role.WORKER]: '师傅',
};
