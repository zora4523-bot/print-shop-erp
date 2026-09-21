import type { Permission } from '@/lib/auth/permissions-dict';
import type { CustomerPriceSection } from '@/lib/price/customer-price-section-membership';

export const RULE_CENTER_HREFS = {
  root: '/owner/rules',
  papers: '/owner/rules/papers',
  stockSkus: '/owner/rules/stock-skus',
  productReferences: '/owner/rules/product-categories/items',
  productCategories: '/owner/rules/product-categories',
  crafts: '/owner/rules/crafts',
  customerPricing: '/owner/rules/customer-pricing',
  priceVersions: '/owner/rules/price-versions',
  employeePay: '/owner/rules/employee-pay',
} as const;

type RuleCenterSidebarItem = {
  id: string;
  menuParentId?: string;
  menuGroupLabel?: string;
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
    menuGroupLabel: '客户计价规则',
    label: '空白封单价',
    description: '按纸张、克重与规格维护局部烫金材料价。',
    impact: '新建工单计价',
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
    menuGroupLabel: '客户计价规则',
    label: '局部烫金机烫费',
    description: '维护局部烫金的机烫费参数；制版费始终由管理员人工核价。',
    impact: '新建工单计价',
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
    menuGroupLabel: '客户计价规则',
    label: '专版烫金单价',
    description: '按数量范围维护中号与大号专版烫金单价。',
    impact: '新建工单计价',
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
    menuGroupLabel: '客户计价规则',
    label: '专版烫金加价',
    description: '维护专版烫金的纸张、工艺与一次性附加费。',
    impact: '新建工单计价',
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
    menuGroupLabel: '客户计价规则',
    label: '彩印阶梯价',
    description: '按产品与数量档维护彩印整单价与烫金附加费。',
    impact: '新建工单计价',
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
    menuGroupLabel: '客户计价规则',
    label: '包装与快递',
    description: '维护入袋、纸箱耗材、重量与快递地区费率。',
    impact: '新建工单计价',
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
    menuGroupLabel: '客户计价规则',
    label: '价格版本',
    description: '审阅客户价目草稿差异、影响与发布计划。',
    impact: '之后的新建工单计价',
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
    menuGroupLabel: '建单主数据',
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
    id: 'productCategories',
    menuParentId: 'overview',
    menuGroupLabel: '建单主数据',
    label: '产品结构',
    description: '维护产品资料与 BOM 共用的分类树。',
    impact: '专版和彩印资料、BOM 与历史引用',
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
    menuGroupLabel: '建单主数据',
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
    id: 'employeePay',
    menuParentId: 'overview',
    menuGroupLabel: '员工薪酬规则',
    label: '员工薪酬规则',
    description: '维护客服提成、计时工与固定工资版本；工序计件工价属于独立规则域。',
    impact: '员工工价与月度结算',
    effect: 'effective-dated',
    href: RULE_CENTER_HREFS.employeePay,
    activeRouteBase: RULE_CENTER_HREFS.employeePay,
    iconName: 'Users',
    breadcrumbLabel: '员工薪酬规则',
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

export function priceVersionsHref(draftId?: string): string {
  if (!draftId) return RULE_CENTER_HREFS.priceVersions;
  return `${RULE_CENTER_HREFS.priceVersions}?draft=${encodeURIComponent(draftId)}`;
}
