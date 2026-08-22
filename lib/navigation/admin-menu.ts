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
  activeRouteBase?: string;
  iconName: IconName;
  breadcrumbLabel: string;
  status: AdminModuleStatus;
  requiredPermission?: Permission;
  roles?: readonly Role[];
};

export type AdminMenuGroup = {
  label?: string;
  items: AdminMenuItem[];
};

const SECTION_LABELS: Record<AdminMenuSection, string> = {
  dashboard: '概览',
  workflow: '业务',
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
): AdminMenuItem {
  return {
    label: module.label,
    href: module.routeBase,
    activeRouteBase: module.activeRouteBase,
    iconName: module.iconName,
    breadcrumbLabel: module.breadcrumbLabel,
    status: module.status,
    requiredPermission: module.requiredPermission,
    roles: module.roles,
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
  const groups: AdminMenuGroup[] = [];
  for (const adminModule of modules) {
    const label = sectionLabel(adminModule.menuSection);
    const group = groups.find((candidate) => candidate.label === label);
    const item = toMenuItem(adminModule);
    if (group) {
      group.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

/**
 * 返回当前 pathname 应唯一高亮的菜单 href。
 *
 * `activeRouteBase` 可以把多个同属一个业务模块的页面归到同一入口，
 * 但点击仍跳转到 `href`。有多个匹配时使用最长路径，避免父子入口同时高亮。
 */
export function getActiveAdminMenuHref(
  pathname: string,
  items: readonly Pick<AdminMenuItem, 'href' | 'activeRouteBase'>[],
): string | null {
  let bestHref: string | null = null;
  let bestMatchLength = -1;

  for (const item of items) {
    const matchBase = item.activeRouteBase ?? item.href;
    if (matchBase === '#' || matchBase === '/') continue;
    const matches =
      pathname === matchBase || pathname.startsWith(`${matchBase}/`);
    if (!matches || matchBase.length <= bestMatchLength) continue;
    bestHref = item.href;
    bestMatchLength = matchBase.length;
  }

  return bestHref;
}

export function getAdminQuickLinks(user: { role: Role }): AdminMenuItem[] {
  const preferredByRole: Partial<Record<Role, readonly string[]>> = {
    [Role.ADMIN]: [
      '/orders',
      '/foreman/scheduling',
      '/owner/purchases',
      '/owner/warehouses',
    ],
    [Role.SALES]: ['/orders/new', '/orders', '/sales/bills'],
    [Role.CUSTOMER_SERVICE]: ['/orders/new', '/orders'],
  };
  const visible = getAdminMenuItems(user).flatMap((group) => group.items);
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
