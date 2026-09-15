import { boxPriceRuleDefinition } from './box-packaging-rules';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
} from '../../generated/prisma/enums';

export const CUSTOMER_PRICE_SECTIONS = [
  'blank',
  'machine',
  'tiers',
  'adds',
  'print',
  'ship',
] as const;

export type CustomerPriceSection = (typeof CUSTOMER_PRICE_SECTIONS)[number];

type CustomerPriceSectionRuleIdentity = {
  code: string;
  exclusiveGroup: string | null;
  kind: CustomerPriceRuleKind;
  calculationType: CustomerPriceCalculationType | null;
};

const ADD_ON_CODES = new Set([
  'CUSTOM_WESTERN_ENVELOPE',
  'CUSTOM_DOUBLE_COLOR',
  'CUSTOM_RELIEF_OR_RAISED_PIECE',
  'CUSTOM_RELIEF_OR_RAISED_SETUP',
]);

/**
 * One server-owned section whitelist shared by reads and writes. UI labels,
 * query text and submitted ids never decide which persisted rule belongs to a
 * design-native editor.
 */
export function customerPriceSectionOwnsRule(
  section: CustomerPriceSection,
  purpose: CustomerPriceBookPurpose,
  rule: CustomerPriceSectionRuleIdentity,
): boolean {
  const code = rule.code.toUpperCase();
  const group = rule.exclusiveGroup?.toUpperCase() ?? '';

  if (section === 'blank') {
    return (
      purpose === CustomerPriceBookPurpose.PROCESSING && group === 'STOCK_BASE'
    );
  }
  if (section === 'machine') {
    return (
      purpose === CustomerPriceBookPurpose.PROCESSING &&
      group === 'STOCK_LOCAL_FOIL_MACHINE'
    );
  }
  if (section === 'tiers') {
    return (
      purpose === CustomerPriceBookPurpose.PROCESSING && group === 'CUSTOM_BASE'
    );
  }
  if (section === 'adds') {
    return (
      purpose === CustomerPriceBookPurpose.PROCESSING &&
      rule.kind === CustomerPriceRuleKind.ADD_ON &&
      (code.startsWith('CUSTOM_PAPER_') || ADD_ON_CODES.has(code))
    );
  }
  if (section === 'print') {
    return (
      purpose === CustomerPriceBookPurpose.PROCESSING &&
      (group === 'COLOR_BASE' || group === 'COLOR_SINGLE_FRONT_FOIL')
    );
  }
  if (purpose === CustomerPriceBookPurpose.LOGISTICS) {
    return (
      group === 'CARTON_ORDER_QUANTITY_TIER' || group === 'ZTO_PROVINCE_RATE'
    );
  }
  return (
    purpose === CustomerPriceBookPurpose.PROCESSING &&
    rule.kind === CustomerPriceRuleKind.ADD_ON &&
    ((rule.calculationType === CustomerPriceCalculationType.PER_BAG &&
      (code === 'PACKAGING_SINGLE_STYLE_PER_BAG' || code === 'PACKAGING_MIXED_STYLE_PER_BAG')) ||
      (rule.calculationType === CustomerPriceCalculationType.PER_BOX && Boolean(boxPriceRuleDefinition(code))))
  );
}

/** Resolve one persisted rule identity to its single design-native editor. */
export function customerPriceSectionForRule(
  purpose: CustomerPriceBookPurpose,
  rule: CustomerPriceSectionRuleIdentity,
): CustomerPriceSection | null {
  return (
    CUSTOMER_PRICE_SECTIONS.find((section) =>
      customerPriceSectionOwnsRule(section, purpose, rule),
    ) ?? null
  );
}
