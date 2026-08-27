import type { Permission } from '@/lib/auth/permissions-dict';

export const RULE_CENTER_HREFS = {
  root: '/owner/rules',
  pricingRoutes: '/owner/rules/pricing-routes',
  papers: '/owner/rules/papers',
  stockSkus: '/owner/rules/stock-skus',
  productCategories: '/owner/rules/product-categories',
  crafts: '/owner/rules/crafts',
  customerPricing: '/owner/rules/customer-pricing',
  priceVersions: '/owner/rules/price-versions',
  internalPricing: '/owner/rules/internal-pricing',
  workerPiecework: '/owner/rules/worker-piecework',
  employeePay: '/owner/rules/employee-pay',
} as const;

type RuleCenterSidebarItem = {
  id: string;
  menuParentId?: string;
  label: string;
  href: string;
  activeRouteBase?: string;
  iconName:
    | 'Settings'
    | 'Calculator'
    | 'BookOpen'
    | 'PackageOpen'
    | 'FileText'
    | 'Sparkles'
    | 'FileArchive'
    | 'Users';
  breadcrumbLabel: string;
  requiredPermission: Permission;
};

/**
 * 规则中心在管理员主导航中的稳定信息架构。
 *
 * 菜单名保持短小，breadcrumbLabel 保留完整业务名。每个入口的
 * 权限与目标页实际 gate 对齐，避免“菜单可见但打开后无权”。
 */
export const RULE_CENTER_SIDEBAR_ITEMS = [
  {
    id: 'overview',
    label: '规则配置中心',
    href: RULE_CENTER_HREFS.root,
    activeRouteBase: RULE_CENTER_HREFS.root,
    iconName: 'Settings',
    breadcrumbLabel: '规则配置中心',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'customerPricing',
    menuParentId: 'overview',
    label: '客户计价',
    href: RULE_CENTER_HREFS.customerPricing,
    activeRouteBase: RULE_CENTER_HREFS.customerPricing,
    iconName: 'Calculator',
    breadcrumbLabel: '客户计价规则',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'papers',
    menuParentId: 'overview',
    label: '纸张',
    href: RULE_CENTER_HREFS.papers,
    activeRouteBase: RULE_CENTER_HREFS.papers,
    iconName: 'BookOpen',
    breadcrumbLabel: '纸张',
    requiredPermission: 'material:manage',
  },
  {
    id: 'stockSkus',
    menuParentId: 'overview',
    label: '报价 SKU',
    href: RULE_CENTER_HREFS.stockSkus,
    activeRouteBase: RULE_CENTER_HREFS.stockSkus,
    iconName: 'PackageOpen',
    breadcrumbLabel: '报价 SKU',
    requiredPermission: 'dict:product:manage',
  },
  {
    id: 'productCategories',
    menuParentId: 'overview',
    label: '产品结构',
    href: RULE_CENTER_HREFS.productCategories,
    activeRouteBase: RULE_CENTER_HREFS.productCategories,
    iconName: 'FileText',
    breadcrumbLabel: '产品结构分类',
    requiredPermission: 'dict:product:manage',
  },
  {
    id: 'crafts',
    menuParentId: 'overview',
    label: '工艺参数',
    href: RULE_CENTER_HREFS.crafts,
    activeRouteBase: RULE_CENTER_HREFS.crafts,
    iconName: 'Sparkles',
    breadcrumbLabel: '工艺与参数',
    requiredPermission: 'dict:craft:manage',
  },
  {
    id: 'priceVersions',
    menuParentId: 'overview',
    label: '价格版本',
    href: RULE_CENTER_HREFS.priceVersions,
    activeRouteBase: RULE_CENTER_HREFS.priceVersions,
    iconName: 'FileArchive',
    breadcrumbLabel: '价格版本',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'internalPricing',
    menuParentId: 'overview',
    label: '内部计价',
    href: RULE_CENTER_HREFS.internalPricing,
    activeRouteBase: RULE_CENTER_HREFS.internalPricing,
    iconName: 'Calculator',
    breadcrumbLabel: '内部计价',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'workerPiecework',
    menuParentId: 'overview',
    label: '师傅计件',
    href: RULE_CENTER_HREFS.workerPiecework,
    activeRouteBase: RULE_CENTER_HREFS.workerPiecework,
    iconName: 'Calculator',
    breadcrumbLabel: '师傅计件规则',
    requiredPermission: 'salary:rule:manage',
  },
  {
    id: 'employeePay',
    menuParentId: 'overview',
    label: '工资提成',
    href: RULE_CENTER_HREFS.employeePay,
    activeRouteBase: RULE_CENTER_HREFS.employeePay,
    iconName: 'Users',
    breadcrumbLabel: '员工工资与提成',
    requiredPermission: 'salary:rule:manage',
  },
] as const satisfies readonly RuleCenterSidebarItem[];

export type CustomerPricingPurpose = 'processing' | 'logistics';

export function customerPricingHref(
  purpose: CustomerPricingPurpose = 'processing',
): string {
  return `${RULE_CENTER_HREFS.customerPricing}?purpose=${purpose}`;
}

export function priceVersionsHref(draftId?: string): string {
  if (!draftId) return RULE_CENTER_HREFS.priceVersions;
  return `${RULE_CENTER_HREFS.priceVersions}?draft=${encodeURIComponent(draftId)}`;
}

export function internalPriceTierHref(id: string): string {
  return `${RULE_CENTER_HREFS.internalPricing}/tiers/${encodeURIComponent(id)}`;
}

export function internalPriceAdjustmentHref(id: string): string {
  return `${RULE_CENTER_HREFS.internalPricing}/adjustments/${encodeURIComponent(id)}`;
}
