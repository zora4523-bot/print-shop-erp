import { BLANK_SPECIFICATIONS } from './blank-paper';
import { canonicalizeCreateOrderPaperFact, canonicalizeCreateOrderSpecification } from './create-order/canonical-facts';
import { parseCustomerRuleCondition } from './customer-rule-condition';

export type BlankPriceIdentity = {
  paperType: string;
  paperWeightGsm: number;
  paperLabel: string;
  specification: string;
  specificationKey: (typeof BLANK_SPECIFICATIONS)[number]['key'];
  key: string;
};

/** One canonical identity for persisted rules, matrix cells and order facts. */
export function blankPriceIdentity(input: {
  paperType: string;
  paperWeightGsm?: number | null;
  specification: string;
}): BlankPriceIdentity | null {
  const paper = canonicalizeCreateOrderPaperFact(input.paperType, input.paperWeightGsm);
  const specification = canonicalizeCreateOrderSpecification(input.specification);
  const spec = BLANK_SPECIFICATIONS.find((entry) => entry.label === specification);
  if (!paper || paper.paperWeightGsm > 2000 || /[/／|]/u.test(paper.paperType) || !spec) return null;
  return {
    ...paper, specification: spec.label, specificationKey: spec.key,
    paperLabel: `${paper.paperWeightGsm}g${paper.paperType}`,
    key: `${paper.paperType}\u0000${paper.paperWeightGsm}\u0000${spec.label}`,
  };
}

export function blankPriceIdentityFromCondition(value: unknown): BlankPriceIdentity | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.paperTypes) || raw.paperTypes.length !== 1 ||
      !Array.isArray(raw.specifications) || raw.specifications.length !== 1) return null;
  const condition = parseCustomerRuleCondition(value).condition;
  if (!condition || condition.target !== 'ITEM' || condition.pricingRoutes?.length !== 1 ||
      condition.pricingRoutes[0] !== 'STOCK_BLANK' || condition.paperTypes?.length !== 1 ||
      condition.specifications?.length !== 1) return null;
  return blankPriceIdentity({ paperType: condition.paperTypes[0]!, specification: condition.specifications[0]! });
}

export function blankPriceTriggerCondition(identity: BlankPriceIdentity) {
  return { schemaVersion: 1, target: 'ITEM', pricingRoutes: ['STOCK_BLANK'],
    paperTypes: [identity.paperLabel], specifications: [identity.specification] };
}
