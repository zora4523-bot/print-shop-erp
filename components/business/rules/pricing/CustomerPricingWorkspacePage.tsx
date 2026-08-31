import Link from 'next/link';
import { Suspense } from 'react';
import Decimal from 'decimal.js';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
} from '@/generated/prisma/enums';
import {
  CreateCustomerPriceBookDraftForm,
  CustomerPriceBookDraftRuleForm,
} from '@/components/business/price/ExternalSalesPriceBookDraftForms';
import { ExternalSalesPriceTierGroupEditor } from '@/components/business/price/ExternalSalesPriceTierGroupEditor';
import {
  ExternalSalesChargeWorkspace,
  type ExternalSalesChargeWorkspaceItem,
} from '@/components/business/price/ExternalSalesChargeWorkspace';
import { buttonVariants } from '@/components/ui/button';
import {
  ContentSkeleton,
  ErrorBoundary,
  PageHeader,
} from '@/components/ui-business';
import {
  buildTableHref,
  firstSearchParam,
  parsePositiveInt,
} from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { updateCustomerPriceRuleDraftGroupAction } from '@/actions/customer-price-books';
import { getCustomerPriceBookDraftRuleEditor } from '@/lib/price/customer-price-book-admin';
import {
  getCustomerPriceRuleGroupWorkspaceDetail,
  getCustomerPriceRuleGroupWorkspacePage,
  type CustomerPriceRuleBusinessDto,
  type CustomerPriceRuleWorkspaceGroupDto,
  type CustomerPriceRuleWorkspaceItemDto,
} from '@/lib/price/customer-price-book-workspace';
import { normalizeZtoProvince } from '@/lib/price/external-order-charges';
import {
  externalPriceBusinessText,
  externalPriceRuleDisplayName,
} from '@/lib/price/external-price-display';
import {
  RULE_CENTER_HREFS,
  customerPricingHref,
} from '@/lib/navigation/rule-center';
import { PriceDataBoundary } from './PriceDataBoundary';

export const metadata = {
  title: '客户计价规则 · 红包印刷 ERP',
};

const WORKSPACE_PATH = RULE_CENTER_HREFS.customerPricing;

type SearchParams = {
  purpose?: string | string[];
  q?: string | string[];
  category?: string | string[];
  subject?: string | string[];
  kind?: string | string[];
  calculation?: string | string[];
  quantity?: string | string[];
  automation?: string | string[];
  status?: string | string[];
  changed?: string | string[];
  page?: string | string[];
  item?: string | string[];
  start?: string | string[];
};

type PageProps = { searchParams: Promise<SearchParams> };

const CALCULATION_LABELS: Record<CustomerPriceCalculationType, string> = {
  [CustomerPriceCalculationType.PER_PIECE]: '按个',
  [CustomerPriceCalculationType.FIXED_AMOUNT]: '整批固定金额',
  [CustomerPriceCalculationType.PER_SHEET]: '按张',
  [CustomerPriceCalculationType.PER_10K]: '每万个',
  [CustomerPriceCalculationType.PER_ITEM]: '每款一次',
  [CustomerPriceCalculationType.PER_BAG]: '按实际袋数',
};

const RULE_KIND_LABELS: Record<CustomerPriceRuleKind, string> = {
  [CustomerPriceRuleKind.BASE]: '基础价',
  [CustomerPriceRuleKind.ADD_ON]: '附加费',
  [CustomerPriceRuleKind.REFERENCE]: '人工参考',
};

function workspaceBusinessText(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return externalPriceBusinessText(value) || null;
}

function safeOpaqueId(value: string): string {
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function purposeFromParam(value: string): CustomerPriceBookPurpose {
  return value === 'logistics'
    ? CustomerPriceBookPurpose.LOGISTICS
    : CustomerPriceBookPurpose.PROCESSING;
}

function purposeParam(purpose: CustomerPriceBookPurpose): 'processing' | 'logistics' {
  return purpose === CustomerPriceBookPurpose.LOGISTICS
    ? 'logistics'
    : 'processing';
}

function enumValue<T extends string>(value: string, values: readonly T[]): T | undefined {
  return values.includes(value as T) ? (value as T) : undefined;
}

function quantityLabel(rule: CustomerPriceRuleBusinessDto): string {
  if (rule.minQty === null && rule.maxQty === null) return '不限数量';
  if (rule.minQty !== null && rule.minQty === rule.maxQty) {
    return `仅 ${rule.minQty.toLocaleString('zh-CN')} 个`;
  }
  if (rule.minQty === null) {
    return `不超过 ${rule.maxQty?.toLocaleString('zh-CN')} 个`;
  }
  if (rule.maxQty === null) {
    return `${rule.minQty.toLocaleString('zh-CN')} 个起`;
  }
  return `${rule.minQty.toLocaleString('zh-CN')}–${rule.maxQty.toLocaleString(
    'zh-CN',
  )} 个`;
}

function decimalValue(value: string): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function decimalLabel(value: Decimal, maximumFractionDigits: number): string {
  const [integer = '0', fraction = ''] = value
    .toFixed(maximumFractionDigits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')
    .split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const absoluteInteger = sign ? integer.slice(1) : integer;
  const groupedInteger = absoluteInteger.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ',',
  );
  return `${sign}${groupedInteger}${fraction ? `.${fraction}` : ''}`;
}

function money(value: string): string {
  const parsed = decimalValue(value);
  return parsed ? decimalLabel(parsed, 4) : value;
}

function calculationTypeLabel(rule: CustomerPriceRuleBusinessDto): string {
  if (
    rule.includedUnits !== null &&
    rule.incrementUnits !== null &&
    rule.incrementAmount !== null
  ) {
    return '首重 + 续重';
  }
  if (rule.calculationType === null) return '人工报价';
  return CALCULATION_LABELS[rule.calculationType];
}

function calculationLabel(rule: CustomerPriceRuleBusinessDto): string {
  const label = calculationTypeLabel(rule);
  return rule.calculationType === CustomerPriceCalculationType.PER_SHEET &&
    rule.unitsPerSheet !== null
    ? `${label} · 每张 ${rule.unitsPerSheet.toLocaleString('zh-CN')} 个`
    : label;
}

function sheetCapacityLabel(rule: CustomerPriceRuleBusinessDto): string {
  if (rule.calculationType !== CustomerPriceCalculationType.PER_SHEET) {
    return '不适用';
  }
  return rule.unitsPerSheet === null
    ? '未设置'
    : `${rule.unitsPerSheet.toLocaleString('zh-CN')} 个`;
}

function amountLabel(rule: CustomerPriceRuleBusinessDto | null): string {
  if (!rule) return '新增项目';
  if (rule.amount === null || rule.calculationType === null) return '待人工确认';
  const amount = money(rule.amount);
  if (
    rule.includedUnits !== null &&
    rule.incrementUnits !== null &&
    rule.incrementAmount !== null
  ) {
    return `首重 ${rule.includedUnits}kg ¥${amount}；续重每 ${rule.incrementUnits}kg ¥${money(
      rule.incrementAmount,
    )}`;
  }
  switch (rule.calculationType) {
    case CustomerPriceCalculationType.PER_PIECE:
      return `¥${amount} / 个`;
    case CustomerPriceCalculationType.PER_SHEET:
      return `¥${amount} / 张`;
    case CustomerPriceCalculationType.PER_10K:
      return `¥${amount} / 万个`;
    case CustomerPriceCalculationType.PER_ITEM:
      return `¥${amount} / 款`;
    case CustomerPriceCalculationType.PER_BAG:
      return `¥${amount} / 袋`;
    case CustomerPriceCalculationType.FIXED_AMOUNT:
      return `整批 ¥${amount}`;
  }
}

function amountChangeLabel(
  currentValue: string | null,
  draftValue: string | null,
): string | null {
  if (currentValue === draftValue) return null;
  if (currentValue === null || draftValue === null) return '金额设置已调整';

  const currentAmount = decimalValue(currentValue);
  const draftAmount = decimalValue(draftValue);
  if (!currentAmount || !draftAmount) {
    return '金额设置已调整';
  }
  if (currentAmount.eq(draftAmount)) return null;
  if (currentAmount.isZero()) {
    return `¥${money(currentValue)} → ¥${money(draftValue)}`;
  }

  const difference = draftAmount.minus(currentAmount);
  const percentage = difference.div(currentAmount).times(100);
  const sign = difference.isPositive() ? '+' : '-';
  return `${sign}¥${decimalLabel(difference.abs(), 4)}（${sign}${decimalLabel(
    percentage.abs(),
    2,
  )}%）`;
}

function perSheetUnitCostComparisonLabel(
  current: CustomerPriceRuleBusinessDto,
  draft: CustomerPriceRuleBusinessDto,
): string | null {
  if (
    current.calculationType !== CustomerPriceCalculationType.PER_SHEET ||
    draft.calculationType !== CustomerPriceCalculationType.PER_SHEET ||
    current.amount === null ||
    draft.amount === null ||
    current.unitsPerSheet === null ||
    draft.unitsPerSheet === null
  ) {
    return null;
  }

  const currentAmount = decimalValue(current.amount);
  const draftAmount = decimalValue(draft.amount);
  if (!currentAmount || !draftAmount) return null;
  const currentUnitCost = currentAmount.div(current.unitsPerSheet);
  const draftUnitCost = draftAmount.div(draft.unitsPerSheet);

  if (currentUnitCost.eq(draftUnitCost)) {
    return `折算单价保持 ¥${decimalLabel(currentUnitCost, 4)}/个`;
  }

  const percentageLabel =
    currentUnitCost.isZero()
      ? ''
      : `（${draftUnitCost.gt(currentUnitCost) ? '+' : '-'}${decimalLabel(
          draftUnitCost.minus(currentUnitCost).div(currentUnitCost).times(100).abs(),
          2,
        )}%）`;
  return `折算单价 ¥${decimalLabel(currentUnitCost, 4)}/个 → ¥${decimalLabel(
    draftUnitCost,
    4,
  )}/个${percentageLabel}`;
}

function priceChangeLabel(
  current: CustomerPriceRuleBusinessDto | null,
  draft: CustomerPriceRuleBusinessDto | null,
): string | null {
  if (!current || !draft) return null;
  if (current.calculationType !== draft.calculationType) {
    return '计价方式已调整';
  }

  if (
    current.calculationType === CustomerPriceCalculationType.PER_SHEET &&
    draft.calculationType === CustomerPriceCalculationType.PER_SHEET
  ) {
    const changes: string[] = [];
    const sheetAmountChange = amountChangeLabel(current.amount, draft.amount);
    const sheetStructureChanged =
      current.unitsPerSheet !== draft.unitsPerSheet;
    const unitCostComparison =
      sheetAmountChange || sheetStructureChanged
        ? perSheetUnitCostComparisonLabel(current, draft)
        : null;
    if (sheetAmountChange) changes.push(`每张 ${sheetAmountChange}`);
    if (unitCostComparison) changes.push(unitCostComparison);
    if ((sheetAmountChange || sheetStructureChanged) && !unitCostComparison) {
      changes.push('按张计价结构已调整');
    }
    return changes.length > 0 ? changes.join('；') : '价格未变';
  }

  const hasShippingTerms = [
    current.includedUnits,
    current.incrementUnits,
    current.incrementAmount,
    draft.includedUnits,
    draft.incrementUnits,
    draft.incrementAmount,
  ].some((value) => value !== null);

  if (hasShippingTerms) {
    const changes: string[] = [];
    const baseChange = amountChangeLabel(current.amount, draft.amount);
    const incrementChange = amountChangeLabel(
      current.incrementAmount,
      draft.incrementAmount,
    );
    if (baseChange) changes.push(`首重 ${baseChange}`);
    if (incrementChange) changes.push(`续重 ${incrementChange}`);
    const sameNumericValue = (
      currentValue: string | null,
      draftValue: string | null,
    ) => {
      if (currentValue === draftValue) return true;
      if (currentValue === null || draftValue === null) return false;
      const currentNumber = decimalValue(currentValue);
      const draftNumber = decimalValue(draftValue);
      return Boolean(currentNumber && draftNumber?.eq(currentNumber));
    };
    if (
      !sameNumericValue(current.includedUnits, draft.includedUnits) ||
      !sameNumericValue(current.incrementUnits, draft.incrementUnits)
    ) {
      changes.push('计重单位已调整');
    }
    return changes.length > 0 ? changes.join('；') : '价格未变';
  }

  return amountChangeLabel(current.amount, draft.amount) ?? '价格未变';
}

function formatShanghaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

type ChargeRulePair = Pick<
  CustomerPriceRuleWorkspaceItemDto,
  'current' | 'draft' | 'changed'
>;

function businessRule(item: ChargeRulePair): CustomerPriceRuleBusinessDto {
  const rule = item.draft ?? item.current;
  if (!rule) throw new Error('收费项目缺少当前版和草稿版数据');
  return rule;
}

function workspaceItem(
  item: ChargeRulePair,
  href: string,
): ExternalSalesChargeWorkspaceItem {
  const rule = businessRule(item);
  const current = item.current;
  const draft = item.draft;
  const scope = (entry: CustomerPriceRuleBusinessDto) =>
    workspaceBusinessText(entry.product?.name) ??
    workspaceBusinessText(entry.scopeLabel) ??
    '通用收费项';
  const changes =
    current && draft
      ? [
          [
            '名称',
            externalPriceRuleDisplayName(current.name),
            externalPriceRuleDisplayName(draft.name),
          ],
          ['收费类目', current.category.name, draft.category.name],
          ['适用范围', scope(current), scope(draft)],
          ['数量范围', quantityLabel(current), quantityLabel(draft)],
          ['收费类型', RULE_KIND_LABELS[current.kind], RULE_KIND_LABELS[draft.kind]],
          [
            '计价方式',
            calculationTypeLabel(current),
            calculationTypeLabel(draft),
          ],
          [
            '每张含几个',
            sheetCapacityLabel(current),
            sheetCapacityLabel(draft),
          ],
          [
            '处理方式',
            current.automation === 'AUTOMATIC' ? '自动计价' : '需人工确认',
            draft.automation === 'AUTOMATIC' ? '自动计价' : '需人工确认',
          ],
          [
            '自动报价限制',
            current.blocksAutomaticQuote ? '阻止自动报价' : '不阻止自动报价',
            draft.blocksAutomaticQuote ? '阻止自动报价' : '不阻止自动报价',
          ],
          [
            '状态',
            current.isActive ? '已启用' : '已停用',
            draft.isActive ? '已启用' : '已停用',
          ],
        ]
          .filter(([, before, after]) => before !== after)
          .map(([label, before, after]) => `${label}：${before} → ${after}`)
      : [];
  return {
    id: rule.id,
    name: externalPriceRuleDisplayName(rule.name),
    categoryKey: rule.category.id,
    categoryLabel: rule.category.name,
    subjectLabel:
      workspaceBusinessText(rule.product?.name) ??
      workspaceBusinessText(rule.scopeLabel) ??
      '通用收费项',
    quantityLabel: quantityLabel(rule),
    calculationLabel: calculationLabel(rule),
    currentAmountLabel: amountLabel(item.current),
    draftAmountLabel: item.draft ? amountLabel(item.draft) : null,
    priceChangeLabel: priceChangeLabel(item.current, item.draft),
    changeSummaryLabels: changes,
    automation: rule.automation === 'AUTOMATIC' ? 'AUTO' : 'MANUAL',
    status: rule.isActive ? 'ACTIVE' : 'INACTIVE',
    changed: item.changed,
    detailHref: href,
  };
}

function groupRepresentative(
  group: CustomerPriceRuleWorkspaceGroupDto,
): CustomerPriceRuleBusinessDto {
  const rule = group.tiers[0]?.draft ?? group.tiers[0]?.current;
  if (!rule) throw new Error('收费项分组缺少价格数据');
  return rule;
}

function productGroupRowName(group: CustomerPriceRuleWorkspaceGroupDto): string {
  const product = group.product;
  if (!product) return externalPriceRuleDisplayName(group.name);

  const productName = workspaceBusinessText(product.name) ?? '未命名产品';
  const paperType = workspaceBusinessText(product.paperType);
  const specification = workspaceBusinessText(product.specification);
  let core = productName;
  let removedBusinessAttribute = false;
  for (const attribute of [paperType, specification]) {
    if (!attribute || !core.includes(attribute)) continue;
    core = core.replaceAll(attribute, ' ');
    removedBusinessAttribute = true;
  }
  core = core
    .replace(/[（(]\s*[)）]/g, ' ')
    .replace(/[\s·•｜|/]+/g, ' ')
    .trim();
  if (!removedBusinessAttribute || !core) return productName;
  return specification
    ? `${core} · ${specification}`
    : core;
}

function groupSubjectLabel(group: CustomerPriceRuleWorkspaceGroupDto): string {
  return (
    workspaceBusinessText(group.product?.paperType) ??
    workspaceBusinessText(group.scopeLabel) ??
    workspaceBusinessText(group.product?.name) ??
    '通用收费项'
  );
}

function groupQuantityLabel(group: CustomerPriceRuleWorkspaceGroupDto): string {
  if (group.tierCount === 1) return quantityLabel(groupRepresentative(group));
  const quantities = group.tiers
    .map((tier) => (tier.draft ?? tier.current)?.minQty ?? null)
    .filter((quantity): quantity is number => quantity !== null);
  const first = quantities[0];
  const last = quantities.at(-1);
  if (first === undefined || last === undefined) {
    return `${group.tierCount.toLocaleString('zh-CN')} 个数量档`;
  }
  return `${group.tierCount.toLocaleString('zh-CN')} 个数量档 · ${first.toLocaleString(
    'zh-CN',
  )}–${last.toLocaleString('zh-CN')} 个`;
}

function groupAmountLabel(
  group: CustomerPriceRuleWorkspaceGroupDto,
  version: 'current' | 'draft',
): string {
  if (group.tierCount === 1) {
    return amountLabel(group.tiers[0]?.[version] ?? null);
  }
  const amounts = group.tiers
    .map((tier) => tier[version]?.amount ?? null)
    .filter((amount): amount is string => amount !== null)
    .map(decimalValue)
    .filter((amount): amount is Decimal => amount !== null);
  if (amounts.length === 0) return '待人工确认';
  const minimum = Decimal.min(...amounts);
  const maximum = Decimal.max(...amounts);
  const range =
    minimum.eq(maximum)
      ? `¥${decimalLabel(minimum, 4)}`
      : `¥${decimalLabel(minimum, 4)}–¥${decimalLabel(maximum, 4)}`;
  return `${group.tierCount.toLocaleString('zh-CN')} 档 · ${range}`;
}

function tierCompactAmountLabel(
  rule: CustomerPriceRuleBusinessDto | null,
): string {
  if (rule?.amount === null || rule === null) return '待人工确认';
  const suffix =
    rule.calculationType === CustomerPriceCalculationType.FIXED_AMOUNT
      ? ' / 批'
      : rule.calculationType === CustomerPriceCalculationType.PER_PIECE
        ? ' / 个'
        : rule.calculationType === CustomerPriceCalculationType.PER_SHEET
          ? ' / 张'
          : rule.calculationType === CustomerPriceCalculationType.PER_10K
            ? ' / 万个'
            : rule.calculationType === CustomerPriceCalculationType.PER_ITEM
              ? ' / 款'
              : '';
  return `¥${money(rule.amount)}${suffix}`;
}

function workspaceGroupItem(
  group: CustomerPriceRuleWorkspaceGroupDto,
  href: string,
): ExternalSalesChargeWorkspaceItem {
  const representative = groupRepresentative(group);
  const singleTier = group.tiers[0];
  if (group.tierCount === 1 && singleTier) {
    return {
      ...workspaceItem(singleTier, href),
      id: group.id,
      name: productGroupRowName(group),
      subjectLabel: groupSubjectLabel(group),
    };
  }
  const changedTierCount = group.tiers.filter((tier) => tier.changed).length;
  return {
    id: group.id,
    name: productGroupRowName(group),
    categoryKey: group.category.id,
    categoryLabel: group.category.name,
    subjectLabel: groupSubjectLabel(group),
    quantityLabel: groupQuantityLabel(group),
    calculationLabel: calculationLabel(representative),
    currentAmountLabel: groupAmountLabel(group, 'current'),
    draftAmountLabel: groupAmountLabel(group, 'draft'),
    priceTiers: group.tiers.map((tier) => {
      const rule = tier.draft ?? tier.current;
      return {
        quantityLabel:
          rule?.minQty === null || rule === null
            ? '数量未设置'
            : `${rule.minQty.toLocaleString('zh-CN')} 个`,
        currentAmountLabel: tierCompactAmountLabel(tier.current),
        draftAmountLabel: tierCompactAmountLabel(tier.draft),
        changed: tier.changed,
      };
    }),
    priceChangeLabel: group.changed
      ? `${changedTierCount.toLocaleString('zh-CN')} 个数量档已调整`
      : '价格未变',
    changeSummaryLabels: [],
    automation: group.automation === 'AUTOMATIC' ? 'AUTO' : 'MANUAL',
    status: group.activeTierCount > 0 ? 'ACTIVE' : 'INACTIVE',
    statusLabel:
      group.activeTierCount === group.tierCount
        ? '全部启用'
        : group.activeTierCount === 0
          ? '全部停用'
          : `${group.activeTierCount.toLocaleString('zh-CN')}/${group.tierCount.toLocaleString('zh-CN')} 档启用`,
    changed: group.changed,
    detailHref: href,
  };
}

function groupContainsItemId(
  group: CustomerPriceRuleWorkspaceGroupDto,
  itemId: string,
): boolean {
  return (
    group.id === itemId ||
    group.tiers.some(
      (tier) =>
        tier.id === itemId ||
        tier.current?.id === itemId ||
        tier.draft?.id === itemId,
    )
  );
}

function selectedGroupTier(
  group: CustomerPriceRuleWorkspaceGroupDto,
  requestedItemId: string,
) {
  return (
    group.tiers.find(
      (tier) =>
        tier.id === requestedItemId ||
        tier.current?.id === requestedItemId ||
        tier.draft?.id === requestedItemId,
    ) ?? group.tiers[0]
  );
}

function isEditableExactBaseProductGroup(
  group: CustomerPriceRuleWorkspaceGroupDto,
): boolean {
  return (
    group.kind === CustomerPriceRuleKind.BASE &&
    group.product !== null &&
    group.tierCount > 1 &&
    group.calculationType !== null &&
    group.tiers.every((tier) => {
      const draft = tier.draft;
      return (
        draft !== null &&
        draft.amount !== null &&
        tier.expectedUpdatedAt !== null &&
        Number.isSafeInteger(draft.minQty) &&
        Number(draft.minQty) > 0 &&
        draft.minQty === draft.maxQty
      );
    })
  );
}

type ChargeWorkspacePromise = ReturnType<
  typeof getCustomerPriceRuleGroupWorkspacePage
>;
type ChargeWorkspace = Awaited<ChargeWorkspacePromise>;
type ChargeWorkspaceDetailPromise = ReturnType<
  typeof getCustomerPriceRuleGroupWorkspaceDetail
>;
type DraftRuleEditorPromise = ReturnType<
  typeof getCustomerPriceBookDraftRuleEditor
>;

type ChargeWorkspaceContext = {
  purpose: CustomerPriceBookPurpose;
  purposeValue: 'processing' | 'logistics';
  q: string;
  categoryId: string;
  productId: string;
  province: string | null;
  kind: CustomerPriceRuleKind | undefined;
  calculationType: CustomerPriceCalculationType | undefined;
  automation: 'AUTOMATIC' | 'MANUAL' | undefined;
  active: 'ACTIVE' | 'INACTIVE' | undefined;
  quantity: number | undefined;
  changedRequested: true | undefined;
  requestedItemId: string;
  createDraftOpen: boolean;
};

export default async function CustomerPricingWorkspacePage({
  searchParams,
}: PageProps) {
  await requirePermission('dict:price:manage');
  const sp = await searchParams;
  const purpose = purposeFromParam(firstSearchParam(sp.purpose));
  const purposeValue = purposeParam(purpose);
  const q = firstSearchParam(sp.q).trim().slice(0, 120);
  const categoryId = safeOpaqueId(firstSearchParam(sp.category));
  const subjectParam = firstSearchParam(sp.subject).trim();
  const productId =
    purpose === CustomerPriceBookPurpose.PROCESSING
      ? safeOpaqueId(subjectParam)
      : '';
  const province =
    purpose === CustomerPriceBookPurpose.LOGISTICS
      ? normalizeZtoProvince(subjectParam)
      : null;
  const kind = enumValue(
    firstSearchParam(sp.kind),
    Object.values(CustomerPriceRuleKind),
  );
  const calculationType = enumValue(
    firstSearchParam(sp.calculation),
    Object.values(CustomerPriceCalculationType),
  );
  const automationParam = firstSearchParam(sp.automation);
  const automation =
    automationParam === 'AUTO'
      ? 'AUTOMATIC'
      : automationParam === 'MANUAL'
        ? 'MANUAL'
        : undefined;
  const statusParam = firstSearchParam(sp.status);
  const active =
    statusParam === 'ACTIVE' || statusParam === 'INACTIVE'
      ? statusParam
      : undefined;
  const quantityRaw = firstSearchParam(sp.quantity).trim();
  const parsedQuantity = Number.parseInt(quantityRaw, 10);
  const quantity =
    Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0
      ? Math.min(parsedQuantity, 9_999_999)
      : undefined;
  const changedRequested =
    firstSearchParam(sp.changed) === '1' ? true : undefined;
  const requestedPage = parsePositiveInt(sp.page, {
    defaultValue: 1,
    max: 100_000,
  });
  const requestedItemId = safeOpaqueId(firstSearchParam(sp.item));
  const context: ChargeWorkspaceContext = {
    purpose,
    purposeValue,
    q,
    categoryId,
    productId,
    province,
    kind,
    calculationType,
    automation,
    active,
    quantity,
    changedRequested,
    requestedItemId,
    createDraftOpen: firstSearchParam(sp.start) === '1',
  };

  // 权限校验通过后只启动一次；页头动作与工作台共享同一 Promise。
  const workspacePromise = getCustomerPriceRuleGroupWorkspacePage({
    purpose,
    ...(q ? { q } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(productId ? { productId } : {}),
    ...(province ? { province } : {}),
    ...(kind ? { kind } : {}),
    ...(calculationType ? { calculationType } : {}),
    ...(automation ? { automation } : {}),
    ...(active ? { active } : {}),
    ...(changedRequested ? { changed: changedRequested } : {}),
    ...(quantity ? { quantity } : {}),
    page: requestedPage,
    pageSize: 25,
  });

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="客户计价规则"
        subtitle={`${
          purpose === CustomerPriceBookPurpose.LOGISTICS
            ? '快递费、打包耗材'
            : '加工费'
        }与调价。`}
        actions={
          <ErrorBoundary
            scope="field"
            title="版本状态暂时无法加载"
            description="可直接进入发布中心查看。"
            action={<PublishCenterLink purpose={purpose} />}
          >
            <Suspense fallback={<PublishCenterLink purpose={purpose} />}>
              <WorkspacePublishCenterLink
                purpose={purpose}
                workspacePromise={workspacePromise}
              />
            </Suspense>
          </ErrorBoundary>
        }
      />

      <ErrorBoundary
        scope="section"
        title="收费项目工作台暂时无法加载"
        description="页头与发布中心入口仍可使用；请重试工作台区域。"
      >
        <Suspense fallback={<ChargeWorkspaceSkeleton />}>
          <ExternalSalesChargeItemsContent
            context={context}
            workspacePromise={workspacePromise}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

function PublishCenterLink({
  purpose,
  scheduled = false,
}: {
  purpose: CustomerPriceBookPurpose;
  scheduled?: boolean;
}) {
  return (
    <Link
      href={
        scheduled
          ? `${RULE_CENTER_HREFS.priceVersions}#price-book-history-${purpose}`
          : RULE_CENTER_HREFS.priceVersions
      }
      prefetch={false}
      className={buttonVariants({ variant: 'outline' })}
    >
      {scheduled ? '查看计划生效版本' : '发布中心'}
    </Link>
  );
}

async function WorkspacePublishCenterLink({
  purpose,
  workspacePromise,
}: {
  purpose: CustomerPriceBookPurpose;
  workspacePromise: ChargeWorkspacePromise;
}) {
  const workspace = await workspacePromise;
  return (
    <PublishCenterLink
      purpose={purpose}
      scheduled={Boolean(workspace.scheduledBook)}
    />
  );
}

function ChargeWorkspaceSkeleton() {
  return (
    <div
      className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.8fr)]"
      aria-busy="true"
      aria-live="polite"
    >
      <ContentSkeleton
        variant="table"
        rows={6}
        label="正在加载收费项目工作台"
      />
      <aside className="hidden min-w-0 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm xl:block">
        选择一个收费项目
      </aside>
    </div>
  );
}

async function ExternalSalesChargeItemsContent({
  context,
  workspacePromise,
}: {
  context: ChargeWorkspaceContext;
  workspacePromise: ChargeWorkspacePromise;
}) {
  const workspace = await workspacePromise;
  const selectedWorkspaceGroup = context.requestedItemId
    ? workspace.groups.find((group) =>
        groupContainsItemId(group, context.requestedItemId),
      )
    : undefined;

  if (!context.requestedItemId || selectedWorkspaceGroup) {
    return renderWorkspaceWithSelectedGroup({
      workspace,
      context,
      selectedGroup: selectedWorkspaceGroup,
    });
  }

  const preservedWorkspace = (
    <ExternalSalesChargeWorkspaceView
      workspace={workspace}
      context={context}
    />
  );
  const detailPromise = getCustomerPriceRuleGroupWorkspaceDetail({
    purpose: context.purpose,
    groupId: context.requestedItemId,
  });

  return (
    <PriceDataBoundary
      title="收费项目详情暂时无法加载"
      description="列表、筛选和调价状态仍可使用；请重试详情区域。"
      preservedContent={preservedWorkspace}
    >
      <Suspense fallback={preservedWorkspace}>
        <DetachedChargeWorkspace
          workspace={workspace}
          context={context}
          detailPromise={detailPromise}
        />
      </Suspense>
    </PriceDataBoundary>
  );
}

async function DetachedChargeWorkspace({
  workspace,
  context,
  detailPromise,
}: {
  workspace: ChargeWorkspace;
  context: ChargeWorkspaceContext;
  detailPromise: ChargeWorkspaceDetailPromise;
}) {
  const detail = await detailPromise;
  return renderWorkspaceWithSelectedGroup({
    workspace,
    context,
    selectedGroup: detail?.group,
  });
}

function renderWorkspaceWithSelectedGroup({
  workspace,
  context,
  selectedGroup,
}: {
  workspace: ChargeWorkspace;
  context: ChargeWorkspaceContext;
  selectedGroup?: CustomerPriceRuleWorkspaceGroupDto;
}): React.ReactNode {
  const preservedWorkspace = (
    <ExternalSalesChargeWorkspaceView
      workspace={workspace}
      context={context}
      selectedGroup={selectedGroup}
    />
  );

  if (!selectedGroup || !workspace.draft) return preservedWorkspace;

  const selectedTier = selectedGroupTier(
    selectedGroup,
    context.requestedItemId,
  );
  if (isEditableExactBaseProductGroup(selectedGroup)) {
    return (
      <ExternalSalesChargeWorkspaceView
        workspace={workspace}
        context={context}
        selectedGroup={selectedGroup}
        selectedEditor={
          <ErrorBoundary
            scope="field"
            title="价格阶梯编辑器暂时无法加载"
            description="收费项目详情仍可查看；重试前不会保存任何更改。"
          >
            <ExternalSalesPriceTierGroupEditorContent
              workspace={workspace}
              context={context}
              selectedGroup={selectedGroup}
            />
          </ErrorBoundary>
        }
      />
    );
  }

  const selectedDraftRuleId = selectedTier?.draft?.id;
  if (!selectedDraftRuleId) return preservedWorkspace;

  const editorPromise = getCustomerPriceBookDraftRuleEditor(
    workspace.draft.id,
    selectedDraftRuleId,
  );
  const editorLoadingWorkspace = (
    <ExternalSalesChargeWorkspaceView
      workspace={workspace}
      context={context}
      selectedGroup={selectedGroup}
      selectedEditor={
        <ContentSkeleton
          variant="form"
          rows={5}
          label="正在加载收费项目编辑器"
        />
      }
    />
  );
  const editorUnavailableWorkspace = (
    <ExternalSalesChargeWorkspaceView
      workspace={workspace}
      context={context}
      selectedGroup={selectedGroup}
      selectedEditor={
        <div className="min-w-0 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
          编辑器暂不可用；当前价格与变更摘要仅供查看。
        </div>
      }
    />
  );

  return (
    <PriceDataBoundary
      title="收费项目编辑器暂时无法加载"
      description="列表与当前价格仍可查看；重试前不会保存任何更改。"
      preservedContent={editorUnavailableWorkspace}
    >
      <Suspense fallback={editorLoadingWorkspace}>
        <DraftRuleEditorWorkspace
          workspace={workspace}
          context={context}
          selectedGroup={selectedGroup}
          editorPromise={editorPromise}
        />
      </Suspense>
    </PriceDataBoundary>
  );
}

function ExternalSalesPriceTierGroupEditorContent({
  workspace,
  context,
  selectedGroup,
}: {
  workspace: ChargeWorkspace;
  context: ChargeWorkspaceContext;
  selectedGroup: CustomerPriceRuleWorkspaceGroupDto;
}) {
  const draft = workspace.draft;
  if (!draft) return null;
  const editorSuccessHref = selectedChargeHref(
    context.purposeValue,
    selectedGroup.id,
  );

  return (
    <ExternalSalesPriceTierGroupEditor
      key={`${selectedGroup.id}:${selectedGroup.tiers
        .map((tier) => tier.expectedUpdatedAt)
        .join(':')}`}
      productTitle={
        workspaceBusinessText(
          selectedGroup.product?.name ?? selectedGroup.name,
        ) ?? '未命名产品'
      }
      paperLabel={
        workspaceBusinessText(selectedGroup.product?.paperType) ?? '未设置纸张'
      }
      sizeLabel={
        workspaceBusinessText(selectedGroup.product?.specification) ??
        '未设置规格'
      }
      calculationType={
        selectedGroup.calculationType as CustomerPriceCalculationType
      }
      priceBookId={draft.id}
      anchorRuleId={selectedGroup.tiers[0]?.draft?.id ?? ''}
      tiers={selectedGroup.tiers.map((tier) => {
        const tierDraft = tier.draft;
        if (
          !tierDraft ||
          tierDraft.amount === null ||
          tierDraft.minQty === null ||
          tier.expectedUpdatedAt === null
        ) {
          throw new Error('价格阶梯缺少可编辑数据');
        }
        return {
          ruleId: tierDraft.id,
          quantity: tierDraft.minQty,
          currentAmount: tier.current?.amount ?? null,
          draftAmount: tierDraft.amount,
          expectedUpdatedAt: tier.expectedUpdatedAt,
          isActive: tierDraft.isActive,
          changed: tier.changed,
        };
      })}
      saveAction={updateCustomerPriceRuleDraftGroupAction}
      successHref={editorSuccessHref}
    />
  );
}

async function DraftRuleEditorWorkspace({
  workspace,
  context,
  selectedGroup,
  editorPromise,
}: {
  workspace: ChargeWorkspace;
  context: ChargeWorkspaceContext;
  selectedGroup: CustomerPriceRuleWorkspaceGroupDto;
  editorPromise: DraftRuleEditorPromise;
}) {
  const editor = await editorPromise;
  if (!editor) {
    return (
      <ExternalSalesChargeWorkspaceView
        workspace={workspace}
        context={context}
        selectedGroup={selectedGroup}
      />
    );
  }

  return (
    <ExternalSalesChargeWorkspaceView
      workspace={workspace}
      context={context}
      selectedGroup={selectedGroup}
      selectedEditor={
        <CustomerPriceBookDraftRuleForm
          key={`${editor.rule.id}:${editor.rule.updatedAt}`}
          context={{
            ...editor.context,
            products: editor.context.products.map((product) => ({
              ...product,
              name: workspaceBusinessText(product.name) ?? '未命名产品',
            })),
          }}
          rule={editor.rule}
          successHref={selectedChargeHref(
            context.purposeValue,
            selectedGroup.id,
          )}
        />
      }
    />
  );
}

function selectedChargeHref(
  purposeValue: 'processing' | 'logistics',
  selectedGroupId: string,
): string {
  return `${WORKSPACE_PATH}?purpose=${purposeValue}&item=${encodeURIComponent(
    selectedGroupId,
  )}#selected-charge-detail`;
}

function ExternalSalesChargeWorkspaceView({
  workspace,
  context,
  selectedGroup,
  selectedEditor,
}: {
  workspace: ChargeWorkspace;
  context: ChargeWorkspaceContext;
  selectedGroup?: CustomerPriceRuleWorkspaceGroupDto;
  selectedEditor?: React.ReactNode;
}) {
  const {
    purpose,
    purposeValue,
    q,
    categoryId,
    productId,
    province,
    kind,
    calculationType,
    automation,
    active,
    quantity,
    changedRequested,
    createDraftOpen,
  } = context;
  const changed =
    changedRequested && workspace.filters.changedAvailable ? true : undefined;
  const queryParams = {
    purpose: purposeValue,
    q: q || undefined,
    category: categoryId || undefined,
    subject: productId || province || undefined,
    kind,
    calculation: calculationType,
    quantity,
    automation:
      automation === 'AUTOMATIC'
        ? 'AUTO'
        : automation === 'MANUAL'
          ? 'MANUAL'
          : undefined,
    status: active,
    changed: changed ? 1 : undefined,
    page: workspace.page,
  };
  const selectedGroupId = selectedGroup?.id ?? '';
  const itemRows = workspace.groups.map((group) =>
    workspaceGroupItem(
      group,
      `${buildTableHref(WORKSPACE_PATH, queryParams, {
        item: group.id,
      })}#selected-charge-detail`,
    ),
  );
  const selectedItem = selectedGroup
    ? workspaceGroupItem(
        selectedGroup,
        selectedChargeHref(purposeValue, selectedGroupId),
      )
    : undefined;
  const canCreateDraft =
    workspace.draft === null &&
    workspace.scheduledBook === null &&
    workspace.draftCreation.allowed;
  const createReturnHref = buildTableHref(WORKSPACE_PATH, queryParams, {
    item: selectedGroupId || null,
    start: null,
  });
  const createDraftEditor = !canCreateDraft ? undefined : (
    <CreateCustomerPriceBookDraftForm
      purpose={purpose}
      returnHref={createReturnHref}
    />
  );
  const createDraftBlockedReason = workspace.scheduledBook
    ? `第 ${workspace.scheduledBook.version} 版已安排在 ${formatShanghaiDateTime(
        workspace.scheduledBook.effectiveFrom,
      )} 生效；生效前不能再发起新调价。`
    : workspace.draftCreation.blockedReason;

  return (
    <ExternalSalesChargeWorkspace
      purpose={purposeValue}
      workspaceStatus={
        workspace.scheduledBook
          ? 'SCHEDULED'
          : workspace.currentBook
            ? 'CURRENT'
            : 'UNAVAILABLE'
      }
      purposeHrefs={{
        processing: customerPricingHref('processing'),
        logistics: customerPricingHref('logistics'),
      }}
      searchAction={WORKSPACE_PATH}
      hiddenSearchFields={{ purpose: purposeValue }}
      filters={{
        query: q,
        category: categoryId,
        subject: productId || province || '',
        kind: kind ?? '',
        calculation: calculationType ?? '',
        quantity: quantity ? String(quantity) : '',
        automation:
          automation === 'AUTOMATIC'
            ? 'AUTO'
            : automation === 'MANUAL'
              ? 'MANUAL'
              : '',
        status: active ?? '',
        changedOnly: changed === true,
      }}
      filterOptions={{
        categories: workspace.filters.categories.map((category) => ({
          value: category.id,
          label: category.name,
        })),
        subjects:
          purpose === CustomerPriceBookPurpose.LOGISTICS
            ? workspace.filters.provinces.map((entry) => ({
                value: entry.value,
                label: entry.name,
              }))
            : workspace.filters.products.map((product) => ({
                value: product.id,
                label: workspaceBusinessText(product.name) ?? '未命名产品',
              })),
        calculations: workspace.filters.calculationTypes.map((value) => ({
          value,
          label: CALCULATION_LABELS[value],
        })),
      }}
      clearFiltersHref={`${WORKSPACE_PATH}?purpose=${purposeValue}`}
      items={itemRows}
      selectedItem={selectedItem}
      selectedItemId={selectedGroupId || undefined}
      selectedEditor={selectedEditor}
      draft={
        workspace.draft
          ? {
              version: workspace.draft.version,
              changeReason: workspace.draft.changeReason,
              changedCount: workspace.draft.changedCount,
              lastSavedLabel: formatShanghaiDateTime(workspace.draft.updatedAt),
              compareHref: buildTableHref(WORKSPACE_PATH, queryParams, {
                changed: 1,
                page: 1,
                item: null,
              }),
              publishHref: `${RULE_CENTER_HREFS.priceVersions}?draft=${encodeURIComponent(
                workspace.draft.id,
              )}`,
            }
          : null
      }
      createDraftHref={
        canCreateDraft
          ? buildTableHref(WORKSPACE_PATH, queryParams, {
              item: selectedGroupId || null,
              start: 1,
            })
          : undefined
      }
      createDraftEditor={createDraftEditor}
      createDraftOpen={createDraftOpen}
      createDraftBlockedReason={createDraftBlockedReason}
      changedFilterAvailable={workspace.filters.changedAvailable}
      pagination={{
        page: workspace.page,
        pageCount: workspace.pageCount,
        total: workspace.total,
        previousHref:
          workspace.page > 1
            ? buildTableHref(WORKSPACE_PATH, queryParams, {
                page: workspace.page - 1,
                item: null,
              })
            : null,
        nextHref:
          workspace.page < workspace.pageCount
            ? buildTableHref(WORKSPACE_PATH, queryParams, {
                page: workspace.page + 1,
                item: null,
              })
            : null,
      }}
    />
  );
}
