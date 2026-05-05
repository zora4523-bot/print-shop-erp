import { Role } from '../../generated/prisma/enums';
import {
  PERMISSIONS,
  type Permission,
} from '../auth/permissions-dict';

// 受控的图标名集合 —— 比 `keyof typeof import('lucide-react')` 更安全：
// 拼错会编译失败，且能在 client 侧建一个静态 registry（避免动态 import 整
// 个 lucide）。新增图标时同时改这里和 AppSidebar 的 ICONS map。
export type IconName =
  | 'LayoutDashboard'
  | 'ClipboardList'
  | 'PlusCircle'
  | 'Wallet'
  | 'CalendarDays'
  | 'Calculator'
  | 'BookOpen'
  | 'Users'
  | 'CalendarClock'
  | 'PackageOpen'
  | 'Boxes'
  | 'Clock'
  | 'FileText'
  | 'TrendingUp'
  | 'Sparkles'
  | 'Bell'
  | 'FileArchive';

export type AdminMenuItem = {
  label: string;
  href: string;
  iconName: IconName;
  // 二选一鉴权：requiredPermission 走 PERMISSIONS 字典，roles 是显式角色白名单
  // （Dashboard 首页等没有对应权限 key 的项用 roles 回退）。
  requiredPermission?: Permission;
  roles?: readonly Role[];
};

export type AdminMenuGroup = {
  label?: string;
  items: AdminMenuItem[];
};

// 各角色的菜单 —— 不同角色的同一 href 标签可能不同（例：OWNER "工单" /
// SALES "我的工单"），所以分角色单独写，渲染期再过滤。
// Dashboard hrefs are `#` placeholders for FOREMAN / SALES / CS — those
// role roots are layout-only, no page.tsx, so a real link would 404
// (Codex round 96 / P2). OWNER's was `#` too until P1 #1 Slice A
// landed `/owner/page.tsx` (this commit) — its href is real now. Same
// "disabled placeholder" convention as 物料 / 报价查询 / 我的业绩 below;
// flip those to real hrefs once their pages land.
const OWNER_MENU: AdminMenuItem[] = [
  { label: 'Dashboard',   href: '/owner',           iconName: 'LayoutDashboard', roles: [Role.OWNER] },
  { label: '工单',         href: '/orders',          iconName: 'ClipboardList',   requiredPermission: 'order:view:all' },
  { label: '账单',         href: '/owner/bills',     iconName: 'Wallet',          requiredPermission: 'bill:view:all' },
  // 薪资总览页 /owner/salary 是 daily/cs/hourly 三项的入口；不显式列
  // 它的话，用户在 /owner/salary 时 sidebar 没有 active 项 (Codex
  // round 97 / P2)。下面的 daily/cs/hourly 各自匹配自己的 leaf 路径。
  { label: '薪资总览',     href: '/owner/salary',        iconName: 'Calculator',    requiredPermission: 'salary:view:all' },
  { label: '师傅日薪',     href: '/owner/salary/daily',  iconName: 'Calculator',    requiredPermission: 'salary:view:all' },
  { label: '客服周期',     href: '/owner/salary/cs',     iconName: 'CalendarClock', requiredPermission: 'salary:view:all' },
  { label: '时薪工月结',   href: '/owner/salary/hourly', iconName: 'Clock',         requiredPermission: 'salary:view:all' },
  { label: '工艺字典',     href: '/owner/crafts',    iconName: 'BookOpen',        requiredPermission: 'dict:craft:manage' },
  // 产品字典原本靠 Dashboard /owner 的 startsWith 匹配获得 active 状态；
  // Dashboard 改 # 后必须显式列，否则 /owner/products{,/[id],/new} 在
  // sidebar 没有 active 项 (round 97 / P2)。
  { label: '产品字典',     href: '/owner/products',  iconName: 'PackageOpen',     requiredPermission: 'dict:product:manage' },
  { label: '用户管理',     href: '/owner/accounts',  iconName: 'Users',           requiredPermission: 'account:manage' },
  { label: '推送配置',     href: '/owner/notifications', iconName: 'Bell',        requiredPermission: 'notification:config' },
];

const FOREMAN_MENU: AdminMenuItem[] = [
  { label: 'Dashboard',   href: '#',                       iconName: 'LayoutDashboard', roles: [Role.FOREMAN] },
  { label: '工单',         href: '/orders',                 iconName: 'ClipboardList',   requiredPermission: 'order:view:all' },
  { label: '排产',         href: '/foreman/scheduling',     iconName: 'CalendarDays',    requiredPermission: 'order:schedule' },
  { label: '外协',         href: '/foreman/outsource',      iconName: 'PackageOpen',     requiredPermission: 'outsource:manage' },
  { label: '物料',         href: '#',                       iconName: 'Boxes',           requiredPermission: 'material:manage' },
  { label: '师傅日薪',     href: '#',                       iconName: 'Calculator',      requiredPermission: 'salary:view:team' },
  { label: '工时录入',     href: '/foreman/attendance',     iconName: 'Clock',           requiredPermission: 'task:assign' },
  { label: 'CDR 汇总',     href: '/foreman/cdr',            iconName: 'FileArchive',     requiredPermission: 'design:bundle:create' },
];

const SALES_MENU: AdminMenuItem[] = [
  { label: '我的 Dashboard', href: '#',              iconName: 'LayoutDashboard', roles: [Role.SALES] },
  { label: '创建工单',       href: '/orders/new',    iconName: 'PlusCircle',      requiredPermission: 'order:create' },
  { label: '我的工单',       href: '/orders',        iconName: 'ClipboardList',   requiredPermission: 'order:view:self' },
  { label: '我的账单',       href: '/sales/bills',   iconName: 'Wallet',          requiredPermission: 'bill:view:self' },
  { label: '报价查询',       href: '#',              iconName: 'FileText',        requiredPermission: 'order:create' },
];

const CUSTOMER_SERVICE_MENU: AdminMenuItem[] = [
  { label: '我的 Dashboard', href: '#',                 iconName: 'LayoutDashboard', roles: [Role.CUSTOMER_SERVICE] },
  { label: '创建工单',       href: '/orders/new',       iconName: 'PlusCircle',      requiredPermission: 'order:create' },
  { label: '我的工单',       href: '/orders',           iconName: 'ClipboardList',   requiredPermission: 'order:view:self' },
  { label: '我的业绩',       href: '#',                 iconName: 'TrendingUp',      requiredPermission: 'salary:view:self' },
  { label: '我的工资单',     href: '#',                 iconName: 'Sparkles',        requiredPermission: 'salary:view:self' },
  { label: '报价查询',       href: '#',                 iconName: 'FileText',        requiredPermission: 'order:create' },
];

const MENU_BY_ROLE: Partial<Record<Role, AdminMenuItem[]>> = {
  [Role.OWNER]: OWNER_MENU,
  [Role.FOREMAN]: FOREMAN_MENU,
  [Role.SALES]: SALES_MENU,
  [Role.CUSTOMER_SERVICE]: CUSTOMER_SERVICE_MENU,
};

function isVisible(item: AdminMenuItem, role: Role): boolean {
  if (item.requiredPermission) {
    // Same cast as lib/auth/permissions.ts uses: per-key tuples don't widen
    // to readonly Role[] without an assertion (TS includes() strictness).
    const allowed = PERMISSIONS[item.requiredPermission] as readonly Role[];
    return allowed.includes(role);
  }
  if (item.roles) {
    return item.roles.includes(role);
  }
  return false;
}

/**
 * 返回当前用户在 (admin) 壳内可见的菜单分组。
 *
 * 实现走 PERMISSIONS 字典（CLAUDE.md §4.6）：每个 item 由
 * `requiredPermission` 或 `roles` 二选一鉴权，渲染期过滤。WORKER 与
 * 其他未识别角色返回空数组（师傅走独立的 (worker) 壳）。
 */
export function getAdminMenuItems(user: { role: Role }): AdminMenuGroup[] {
  const base = MENU_BY_ROLE[user.role];
  if (!base) return [];
  const items = base.filter((item) => isVisible(item, user.role));
  return items.length === 0 ? [] : [{ items }];
}

// Role-specific 标题，渲染在 sidebar 顶部 / 顶部条 role badge。
export const ADMIN_ROLE_BADGE: Record<Role, string> = {
  [Role.OWNER]: '老板后台',
  [Role.FOREMAN]: '车间',
  [Role.SALES]: '销售',
  [Role.CUSTOMER_SERVICE]: '客服',
  [Role.WORKER]: '师傅',
};
