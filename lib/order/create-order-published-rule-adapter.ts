import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
  OrderSettlementType,
} from '../../generated/prisma/enums';
import { db } from '../db';
import {
  canonicalizeCreateOrderPaperFact,
  canonicalizeCreateOrderSpecification,
  type CanonicalCreateOrderPaperFact,
} from '../price/create-order/canonical-facts';
import type {
  CreateOrderPriceSnapshot,
  CreateOrderPriceVersionBundle,
  CreateOrderPricingGroup,
} from '../price/create-order/types';
import { parseCustomerRuleCondition } from '../price/customer-rule-condition';
import type {
  ExternalOrderChargeRule,
  ExternalOrderChargeSource,
  ExternalOrderLogisticsPolicy,
} from '../price/external-order-charges';
import {
  readExternalCreateOrderPriceSnapshot,
  type ExternalCreateOrderPriceSnapshot,
} from './create-order-price-snapshot';
import { ZTO_PROVINCE_OPTIONS } from '../price/external-order-charges';
import { acquirePriceRuleSnapshotReadLock } from '../price/rule-snapshot-lock';

const MAX_PERSISTED_QUANTITY = 9_999_999;
const SHA256 = /^[a-f\d]{64}$/iu;

export type PublishedCreateOrderRuleRow = {
  id: string;
  priceBookId: string;
  code: unknown;
  name: string;
  kind: CustomerPriceRuleKind;
  calculationType: CustomerPriceCalculationType | null;
  amount: unknown;
  includedUnits: unknown;
  incrementUnits: unknown;
  incrementAmount: unknown;
  minQty: number | null;
  maxQty: number | null;
  triggerCondition: unknown;
  exclusiveGroup: string | null;
  priority: number;
  sourceSheet: string | null;
  sourceRange: string | null;
  sourceName: string | null;
  sourceSha256: string | null;
  blocksAutomaticQuote: boolean;
  isActive: boolean;
  category: { code: unknown; name: string };
};

export type PublishedCreateOrderPriceProjectionInput = {
  priceVersion: ExternalCreateOrderPriceSnapshot;
  processingNotes: unknown;
  logisticsNotes: unknown;
  rules: readonly PublishedCreateOrderRuleRow[];
};

export type PublishedCreateOrderPriceProjectionAudit = {
  processingRuleCount: number;
  logisticsRuleCount: number;
  processingRuleCodes: readonly string[];
  logisticsRuleCodes: readonly string[];
  projectedRuleCodes: {
    partialBlank: readonly string[];
    partialMachine: readonly string[];
    fullTiers: readonly string[];
    fullPaperSurcharges: readonly string[];
    fullOtherSurcharges: readonly string[];
    printBase: readonly string[];
    printFoil: readonly string[];
    bagging: readonly string[];
    logistics: readonly string[];
  };
};

export type PublishedCreateOrderPriceProjection = {
  snapshot: CreateOrderPriceSnapshot;
  audit: PublishedCreateOrderPriceProjectionAudit;
};

export type PublishedCreateOrderPriceReadClient = Pick<
  Prisma.TransactionClient,
  '$executeRaw' | 'customerPriceBook' | 'customerPriceRule'
>;

export type CandidatePublishedCreateOrderPriceProjectionOptions = {
  candidatePriceBookId: string;
  effectiveFrom: Date;
  snapshotLockHeld?: boolean;
};

export class PublishedCreateOrderPriceAdapterError extends Error {
  constructor(
    readonly code:
      | 'MISSING_BOOK_DETAILS'
      | 'MISSING_RULE'
      | 'DUPLICATE_RULE'
      | 'INVALID_RULE'
      | 'UNSUPPORTED_RULE'
      | 'INVALID_LOGISTICS_POLICY',
    message: string,
    readonly rule?: { id: string; code: string },
  ) {
    super(message);
    this.name = 'PublishedCreateOrderPriceAdapterError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textCode(value: unknown): string {
  return String(value).trim();
}

function ruleIdentity(rule: PublishedCreateOrderRuleRow): {
  id: string;
  code: string;
} {
  return { id: rule.id, code: textCode(rule.code) };
}

function invalidRule(
  rule: PublishedCreateOrderRuleRow,
  message: string,
): never {
  throw new PublishedCreateOrderPriceAdapterError(
    'INVALID_RULE',
    `\u4ef7\u76ee\u89c4\u5219 ${textCode(rule.code) || rule.id}\uff1a${message}`,
    ruleIdentity(rule),
  );
}

function normalizedDecimal(
  value: unknown,
  options: {
    rule: PublishedCreateOrderRuleRow;
    label: string;
    nullable?: boolean;
    positive?: boolean;
  },
): string | null {
  if (value === null || value === undefined) {
    if (options.nullable) return null;
    return invalidRule(options.rule, `\u7f3a\u5c11${options.label}`);
  }
  let amount: Decimal;
  try {
    amount = new Decimal(String(value));
  } catch {
    return invalidRule(options.rule, `${options.label}\u683c\u5f0f\u65e0\u6548`);
  }
  if (
    !amount.isFinite() ||
    amount.isNegative() ||
    (options.positive && !amount.gt(0)) ||
    amount.decimalPlaces() > 4
  ) {
    return invalidRule(options.rule, `${options.label}\u683c\u5f0f\u65e0\u6548`);
  }
  return amount.toString();
}

function processingCondition(rule: PublishedCreateOrderRuleRow) {
  const parsed = parseCustomerRuleCondition(rule.triggerCondition);
  if (!parsed.condition) {
    return invalidRule(
      rule,
      `\u9002\u7528\u6761\u4ef6\u65e0\u6548\uff08${parsed.errors.join('\uff1b')}\uff09`,
    );
  }
  return parsed.condition;
}

function exactlyOne<T>(
  values: readonly T[] | undefined,
  rule: PublishedCreateOrderRuleRow,
  label: string,
): T {
  if (values?.length !== 1) {
    return invalidRule(rule, `${label}\u5fc5\u987b\u552f\u4e00`);
  }
  return values[0]!;
}

function hasOnly<T>(values: readonly T[] | undefined, expected: T): boolean {
  return values?.length === 1 && values[0] === expected;
}

function requireRuleShape(
  rule: PublishedCreateOrderRuleRow,
  expected: {
    kind: CustomerPriceRuleKind;
    calculationType: CustomerPriceCalculationType | null;
  },
): void {
  if (
    rule.kind !== expected.kind ||
    rule.calculationType !== expected.calculationType
  ) {
    invalidRule(rule, '\u89c4\u5219\u7c7b\u578b\u6216\u8ba1\u4ef7\u65b9\u5f0f\u4e0e\u4e1a\u52a1\u677f\u5757\u4e0d\u7b26');
  }
}

function assertUniqueCodes(
  rules: readonly PublishedCreateOrderRuleRow[],
): void {
  const seen = new Map<string, PublishedCreateOrderRuleRow>();
  for (const rule of rules) {
    const code = textCode(rule.code).toLocaleUpperCase('en-US');
    if (!code) invalidRule(rule, '\u7f16\u7801\u4e3a\u7a7a');
    const previous = seen.get(code);
    if (previous) {
      throw new PublishedCreateOrderPriceAdapterError(
        'DUPLICATE_RULE',
        `\u4ef7\u76ee\u7c3f ${rule.priceBookId} \u5b58\u5728\u91cd\u590d\u89c4\u5219\u7f16\u7801 ${code}`,
        ruleIdentity(rule),
      );
    }
    seen.set(code, rule);
  }
}

function requireOneRule(
  rules: readonly PublishedCreateOrderRuleRow[],
  label: string,
): PublishedCreateOrderRuleRow {
  if (rules.length === 0) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_RULE',
      `\u5df2\u53d1\u5e03\u4ef7\u76ee\u7c3f\u7f3a\u5c11${label}`,
    );
  }
  if (rules.length > 1) {
    const rule = rules[1]!;
    throw new PublishedCreateOrderPriceAdapterError(
      'DUPLICATE_RULE',
      `\u5df2\u53d1\u5e03\u4ef7\u76ee\u7c3f\u540c\u65f6\u5b58\u5728\u591a\u6761${label}`,
      ruleIdentity(rule),
    );
  }
  return rules[0]!;
}

function canonicalPaperFromRule(
  label: string,
  rule: PublishedCreateOrderRuleRow,
): CanonicalCreateOrderPaperFact {
  const paper = canonicalizeCreateOrderPaperFact(label);
  if (!paper) invalidRule(rule, `\u65e0\u6cd5\u552f\u4e00\u89e3\u6790\u7eb8\u5f20\u4e0e\u514b\u91cd\u201c${label}\u201d`);
  return paper;
}

function canonicalSpecificationFromRule(
  label: string,
  rule: PublishedCreateOrderRuleRow,
): string {
  const specification = canonicalizeCreateOrderSpecification(label);
  if (!specification) invalidRule(rule, `\u65e0\u6cd5\u552f\u4e00\u89e3\u6790\u89c4\u683c\u201c${label}\u201d`);
  return specification;
}

function paperKey(paper: CanonicalCreateOrderPaperFact): string {
  return `${paper.paperType}\u0000${paper.paperWeightGsm}`;
}

function pricingGroupForSpecification(
  specification: string,
  rule: PublishedCreateOrderRuleRow,
): CreateOrderPricingGroup {
  if (specification === '\u5927\u53f7\u5c01' || specification === '\u897f\u5c01\u5927\u53f7') {
    return 'LARGE';
  }
  if (
    specification === '\u4e2d\u53f7\u5c01' ||
    specification === '\u65b9\u5f62\u5c01' ||
    specification === '\u897f\u5c01\u4e2d\u53f7'
  ) {
    return 'MID';
  }
  return invalidRule(rule, `\u4e13\u7248\u9636\u68af\u89c4\u683c\u4e0d\u5c5e\u4e8e\u5df2\u5b9a\u4e49\u8ba1\u4ef7\u7ec4\uff1a${specification}`);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function projectPartial(
  rules: readonly PublishedCreateOrderRuleRow[],
  consumed: Set<string>,
): {
  snapshot: CreateOrderPriceSnapshot['partial'];
  blankCodes: string[];
  machineCodes: string[];
} {
  const blankRules = rules.filter(
    (rule) => rule.exclusiveGroup === 'STOCK_BASE',
  );
  if (blankRules.length === 0) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_RULE',
      '\u5df2\u53d1\u5e03\u52a0\u5de5\u8d39\u4ef7\u76ee\u7c3f\u7f3a\u5c11\u5c40\u90e8\u70eb\u91d1\u7a7a\u767d\u5c01\u5355\u4ef7',
    );
  }
  const seen = new Map<string, PublishedCreateOrderRuleRow>();
  const blankUnitPrices = blankRules.map((rule) => {
    consumed.add(rule.id);
    requireRuleShape(rule, {
      kind: CustomerPriceRuleKind.BASE,
      calculationType: CustomerPriceCalculationType.PER_PIECE,
    });
    const condition = processingCondition(rule);
    if (
      condition.target !== 'ITEM' ||
      !hasOnly(condition.pricingRoutes, 'STOCK_BLANK')
    ) {
      invalidRule(rule, '\u7a7a\u767d\u5c01\u89c4\u5219\u672a\u552f\u4e00\u9650\u5b9a\u5c40\u90e8\u70eb\u91d1\u8def\u7ebf');
    }
    const paper = canonicalPaperFromRule(
      exactlyOne(condition.paperTypes, rule, '\u7eb8\u5f20'),
      rule,
    );
    const specification = canonicalSpecificationFromRule(
      exactlyOne(condition.specifications, rule, '\u89c4\u683c'),
      rule,
    );
    const key = `${paperKey(paper)}\u0000${specification}`;
    const previous = seen.get(key);
    if (previous) {
      throw new PublishedCreateOrderPriceAdapterError(
        'DUPLICATE_RULE',
        `\u7a7a\u767d\u5c01\u7ec4\u5408\u540c\u65f6\u547d\u4e2d ${textCode(previous.code)} \u4e0e ${textCode(rule.code)}`,
        ruleIdentity(rule),
      );
    }
    seen.set(key, rule);
    return {
      ...paper,
      specification,
      unitPrice: normalizedDecimal(rule.amount, {
        rule,
        label: '\u7a7a\u767d\u5c01\u5355\u4ef7',
        nullable: true,
      }),
    };
  });

  const machineRules = rules.filter(
    (rule) => rule.exclusiveGroup === 'STOCK_LOCAL_FOIL_MACHINE',
  );
  const fixed = requireOneRule(
    machineRules.filter(
      (rule) =>
        rule.calculationType === CustomerPriceCalculationType.FIXED_AMOUNT,
    ),
    '\u5c40\u90e8\u70eb\u91d1\u4f4e\u6570\u91cf\u56fa\u5b9a\u673a\u70eb\u8d39',
  );
  const perPiece = requireOneRule(
    machineRules.filter(
      (rule) =>
        rule.calculationType === CustomerPriceCalculationType.PER_PIECE,
    ),
    '\u5c40\u90e8\u70eb\u91d1\u9ad8\u6570\u91cf\u6309\u4e2a\u673a\u70eb\u8d39',
  );
  for (const rule of [fixed, perPiece]) {
    consumed.add(rule.id);
    requireRuleShape(rule, {
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: rule.calculationType,
    });
    const condition = processingCondition(rule);
    if (
      condition.target !== 'ITEM' ||
      !hasOnly(condition.pricingRoutes, 'STOCK_BLANK') ||
      condition.perFoilPass !== true
    ) {
      invalidRule(rule, '\u673a\u70eb\u8d39\u5fc5\u987b\u6309\u5c40\u90e8\u70eb\u91d1\u8fc7\u7248\u6b21\u6570\u8ba1\u4ef7');
    }
  }
  if (
    fixed.minQty !== 1 ||
    fixed.maxQty === null ||
    perPiece.minQty === null ||
    fixed.maxQty + 1 !== perPiece.minQty ||
    (perPiece.maxQty !== null && perPiece.maxQty !== MAX_PERSISTED_QUANTITY)
  ) {
    invalidRule(perPiece, '\u673a\u70eb\u8d39\u4e24\u4e2a\u6570\u91cf\u533a\u95f4\u5fc5\u987b\u4ece 1 \u5f00\u59cb\u8fde\u7eed\u8986\u76d6');
  }

  return {
    snapshot: {
      blankUnitPrices: blankUnitPrices.sort((left, right) =>
        compareText(
          `${left.paperType}:${left.paperWeightGsm}:${left.specification}`,
          `${right.paperType}:${right.paperWeightGsm}:${right.specification}`,
        ),
      ),
      machineFee: {
        perPassBelowQuantity: perPiece.minQty,
        fixedFeePerPass: normalizedDecimal(fixed.amount, {
          rule: fixed,
          label: '\u6bcf\u6b21\u56fa\u5b9a\u673a\u70eb\u8d39',
        })!,
        perPiecePerPass: normalizedDecimal(perPiece.amount, {
          rule: perPiece,
          label: '\u6bcf\u4e2a\u6bcf\u6b21\u673a\u70eb\u8d39',
        })!,
      },
    },
    blankCodes: blankRules.map((rule) => textCode(rule.code)).sort(compareText),
    machineCodes: machineRules
      .map((rule) => textCode(rule.code))
      .sort(compareText),
  };
}

const REQUIRED_FULL_SPECIFICATIONS = new Set([
  '\u4e2d\u53f7\u5c01',
  '\u65b9\u5f62\u5c01',
  '\u5927\u53f7\u5c01',
  '\u897f\u5c01\u4e2d\u53f7',
  '\u897f\u5c01\u5927\u53f7',
]);

type FullTierCandidate = {
  rule: PublishedCreateOrderRuleRow;
  specification: string;
  pricingGroup: CreateOrderPricingGroup;
  minQuantity: number;
  maxQuantity: number | null;
  persistedMaxQuantity: number | null;
  unitPrice: string | null;
  papers: CanonicalCreateOrderPaperFact[];
};

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function processingBaselineWeight(
  notes: unknown,
): number | null {
  if (!isRecord(notes) || !isRecord(notes.constants)) return null;
  const values = [
    notes.constants.customPaperBaselineGsm,
    notes.constants.paperWeightBaselineGsm,
  ].filter((value) => value !== undefined);
  if (
    values.length !== 1 ||
    !Number.isSafeInteger(values[0]) ||
    Number(values[0]) <= 0
  ) {
    return null;
  }
  return Number(values[0]);
}

function projectFull(
  rules: readonly PublishedCreateOrderRuleRow[],
  processingNotes: unknown,
  consumed: Set<string>,
): {
  snapshot: CreateOrderPriceSnapshot['full'];
  tierCodes: string[];
  paperSurchargeCodes: string[];
  otherSurchargeCodes: string[];
} {
  const tierRules = rules.filter(
    (rule) => rule.exclusiveGroup === 'CUSTOM_BASE',
  );
  if (tierRules.length === 0) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_RULE',
      '\u5df2\u53d1\u5e03\u52a0\u5de5\u8d39\u4ef7\u76ee\u7c3f\u7f3a\u5c11\u4e13\u7248\u70eb\u91d1\u9636\u68af',
    );
  }

  const candidates: FullTierCandidate[] = tierRules.map((rule) => {
    consumed.add(rule.id);
    requireRuleShape(rule, {
      kind: CustomerPriceRuleKind.BASE,
      calculationType: CustomerPriceCalculationType.PER_PIECE,
    });
    const condition = processingCondition(rule);
    if (
      condition.target !== 'ITEM' ||
      !hasOnly(condition.pricingRoutes, 'CUSTOM_SINGLE_FLAT_FOIL') ||
      !Number.isSafeInteger(rule.minQty) ||
      rule.minQty === null ||
      rule.minQty < 1 ||
      (rule.maxQty !== null &&
        (!Number.isSafeInteger(rule.maxQty) || rule.maxQty < rule.minQty))
    ) {
      invalidRule(rule, '\u4e13\u7248\u9636\u68af\u7684\u8def\u7ebf\u6216\u6570\u91cf\u533a\u95f4\u65e0\u6548');
    }
    const specification = canonicalSpecificationFromRule(
      exactlyOne(condition.specifications, rule, '\u89c4\u683c'),
      rule,
    );
    const papers = (condition.paperTypes ?? []).map((paper) =>
      canonicalPaperFromRule(paper, rule),
    );
    if (papers.length === 0) invalidRule(rule, '\u4e13\u7248\u9636\u68af\u672a\u58f0\u660e\u9002\u7528\u7eb8\u5f20');
    const paperKeys = papers.map(paperKey);
    if (new Set(paperKeys).size !== paperKeys.length) {
      invalidRule(rule, '\u4e13\u7248\u9636\u68af\u7684\u7eb8\u5f20\u8303\u56f4\u89c4\u8303\u5316\u540e\u91cd\u590d');
    }
    return {
      rule,
      specification,
      pricingGroup: pricingGroupForSpecification(specification, rule),
      minQuantity: rule.minQty,
      maxQuantity:
        rule.maxQty === MAX_PERSISTED_QUANTITY ? null : rule.maxQty,
      persistedMaxQuantity: rule.maxQty,
      unitPrice: normalizedDecimal(rule.amount, {
        rule,
        label: '\u4e13\u7248\u9636\u68af\u5355\u4ef7',
        nullable: true,
      }),
      papers,
    };
  });

  const canonicalPaperUniverse = candidates[0]!.papers
    .map(paperKey)
    .sort(compareText);
  for (const candidate of candidates.slice(1)) {
    if (
      !sameStringSet(
        candidate.papers.map(paperKey).sort(compareText),
        canonicalPaperUniverse,
      )
    ) {
      invalidRule(candidate.rule, '\u5404\u4e13\u7248\u9636\u68af\u7684\u9002\u7528\u7eb8\u5f20\u8303\u56f4\u4e0d\u4e00\u81f4');
    }
  }

  const byInterval = new Map<string, FullTierCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.minQuantity}:${candidate.persistedMaxQuantity ?? 'NULL'}`;
    byInterval.set(key, [...(byInterval.get(key) ?? []), candidate]);
  }
  const intervals = [...byInterval.values()].sort(
    (left, right) => left[0]!.minQuantity - right[0]!.minQuantity,
  );
  let expectedMinimum = 1;
  const unitPrices: CreateOrderPriceSnapshot['full']['unitPrices'][number][] = [];
  for (const interval of intervals) {
    const first = interval[0]!;
    if (first.minQuantity !== expectedMinimum) {
      invalidRule(first.rule, '\u4e13\u7248\u9636\u68af\u6570\u91cf\u533a\u95f4\u5b58\u5728\u7a7a\u6863\u6216\u91cd\u53e0');
    }
    const specifications = interval.map((candidate) => candidate.specification);
    if (
      new Set(specifications).size !== specifications.length ||
      specifications.length !== REQUIRED_FULL_SPECIFICATIONS.size ||
      [...REQUIRED_FULL_SPECIFICATIONS].some(
        (specification) => !specifications.includes(specification),
      )
    ) {
      invalidRule(first.rule, '\u4e13\u7248\u9636\u68af\u6bcf\u6863\u5fc5\u987b\u5b8c\u6574\u8986\u76d6\u4e2d\u53f7\u3001\u65b9\u5f62\u3001\u5927\u53f7\u4e0e\u897f\u5c01');
    }
    for (const pricingGroup of ['MID', 'LARGE'] as const) {
      const groupCandidates = interval.filter(
        (candidate) => candidate.pricingGroup === pricingGroup,
      );
      const prices = [...new Set(groupCandidates.map((candidate) => candidate.unitPrice))];
      if (prices.length !== 1) {
        invalidRule(groupCandidates[1]!.rule, `\u4e13\u7248${pricingGroup}\u7ec4\u540c\u4e00\u6863\u4ef7\u683c\u4e0d\u4e00\u81f4`);
      }
      const representativeSpecification =
        pricingGroup === 'MID' ? '\u4e2d\u53f7\u5c01' : '\u5927\u53f7\u5c01';
      const representative = groupCandidates.find(
        (candidate) => candidate.specification === representativeSpecification,
      )!;
      unitPrices.push({
        tierCode: textCode(representative.rule.code),
        pricingGroup,
        minQuantity: representative.minQuantity,
        maxQuantity: representative.maxQuantity,
        unitPrice: representative.unitPrice,
      });
    }
    if (first.maxQuantity === null) {
      expectedMinimum = Number.POSITIVE_INFINITY;
    } else {
      expectedMinimum = first.maxQuantity + 1;
    }
  }
  if (expectedMinimum !== Number.POSITIVE_INFINITY) {
    invalidRule(intervals.at(-1)![0]!.rule, '\u4e13\u7248\u9636\u68af\u672a\u8986\u76d6\u6700\u540e\u4e00\u4e2a\u65e0\u4e0a\u9650\u533a\u95f4');
  }

  const surchargeRules = rules.filter(
    (rule) => rule.exclusiveGroup === 'CUSTOM_PAPER_SURCHARGE',
  );
  const surchargeByPaper = new Map<
    string,
    { paper: CanonicalCreateOrderPaperFact; rule: PublishedCreateOrderRuleRow }
  >();
  const paperSurcharges = surchargeRules.map((rule) => {
    consumed.add(rule.id);
    requireRuleShape(rule, {
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.PER_PIECE,
    });
    const condition = processingCondition(rule);
    if (
      condition.target !== 'ITEM' ||
      !hasOnly(condition.pricingRoutes, 'CUSTOM_SINGLE_FLAT_FOIL')
    ) {
      invalidRule(rule, '\u4e13\u7248\u7eb8\u5f20\u52a0\u4ef7\u672a\u552f\u4e00\u9650\u5b9a\u4e13\u7248\u8def\u7ebf');
    }
    const paper = canonicalPaperFromRule(
      exactlyOne(condition.paperTypes, rule, '\u7eb8\u5f20'),
      rule,
    );
    const key = paperKey(paper);
    if (surchargeByPaper.has(key)) {
      throw new PublishedCreateOrderPriceAdapterError(
        'DUPLICATE_RULE',
        `\u4e13\u7248\u7eb8\u5f20 ${paper.paperType} ${paper.paperWeightGsm}g \u5b58\u5728\u91cd\u590d\u52a0\u4ef7`,
        ruleIdentity(rule),
      );
    }
    surchargeByPaper.set(key, { paper, rule });
    return {
      ...paper,
      unitSurcharge: normalizedDecimal(rule.amount, {
        rule,
        label: '\u4e13\u7248\u7eb8\u5f20\u52a0\u4ef7',
        nullable: true,
      }),
    };
  });
  const baselineWeight = processingBaselineWeight(processingNotes);
  if (baselineWeight === null) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_RULE',
      '\u5df2\u53d1\u5e03\u52a0\u5de5\u8d39\u4ef7\u76ee\u7c3f\u7f3a\u5c11\u4e13\u7248\u57fa\u51c6\u7eb8\u5f20\u514b\u91cd\u58f0\u660e',
    );
  }
  const paperUniverse = candidates[0]!.papers;
  for (const key of surchargeByPaper.keys()) {
    if (!canonicalPaperUniverse.includes(key)) {
      invalidRule(surchargeByPaper.get(key)!.rule, '\u7eb8\u5f20\u52a0\u4ef7\u4e0d\u5728\u4e13\u7248\u9636\u68af\u7684\u7eb8\u5f20\u8303\u56f4\u5185');
    }
  }
  const basePapers = paperUniverse.filter(
    (paper) => !surchargeByPaper.has(paperKey(paper)),
  );
  if (
    basePapers.length !== 2 ||
    basePapers.some((paper) => paper.paperWeightGsm !== baselineWeight)
  ) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_RULE',
      '\u4e13\u7248\u7eb8\u5f20\u57fa\u51c6\u96c6\u4e0e\u52a0\u4ef7\u96c6\u4e0d\u80fd\u552f\u4e00\u95ed\u5408',
    );
  }

  const secondColor = requireOneRule(
    rules.filter((rule) => textCode(rule.code) === 'CUSTOM_DOUBLE_COLOR'),
    '\u4e13\u7248\u53cc\u8272\u52a0\u4ef7',
  );
  const western = requireOneRule(
    rules.filter((rule) => textCode(rule.code) === 'CUSTOM_WESTERN_ENVELOPE'),
    '\u4e13\u7248\u897f\u5c01\u52a0\u4ef7',
  );
  const effectPiece = requireOneRule(
    rules.filter(
      (rule) => textCode(rule.code) === 'CUSTOM_RELIEF_OR_RAISED_PIECE',
    ),
    '\u4e13\u7248\u6d6e\u96d5\u6216\u6fc0\u51f8\u5355\u4ef7',
  );
  const effectSetup = requireOneRule(
    rules.filter(
      (rule) => textCode(rule.code) === 'CUSTOM_RELIEF_OR_RAISED_SETUP',
    ),
    '\u4e13\u7248\u6d6e\u96d5\u6216\u6fc0\u51f8\u8c03\u7248\u8d39',
  );
  for (const [rule, calculationType] of [
    [secondColor, CustomerPriceCalculationType.PER_PIECE],
    [western, CustomerPriceCalculationType.PER_PIECE],
    [effectPiece, CustomerPriceCalculationType.PER_PIECE],
    [effectSetup, CustomerPriceCalculationType.FIXED_AMOUNT],
  ] as const) {
    consumed.add(rule.id);
    requireRuleShape(rule, {
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType,
    });
    const condition = processingCondition(rule);
    if (!hasOnly(condition.pricingRoutes, 'CUSTOM_SINGLE_FLAT_FOIL')) {
      invalidRule(rule, '\u4e13\u7248\u5de5\u827a\u52a0\u4ef7\u672a\u552f\u4e00\u9650\u5b9a\u4e13\u7248\u8def\u7ebf');
    }
  }
  if (processingCondition(secondColor).foilColorCount !== 2) {
    invalidRule(secondColor, '\u53cc\u8272\u52a0\u4ef7\u5fc5\u987b\u7cbe\u786e\u5339\u914d 2 \u8272');
  }
  if (
    !hasOnly(
      processingCondition(western).productStructures,
      'WESTERN_ENVELOPE',
    )
  ) {
    invalidRule(western, '\u897f\u5c01\u52a0\u4ef7\u5fc5\u987b\u7cbe\u786e\u5339\u914d\u897f\u5c01\u7ed3\u6784');
  }
  for (const rule of [effectPiece, effectSetup]) {
    const techniques = processingCondition(rule).foilTechniques ?? [];
    if (
      !sameStringSet([...techniques].sort(), ['RAISED', 'RELIEF'])
    ) {
      invalidRule(rule, '\u7279\u6b8a\u5de5\u827a\u52a0\u4ef7\u5fc5\u987b\u540c\u65f6\u4e14\u4ec5\u8986\u76d6\u6d6e\u96d5\u3001\u6fc0\u51f8');
    }
  }
  const effectUnitSurcharge = normalizedDecimal(effectPiece.amount, {
    rule: effectPiece,
    label: '\u7279\u6b8a\u5de5\u827a\u5355\u4ef7',
    nullable: true,
  });
  const effectSetupFee = normalizedDecimal(effectSetup.amount, {
    rule: effectSetup,
    label: '\u7279\u6b8a\u5de5\u827a\u8c03\u7248\u8d39',
    nullable: true,
  });

  return {
    snapshot: {
      unitPrices,
      basePapers: [...basePapers].sort((left, right) =>
        compareText(paperKey(left), paperKey(right)),
      ),
      paperSurcharges: paperSurcharges.sort((left, right) =>
        compareText(paperKey(left), paperKey(right)),
      ),
      secondColorUnitSurcharge: normalizedDecimal(secondColor.amount, {
        rule: secondColor,
        label: '\u53cc\u8272\u52a0\u4ef7',
        nullable: true,
      }),
      westEnvelopeUnitSurcharge: normalizedDecimal(western.amount, {
        rule: western,
        label: '\u897f\u5c01\u52a0\u4ef7',
        nullable: true,
      }),
      specialEffects: [
        {
          effect: 'RELIEF',
          unitSurcharge: effectUnitSurcharge,
          setupFee: effectSetupFee,
        },
        {
          effect: 'RAISED',
          unitSurcharge: effectUnitSurcharge,
          setupFee: effectSetupFee,
        },
      ],
    },
    tierCodes: tierRules.map((rule) => textCode(rule.code)).sort(compareText),
    paperSurchargeCodes: surchargeRules
      .map((rule) => textCode(rule.code))
      .sort(compareText),
    otherSurchargeCodes: [secondColor, western, effectPiece, effectSetup]
      .map((rule) => textCode(rule.code))
      .sort(compareText),
  };
}

function tierQuantityFromCode(
  rule: PublishedCreateOrderRuleRow,
): number {
  const match = /_Q(\d+)$/iu.exec(textCode(rule.code));
  const quantity = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return invalidRule(rule, '\u5f69\u5370\u6863\u4f4d\u7f16\u7801\u7f3a\u5c11 _Q\u6570\u91cf \u8eab\u4efd');
  }
  if (
    (rule.minQty !== null && quantity < rule.minQty) ||
    (rule.maxQty !== null && quantity > rule.maxQty)
  ) {
    return invalidRule(rule, '\u5f69\u5370\u6863\u4f4d\u7f16\u7801\u4e0e\u5b9e\u9645\u6570\u91cf\u533a\u95f4\u77db\u76fe');
  }
  return quantity;
}

function projectPrint(
  rules: readonly PublishedCreateOrderRuleRow[],
  consumed: Set<string>,
): {
  snapshot: CreateOrderPriceSnapshot['print'];
  baseCodes: string[];
  foilCodes: string[];
} {
  const baseRules = rules.filter(
    (rule) => rule.exclusiveGroup === 'COLOR_BASE',
  );
  if (baseRules.length === 0) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_RULE',
      '\u5df2\u53d1\u5e03\u52a0\u5de5\u8d39\u4ef7\u76ee\u7c3f\u7f3a\u5c11\u5f69\u5370\u9636\u68af\u603b\u4ef7',
    );
  }
  const seenBaseKeys = new Map<string, PublishedCreateOrderRuleRow>();
  const perOrderPrices = baseRules.map((rule) => {
    consumed.add(rule.id);
    requireRuleShape(rule, {
      kind: CustomerPriceRuleKind.BASE,
      calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
    });
    const condition = processingCondition(rule);
    if (
      condition.target !== 'ITEM' ||
      !hasOnly(condition.pricingRoutes, 'COLOR_PRINT')
    ) {
      invalidRule(rule, '\u5f69\u5370\u57fa\u7840\u4ef7\u672a\u552f\u4e00\u9650\u5b9a\u5f69\u5370\u8def\u7ebf');
    }
    const paper = canonicalPaperFromRule(
      exactlyOne(condition.paperTypes, rule, '\u7eb8\u5f20'),
      rule,
    );
    const specification = canonicalSpecificationFromRule(
      exactlyOne(condition.specifications, rule, '\u89c4\u683c'),
      rule,
    );
    const tierQuantity = tierQuantityFromCode(rule);
    const key = `${paperKey(paper)}\u0000${specification}\u0000${tierQuantity}`;
    const previous = seenBaseKeys.get(key);
    if (previous) {
      throw new PublishedCreateOrderPriceAdapterError(
        'DUPLICATE_RULE',
        `\u5f69\u5370\u9636\u68af\u540c\u65f6\u547d\u4e2d ${textCode(previous.code)} \u4e0e ${textCode(rule.code)}`,
        ruleIdentity(rule),
      );
    }
    seenBaseKeys.set(key, rule);
    return {
      ...paper,
      specification,
      tierQuantity,
      amount: normalizedDecimal(rule.amount, {
        rule,
        label: '\u5f69\u5370\u9636\u68af\u603b\u4ef7',
        nullable: true,
      }),
    };
  });

  const foilRules = rules.filter(
    (rule) => rule.exclusiveGroup === 'COLOR_SINGLE_FRONT_FOIL',
  );
  if (foilRules.length === 0) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_RULE',
      '\u5df2\u53d1\u5e03\u52a0\u5de5\u8d39\u4ef7\u76ee\u7c3f\u7f3a\u5c11\u5f69\u5370\u5355\u8272\u70eb\u91d1\u52a0\u4ef7',
    );
  }
  const seenFoilTiers = new Map<number, PublishedCreateOrderRuleRow>();
  const foilPerOrderPrices = foilRules.flatMap((rule) => {
    consumed.add(rule.id);
    requireRuleShape(rule, {
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
    });
    const condition = processingCondition(rule);
    if (
      condition.target !== 'ITEM' ||
      !hasOnly(condition.pricingRoutes, 'COLOR_PRINT') ||
      condition.foilPassCount !== 1
    ) {
      invalidRule(rule, '\u5f69\u5370\u70eb\u91d1\u52a0\u4ef7\u5fc5\u987b\u552f\u4e00\u5339\u914d\u5f69\u5370\u5355\u6b21\u70eb\u91d1');
    }
    const tierQuantity = tierQuantityFromCode(rule);
    const previous = seenFoilTiers.get(tierQuantity);
    if (previous) {
      throw new PublishedCreateOrderPriceAdapterError(
        'DUPLICATE_RULE',
        `\u5f69\u5370\u70eb\u91d1 ${tierQuantity} \u6863\u540c\u65f6\u5b58\u5728 ${textCode(previous.code)} \u4e0e ${textCode(rule.code)}`,
        ruleIdentity(rule),
      );
    }
    seenFoilTiers.set(tierQuantity, rule);
    const amount = normalizedDecimal(rule.amount, {
      rule,
      label: '\u5f69\u5370\u5355\u8272\u70eb\u91d1\u603b\u4ef7',
      nullable: true,
    });
    return (['PARTIAL', 'FULL'] as const).map((mode) => ({
      mode,
      foilPassCount: 1,
      tierQuantity,
      amount,
    }));
  });

  return {
    snapshot: {
      perOrderPrices: perOrderPrices.sort(
        (left, right) =>
          compareText(
            `${left.paperType}:${left.paperWeightGsm}:${left.specification}`,
            `${right.paperType}:${right.paperWeightGsm}:${right.specification}`,
          ) || left.tierQuantity - right.tierQuantity,
      ),
      foilPerOrderPrices: foilPerOrderPrices.sort(
        (left, right) =>
          left.tierQuantity - right.tierQuantity ||
          compareText(left.mode, right.mode),
      ),
    },
    baseCodes: baseRules.map((rule) => textCode(rule.code)).sort(compareText),
    foilCodes: foilRules.map((rule) => textCode(rule.code)).sort(compareText),
  };
}

function projectBagging(
  rules: readonly PublishedCreateOrderRuleRow[],
  consumed: Set<string>,
): { snapshot: CreateOrderPriceSnapshot['bagging']; codes: string[] } {
  const baggingRules = rules.filter(
    (rule) => rule.exclusiveGroup === 'PACKAGING_GROUP_MODE',
  );
  const single = requireOneRule(
    baggingRules.filter(
      (rule) =>
        processingCondition(rule).packagingModes?.includes('SINGLE_STYLE'),
    ),
    '\u5e38\u89c4\u5165\u888b\u8d39',
  );
  const mixed = requireOneRule(
    baggingRules.filter((rule) =>
      processingCondition(rule).packagingModes?.includes('MIXED_STYLE'),
    ),
    '\u6df7\u88c5\u5165\u888b\u8d39',
  );
  for (const [rule, mode] of [
    [single, 'SINGLE_STYLE'],
    [mixed, 'MIXED_STYLE'],
  ] as const) {
    consumed.add(rule.id);
    requireRuleShape(rule, {
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.PER_BAG,
    });
    const condition = processingCondition(rule);
    if (
      condition.target !== 'PACKAGING_GROUP' ||
      !hasOnly(condition.packagingModes, mode) ||
      rule.minQty !== null ||
      rule.maxQty !== null
    ) {
      invalidRule(rule, '\u5165\u888b\u8d39\u5fc5\u987b\u6309\u5305\u88c5\u7ec4\u7684\u552f\u4e00\u6a21\u5f0f\u6309\u888b\u8ba1\u4ef7');
    }
  }
  return {
    snapshot: {
      standardPerBag: normalizedDecimal(single.amount, {
        rule: single,
        label: '\u5e38\u89c4\u5165\u888b\u8d39',
      })!,
      mixedPerBag: normalizedDecimal(mixed.amount, {
        rule: mixed,
        label: '\u6df7\u88c5\u5165\u888b\u8d39',
      })!,
    },
    codes: baggingRules.map((rule) => textCode(rule.code)).sort(compareText),
  };
}

function positivePolicyDecimal(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.gt(0) && parsed.decimalPlaces() <= 4
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function projectLogisticsPolicy(notes: unknown): ExternalOrderLogisticsPolicy {
  if (!isRecord(notes) || !isRecord(notes.shipping)) {
    throw new PublishedCreateOrderPriceAdapterError(
      'INVALID_LOGISTICS_POLICY',
      '\u5df2\u53d1\u5e03\u7269\u6d41\u4ef7\u76ee\u7c3f\u7f3a\u5c11\u7248\u672c\u5316\u91cd\u91cf\u7b56\u7565',
    );
  }
  const ruleVersion =
    typeof notes.ruleVersion === 'string' ? notes.ruleVersion.trim() : '';
  const shipping = notes.shipping;
  if (
    !ruleVersion ||
    shipping.billableWeightInput !==
      'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE' ||
    !Array.isArray(shipping.weightResolutionOrder) ||
    shipping.weightResolutionOrder.length !== 2 ||
    shipping.weightResolutionOrder[0] !== 'ACTUAL_FULFILLMENT_WEIGHT' ||
    shipping.weightResolutionOrder[1] !== 'SERVER_ESTIMATE' ||
    shipping.billableWeightRounding !== 'CEIL_KG' ||
    !Number.isSafeInteger(shipping.maxOrderQuantity) ||
    Number(shipping.maxOrderQuantity) < 1 ||
    !isRecord(shipping.gramsPerItemByPaperWeightGsm)
  ) {
    throw new PublishedCreateOrderPriceAdapterError(
      'INVALID_LOGISTICS_POLICY',
      '\u5df2\u53d1\u5e03\u7269\u6d41\u4ef7\u76ee\u7c3f\u7684\u91cd\u91cf\u7b56\u7565\u7ed3\u6784\u65e0\u6548',
    );
  }
  const minimumBillableWeightKg = positivePolicyDecimal(
    shipping.minimumBillableWeightKg,
  );
  const tenThousandEnvelopeGramsPerItem = positivePolicyDecimal(
    shipping.tenThousandEnvelopeGramsPerItem,
  );
  const gramsPerItemByPaperWeightGsm: Record<string, string> = {};
  for (const [gsm, value] of Object.entries(
    shipping.gramsPerItemByPaperWeightGsm,
  )) {
    const amount = positivePolicyDecimal(value);
    if (!/^[1-9]\d*$/u.test(gsm) || !Number.isSafeInteger(Number(gsm)) || !amount) {
      throw new PublishedCreateOrderPriceAdapterError(
        'INVALID_LOGISTICS_POLICY',
        `\u7269\u6d41\u4ef7\u76ee\u7c3f\u7684 ${gsm}g \u5355\u4e2a\u91cd\u91cf\u65e0\u6548`,
      );
    }
    gramsPerItemByPaperWeightGsm[gsm] = amount;
  }
  if (
    !minimumBillableWeightKg ||
    !tenThousandEnvelopeGramsPerItem ||
    Object.keys(gramsPerItemByPaperWeightGsm).length === 0
  ) {
    throw new PublishedCreateOrderPriceAdapterError(
      'INVALID_LOGISTICS_POLICY',
      '\u7269\u6d41\u4ef7\u76ee\u7c3f\u7684\u6700\u4f4e\u91cd\u91cf\u6216\u5355\u4e2a\u91cd\u91cf\u7f3a\u5931',
    );
  }
  return {
    ruleVersion,
    billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
    weightResolutionOrder: [
      'ACTUAL_FULFILLMENT_WEIGHT',
      'SERVER_ESTIMATE',
    ],
    maxOrderQuantity: Number(shipping.maxOrderQuantity),
    billableWeightRounding: 'CEIL_KG',
    minimumBillableWeightKg,
    gramsPerItemByPaperWeightGsm,
    tenThousandEnvelopeGramsPerItem,
  };
}

function exactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => key in value);
}

function ruleSource(
  rule: PublishedCreateOrderRuleRow,
): ExternalOrderChargeSource {
  if (
    !rule.sourceName?.trim() ||
    !rule.sourceSheet?.trim() ||
    !rule.sourceRange?.trim() ||
    !rule.sourceSha256 ||
    !SHA256.test(rule.sourceSha256)
  ) {
    return invalidRule(rule, '\u7269\u6d41\u89c4\u5219\u7f3a\u5c11\u5b8c\u6574\u6765\u6e90\u5feb\u7167');
  }
  return {
    fileName: rule.sourceName,
    sha256: rule.sourceSha256,
    sheetName: rule.sourceSheet,
    sourceRange: rule.sourceRange,
  };
}

function projectLogistics(
  rules: readonly PublishedCreateOrderRuleRow[],
  notes: unknown,
): {
  rules: ExternalOrderChargeRule[];
  policy: ExternalOrderLogisticsPolicy;
  codes: string[];
} {
  const shipping = rules.filter(
    (rule) => textCode(rule.category.code) === 'SHIPPING_FEE',
  );
  const cartons = rules.filter(
    (rule) => textCode(rule.category.code) === 'PACKING_MATERIAL',
  );
  if (shipping.length === 0 || cartons.length === 0) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_RULE',
      '\u7269\u6d41\u4ef7\u76ee\u7c3f\u5fc5\u987b\u540c\u65f6\u5305\u542b\u5feb\u9012\u4e0e\u7eb8\u7bb1\u89c4\u5219',
    );
  }
  const provinceOwners = new Map<string, PublishedCreateOrderRuleRow>();
  const shippingRules = shipping.map((rule) => {
    requireRuleShape(rule, {
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
    });
    if (
      rule.exclusiveGroup !== 'ZTO_PROVINCE_RATE' ||
      rule.minQty !== null ||
      rule.maxQty !== null ||
      rule.blocksAutomaticQuote ||
      !isRecord(rule.triggerCondition) ||
      !exactObjectKeys(rule.triggerCondition, ['carrierCode', 'provinces']) ||
      rule.triggerCondition.carrierCode !== 'ZTO' ||
      !Array.isArray(rule.triggerCondition.provinces) ||
      rule.triggerCondition.provinces.length === 0 ||
      rule.triggerCondition.provinces.some(
        (province) => typeof province !== 'string' || !province.trim(),
      )
    ) {
      invalidRule(rule, '\u5feb\u9012\u8d39\u7684\u4e2d\u901a\u5730\u533a\u6761\u4ef6\u65e0\u6548');
    }
    const provinces = rule.triggerCondition.provinces as string[];
    for (const province of provinces) {
      const previous = provinceOwners.get(province);
      if (previous) {
        throw new PublishedCreateOrderPriceAdapterError(
          'DUPLICATE_RULE',
          `\u4e2d\u901a\u5730\u533a ${province} \u540c\u65f6\u7531 ${textCode(previous.code)} \u4e0e ${textCode(rule.code)} \u8ba1\u4ef7`,
          ruleIdentity(rule),
        );
      }
      provinceOwners.set(province, rule);
    }
    return {
      kind: 'SHIPPING' as const,
      code: textCode(rule.code),
      provinces,
      firstFee: normalizedDecimal(rule.amount, {
        rule,
        label: '\u9996\u91cd\u8d39',
      })!,
      firstWeightKg: normalizedDecimal(rule.includedUnits, {
        rule,
        label: '\u9996\u91cd\u91cd\u91cf',
        positive: true,
      })!,
      additionalUnitKg: normalizedDecimal(rule.incrementUnits, {
        rule,
        label: '\u7eed\u91cd\u5355\u4f4d',
        positive: true,
      })!,
      additionalUnitFee: normalizedDecimal(rule.incrementAmount, {
        rule,
        label: '\u7eed\u91cd\u8d39',
      })!,
      source: ruleSource(rule),
    };
  });
  const missingProvinces = ZTO_PROVINCE_OPTIONS.filter(
    (province) => !provinceOwners.has(province),
  );
  const unsupportedProvinces = [...provinceOwners.keys()].filter(
    (province) => !ZTO_PROVINCE_OPTIONS.includes(province),
  );
  if (missingProvinces.length > 0 || unsupportedProvinces.length > 0) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_RULE',
      `中通地区规则未完整闭合（缺失：${missingProvinces.join('、') || '无'}；额外：${unsupportedProvinces.join('、') || '无'}）`,
    );
  }

  const sortedCartons = [...cartons].sort(
    (left, right) => (left.minQty ?? 0) - (right.minQty ?? 0),
  );
  let nextMinimum = 1;
  const cartonRules = sortedCartons.map((rule) => {
    requireRuleShape(rule, {
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
    });
    if (
      rule.exclusiveGroup !== 'CARTON_ORDER_QUANTITY_TIER' ||
      rule.blocksAutomaticQuote ||
      rule.minQty !== nextMinimum ||
      rule.maxQty === null ||
      rule.maxQty < rule.minQty ||
      !isRecord(rule.triggerCondition) ||
      !exactObjectKeys(rule.triggerCondition, [
        'scope',
        'segmentedAboveMaximum',
      ]) ||
      rule.triggerCondition.scope !== 'ORDER_TOTAL_QUANTITY' ||
      rule.triggerCondition.segmentedAboveMaximum !== true
    ) {
      invalidRule(rule, '\u7eb8\u7bb1\u8d39\u5fc5\u987b\u6309\u6574\u5355\u6570\u91cf\u8fde\u7eed\u5206\u6863\u5e76\u5728\u4e0a\u754c\u4ee5\u4e0a\u5206\u6bb5');
    }
    nextMinimum = rule.maxQty + 1;
    return {
      kind: 'PACKAGING' as const,
      code: textCode(rule.code),
      minQty: rule.minQty,
      maxQty: rule.maxQty,
      amount: normalizedDecimal(rule.amount, {
        rule,
        label: '\u7eb8\u7bb1\u8d39',
      })!,
      advisory: false as const,
      source: ruleSource(rule),
    };
  });
  if (sortedCartons.at(-1)?.maxQty !== 5_000) {
    invalidRule(sortedCartons.at(-1)!, '\u7eb8\u7bb1\u5206\u6bb5\u4e0a\u754c\u5fc5\u987b\u7531\u5df2\u53d1\u5e03 5000 \u6863\u660e\u786e\u63d0\u4f9b');
  }

  const unknown = rules.filter(
    (rule) =>
      textCode(rule.category.code) !== 'SHIPPING_FEE' &&
      textCode(rule.category.code) !== 'PACKING_MATERIAL',
  );
  if (unknown.length > 0) {
    const rule = unknown[0]!;
    throw new PublishedCreateOrderPriceAdapterError(
      'UNSUPPORTED_RULE',
      `\u7269\u6d41\u4ef7\u76ee\u7c3f\u5305\u542b\u65e0\u6cd5\u6295\u5f71\u7684\u6536\u8d39\u89c4\u5219 ${textCode(rule.code)}`,
      ruleIdentity(rule),
    );
  }
  return {
    rules: [...shippingRules, ...cartonRules],
    policy: projectLogisticsPolicy(notes),
    codes: rules.map((rule) => textCode(rule.code)).sort(compareText),
  };
}

const SUPPORTED_BLOCKING_REFERENCE_CODES = new Set([
  'COLOR_BACK_SIDE_FOIL_MANUAL',
  'COLOR_MULTI_FOIL_MANUAL',
  'COLOR_NON_FLAT_FOIL_MANUAL',
  'COLOR_NONSTANDARD_LAMINATION_MANUAL',
  'COLOR_NONSTANDARD_PROCESS_MANUAL',
  'COLOR_SINGLE_FRONT_FOIL_LT_1000_MANUAL',
  'CUSTOM_DOUBLE_SIDED_MANUAL',
  'CUSTOM_TEN_THOUSAND_MANUAL',
  'CUSTOM_THREE_PLUS_COLORS_MANUAL',
]);

function priceVersionBundle(
  snapshot: ExternalCreateOrderPriceSnapshot,
): CreateOrderPriceVersionBundle {
  return {
    processing: {
      id: snapshot.processing.id,
      code: snapshot.processing.code,
      version: snapshot.processing.version,
      sourceSha256: snapshot.processing.sourceSha256,
    },
    logistics: {
      id: snapshot.logistics.id,
      code: snapshot.logistics.code,
      version: snapshot.logistics.version,
      sourceSha256: snapshot.logistics.sourceSha256,
    },
  };
}

/** Pure, fail-closed projection of two exact published rule sets. */
export function projectPublishedCreateOrderPriceSnapshot(
  input: PublishedCreateOrderPriceProjectionInput,
): PublishedCreateOrderPriceProjection {
  const processingRules = input.rules.filter(
    (rule) =>
      rule.isActive && rule.priceBookId === input.priceVersion.processing.id,
  );
  const logisticsRules = input.rules.filter(
    (rule) =>
      rule.isActive && rule.priceBookId === input.priceVersion.logistics.id,
  );
  if (processingRules.length === 0 || logisticsRules.length === 0) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_RULE',
      '\u5f53\u524d\u53cc\u4ef7\u76ee\u7c3f\u4e2d\u6709\u4e00\u6761\u7248\u672c\u6d41\u6ca1\u6709\u542f\u7528\u89c4\u5219',
    );
  }
  assertUniqueCodes(processingRules);
  assertUniqueCodes(logisticsRules);

  const consumed = new Set<string>();
  const partial = projectPartial(processingRules, consumed);
  const full = projectFull(processingRules, input.processingNotes, consumed);
  const print = projectPrint(processingRules, consumed);
  const bagging = projectBagging(processingRules, consumed);
  for (const rule of processingRules) {
    if (consumed.has(rule.id)) continue;
    const code = textCode(rule.code);
    if (
      rule.kind === CustomerPriceRuleKind.REFERENCE &&
      rule.blocksAutomaticQuote &&
      SUPPORTED_BLOCKING_REFERENCE_CODES.has(code)
    ) {
      consumed.add(rule.id);
      continue;
    }
    throw new PublishedCreateOrderPriceAdapterError(
      'UNSUPPORTED_RULE',
      `\u52a0\u5de5\u8d39\u4ef7\u76ee\u7c3f\u5305\u542b\u65e0\u6cd5\u6295\u5f71\u7684\u542f\u7528\u89c4\u5219 ${code}`,
      ruleIdentity(rule),
    );
  }
  const logistics = projectLogistics(logisticsRules, input.logisticsNotes);
  const processingRuleCodes = processingRules
    .map((rule) => textCode(rule.code))
    .sort(compareText);
  const logisticsRuleCodes = logisticsRules
    .map((rule) => textCode(rule.code))
    .sort(compareText);

  return {
    snapshot: {
      priceVersion: priceVersionBundle(input.priceVersion),
      partial: partial.snapshot,
      full: full.snapshot,
      print: print.snapshot,
      bagging: bagging.snapshot,
      plate: { label: '\u5236\u70eb\u91d1\u7248\u8d39' },
      orderCharges: {
        rules: logistics.rules,
        logisticsPolicy: logistics.policy,
      },
    },
    audit: {
      processingRuleCount: processingRules.length,
      logisticsRuleCount: logisticsRules.length,
      processingRuleCodes,
      logisticsRuleCodes,
      projectedRuleCodes: {
        partialBlank: partial.blankCodes,
        partialMachine: partial.machineCodes,
        fullTiers: full.tierCodes,
        fullPaperSurcharges: full.paperSurchargeCodes,
        fullOtherSurcharges: full.otherSurchargeCodes,
        printBase: print.baseCodes,
        printFoil: print.foilCodes,
        bagging: bagging.codes,
        logistics: logistics.codes,
      },
    },
  };
}

const RULE_SELECT = {
  id: true,
  priceBookId: true,
  code: true,
  name: true,
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
  blocksAutomaticQuote: true,
  isActive: true,
  category: { select: { code: true, name: true } },
} as const;

type ProjectionBookMetadata = {
  id: string;
  code: unknown;
  name: string;
  purpose: CustomerPriceBookPurpose;
  version: number;
  sourceSha256: string;
  notes: unknown;
};

function assertProjectionBookMetadata(
  book: ProjectionBookMetadata,
  label: string,
): void {
  if (
    !book.id.trim() ||
    !String(book.code).trim() ||
    !book.name.trim() ||
    !Number.isSafeInteger(book.version) ||
    book.version <= 0 ||
    !SHA256.test(book.sourceSha256)
  ) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_BOOK_DETAILS',
      `${label}\u4ef7\u76ee\u7c3f\u7248\u672c\u8bc1\u636e\u4e0d\u5b8c\u6574\uff0c\u5df2\u62d2\u7edd\u53d1\u5e03`,
    );
  }
}

function projectedProcessingBookMetadata(
  book: ProjectionBookMetadata,
): ExternalCreateOrderPriceSnapshot['processing'] {
  return {
    purpose: CustomerPriceBookPurpose.PROCESSING,
    id: book.id,
    code: String(book.code),
    name: book.name,
    version: book.version,
    sourceSha256: book.sourceSha256,
  };
}

function projectedLogisticsBookMetadata(
  book: ProjectionBookMetadata,
): ExternalCreateOrderPriceSnapshot['logistics'] {
  return {
    purpose: CustomerPriceBookPurpose.LOGISTICS,
    id: book.id,
    code: String(book.code),
    name: book.name,
    version: book.version,
    sourceSha256: book.sourceSha256,
  };
}

/**
 * Project one unpublished candidate together with the exact opposite-purpose
 * book that will be effective at its requested release instant. The candidate
 * is addressed by id instead of `isActive`, so publication can fail closed
 * before either version window is changed.
 */
export async function readCandidatePublishedCreateOrderPriceProjection(
  client: PublishedCreateOrderPriceReadClient,
  options: CandidatePublishedCreateOrderPriceProjectionOptions,
): Promise<PublishedCreateOrderPriceProjection> {
  if (
    !options.candidatePriceBookId.trim() ||
    Number.isNaN(options.effectiveFrom.getTime())
  ) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_BOOK_DETAILS',
      '\u5019\u9009\u4ef7\u76ee\u7c3f\u6216\u751f\u6548\u65f6\u95f4\u65e0\u6548\uff0c\u5df2\u62d2\u7edd\u53d1\u5e03',
    );
  }
  if (!options.snapshotLockHeld) {
    await acquirePriceRuleSnapshotReadLock(client);
  }

  const candidate = await client.customerPriceBook.findUnique({
    where: { id: options.candidatePriceBookId },
    select: {
      id: true,
      code: true,
      name: true,
      settlementType: true,
      purpose: true,
      version: true,
      sourceSha256: true,
      notes: true,
    },
  });
  if (
    !candidate ||
    candidate.settlementType !== OrderSettlementType.EXTERNAL_SALES
  ) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_BOOK_DETAILS',
      '\u5f85\u53d1\u5e03\u7684\u5916\u90e8\u9500\u552e\u4ef7\u76ee\u7c3f\u4e0d\u5b58\u5728',
    );
  }
  assertProjectionBookMetadata(candidate, '\u5019\u9009');

  const counterpartPurpose =
    candidate.purpose === CustomerPriceBookPurpose.PROCESSING
      ? CustomerPriceBookPurpose.LOGISTICS
      : CustomerPriceBookPurpose.PROCESSING;
  const counterparts = await client.customerPriceBook.findMany({
    where: {
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      purpose: counterpartPurpose,
      isActive: true,
      effectiveFrom: { lte: options.effectiveFrom },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gt: options.effectiveFrom } },
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      purpose: true,
      version: true,
      sourceSha256: true,
      notes: true,
    },
    orderBy: [
      { effectiveFrom: 'desc' },
      { version: 'desc' },
      { id: 'asc' },
    ],
    take: 2,
  });
  if (counterparts.length !== 1) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_BOOK_DETAILS',
      counterparts.length === 0
        ? '\u5019\u9009\u7248\u672c\u751f\u6548\u65f6\u7f3a\u5c11\u552f\u4e00\u7684\u914d\u5957\u4ef7\u76ee\u7c3f'
        : '\u5019\u9009\u7248\u672c\u751f\u6548\u65f6\u540c\u65f6\u5b58\u5728\u591a\u4e2a\u914d\u5957\u4ef7\u76ee\u7c3f',
    );
  }
  const counterpart = counterparts[0]!;
  assertProjectionBookMetadata(counterpart, '\u914d\u5957');

  const priceVersion: ExternalCreateOrderPriceSnapshot =
    candidate.purpose === CustomerPriceBookPurpose.PROCESSING
      ? {
          processing: projectedProcessingBookMetadata(candidate),
          logistics: projectedLogisticsBookMetadata(counterpart),
        }
      : {
          processing: projectedProcessingBookMetadata(counterpart),
          logistics: projectedLogisticsBookMetadata(candidate),
        };
  const rules = await client.customerPriceRule.findMany({
    where: {
      priceBookId: {
        in: [priceVersion.processing.id, priceVersion.logistics.id],
      },
    },
    select: RULE_SELECT,
    orderBy: [{ priceBookId: 'asc' }, { code: 'asc' }, { id: 'asc' }],
  });

  return projectPublishedCreateOrderPriceSnapshot({
    priceVersion,
    processingNotes:
      candidate.purpose === CustomerPriceBookPurpose.PROCESSING
        ? candidate.notes
        : counterpart.notes,
    logisticsNotes:
      candidate.purpose === CustomerPriceBookPurpose.LOGISTICS
        ? candidate.notes
        : counterpart.notes,
    rules: rules as PublishedCreateOrderRuleRow[],
  });
}

/**
 * Read the unchanged dual-version identity first, then project only rules from
 * those exact two ids while the same transaction still holds the shared lock.
 */
export async function readPublishedCreateOrderPriceProjection(
  client: PublishedCreateOrderPriceReadClient,
  options: { now?: Date; snapshotLockHeld?: boolean } = {},
): Promise<PublishedCreateOrderPriceProjection> {
  const priceVersion = await readExternalCreateOrderPriceSnapshot(client, options);
  const bookIds = [priceVersion.processing.id, priceVersion.logistics.id];
  const [books, rules] = await Promise.all([
    client.customerPriceBook.findMany({
      where: { id: { in: bookIds } },
      select: { id: true, notes: true },
      orderBy: { id: 'asc' },
    }),
    client.customerPriceRule.findMany({
      where: { priceBookId: { in: bookIds } },
      select: RULE_SELECT,
      orderBy: [{ priceBookId: 'asc' }, { code: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const notesById = new Map(books.map((book) => [book.id, book.notes]));
  if (!notesById.has(priceVersion.processing.id) || !notesById.has(priceVersion.logistics.id)) {
    throw new PublishedCreateOrderPriceAdapterError(
      'MISSING_BOOK_DETAILS',
      '\u8bfb\u53d6\u53cc\u4ef7\u76ee\u7c3f\u89c4\u5219\u65f6\u7248\u672c\u8be6\u60c5\u4e0d\u5b8c\u6574',
    );
  }
  return projectPublishedCreateOrderPriceSnapshot({
    priceVersion,
    processingNotes: notesById.get(priceVersion.processing.id),
    logisticsNotes: notesById.get(priceVersion.logistics.id),
    rules: rules as PublishedCreateOrderRuleRow[],
  });
}

export async function readPublishedCreateOrderPriceSnapshot(
  client: PublishedCreateOrderPriceReadClient,
  options: { now?: Date; snapshotLockHeld?: boolean } = {},
): Promise<CreateOrderPriceSnapshot> {
  return (await readPublishedCreateOrderPriceProjection(client, options)).snapshot;
}

export async function loadPublishedCreateOrderPriceSnapshot(
  now: Date = new Date(),
): Promise<CreateOrderPriceSnapshot> {
  return db.$transaction((tx) =>
    readPublishedCreateOrderPriceSnapshot(tx, { now }),
  );
}
