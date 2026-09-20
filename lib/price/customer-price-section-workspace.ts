import 'server-only';
import { blankPaperFact } from './blank-paper';
import { blankPriceIdentityFromCondition, type BlankPriceIdentity } from './blank-price-identity';

import Decimal from 'decimal.js';
import {
  CustomerPriceBookPurpose,
  OrderSettlementType,
} from '../../generated/prisma/enums';
import { db } from '../db';
import type { ExternalOrderLogisticsPolicy } from './external-order-charges';
import {
  customerPriceSectionOwnsRule,
  type CustomerPriceSection,
} from './customer-price-section-membership';
import {
  CustomerPriceBookWorkspaceError,
  getCustomerPriceRuleTechnicalMeta,
  getCustomerPriceRuleGroupWorkspacePage,
  type CustomerPriceBookWorkspaceDraftSummaryDto,
  type CustomerPriceBookWorkspaceSummaryDto,
  type CustomerPriceRuleBusinessDto,
  type CustomerPriceRuleGroupWorkspacePageDto,
  type CustomerPriceRuleWorkspaceGroupDto,
} from './customer-price-book-workspace';

export {
  CUSTOMER_PRICE_SECTIONS,
  type CustomerPriceSection,
} from './customer-price-section-membership';

export type CustomerPriceSectionRuleValueDto = Pick<
  CustomerPriceRuleBusinessDto,
  | 'id'
  | 'name'
  | 'category'
  | 'kind'
  | 'calculationType'
  | 'unitsPerSheet'
  | 'amount'
  | 'includedUnits'
  | 'incrementUnits'
  | 'incrementAmount'
  | 'minQty'
  | 'maxQty'
  | 'scopeLabel'
  | 'automation'
  | 'blocksAutomaticQuote'
  | 'isActive'
> & {
  code: string;
  blankIdentity?: BlankPriceIdentity | null;
  product: {
    id: string;
    code: string;
    name: string;
    specification: string | null;
    paperType: string | null;
  } | null;
  exclusiveGroup: string | null;
};

/** One persisted rule, flattened out of the generic visual group. */
export type CustomerPriceSectionRuleDto = {
  id: string;
  purpose: CustomerPriceBookPurpose;
  code: string;
  current: CustomerPriceSectionRuleValueDto | null;
  draft: CustomerPriceSectionRuleValueDto | null;
  changed: boolean;
  expectedUpdatedAt: string | null;
};

export type CustomerPriceSectionWorkspaceStateDto = {
  purpose: CustomerPriceBookPurpose;
  currentBook: CustomerPriceBookWorkspaceSummaryDto | null;
  scheduledBook: CustomerPriceBookWorkspaceSummaryDto | null;
  draft: CustomerPriceBookWorkspaceDraftSummaryDto | null;
  draftCreation: {
    allowed: boolean;
    blockedReason: string | null;
  };
};

export type CustomerPriceShippingWeightPolicyDto = {
  current: ExternalOrderLogisticsPolicy | null;
  draft: ExternalOrderLogisticsPolicy | null;
};

export type CustomerPriceSectionWorkspaceDto = {
  section: CustomerPriceSection;
  /**
   * The first source is the section's owning book. `ship` additionally exposes
   * PROCESSING because per-bag packaging rules live there.
   */
  sources: CustomerPriceSectionWorkspaceStateDto[];
  rules: CustomerPriceSectionRuleDto[];
  shippingWeightPolicy: CustomerPriceShippingWeightPolicyDto | null;
  blankPapers?: Array<{ id: string; label: string; available: boolean; issue: string | null }>;
};

export type CustomerPriceSectionProjectionSource = {
  purpose: CustomerPriceBookPurpose;
  groups: readonly CustomerPriceRuleWorkspaceGroupDto[];
};

function selectedRule(
  current: CustomerPriceSectionRuleValueDto | null,
  draft: CustomerPriceSectionRuleValueDto | null,
): CustomerPriceSectionRuleValueDto | null {
  return draft ?? current;
}

type LegacyTechnicalRule = CustomerPriceRuleBusinessDto & {
  code?: unknown;
  exclusiveGroup?: unknown;
  product:
    | (NonNullable<CustomerPriceRuleBusinessDto['product']> & {
        code?: unknown;
        specification?: unknown;
        paperType?: unknown;
      })
    | null;
};

function sectionRuleValue(
  rule: CustomerPriceRuleBusinessDto | null,
): CustomerPriceSectionRuleValueDto | null {
  if (!rule) return null;
  const technical = getCustomerPriceRuleTechnicalMeta(rule);
  const legacy = rule as LegacyTechnicalRule;
  const code =
    technical?.code ??
    (typeof legacy.code === 'string' ? legacy.code : '');
  if (!code) return null;
  const exclusiveGroup =
    technical?.exclusiveGroup ??
    (typeof legacy.exclusiveGroup === 'string'
      ? legacy.exclusiveGroup
      : null);
  const product = rule.product
    ? {
        id: rule.product.id,
        code:
          technical?.productCode ??
          (typeof legacy.product?.code === 'string'
            ? legacy.product.code
            : ''),
        name: rule.product.name,
        specification:
          technical?.productSpecification ??
          (typeof legacy.product?.specification === 'string'
            ? legacy.product.specification
            : null),
        paperType:
          technical?.productPaperType ??
          (typeof legacy.product?.paperType === 'string'
            ? legacy.product.paperType
            : null),
      }
    : null;
  return {
    blankIdentity: blankPriceIdentityFromCondition(technical?.triggerCondition),
    ...rule,
    code,
    product,
    exclusiveGroup,
  };
}

function isSectionRule(
  section: CustomerPriceSection,
  purpose: CustomerPriceBookPurpose,
  rule: CustomerPriceSectionRuleValueDto,
): boolean {
  return customerPriceSectionOwnsRule(section, purpose, rule);
}

/**
 * Pure whitelist projection. It deliberately does not infer membership from a
 * display name, category label, or search result.
 */
export function projectCustomerPriceSectionRules(
  section: CustomerPriceSection,
  sources: readonly CustomerPriceSectionProjectionSource[],
): CustomerPriceSectionRuleDto[] {
  const projected: CustomerPriceSectionRuleDto[] = [];
  for (const source of sources) {
    for (const group of source.groups) {
      for (const tier of group.tiers) {
        const current = sectionRuleValue(tier.current);
        const draft = sectionRuleValue(tier.draft);
        const rule = selectedRule(current, draft);
        if (!rule || !isSectionRule(section, source.purpose, rule)) continue;
        projected.push({
          id: tier.id,
          purpose: source.purpose,
          code: rule.code,
          current,
          draft,
          changed: tier.changed,
          expectedUpdatedAt: tier.expectedUpdatedAt,
        });
      }
    }
  }
  return projected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveDecimal(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.gt(0) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function positiveSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
}

/** Parses only the fields consumed by the shipping calculator; malformed notes are ignored. */
export function parseCustomerPriceShippingWeightPolicy(
  notes: unknown,
): ExternalOrderLogisticsPolicy | null {
  if (!isRecord(notes) || !isRecord(notes.shipping)) return null;
  const ruleVersion =
    typeof notes.ruleVersion === 'string' ? notes.ruleVersion.trim() : '';
  if (!ruleVersion) return null;

  const shipping = notes.shipping;
  if (shipping.billableWeightInput === 'CARRIER_CONFIRMED') {
    const maxOrderQuantity = positiveSafeInteger(
      shipping.maxOrderQuantity ?? shipping.ztoMaximumOrderQuantity,
    );
    if (maxOrderQuantity === null) return null;
    if (
      shipping.weightResolutionOrder !== undefined &&
      (!Array.isArray(shipping.weightResolutionOrder) ||
        shipping.weightResolutionOrder.length !== 1 ||
        shipping.weightResolutionOrder[0] !== 'ACTUAL_FULFILLMENT_WEIGHT')
    ) {
      return null;
    }
    return {
      ruleVersion,
      billableWeightInput: 'CARRIER_CONFIRMED',
      weightResolutionOrder: ['ACTUAL_FULFILLMENT_WEIGHT'],
      maxOrderQuantity,
    };
  }

  if (
    shipping.billableWeightInput !==
      'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE' ||
    !Array.isArray(shipping.weightResolutionOrder) ||
    shipping.weightResolutionOrder.length !== 2 ||
    shipping.weightResolutionOrder[0] !== 'ACTUAL_FULFILLMENT_WEIGHT' ||
    shipping.weightResolutionOrder[1] !== 'SERVER_ESTIMATE' ||
    shipping.billableWeightRounding !== 'CEIL_KG'
  ) {
    return null;
  }

  const maxOrderQuantity = positiveSafeInteger(shipping.maxOrderQuantity);
  const minimumBillableWeightKg = positiveDecimal(
    shipping.minimumBillableWeightKg,
  );
  const tenThousandEnvelopeGramsPerItem = positiveDecimal(
    shipping.tenThousandEnvelopeGramsPerItem,
  );
  if (
    maxOrderQuantity === null ||
    minimumBillableWeightKg === null ||
    tenThousandEnvelopeGramsPerItem === null ||
    !isRecord(shipping.gramsPerItemByPaperWeightGsm) ||
    Object.keys(shipping.gramsPerItemByPaperWeightGsm).length === 0
  ) {
    return null;
  }

  const gramsPerItemByPaperWeightGsm: Record<string, string> = {};
  for (const [paperWeightGsm, value] of Object.entries(
    shipping.gramsPerItemByPaperWeightGsm,
  )) {
    const grams = positiveDecimal(value);
    if (!/^[1-9]\d*$/.test(paperWeightGsm) || grams === null) return null;
    const numericPaperWeight = Number(paperWeightGsm);
    if (!Number.isSafeInteger(numericPaperWeight)) return null;
    gramsPerItemByPaperWeightGsm[paperWeightGsm] = grams;
  }

  return {
    ruleVersion,
    billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
    weightResolutionOrder: [
      'ACTUAL_FULFILLMENT_WEIGHT',
      'SERVER_ESTIMATE',
    ],
    maxOrderQuantity,
    billableWeightRounding: 'CEIL_KG',
    minimumBillableWeightKg,
    gramsPerItemByPaperWeightGsm,
    tenThousandEnvelopeGramsPerItem,
  };
}

function workspaceState(
  workspace: CustomerPriceRuleGroupWorkspacePageDto,
): CustomerPriceSectionWorkspaceStateDto {
  return {
    purpose: workspace.purpose,
    currentBook: workspace.currentBook,
    scheduledBook: workspace.scheduledBook,
    draft: workspace.draft,
    draftCreation: workspace.draftCreation,
  };
}

function workspaceStateKey(
  workspace: CustomerPriceRuleGroupWorkspacePageDto,
): string {
  return JSON.stringify({
    purpose: workspace.purpose,
    current: workspace.currentBook?.id ?? null,
    scheduled: workspace.scheduledBook?.id ?? null,
    draft: workspace.draft?.id ?? null,
  });
}

async function readAllWorkspaceGroups(
  purpose: CustomerPriceBookPurpose,
  now: Date,
): Promise<CustomerPriceRuleGroupWorkspacePageDto> {
  const first = await getCustomerPriceRuleGroupWorkspacePage(
    { purpose, page: 1, pageSize: 100 },
    now,
  );
  if (first.pageCount <= 1) return first;

  const pages = await Promise.all(
    Array.from({ length: first.pageCount - 1 }, (_, index) =>
      getCustomerPriceRuleGroupWorkspacePage(
        { purpose, page: index + 2, pageSize: 100 },
        now,
      ),
    ),
  );
  const expectedState = workspaceStateKey(first);
  if (pages.some((page) => workspaceStateKey(page) !== expectedState)) {
    throw new CustomerPriceBookWorkspaceError(
      '价格版本在分页读取期间发生变化，请重试',
    );
  }
  return {
    ...first,
    groups: [first, ...pages].flatMap((page) => page.groups),
  };
}

async function readShippingWeightPolicies(
  workspace: CustomerPriceRuleGroupWorkspacePageDto,
): Promise<CustomerPriceShippingWeightPolicyDto> {
  const bookIds = [workspace.currentBook?.id, workspace.draft?.id].filter(
    (id): id is string => Boolean(id),
  );
  if (bookIds.length === 0) return { current: null, draft: null };

  const books = await db.customerPriceBook.findMany({
    where: {
      id: { in: bookIds },
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      purpose: CustomerPriceBookPurpose.LOGISTICS,
    },
    select: { id: true, notes: true },
  });
  const notesById = new Map(books.map((book) => [book.id, book.notes]));
  return {
    current: workspace.currentBook
      ? parseCustomerPriceShippingWeightPolicy(
          notesById.get(workspace.currentBook.id),
        )
      : null,
    draft: workspace.draft
      ? parseCustomerPriceShippingWeightPolicy(notesById.get(workspace.draft.id))
      : null,
  };
}

/**
 * Reads the existing version-aware workspaces and only projects their selected
 * current/draft rules. Version and draft-baseline selection remain owned by
 * `getCustomerPriceRuleGroupWorkspacePage`.
 */
export async function getCustomerPriceSectionWorkspace(
  section: CustomerPriceSection,
  now: Date = new Date(),
): Promise<CustomerPriceSectionWorkspaceDto> {
  if (section !== 'ship') {
    const processing = await readAllWorkspaceGroups(
      CustomerPriceBookPurpose.PROCESSING,
      now,
    );
    return {
      section,
      sources: [workspaceState(processing)],
      rules: projectCustomerPriceSectionRules(section, [
        { purpose: processing.purpose, groups: processing.groups },
      ]),
      shippingWeightPolicy: null,
      ...(section === 'blank' ? {
        blankPapers: (await db.material.findMany({ where: { category: 'PAPER' } })).map((paper) => {
          const fact = blankPaperFact(paper);
          return { id: paper.id, label: fact ? `${fact.paperWeightGsm}g${fact.paperType}` : paper.name,
            available: paper.isActive && !paper.outOfStock && fact !== null,
            issue: !fact ? '纸张名称或克重不完整' : !paper.isActive ? '纸张已停用' : paper.outOfStock ? '纸张缺货' : null };
        }),
      } : {}),
    };
  }

  const [logistics, processing] = await Promise.all([
    readAllWorkspaceGroups(CustomerPriceBookPurpose.LOGISTICS, now),
    readAllWorkspaceGroups(CustomerPriceBookPurpose.PROCESSING, now),
  ]);
  return {
    section,
    sources: [workspaceState(logistics), workspaceState(processing)],
    rules: projectCustomerPriceSectionRules(section, [
      { purpose: logistics.purpose, groups: logistics.groups },
      { purpose: processing.purpose, groups: processing.groups },
    ]),
    shippingWeightPolicy: await readShippingWeightPolicies(logistics),
  };
}
