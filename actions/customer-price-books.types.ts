import type {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
} from '../generated/prisma/enums';
import type { CustomerRuleConditionEditorInput } from '../lib/price/customer-rule-condition';
import type { CustomerPriceSection } from '../lib/price/customer-price-section-membership';

export type CreateCustomerPriceBookDraftActionInput = {
  purpose: CustomerPriceBookPurpose;
  changeReason: string;
};

export type UpdateCustomerPriceRuleDraftActionInput = {
  priceBookId: string;
  ruleId: string;
  /** Exact ISO instant from the draft rule DTO, used for lost-update protection. */
  expectedUpdatedAt: string;
  name: string;
  amount: string | null;
  isActive: boolean;
  /** Processing-only business fields. The locked DAL decides whether they apply. */
  categoryId?: string;
  productId?: string | null;
  kind?: CustomerPriceRuleKind;
  calculationType?: CustomerPriceCalculationType | null;
  /** Processing-only sheet capacity. Required when calculationType is PER_SHEET. */
  unitsPerSheet?: number | null;
  minQty?: number | null;
  maxQty?: number | null;
  blocksAutomaticQuote?: boolean;
  /** Processing-only, closed and versioned matcher. Arbitrary JSON is not accepted. */
  match?: CustomerRuleConditionEditorInput;
  /** Shipping-only business fields. Hidden matching conditions stay server-side. */
  includedUnits?: string | null;
  incrementUnits?: string | null;
  incrementAmount?: string | null;
};

/**
 * Saves every quantity tier in one processing-product group atomically.
 * Group membership and all matching/provenance fields are derived server-side.
 */
export type UpdateCustomerPriceRuleDraftGroupActionInput = {
  priceBookId: string;
  /** One member used by the locked DAL to derive the complete product group. */
  anchorRuleId: string;
  rows: Array<{
    ruleId: string;
    /** Exact ISO instant from the row DTO, used for per-row lost-update protection. */
    expectedUpdatedAt: string;
    amount: string;
    isActive: boolean;
  }>;
};

export type CustomerPricingSectionId = CustomerPriceSection;

/**
 * Saves a complete dedicated rule-center section. The server derives the
 * section membership again and rejects partial or cross-section payloads.
 */
export type UpdateCustomerPriceSectionDraftActionInput = {
  priceBookId: string;
  section: CustomerPricingSectionId;
  rows: Array<{
    ruleId: string;
    expectedUpdatedAt: string;
    amount: string | null;
    minQty: number | null;
    maxQty: number | null;
    includedUnits: string | null;
    incrementUnits: string | null;
    incrementAmount: string | null;
  }>;
};

export type PublishCustomerPriceBookDraftActionInput = {
  priceBookId: string;
  expectedDraftUpdatedAt: string;
  /**
   * Optional Shanghai wall time from an HTML datetime-local control.
   * Omit it (or submit an empty value) for an immediate, server-timestamped
   * release. Explicit future instants remain supported for scheduled releases.
   */
  effectiveFrom?: string;
  /**
   * Optional release-note supplement. Empty values reuse the draft's required
   * change reason so the same explanation is not entered twice.
   */
  publishNote?: string;
  /** Explicit acknowledgement for the L3, all-future-orders impact. */
  confirmedImpact: boolean;
};

export type DiscardCustomerPriceBookDraftActionInput = {
  priceBookId: string;
  expectedDraftUpdatedAt: string;
};

export type CancelScheduledCustomerPriceBookActionInput = {
  priceBookId: string;
  expectedUpdatedAt: string;
  reason: string;
  confirmedImpact: boolean;
};

export type RescheduleCustomerPriceBookActionInput = {
  priceBookId: string;
  expectedUpdatedAt: string;
  /** Shanghai wall time from an HTML datetime-local control. */
  effectiveFrom: string;
  reason: string;
  confirmedImpact: boolean;
};

export type CustomerPriceBookMutationResult =
  | {
      status: 'success';
      priceBookId: string;
      version?: number;
      ruleId?: string;
      ruleIds?: string[];
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
