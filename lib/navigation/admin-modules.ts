import { Role } from '../../generated/prisma/enums';
import type { Permission } from '../auth/permissions-dict';
import { RULE_CENTER_SIDEBAR_ITEMS } from './rule-center';

// 受控的图标名集合。新增图标时同时更新 AppSidebar 的 ICONS map。
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
  | 'FileArchive'
  | 'Database'
  | 'Settings';

export type AdminModuleStatus = 'implemented' | 'placeholder';

export type AdminMenuSection =
  | 'workflow'
  | 'rules'
  | 'finance'
  | 'dictionary'
  | 'operations'
  | 'account';

export type AdminModuleMetadata = {
  id: string;
  menuParentId?: string;
  menuGroupLabel?: string;
  label: string;
  routeBase: string;
  activeRouteBase?: string;
  activeQuery?: readonly Readonly<Record<string, string | null>>[];
  iconName: IconName;
  breadcrumbLabel: string;
  menuSection: AdminMenuSection;
  status: AdminModuleStatus;
  menuOrder: number;
  menuRoles: readonly Role[];
  requiredPermission?: Permission;
  roles?: readonly Role[];
};

const RULE_CENTER_ADMIN_MODULES: readonly AdminModuleMetadata[] =
  RULE_CENTER_SIDEBAR_ITEMS.map((item, index) => ({
    id: `owner.rules.${item.id}`,
    menuParentId:
      'menuParentId' in item
        ? `owner.rules.${item.menuParentId}`
        : undefined,
    menuGroupLabel:
      'menuGroupLabel' in item ? item.menuGroupLabel : undefined,
    label: item.label,
    routeBase: item.href,
    activeRouteBase: item.activeRouteBase,
    activeQuery: 'activeQuery' in item ? item.activeQuery : undefined,
    iconName: item.iconName,
    breadcrumbLabel: item.breadcrumbLabel,
    menuSection: 'rules',
    status: 'implemented',
    // 规则组位于业务与财务之间；小数只用于组内稳定排序。
    menuOrder: 29 + index / 10,
    menuRoles: [Role.ADMIN],
    requiredPermission: item.requiredPermission,
  }));

export const ADMIN_MODULES: readonly AdminModuleMetadata[] = [
  {
    id: 'owner.dashboard',
    label: '工作台',
    routeBase: '/owner',
    iconName: 'LayoutDashboard',
    breadcrumbLabel: '工作台',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 10,
    menuRoles: [Role.ADMIN],
    roles: [Role.ADMIN],
  },
  {
    id: 'owner.analytics',
    label: '经营概览',
    routeBase: '/owner/analytics',
    iconName: 'TrendingUp',
    breadcrumbLabel: '经营概览',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 15,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'report:all',
  },
  {
    id: 'owner.orders',
    label: '工单',
    routeBase: '/orders',
    iconName: 'ClipboardList',
    breadcrumbLabel: '工单',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 20,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'order:view:all',
  },
  {
    id: 'owner.purchases',
    label: '采购单',
    routeBase: '/owner/purchases',
    iconName: 'ClipboardList',
    breadcrumbLabel: '采购单',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 25,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'purchase:manage',
  },
  {
    id: 'owner.orderChanges',
    label: '工单修改申请',
    routeBase: '/owner/order-changes',
    iconName: 'FileText',
    breadcrumbLabel: '工单修改申请',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 27,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'order:change:review',
  },
  ...RULE_CENTER_ADMIN_MODULES,
  {
    id: 'owner.bills',
    label: '账单',
    routeBase: '/owner/agent-bills',
    iconName: 'Wallet',
    breadcrumbLabel: '代理商月度账单',
    menuSection: 'finance',
    status: 'implemented',
    menuOrder: 30,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'bill:view:all',
  },
  {
    id: 'owner.salary',
    label: '薪资总览',
    routeBase: '/owner/salary',
    iconName: 'Calculator',
    breadcrumbLabel: '薪资总览',
    menuSection: 'finance',
    status: 'implemented',
    menuOrder: 40,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'salary:view:all',
  },
  {
    id: 'owner.salary.piecework',
    label: '工序计件结算',
    routeBase: '/owner/salary/piecework',
    iconName: 'Calculator',
    breadcrumbLabel: '工序计件结算',
    menuSection: 'finance',
    status: 'implemented',
    menuOrder: 45,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'salary:view:all',
  },
  {
    id: 'owner.salary.daily',
    label: '历史日薪档案',
    routeBase: '/owner/salary/daily',
    iconName: 'Calculator',
    breadcrumbLabel: '历史日薪档案',
    menuSection: 'finance',
    status: 'implemented',
    menuOrder: 50,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'salary:view:all',
  },
  {
    id: 'owner.salary.cs',
    label: '客服周期',
    routeBase: '/owner/salary/cs',
    iconName: 'CalendarClock',
    breadcrumbLabel: '客服周期',
    menuSection: 'finance',
    status: 'implemented',
    menuOrder: 60,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'salary:view:all',
  },
  {
    id: 'owner.salary.hourly',
    label: '时薪工月结',
    routeBase: '/owner/salary/hourly',
    iconName: 'Clock',
    breadcrumbLabel: '时薪工月结',
    menuSection: 'finance',
    status: 'implemented',
    menuOrder: 70,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'salary:view:all',
  },
  {
    id: 'owner.materials',
    label: '物料',
    routeBase: '/owner/materials',
    iconName: 'Boxes',
    breadcrumbLabel: '物料',
    menuSection: 'dictionary',
    status: 'implemented',
    menuOrder: 120,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'material:manage',
  },
  {
    id: 'owner.warehouses',
    label: '仓库/库位',
    routeBase: '/owner/warehouses',
    iconName: 'Boxes',
    breadcrumbLabel: '仓库/库位',
    menuSection: 'dictionary',
    status: 'implemented',
    menuOrder: 125,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'warehouse:manage',
  },
  {
    id: 'owner.accounts',
    label: '用户管理',
    routeBase: '/owner/accounts',
    iconName: 'Users',
    breadcrumbLabel: '用户管理',
    menuSection: 'account',
    status: 'implemented',
    menuOrder: 130,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'account:manage',
  },
  {
    id: 'owner.notifications',
    label: '推送配置',
    routeBase: '/owner/notifications',
    iconName: 'Bell',
    breadcrumbLabel: '推送配置',
    menuSection: 'operations',
    status: 'implemented',
    menuOrder: 140,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'notification:config',
  },
  {
    id: 'owner.settings',
    label: '系统设置',
    routeBase: '/owner/settings',
    iconName: 'Settings',
    breadcrumbLabel: '系统设置',
    menuSection: 'operations',
    status: 'implemented',
    menuOrder: 135,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'setting:manage',
  },
  {
    id: 'owner.pigsty',
    label: 'Pigsty 运维',
    routeBase: '/owner/pigsty',
    iconName: 'Database',
    breadcrumbLabel: 'Pigsty 运维',
    menuSection: 'operations',
    status: 'implemented',
    menuOrder: 150,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'ops:pigsty:view',
  },
  {
    id: 'owner.backgroundJobs',
    label: '后台任务',
    routeBase: '/owner/background-jobs',
    iconName: 'Clock',
    breadcrumbLabel: '后台任务',
    menuSection: 'operations',
    status: 'implemented',
    menuOrder: 145,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'ops:jobs:manage',
  },
  {
    id: 'foreman.outsource',
    label: '外协',
    routeBase: '/foreman/outsource',
    iconName: 'PackageOpen',
    breadcrumbLabel: '外协',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 40,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'outsource:manage',
  },
  {
    id: 'foreman.materials',
    label: '车间用料',
    routeBase: '/foreman/materials',
    iconName: 'Boxes',
    breadcrumbLabel: '车间用料',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 45,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'material:manage',
  },
  {
    id: 'foreman.attendance',
    label: '工时录入',
    routeBase: '/foreman/attendance',
    iconName: 'Clock',
    breadcrumbLabel: '工时录入',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 50,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'attendance:manage',
  },
  {
    id: 'foreman.cdr',
    label: 'CDR 汇总',
    routeBase: '/foreman/cdr',
    iconName: 'FileArchive',
    breadcrumbLabel: 'CDR 汇总',
    menuSection: 'operations',
    status: 'implemented',
    menuOrder: 160,
    menuRoles: [Role.ADMIN],
    requiredPermission: 'design:bundle:create',
  },
  {
    id: 'sales.orders.new',
    label: '创建工单',
    routeBase: '/orders/new',
    iconName: 'PlusCircle',
    breadcrumbLabel: '创建工单',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 20,
    menuRoles: [Role.SALES],
    requiredPermission: 'order:create',
  },
  {
    id: 'sales.orders',
    label: '我的工单',
    routeBase: '/orders',
    iconName: 'ClipboardList',
    breadcrumbLabel: '我的工单',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 30,
    menuRoles: [Role.SALES],
    requiredPermission: 'order:view:self',
  },
  {
    id: 'sales.bills',
    label: '我的账单',
    routeBase: '/sales/bills',
    iconName: 'Wallet',
    breadcrumbLabel: '我的账单',
    menuSection: 'finance',
    status: 'implemented',
    menuOrder: 40,
    menuRoles: [Role.SALES],
    requiredPermission: 'bill:view:self',
  },
  {
    id: 'cs.orders.new',
    label: '创建工单',
    routeBase: '/orders/new',
    iconName: 'PlusCircle',
    breadcrumbLabel: '创建工单',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 20,
    menuRoles: [Role.CUSTOMER_SERVICE],
    requiredPermission: 'order:create',
  },
  {
    id: 'cs.orders',
    label: '我的工单',
    routeBase: '/orders',
    iconName: 'ClipboardList',
    breadcrumbLabel: '我的工单',
    menuSection: 'workflow',
    status: 'implemented',
    menuOrder: 30,
    menuRoles: [Role.CUSTOMER_SERVICE],
    requiredPermission: 'order:view:self',
  },
  {
    id: 'cs.performance',
    label: '我的业绩',
    routeBase: '#',
    iconName: 'TrendingUp',
    breadcrumbLabel: '我的业绩',
    menuSection: 'finance',
    status: 'placeholder',
    menuOrder: 40,
    menuRoles: [Role.CUSTOMER_SERVICE],
    requiredPermission: 'salary:view:self',
  },
  {
    id: 'cs.salary',
    label: '我的工资单',
    routeBase: '#',
    iconName: 'Sparkles',
    breadcrumbLabel: '我的工资单',
    menuSection: 'finance',
    status: 'placeholder',
    menuOrder: 50,
    menuRoles: [Role.CUSTOMER_SERVICE],
    requiredPermission: 'salary:view:self',
  },
] as const;

export function getAdminModulesForRole(role: Role): AdminModuleMetadata[] {
  return ADMIN_MODULES
    .filter((module) => module.menuRoles.includes(role))
    .sort((a, b) => a.menuOrder - b.menuOrder);
}
