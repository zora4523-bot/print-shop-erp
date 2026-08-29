import type { Permission } from '@/lib/auth/permissions-dict';
import type { CustomerPriceSection } from '@/lib/price/customer-price-section-membership';

export const RULE_CENTER_HREFS = {
  root: '/owner/rules',
  papers: '/owner/rules/papers',
  stockSkus: '/owner/rules/stock-skus',
  productCategories: '/owner/rules/product-categories',
  crafts: '/owner/rules/crafts',
  customerPricing: '/owner/rules/customer-pricing',
  priceVersions: '/owner/rules/price-versions',
  internalPricing: '/owner/rules/internal-pricing',
  employeePay: '/owner/rules/employee-pay',
} as const;

type RuleCenterSidebarItem = {
  id: string;
  menuParentId?: string;
  label: string;
  description: string;
  impact: string;
  effect: RuleCenterEffect;
  href: string;
  activeRouteBase?: string;
  activeQuery?: readonly Readonly<Record<string, string | null>>[];
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

export type RuleCenterEffect =
  | 'mixed'
  | 'versioned'
  | 'immediate'
  | 'effective-dated';

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
    description: '按业务边界管理计价、主数据与结算规则。',
    impact: '新建工单计价、生产与工资结算',
    effect: 'mixed',
    href: RULE_CENTER_HREFS.root,
    activeRouteBase: RULE_CENTER_HREFS.root,
    iconName: 'Settings',
    breadcrumbLabel: '规则配置中心',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'blankEnvelopePricing',
    menuParentId: 'overview',
    label: '空白封单价',
    description: '按纸张、克重与规格维护局部烫金材料价。',
    impact: '对外新建工单计价',
    effect: 'versioned',
    href: `${RULE_CENTER_HREFS.customerPricing}?section=blank`,
    activeRouteBase: RULE_CENTER_HREFS.customerPricing,
    activeQuery: [
      { section: 'blank' },
      { section: null },
    ],
    iconName: 'Calculator',
    breadcrumbLabel: '空白封单价',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'partialFoilMachinePricing',
    menuParentId: 'overview',
    label: '局部烫金机烫费',
    description: '维护局部烫金的费率、固定费、跳变点与制版费。',
    impact: '对外新建工单计价',
    effect: 'versioned',
    href: `${RULE_CENTER_HREFS.customerPricing}?section=machine`,
    activeRouteBase: RULE_CENTER_HREFS.customerPricing,
    activeQuery: [{ section: 'machine' }],
    iconName: 'Calculator',
    breadcrumbLabel: '局部烫金机烫费',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'customFoilTierPricing',
    menuParentId: 'overview',
    label: '专版烫金单价',
    description: '按数量范围维护中号与大号专版烫金单价。',
    impact: '对外新建工单计价',
    effect: 'versioned',
    href: `${RULE_CENTER_HREFS.customerPricing}?section=tiers`,
    activeRouteBase: RULE_CENTER_HREFS.customerPricing,
    activeQuery: [{ section: 'tiers' }],
    iconName: 'Calculator',
    breadcrumbLabel: '专版烫金单价',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'customFoilAddOnPricing',
    menuParentId: 'overview',
    label: '专版烫金加价',
    description: '维护专版烫金的纸张、工艺与一次性附加费。',
    impact: '对外新建工单计价',
    effect: 'versioned',
    href: `${RULE_CENTER_HREFS.customerPricing}?section=adds`,
    activeRouteBase: RULE_CENTER_HREFS.customerPricing,
    activeQuery: [{ section: 'adds' }],
    iconName: 'Calculator',
    breadcrumbLabel: '专版烫金加价',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'colorPrintTierPricing',
    menuParentId: 'overview',
    label: '彩印阶梯价',
    description: '按产品与数量档维护彩印整单价与烫金附加费。',
    impact: '对外新建工单计价',
    effect: 'versioned',
    href: `${RULE_CENTER_HREFS.customerPricing}?section=print`,
    activeRouteBase: RULE_CENTER_HREFS.customerPricing,
    activeQuery: [{ section: 'print' }],
    iconName: 'Calculator',
    breadcrumbLabel: '彩印阶梯价',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'packagingShippingPricing',
    menuParentId: 'overview',
    label: '包装与快递',
    description: '维护入袋、纸箱耗材、重量与快递地区费率。',
    impact: '对外新建工单计价',
    effect: 'versioned',
    href: `${RULE_CENTER_HREFS.customerPricing}?purpose=logistics&section=ship`,
    activeRouteBase: RULE_CENTER_HREFS.customerPricing,
    activeQuery: [
      { section: 'ship' },
      { section: null, purpose: 'logistics' },
    ],
    iconName: 'Calculator',
    breadcrumbLabel: '包装与快递',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'priceVersions',
    menuParentId: 'overview',
    label: '价格版本',
    description: '审阅客户价目草稿差异、影响与发布计划。',
    impact: '之后的对外新建工单计价',
    effect: 'versioned',
    href: RULE_CENTER_HREFS.priceVersions,
    activeRouteBase: RULE_CENTER_HREFS.priceVersions,
    iconName: 'FileArchive',
    breadcrumbLabel: '价格版本',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'papers',
    menuParentId: 'overview',
    label: '纸张',
    description: '维护纸张编码、规格、库存与启停状态。',
    impact: '建单可选纸张与仓储出入库',
    effect: 'immediate',
    href: RULE_CENTER_HREFS.papers,
    activeRouteBase: RULE_CENTER_HREFS.papers,
    iconName: 'BookOpen',
    breadcrumbLabel: '纸张',
    requiredPermission: 'material:manage',
  },
  {
    id: 'stockSkus',
    menuParentId: 'overview',
    label: '建单产品目录',
    description: '维护新建工单按路线、纸张和规格隐式匹配的产品事实。',
    impact: '新建工单的产品解析与计价事实',
    effect: 'immediate',
    href: RULE_CENTER_HREFS.stockSkus,
    activeRouteBase: RULE_CENTER_HREFS.stockSkus,
    iconName: 'PackageOpen',
    breadcrumbLabel: '建单产品目录',
    requiredPermission: 'dict:product:manage',
  },
  {
    id: 'productCategories',
    menuParentId: 'overview',
    label: '产品结构',
    description: '维护建单产品与 BOM 共用的产品分类树。',
    impact: '新建 SKU、BOM 与历史引用',
    effect: 'immediate',
    href: RULE_CENTER_HREFS.productCategories,
    activeRouteBase: RULE_CENTER_HREFS.productCategories,
    iconName: 'FileText',
    breadcrumbLabel: '产品结构分类',
    requiredPermission: 'dict:product:manage',
  },
  {
    id: 'crafts',
    menuParentId: 'overview',
    label: '建单工艺目录',
    description: '维护建单、计价、外协识别与历史展示共用的工艺字典。',
    impact: '新建工单的工艺校验、外协识别与历史展示',
    effect: 'immediate',
    href: RULE_CENTER_HREFS.crafts,
    activeRouteBase: RULE_CENTER_HREFS.crafts,
    iconName: 'Sparkles',
    breadcrumbLabel: '建单工艺目录',
    requiredPermission: 'dict:craft:manage',
  },
  {
    id: 'internalPricing',
    menuParentId: 'overview',
    label: '内部计价',
    description: '维护内部直单价格阶梯、加价规则与有效期。',
    impact: '内部报价和成本结算',
    effect: 'effective-dated',
    href: RULE_CENTER_HREFS.internalPricing,
    activeRouteBase: RULE_CENTER_HREFS.internalPricing,
    iconName: 'Calculator',
    breadcrumbLabel: '内部计价',
    requiredPermission: 'dict:price:manage',
  },
  {
    id: 'employeePay',
    menuParentId: 'overview',
    label: '工资提成',
    description: '维护客服提成、计时工与厨师工资版本。',
    impact: '后续工资快照与月度结算',
    effect: 'effective-dated',
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
  return purpose === 'logistics'
    ? `${RULE_CENTER_HREFS.customerPricing}?purpose=logistics&section=ship`
    : `${RULE_CENTER_HREFS.customerPricing}?section=blank`;
}

/**
 * Return from version review to the design-native editor that owns a rule.
 * `focus` is intentionally an opaque id; the server-rendered editor resolves it
 * to one of its trusted form bindings before the client focuses anything.
 */
export function customerPricingRuleHref(
  section: CustomerPriceSection,
  ruleId: string,
): string {
  const params = new URLSearchParams({ section, focus: ruleId });
  return `${RULE_CENTER_HREFS.customerPricing}?${params.toString()}`;
}

export const RULE_CENTER_DEFAULT_HREF =
  `${RULE_CENTER_HREFS.customerPricing}?section=blank` as const;

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
