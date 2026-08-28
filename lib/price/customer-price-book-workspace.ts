import 'server-only';

import {
  Prisma,
  type CustomerPriceCalculationType,
  type CustomerPriceRuleKind,
} from '../../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType as CustomerPriceCalculationTypeValue,
  CustomerPriceRuleKind as CustomerPriceRuleKindValue,
  OrderSettlementType,
} from '../../generated/prisma/enums';
import { db } from '../db';
import {
  normalizeZtoProvince,
  ZTO_PROVINCE_OPTIONS,
} from './external-order-charges';
import { acquirePriceRuleSnapshotReadLock } from './rule-snapshot-lock';

const EXTERNAL_SETTLEMENT = OrderSettlementType.EXTERNAL_SALES;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export type CustomerPriceRuleAutomationFilter = 'AUTOMATIC' | 'MANUAL';
export type CustomerPriceRuleActiveFilter = 'ACTIVE' | 'INACTIVE';

export type CustomerPriceRuleWorkspaceQuery = {
  purpose: CustomerPriceBookPurpose;
  q?: string;
  categoryId?: string;
  productId?: string;
  province?: string;
  kind?: CustomerPriceRuleKind;
  calculationType?: CustomerPriceCalculationType;
  automation?: CustomerPriceRuleAutomationFilter;
  active?: CustomerPriceRuleActiveFilter;
  changed?: boolean;
  quantity?: number;
  page?: number;
  pageSize?: number;
};

export type CustomerPriceRuleBusinessDto = {
  id: string;
  name: string;
  category: { id: string; name: string };
  product: { id: string; name: string } | null;
  kind: CustomerPriceRuleKind;
  calculationType: CustomerPriceCalculationType | null;
  /** Safe business projection of triggerCondition.unitsPerSheet. */
  unitsPerSheet: number | null;
  amount: string | null;
  includedUnits: string | null;
  incrementUnits: string | null;
  incrementAmount: string | null;
  minQty: number | null;
  maxQty: number | null;
  scopeLabel: string | null;
  automation: CustomerPriceRuleAutomationFilter;
  blocksAutomaticQuote: boolean;
  isActive: boolean;
};

export type CustomerPriceRuleWorkspaceItemDto = {
  id: string;
  current: CustomerPriceRuleBusinessDto | null;
  draft: CustomerPriceRuleBusinessDto | null;
  changed: boolean;
};

/**
 * A single persisted rule inside a business-facing price group. Rules remain
 * independent records; grouping only removes repeated labels from the admin UI.
 */
export type CustomerPriceRuleGroupTierDto = {
  id: string;
  current: CustomerPriceRuleBusinessDto | null;
  draft: CustomerPriceRuleBusinessDto | null;
  changed: boolean;
  expectedUpdatedAt: string | null;
};

export type CustomerPriceRuleWorkspaceGroupDto = {
  /** The first tier rule id is an opaque, safe handle for opening this group. */
  id: string;
  name: string;
  category: { id: string; name: string };
  product: {
    id: string;
    name: string;
    specification: string | null;
    paperType: string | null;
  } | null;
  kind: CustomerPriceRuleKind;
  calculationType: CustomerPriceCalculationType | null;
  unitsPerSheet: number | null;
  scopeLabel: string | null;
  automation: CustomerPriceRuleAutomationFilter;
  blocksAutomaticQuote: boolean;
  tierCount: number;
  activeTierCount: number;
  changed: boolean;
  tiers: CustomerPriceRuleGroupTierDto[];
};

type CustomerPriceRuleTechnicalMeta = {
  code: string;
  exclusiveGroup: string | null;
  productCode: string | null;
  productSpecification: string | null;
  productPaperType: string | null;
};

const CUSTOMER_PRICE_RULE_TECHNICAL_META = new WeakMap<
  CustomerPriceRuleBusinessDto,
  CustomerPriceRuleTechnicalMeta
>();

/** Server-only metadata used by the dedicated business projections. */
export function getCustomerPriceRuleTechnicalMeta(
  rule: CustomerPriceRuleBusinessDto,
): CustomerPriceRuleTechnicalMeta | null {
  return CUSTOMER_PRICE_RULE_TECHNICAL_META.get(rule) ?? null;
}

export type CustomerPriceBookWorkspaceSummaryDto = {
  id: string;
  name: string;
  purpose: CustomerPriceBookPurpose;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type CustomerPriceBookWorkspaceDraftSummaryDto = {
  id: string;
  name: string;
  purpose: CustomerPriceBookPurpose;
  version: number;
  basedOnVersion: number;
  changeReason: string;
  changedCount: number;
  updatedAt: string;
};

export type CustomerPriceRuleWorkspaceFiltersDto = {
  categories: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  provinces: Array<{ value: string; name: string }>;
  kinds: CustomerPriceRuleKind[];
  calculationTypes: CustomerPriceCalculationType[];
  automations: CustomerPriceRuleAutomationFilter[];
  activeStates: CustomerPriceRuleActiveFilter[];
  changedAvailable: boolean;
};

export type CustomerPriceRuleWorkspaceDto = {
  purpose: CustomerPriceBookPurpose;
  currentBook: CustomerPriceBookWorkspaceSummaryDto | null;
  scheduledBook: CustomerPriceBookWorkspaceSummaryDto | null;
  draft: CustomerPriceBookWorkspaceDraftSummaryDto | null;
  draftCreation: {
    allowed: boolean;
    blockedReason: string | null;
  };
  items: CustomerPriceRuleWorkspaceItemDto[];
  filters: CustomerPriceRuleWorkspaceFiltersDto;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type CustomerPriceRuleGroupWorkspacePageDto = Omit<
  CustomerPriceRuleWorkspaceDto,
  'items'
> & {
  groups: CustomerPriceRuleWorkspaceGroupDto[];
};

export type CustomerPriceRuleWorkspaceDetailDto = {
  purpose: CustomerPriceBookPurpose;
  priceBookId: string;
  editable: boolean;
  expectedUpdatedAt: string | null;
  current: CustomerPriceRuleBusinessDto | null;
  draft: CustomerPriceRuleBusinessDto | null;
  changed: boolean;
  categories: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
};

export type CustomerPriceRuleGroupWorkspaceDetailDto = {
  purpose: CustomerPriceBookPurpose;
  priceBookId: string;
  editable: boolean;
  group: CustomerPriceRuleWorkspaceGroupDto;
  categories: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
};

export class CustomerPriceBookWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerPriceBookWorkspaceError';
  }
}

type DraftWorkspaceMetadata = {
  basedOnId: string;
  basedOnVersion: number;
  changeReason: string;
};

const BOOK_SELECT = {
  id: true,
  name: true,
  settlementType: true,
  purpose: true,
  version: true,
  effectiveFrom: true,
  effectiveTo: true,
  isActive: true,
  notes: true,
  updatedAt: true,
} as const;

const INTERNAL_RULE_SELECT = {
  id: true,
  priceBookId: true,
  code: true,
  name: true,
  categoryId: true,
  productId: true,
  kind: true,
  calculationType: true,
  amount: true,
  includedUnits: true,
  incrementUnits: true,
  incrementAmount: true,
  minQty: true,
  maxQty: true,
  triggerCondition: true,
  exclusiveGroup: true,
  priority: true,
  sourceSheet: true,
  sourceRange: true,
  sourceName: true,
  sourceSha256: true,
  note: true,
  blocksAutomaticQuote: true,
  isActive: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      specification: true,
      paperType: true,
    },
  },
} as const;

const GROUP_RULE_ORDER_BY = [
  { category: { sortOrder: 'asc' } },
  { product: { name: 'asc' } },
  { name: 'asc' },
  { minQty: 'asc' },
  { maxQty: 'asc' },
  { priority: 'desc' },
  { id: 'asc' },
] satisfies Prisma.CustomerPriceRuleOrderByWithRelationInput[];

type BookRow = Prisma.CustomerPriceBookGetPayload<{
  select: typeof BOOK_SELECT;
}>;

type InternalRuleRow = Prisma.CustomerPriceRuleGetPayload<{
  select: typeof INTERNAL_RULE_SELECT;
}>;

type WorkspaceBooks = {
  current: BookRow | null;
  scheduled: BookRow | null;
  draft: BookRow | null;
  draftMetadata: DraftWorkspaceMetadata | null;
  baseline: BookRow | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function draftWorkspaceMetadata(notes: unknown): DraftWorkspaceMetadata | null {
  if (!isRecord(notes) || !isRecord(notes.workflow)) return null;
  const workflow = notes.workflow;
  if (
    workflow.status !== 'DRAFT' ||
    !isRecord(workflow.basedOn) ||
    typeof workflow.basedOn.id !== 'string' ||
    !Number.isSafeInteger(workflow.basedOn.version) ||
    typeof workflow.changeReason !== 'string'
  ) {
    return null;
  }
  return {
    basedOnId: workflow.basedOn.id,
    basedOnVersion: Number(workflow.basedOn.version),
    changeReason: workflow.changeReason,
  };
}

function currentBookAt(book: BookRow, now: Date): boolean {
  return (
    book.isActive &&
    book.effectiveFrom <= now &&
    (book.effectiveTo === null || book.effectiveTo > now)
  );
}

async function resolveWorkspaceBooks(
  tx: Prisma.TransactionClient,
  purpose: CustomerPriceBookPurpose,
  now: Date,
): Promise<WorkspaceBooks> {
  const books = await tx.customerPriceBook.findMany({
    where: {
      settlementType: EXTERNAL_SETTLEMENT,
      purpose,
      OR: [
        {
          isActive: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        { isActive: true, effectiveFrom: { gt: now } },
        { isActive: false },
      ],
    },
    select: BOOK_SELECT,
    orderBy: [{ version: 'desc' }],
  });

  const currentBooks = books.filter((book) => currentBookAt(book, now));
  if (currentBooks.length > 1) {
    throw new CustomerPriceBookWorkspaceError(
      '同一用途同时存在多个生效价目版本，请先修正有效期',
    );
  }

  const drafts = books
    .filter((book) => !book.isActive)
    .map((book) => ({ book, metadata: draftWorkspaceMetadata(book.notes) }))
    .filter(
      (
        candidate,
      ): candidate is { book: BookRow; metadata: DraftWorkspaceMetadata } =>
        candidate.metadata !== null,
    );
  if (drafts.length > 1) {
    throw new CustomerPriceBookWorkspaceError(
      '同一用途同时存在多个调价草稿，请先保留一份',
    );
  }

  const current = currentBooks[0] ?? null;
  const scheduledBooks = books.filter(
    (book) => book.isActive && book.effectiveFrom > now,
  );
  if (scheduledBooks.length > 1) {
    throw new CustomerPriceBookWorkspaceError(
      '同一用途同时存在多个计划生效版本，请先修正版本时间',
    );
  }
  const scheduled = scheduledBooks[0] ?? null;
  const draft = drafts[0]?.book ?? null;
  const metadata = drafts[0]?.metadata ?? null;
  let baseline: BookRow | null = null;
  if (metadata) {
    baseline =
      books.find((book) => book.id === metadata.basedOnId) ??
      (await tx.customerPriceBook.findUnique({
        where: { id: metadata.basedOnId },
        select: BOOK_SELECT,
      }));
    if (
      !baseline ||
      baseline.settlementType !== EXTERNAL_SETTLEMENT ||
      baseline.purpose !== purpose
    ) {
      throw new CustomerPriceBookWorkspaceError(
        '调价草稿的基线版本不存在或用途不匹配',
      );
    }
  }

  return { current, scheduled, draft, draftMetadata: metadata, baseline };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function normalizeQuery(query: CustomerPriceRuleWorkspaceQuery): {
  q: string;
  page: number;
  pageSize: number;
  quantity: number | null;
  province: string | null;
} {
  const quantity =
    Number.isSafeInteger(query.quantity) && Number(query.quantity) > 0
      ? Number(query.quantity)
      : null;
  return {
    q: query.q?.trim().slice(0, 120) ?? '',
    page: positiveInteger(query.page, 1),
    pageSize: Math.min(positiveInteger(query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE),
    quantity,
    province: normalizeZtoProvince(query.province ?? null),
  };
}

function automaticRuleWhere(
  automation: CustomerPriceRuleAutomationFilter,
): Prisma.CustomerPriceRuleWhereInput {
  if (automation === 'MANUAL') {
    return {
      OR: [
        { kind: CustomerPriceRuleKindValue.REFERENCE },
        { blocksAutomaticQuote: true },
      ],
    };
  }
  return {
    kind: { not: CustomerPriceRuleKindValue.REFERENCE },
    blocksAutomaticQuote: false,
  };
}

function buildRuleWhere(
  query: CustomerPriceRuleWorkspaceQuery,
  normalized: ReturnType<typeof normalizeQuery>,
  priceBookId: string,
  changedCodes: Set<string> | null,
): Prisma.CustomerPriceRuleWhereInput {
  const AND: Prisma.CustomerPriceRuleWhereInput[] = [];
  if (normalized.q) {
    const province = normalizeZtoProvince(normalized.q);
    AND.push({
      OR: [
        { name: { contains: normalized.q, mode: 'insensitive' } },
        {
          category: {
            name: { contains: normalized.q, mode: 'insensitive' },
          },
        },
        {
          product: {
            name: { contains: normalized.q, mode: 'insensitive' },
          },
        },
        ...(province
          ? [
              {
                triggerCondition: {
                  path: ['provinces'],
                  array_contains: [province],
                },
              },
            ]
          : []),
      ],
    });
  }
  if (normalized.province) {
    AND.push({
      triggerCondition: {
        path: ['provinces'],
        array_contains: [normalized.province],
      },
    });
  }
  if (normalized.quantity !== null) {
    AND.push(
      { OR: [{ minQty: null }, { minQty: { lte: normalized.quantity } }] },
      { OR: [{ maxQty: null }, { maxQty: { gte: normalized.quantity } }] },
    );
  }
  if (query.automation) AND.push(automaticRuleWhere(query.automation));
  if (query.changed !== undefined) {
    const codes = [...(changedCodes ?? new Set<string>())];
    AND.push(
      query.changed ? { code: { in: codes } } : { code: { notIn: codes } },
    );
  }

  return {
    priceBookId,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.calculationType
      ? { calculationType: query.calculationType }
      : {}),
    ...(query.active
      ? { isActive: query.active === 'ACTIVE' }
      : {}),
    ...(AND.length > 0 ? { AND } : {}),
  };
}

/** Trigger arrays are set-like matchers, so their input order is not semantic. */
function canonicalTriggerJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value
      .map(canonicalTriggerJson)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalTriggerJson(child)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return String(value);
}

function decimalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return new Prisma.Decimal(String(value)).toString();
}

function pricingSignature(rule: InternalRuleRow): string {
  return JSON.stringify({
    name: rule.name,
    categoryId: rule.categoryId,
    productId: rule.productId,
    kind: rule.kind,
    calculationType: rule.calculationType,
    amount: decimalText(rule.amount),
    includedUnits: decimalText(rule.includedUnits),
    incrementUnits: decimalText(rule.incrementUnits),
    incrementAmount: decimalText(rule.incrementAmount),
    minQty: rule.minQty,
    maxQty: rule.maxQty,
    triggerCondition: canonicalTriggerJson(rule.triggerCondition),
    exclusiveGroup: rule.exclusiveGroup,
    priority: rule.priority,
    note: rule.note,
    blocksAutomaticQuote: rule.blocksAutomaticQuote,
    isActive: rule.isActive,
  });
}

function changedRuleCodes(
  draftRules: InternalRuleRow[],
  baselineRules: InternalRuleRow[],
): Set<string> {
  const baselineByCode = new Map(
    baselineRules.map((rule) => [String(rule.code), rule]),
  );
  const changed = new Set<string>();
  for (const rule of draftRules) {
    const code = String(rule.code);
    const baseline = baselineByCode.get(code);
    if (!baseline || pricingSignature(rule) !== pricingSignature(baseline)) {
      changed.add(code);
    }
  }
  return changed;
}

function automationForRule(
  rule: Pick<InternalRuleRow, 'kind' | 'blocksAutomaticQuote'>,
): CustomerPriceRuleAutomationFilter {
  return rule.kind === CustomerPriceRuleKindValue.REFERENCE ||
    rule.blocksAutomaticQuote
    ? 'MANUAL'
    : 'AUTOMATIC';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];
}

function businessScopeLabel(triggerCondition: unknown): string | null {
  if (!isRecord(triggerCondition)) return null;
  const carrierCode =
    typeof triggerCondition.carrierCode === 'string'
      ? triggerCondition.carrierCode
      : null;
  const provinces = stringArray(triggerCondition.provinces);
  if (carrierCode || provinces.length > 0) {
    const carrier = carrierCode === 'ZTO' ? '中通' : '指定承运商';
    return provinces.length > 0
      ? `${carrier} · ${provinces.join('、')}`
      : `${carrier} · 全部地区`;
  }

  const scopes: string[] = [];
  const productCodes = stringArray(triggerCondition.productCodes);
  const craftCodes = stringArray(triggerCondition.craftCodes);
  const excludedCraftCodes = stringArray(triggerCondition.noneOfCraftCodes);
  const specifications = stringArray(triggerCondition.specifications);
  const paperTypes = stringArray(triggerCondition.paperTypes);
  const foilColors = stringArray(triggerCondition.foilColors);
  if (productCodes.length > 0) scopes.push(`${productCodes.length} 类指定产品`);
  if (craftCodes.length > 0) scopes.push(`${craftCodes.length} 种指定工艺`);
  if (excludedCraftCodes.length > 0) {
    scopes.push(`排除 ${excludedCraftCodes.length} 种工艺`);
  }
  if (specifications.length > 0) {
    scopes.push(`规格：${specifications.join('、')}`);
  }
  if (paperTypes.length > 0) scopes.push(`纸张：${paperTypes.join('、')}`);
  if (foilColors.length > 0) scopes.push(`烫金色：${foilColors.join('、')}`);
  if (Number.isSafeInteger(triggerCondition.foilColorCount)) {
    scopes.push(`${Number(triggerCondition.foilColorCount)} 色烫金`);
  } else if (
    Number.isSafeInteger(triggerCondition.minFoilColorCount) ||
    Number.isSafeInteger(triggerCondition.maxFoilColorCount)
  ) {
    const minimum = Number.isSafeInteger(triggerCondition.minFoilColorCount)
      ? Number(triggerCondition.minFoilColorCount)
      : 0;
    const maximum = Number.isSafeInteger(triggerCondition.maxFoilColorCount)
      ? Number(triggerCondition.maxFoilColorCount)
      : '不限';
    scopes.push(`${minimum}–${maximum} 色烫金`);
  }
  if (Number.isSafeInteger(triggerCondition.foilPassCount)) {
    scopes.push(
      `${Number(triggerCondition.foilPassCount)} 道烫金（正面＋背面）`,
    );
  } else if (
    Number.isSafeInteger(triggerCondition.minFoilPassCount) ||
    Number.isSafeInteger(triggerCondition.maxFoilPassCount)
  ) {
    const minimum = Number.isSafeInteger(triggerCondition.minFoilPassCount)
      ? Number(triggerCondition.minFoilPassCount)
      : 0;
    const maximum = Number.isSafeInteger(triggerCondition.maxFoilPassCount)
      ? Number(triggerCondition.maxFoilPassCount)
      : '不限';
    scopes.push(`${minimum}–${maximum} 道烫金（正面＋背面）`);
  }
  if (triggerCondition.perFoilPass === true) {
    scopes.push('按实际烫金道数乘算');
  }
  if (triggerCondition.isDoubleSided === true) scopes.push('双面');
  if (triggerCondition.isDoubleSided === false) scopes.push('单面');
  if (triggerCondition.isDoubleColor === true) scopes.push('双色');
  if (triggerCondition.isDoubleColor === false) scopes.push('单色');
  return scopes.length > 0 ? scopes.join(' · ') : null;
}

function businessUnitsPerSheet(triggerCondition: unknown): number | null {
  if (!isRecord(triggerCondition)) return null;
  const value = triggerCondition.unitsPerSheet;
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
}

function businessRule(rule: InternalRuleRow): CustomerPriceRuleBusinessDto {
  const business: CustomerPriceRuleBusinessDto = {
    id: rule.id,
    name: rule.name,
    category: { id: rule.category.id, name: rule.category.name },
    product: rule.product
      ? { id: rule.product.id, name: rule.product.name }
      : null,
    kind: rule.kind,
    calculationType: rule.calculationType,
    unitsPerSheet: businessUnitsPerSheet(rule.triggerCondition),
    amount: decimalText(rule.amount),
    includedUnits: decimalText(rule.includedUnits),
    incrementUnits: decimalText(rule.incrementUnits),
    incrementAmount: decimalText(rule.incrementAmount),
    minQty: rule.minQty,
    maxQty: rule.maxQty,
    scopeLabel: businessScopeLabel(rule.triggerCondition),
    automation: automationForRule(rule),
    blocksAutomaticQuote: rule.blocksAutomaticQuote,
    isActive: rule.isActive,
  };
  CUSTOMER_PRICE_RULE_TECHNICAL_META.set(business, {
    code: String(rule.code),
    exclusiveGroup: rule.exclusiveGroup,
    productCode: rule.product ? String(rule.product.code) : null,
    productSpecification: rule.product?.specification ?? null,
    productPaperType: rule.product?.paperType ?? null,
  });
  return business;
}

type InternalRuleGroup = {
  signature: string;
  rules: InternalRuleRow[];
};

/**
 * Only quantity/amount/status fields are intentionally absent. Every business
 * matcher and provenance gate must agree before two persisted rules can share
 * one visual price group.
 */
function ruleGroupSignature(rule: InternalRuleRow): string {
  const exactBaseProductAnchor =
    rule.kind === CustomerPriceRuleKindValue.BASE &&
    rule.productId !== null &&
    Number.isSafeInteger(rule.minQty) &&
    Number(rule.minQty) > 0 &&
    rule.minQty === rule.maxQty;
  return JSON.stringify({
    priceBookId: rule.priceBookId,
    // Only exact base-product anchors are safe to collapse into a ladder.
    // All range/add-on/reference rules retain a per-record discriminator.
    ...(exactBaseProductAnchor ? {} : { individualRuleId: rule.id }),
    categoryId: rule.categoryId,
    productId: rule.productId,
    kind: rule.kind,
    calculationType: rule.calculationType,
    includedUnits: decimalText(rule.includedUnits),
    incrementUnits: decimalText(rule.incrementUnits),
    incrementAmount: decimalText(rule.incrementAmount),
    triggerCondition: canonicalTriggerJson(rule.triggerCondition),
    exclusiveGroup: rule.exclusiveGroup,
    priority: rule.priority,
    blocksAutomaticQuote: rule.blocksAutomaticQuote,
    note: rule.note,
    sourceSheet: rule.sourceSheet,
    sourceName: rule.sourceName,
    sourceSha256: rule.sourceSha256,
  });
}

function compareNullableQuantity(
  left: number | null,
  right: number | null,
): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left - right;
}

function sortGroupTiers(rules: InternalRuleRow[]): InternalRuleRow[] {
  return [...rules].sort(
    (left, right) =>
      compareNullableQuantity(left.minQty, right.minQty) ||
      compareNullableQuantity(left.maxQty, right.maxQty) ||
      left.id.localeCompare(right.id),
  );
}

function groupInternalRules(rules: InternalRuleRow[]): InternalRuleGroup[] {
  const groups = new Map<string, InternalRuleRow[]>();
  for (const rule of rules) {
    const signature = ruleGroupSignature(rule);
    const existing = groups.get(signature);
    if (existing) existing.push(rule);
    else groups.set(signature, [rule]);
  }
  return [...groups].map(([signature, groupedRules]) => ({
    signature,
    rules: sortGroupTiers(groupedRules),
  }));
}

function groupMatchesAggregateFilters(
  group: InternalRuleGroup,
  query: Pick<CustomerPriceRuleWorkspaceQuery, 'active' | 'changed'>,
  changedCodes: Set<string> | null,
): boolean {
  if (query.active === 'ACTIVE' && !group.rules.some((rule) => rule.isActive)) {
    return false;
  }
  if (query.active === 'INACTIVE' && group.rules.some((rule) => rule.isActive)) {
    return false;
  }
  if (query.changed !== undefined) {
    const changed = group.rules.some((rule) =>
      changedCodes?.has(String(rule.code)),
    );
    if (changed !== query.changed) return false;
  }
  return true;
}

function workspaceGroup(
  group: InternalRuleGroup,
  hasDraft: boolean,
  currentByCode: Map<string, InternalRuleRow>,
  changedCodes: Set<string> | null,
): CustomerPriceRuleWorkspaceGroupDto {
  const head = group.rules[0];
  if (!head) {
    throw new CustomerPriceBookWorkspaceError('收费项分组不能为空');
  }
  const common = businessRule(head);
  const tiers = group.rules.map((rule) => {
    const code = String(rule.code);
    const current = hasDraft ? currentByCode.get(code) ?? null : rule;
    return {
      id: rule.id,
      current: current ? businessRule(current) : null,
      draft: hasDraft ? businessRule(rule) : null,
      changed: changedCodes?.has(code) ?? false,
      expectedUpdatedAt: hasDraft ? rule.updatedAt.toISOString() : null,
    };
  });
  return {
    id: hasDraft
      ? currentByCode.get(String(head.code))?.id ?? head.id
      : head.id,
    name: head.product?.name ?? common.name,
    category: common.category,
    product: head.product
      ? {
          id: head.product.id,
          name: head.product.name,
          specification: head.product.specification,
          paperType: head.product.paperType,
        }
      : null,
    kind: common.kind,
    calculationType: common.calculationType,
    unitsPerSheet: common.unitsPerSheet,
    scopeLabel: common.scopeLabel,
    automation: common.automation,
    blocksAutomaticQuote: common.blocksAutomaticQuote,
    tierCount: tiers.length,
    activeTierCount: group.rules.filter((rule) => rule.isActive).length,
    changed: tiers.some((tier) => tier.changed),
    tiers,
  };
}

function emptyFilters(): CustomerPriceRuleWorkspaceFiltersDto {
  return {
    categories: [],
    products: [],
    provinces: [],
    kinds: Object.values(CustomerPriceRuleKindValue),
    calculationTypes: Object.values(CustomerPriceCalculationTypeValue),
    automations: ['AUTOMATIC', 'MANUAL'],
    activeStates: ['ACTIVE', 'INACTIVE'],
    changedAvailable: false,
  };
}

function currentBookSummary(
  book: BookRow | null,
): CustomerPriceBookWorkspaceSummaryDto | null {
  return book
    ? {
        id: book.id,
        name: book.name,
        purpose: book.purpose,
        version: book.version,
        effectiveFrom: book.effectiveFrom.toISOString(),
        effectiveTo: book.effectiveTo?.toISOString() ?? null,
      }
    : null;
}

function draftSummary(
  book: BookRow | null,
  metadata: DraftWorkspaceMetadata | null,
  changedCount: number,
): CustomerPriceBookWorkspaceDraftSummaryDto | null {
  return book && metadata
    ? {
        id: book.id,
        name: book.name,
        purpose: book.purpose,
        version: book.version,
        basedOnVersion: metadata.basedOnVersion,
        changeReason: metadata.changeReason,
        changedCount,
        updatedAt: book.updatedAt.toISOString(),
      }
    : null;
}

async function readFilterOptions(
  tx: Prisma.TransactionClient,
  priceBookId: string,
  changedAvailable: boolean,
  purpose: CustomerPriceBookPurpose,
): Promise<CustomerPriceRuleWorkspaceFiltersDto> {
  const [categories, products] = await Promise.all([
    tx.customerChargeCategory.findMany({
      where: { rules: { some: { priceBookId } } },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    tx.product.findMany({
      where: { customerPriceRules: { some: { priceBookId } } },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }],
    }),
  ]);
  return {
    categories,
    products,
    provinces:
      purpose === CustomerPriceBookPurpose.LOGISTICS
        ? ZTO_PROVINCE_OPTIONS.map((province) => ({
            value: province,
            name: province,
          }))
        : [],
    kinds: Object.values(CustomerPriceRuleKindValue),
    calculationTypes: Object.values(CustomerPriceCalculationTypeValue),
    automations: ['AUTOMATIC', 'MANUAL'],
    activeStates: ['ACTIVE', 'INACTIVE'],
    changedAvailable,
  };
}

async function readRuleDiff(
  tx: Prisma.TransactionClient,
  draft: BookRow | null,
  baseline: BookRow | null,
): Promise<{
  changedCodes: Set<string> | null;
  draftRules: InternalRuleRow[];
  baselineRules: InternalRuleRow[];
}> {
  if (!draft || !baseline) {
    return { changedCodes: null, draftRules: [], baselineRules: [] };
  }
  const [draftRules, baselineRules] = await Promise.all([
    tx.customerPriceRule.findMany({
      where: { priceBookId: draft.id },
      select: INTERNAL_RULE_SELECT,
      orderBy: [{ code: 'asc' }],
    }),
    tx.customerPriceRule.findMany({
      where: { priceBookId: baseline.id },
      select: INTERNAL_RULE_SELECT,
      orderBy: [{ code: 'asc' }],
    }),
  ]);
  return {
    changedCodes: changedRuleCodes(draftRules, baselineRules),
    draftRules,
    baselineRules,
  };
}

export async function getCustomerPriceRuleWorkspace(
  query: CustomerPriceRuleWorkspaceQuery,
  now: Date = new Date(),
): Promise<CustomerPriceRuleWorkspaceDto> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotReadLock(tx);
    const books = await resolveWorkspaceBooks(tx, query.purpose, now);
    const primaryBook = books.draft ?? books.current;
    const normalized = normalizeQuery(query);
    if (!primaryBook) {
      return {
        purpose: query.purpose,
        currentBook: null,
        scheduledBook: currentBookSummary(books.scheduled),
        draft: null,
        draftCreation: {
          allowed: false,
          blockedReason: books.scheduled
            ? '已有计划生效版本，待该版本生效后才能再发起调价'
            : '当前没有可复制的生效价格版本',
        },
        items: [],
        filters: emptyFilters(),
        total: 0,
        page: 1,
        pageSize: normalized.pageSize,
        pageCount: 0,
      };
    }

    const diff = await readRuleDiff(tx, books.draft, books.baseline);
    const effectiveQuery = books.draft
      ? query
      : { ...query, changed: undefined };
    const where = buildRuleWhere(
      effectiveQuery,
      normalized,
      primaryBook.id,
      diff.changedCodes,
    );
    const total = await tx.customerPriceRule.count({ where });
    const pageCount = total === 0 ? 0 : Math.ceil(total / normalized.pageSize);
    const page = pageCount === 0 ? 1 : Math.min(normalized.page, pageCount);
    const [rules, filters] = await Promise.all([
      tx.customerPriceRule.findMany({
        where,
        select: INTERNAL_RULE_SELECT,
        orderBy: [
          { category: { sortOrder: 'asc' } },
          { product: { name: 'asc' } },
          { minQty: 'asc' },
          { priority: 'desc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * normalized.pageSize,
        take: normalized.pageSize,
      }),
      readFilterOptions(
        tx,
        primaryBook.id,
        books.draft !== null,
        query.purpose,
      ),
    ]);

    const currentByCode = new Map(
      diff.baselineRules.map((rule) => [String(rule.code), rule]),
    );
    const draftByCode = new Map(
      diff.draftRules.map((rule) => [String(rule.code), rule]),
    );
    const items = rules.map((rule) => {
      const code = String(rule.code);
      const current = books.draft ? currentByCode.get(code) ?? null : rule;
      const draft = books.draft ? draftByCode.get(code) ?? rule : null;
      return {
        id: rule.id,
        current: current ? businessRule(current) : null,
        draft: draft ? businessRule(draft) : null,
        changed: diff.changedCodes?.has(code) ?? false,
      };
    });

    return {
      purpose: query.purpose,
      currentBook: currentBookSummary(books.current),
      scheduledBook: currentBookSummary(books.scheduled),
      draft: draftSummary(
        books.draft,
        books.draftMetadata,
        diff.changedCodes?.size ?? 0,
      ),
      draftCreation: {
        allowed:
          books.draft === null &&
          books.scheduled === null &&
          books.current !== null,
        blockedReason: books.draft
          ? '已有未发布调价草稿'
          : books.scheduled
            ? '已有计划生效版本，待该版本生效后才能再发起调价'
            : books.current
              ? null
              : '当前没有可复制的生效价格版本',
      },
      items,
      filters,
      total,
      page,
      pageSize: normalized.pageSize,
      pageCount,
    };
  });
}

/**
 * Reads business price groups while keeping every tier as an independent rule.
 * Pagination is intentionally applied after grouping so a seven-tier product
 * counts as one result and is never split across pages.
 */
export async function getCustomerPriceRuleGroupWorkspacePage(
  query: CustomerPriceRuleWorkspaceQuery,
  now: Date = new Date(),
): Promise<CustomerPriceRuleGroupWorkspacePageDto> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotReadLock(tx);
    const books = await resolveWorkspaceBooks(tx, query.purpose, now);
    const primaryBook = books.draft ?? books.current;
    const normalized = normalizeQuery(query);
    if (!primaryBook) {
      return {
        purpose: query.purpose,
        currentBook: null,
        scheduledBook: currentBookSummary(books.scheduled),
        draft: null,
        draftCreation: {
          allowed: false,
          blockedReason: books.scheduled
            ? '已有计划生效版本，待该版本生效后才能再发起调价'
            : '当前没有可复制的生效价格版本',
        },
        groups: [],
        filters: emptyFilters(),
        total: 0,
        page: 1,
        pageSize: normalized.pageSize,
        pageCount: 0,
      };
    }

    const diff = await readRuleDiff(tx, books.draft, books.baseline);
    const effectiveQuery = books.draft
      ? query
      : { ...query, changed: undefined };
    // Active/changed describe the completed business group, not an individual
    // persisted tier. Keep the other filters as tier-level group discovery,
    // then apply these two predicates after the matching groups are completed.
    const tierMatchingQuery = {
      ...effectiveQuery,
      active: undefined,
      changed: undefined,
    };
    const where = buildRuleWhere(
      tierMatchingQuery,
      normalized,
      primaryBook.id,
      diff.changedCodes,
    );
    const [matchingRules, filters, currentVersionRules] = await Promise.all([
      tx.customerPriceRule.findMany({
        where,
        select: INTERNAL_RULE_SELECT,
        orderBy: GROUP_RULE_ORDER_BY,
      }),
      readFilterOptions(
        tx,
        primaryBook.id,
        books.draft !== null,
        query.purpose,
      ),
      books.draft
        ? Promise.resolve(diff.draftRules)
        : tx.customerPriceRule.findMany({
            where: { priceBookId: primaryBook.id },
            select: INTERNAL_RULE_SELECT,
            orderBy: GROUP_RULE_ORDER_BY,
          }),
    ]);

    const matchingGroups = groupInternalRules(matchingRules);
    const completeGroups = new Map(
      groupInternalRules(currentVersionRules).map((group) => [
        group.signature,
        group,
      ]),
    );
    const aggregateFilteredGroups = matchingGroups
      .map((matchedGroup) => {
        const completeGroup = completeGroups.get(matchedGroup.signature);
        if (!completeGroup) {
          throw new CustomerPriceBookWorkspaceError(
            '收费项分组在读取期间发生变化，请重试',
          );
        }
        return completeGroup;
      })
      .filter((group) =>
        groupMatchesAggregateFilters(
          group,
          effectiveQuery,
          diff.changedCodes,
        ),
      );
    const total = aggregateFilteredGroups.length;
    const pageCount = total === 0 ? 0 : Math.ceil(total / normalized.pageSize);
    const page = pageCount === 0 ? 1 : Math.min(normalized.page, pageCount);
    const pageGroups = aggregateFilteredGroups.slice(
      (page - 1) * normalized.pageSize,
      page * normalized.pageSize,
    );
    const currentByCode = new Map(
      diff.baselineRules.map((rule) => [String(rule.code), rule]),
    );
    const groups = pageGroups.map((completeGroup) => {
      return workspaceGroup(
        completeGroup,
        books.draft !== null,
        currentByCode,
        diff.changedCodes,
      );
    });

    return {
      purpose: query.purpose,
      currentBook: currentBookSummary(books.current),
      scheduledBook: currentBookSummary(books.scheduled),
      draft: draftSummary(
        books.draft,
        books.draftMetadata,
        diff.changedCodes?.size ?? 0,
      ),
      draftCreation: {
        allowed:
          books.draft === null &&
          books.scheduled === null &&
          books.current !== null,
        blockedReason: books.draft
          ? '已有未发布调价草稿'
          : books.scheduled
            ? '已有计划生效版本，待该版本生效后才能再发起调价'
            : books.current
              ? null
              : '当前没有可复制的生效价格版本',
      },
      groups,
      filters,
      total,
      page,
      pageSize: normalized.pageSize,
      pageCount,
    };
  });
}

export async function getCustomerPriceRuleGroupWorkspaceDetail(
  input: {
    purpose: CustomerPriceBookPurpose;
    groupId: string;
  },
  now: Date = new Date(),
): Promise<CustomerPriceRuleGroupWorkspaceDetailDto | null> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotReadLock(tx);
    const books = await resolveWorkspaceBooks(tx, input.purpose, now);
    const primaryBook = books.draft ?? books.current;
    if (!primaryBook) return null;

    let selected = await tx.customerPriceRule.findFirst({
      where: { id: input.groupId, priceBookId: primaryBook.id },
      select: INTERNAL_RULE_SELECT,
    });
    if (!selected && books.draft && books.baseline) {
      const selectedCurrent = await tx.customerPriceRule.findFirst({
        where: { id: input.groupId, priceBookId: books.baseline.id },
        select: INTERNAL_RULE_SELECT,
      });
      if (selectedCurrent) {
        selected = await tx.customerPriceRule.findFirst({
          where: {
            priceBookId: books.draft.id,
            code: selectedCurrent.code,
          },
          select: INTERNAL_RULE_SELECT,
        });
      }
    }
    if (!selected) return null;

    const [allPrimaryRules, filters] = await Promise.all([
      tx.customerPriceRule.findMany({
        where: { priceBookId: primaryBook.id },
        select: INTERNAL_RULE_SELECT,
        orderBy: GROUP_RULE_ORDER_BY,
      }),
      readFilterOptions(
        tx,
        primaryBook.id,
        books.draft !== null,
        input.purpose,
      ),
    ]);
    const selectedSignature = ruleGroupSignature(selected);
    const groupedRules = allPrimaryRules.filter(
      (rule) => ruleGroupSignature(rule) === selectedSignature,
    );
    if (groupedRules.length === 0) {
      throw new CustomerPriceBookWorkspaceError(
        '收费项分组在读取期间发生变化，请重试',
      );
    }

    let currentRules: InternalRuleRow[] = [];
    if (books.draft && books.baseline) {
      currentRules = await tx.customerPriceRule.findMany({
        where: {
          priceBookId: books.baseline.id,
          code: { in: groupedRules.map((rule) => String(rule.code)) },
        },
        select: INTERNAL_RULE_SELECT,
      });
    }
    const currentByCode = new Map(
      currentRules.map((rule) => [String(rule.code), rule]),
    );
    const changedCodes = books.draft
      ? new Set(
          groupedRules
            .filter((rule) => {
              const current = currentByCode.get(String(rule.code));
              return (
                !current || pricingSignature(rule) !== pricingSignature(current)
              );
            })
            .map((rule) => String(rule.code)),
        )
      : null;
    const group = workspaceGroup(
      {
        signature: selectedSignature,
        rules: sortGroupTiers(groupedRules),
      },
      books.draft !== null,
      currentByCode,
      changedCodes,
    );

    return {
      purpose: input.purpose,
      priceBookId: primaryBook.id,
      editable: books.draft !== null,
      group,
      categories: filters.categories,
      products: filters.products,
    };
  });
}

export async function getCustomerPriceRuleWorkspaceDetail(
  input: {
    purpose: CustomerPriceBookPurpose;
    ruleId: string;
  },
  now: Date = new Date(),
): Promise<CustomerPriceRuleWorkspaceDetailDto | null> {
  return db.$transaction(async (tx) => {
    await acquirePriceRuleSnapshotReadLock(tx);
    const books = await resolveWorkspaceBooks(tx, input.purpose, now);
    const primaryBook = books.draft ?? books.current;
    if (!primaryBook) return null;

    const selected = await tx.customerPriceRule.findFirst({
      where: { id: input.ruleId, priceBookId: primaryBook.id },
      select: INTERNAL_RULE_SELECT,
    });
    if (!selected) return null;

    let current: InternalRuleRow | null = books.draft ? null : selected;
    if (books.draft && books.baseline) {
      current = await tx.customerPriceRule.findFirst({
        where: { priceBookId: books.baseline.id, code: selected.code },
        select: INTERNAL_RULE_SELECT,
      });
    }
    const filters = await readFilterOptions(
      tx,
      primaryBook.id,
      books.draft !== null,
      input.purpose,
    );

    return {
      purpose: input.purpose,
      priceBookId: primaryBook.id,
      editable: books.draft !== null,
      expectedUpdatedAt: books.draft ? selected.updatedAt.toISOString() : null,
      current: current ? businessRule(current) : null,
      draft: books.draft ? businessRule(selected) : null,
      changed:
        books.draft !== null &&
        (!current || pricingSignature(selected) !== pricingSignature(current)),
      categories: filters.categories,
      products: filters.products,
    };
  });
}
