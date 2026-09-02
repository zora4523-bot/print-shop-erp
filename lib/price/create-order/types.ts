import type {
  ExternalOrderChargeRule,
  ExternalOrderLogisticsPolicy,
  ExternalOrderProductStructure,
} from '../external-order-charges';

export type CreateOrderCraft = 'PARTIAL' | 'FULL' | 'PRINT';

export type CreateOrderPackagingMode = 'SINGLE_STYLE' | 'MIXED_STYLE';

export type CreateOrderSpecialEffect = 'NONE' | 'RELIEF' | 'RAISED';

export type CreateOrderPrintFoilMode = 'NONE' | 'PARTIAL' | 'FULL';

export type CreateOrderPricingGroup = 'MID' | 'LARGE';

export type CreateOrderManualReasonCode =
  | 'CONFIGURATION_OUTSIDE_NOTE'
  | 'CUSTOM_PAPER'
  | 'CUSTOM_CRAFT'
  | 'MANUAL_PAPER_WEIGHT'
  | 'RESIZED'
  | 'PARTIAL_BLANK_PRICE_NOT_FOUND'
  | 'PARTIAL_TEN_THOUSAND_ENVELOPE'
  | 'FULL_PRICE_NOT_FOUND'
  | 'FULL_PAPER_SURCHARGE_NOT_FOUND'
  | 'FULL_WEST_ENVELOPE_SURCHARGE_NOT_FOUND'
  | 'FULL_SECOND_COLOR_SURCHARGE_NOT_FOUND'
  | 'FULL_SPECIAL_EFFECT_PRICE_NOT_FOUND'
  | 'FULL_THREE_OR_MORE_COLORS'
  | 'FULL_TEN_THOUSAND_ENVELOPE'
  | 'PRINT_PRICE_NOT_FOUND'
  | 'PRINT_QUANTITY_OVER_LIMIT'
  | 'PRINT_FINISHING_PRICE_NOT_FOUND'
  | 'PRINT_FOIL_PRICE_NOT_FOUND'
  | 'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE';

export type CreateOrderManualReason = {
  code: CreateOrderManualReasonCode;
  message: string;
};

export type CreateOrderPendingReasonCode =
  | 'BAGGING_INPUT_PENDING'
  | 'PLATE_AMOUNT_PENDING'
  | 'FREIGHT_QUOTE_PENDING';

export type CreateOrderPendingReason = {
  code: CreateOrderPendingReasonCode;
  message: string;
  itemKey?: string;
  groupKey?: string;
  shipmentKey?: string;
};

/**
 * These facts are produced by the server-side catalog normalizer. The pure
 * calculator deliberately does not accept browser-authored "is custom"
 * booleans as pricing authority.
 */
export type CreateOrderConfigurationFacts = {
  paper: 'CATALOG' | 'CUSTOM';
  paperWeight: 'CATALOG' | 'MANUAL';
  specification: 'CATALOG' | 'RESIZED';
  craft: 'CATALOG' | 'CUSTOM';
};

export type CreateOrderQuoteItemInput = {
  itemKey: string;
  fig: number;
  craft: CreateOrderCraft;
  paperType: string;
  paperWeightGsm: number | null;
  specification: string;
  pricingGroup: CreateOrderPricingGroup;
  productStructure: ExternalOrderProductStructure;
  quantity: number;
  frontColors: readonly string[];
  backColors: readonly string[];
  /**
   * Internal create only: one free-text description is the explicit exit for
   * configuration-outside work. External create rejects this field at its
   * command boundary. The pure engine preserves it as a typed manual reason
   * and never turns it into a fabricated zero quote.
   */
  manualPricingReason?: string | null;
  configuration: CreateOrderConfigurationFacts;
  specialEffect?: CreateOrderSpecialEffect;
  printFoilMode?: CreateOrderPrintFoilMode;
  printFinishing?: 'MATTE' | 'TACTILE' | 'GLOSS' | 'LASER';
};

export type CreateOrderPackagingGroupItemInput = {
  itemKey: string;
  unitsPerBag: number | null;
};

export type CreateOrderPackagingGroupInput = {
  groupKey: string;
  mode: CreateOrderPackagingMode;
  items: readonly CreateOrderPackagingGroupItemInput[];
};

export type CreateOrderShipmentInput = {
  shipmentKey: string;
  province: string | null;
  /** Only a server-owned fulfilment fact may be provided here. */
  trustedBillableWeightKg?: string | null;
  itemQuantities: Readonly<Record<string, number>>;
};

export type CreateOrderQuoteInput = {
  items: readonly CreateOrderQuoteItemInput[];
  packagingGroups: readonly CreateOrderPackagingGroupInput[];
  isSfCollect: boolean;
  shipments: readonly CreateOrderShipmentInput[];
  /** External customer charges are included unless an internal caller opts out. */
  includeOrderCharges?: boolean;
};

export type PartialBlankUnitPrice = {
  paperType: string;
  paperWeightGsm: number;
  specification: string;
  /** null is a configured blank (`—`), distinct from a quoted zero. */
  unitPrice: string | null;
};

export type FullFoilUnitPrice = {
  tierCode: string;
  pricingGroup: CreateOrderPricingGroup;
  minQuantity: number;
  maxQuantity: number | null;
  /** null is a configured blank (`—`), distinct from a quoted zero. */
  unitPrice: string | null;
};

export type FullFoilPaperSurcharge = {
  paperType: string;
  paperWeightGsm: number;
  /** null is a configured blank (`—`), distinct from a quoted zero. */
  unitSurcharge: string | null;
};

export type FullFoilSpecialEffectPrice = {
  effect: Exclude<CreateOrderSpecialEffect, 'NONE'>;
  unitSurcharge: string | null;
  setupFee: string | null;
};

export type PrintPerOrderPrice = {
  paperType: string;
  paperWeightGsm: number;
  specification: string;
  tierQuantity: number;
  /** A configured blank is intentional and must trigger manual pricing. */
  amount: string | null;
};

export type PrintFoilPerOrderPrice = {
  mode: Exclude<CreateOrderPrintFoilMode, 'NONE'>;
  foilPassCount: number;
  tierQuantity: number;
  /** null is a configured blank (`—`), distinct from a quoted zero. */
  amount: string | null;
};

/**
 * Published color-print foil amounts are indivisible processing-plus-plate
 * bundles. An explicitly versioned bundle may be quoted atomically, but its
 * plate component must never also create an order-level plate charge.
 */
export const CREATE_ORDER_PRINT_FOIL_PRICING_POLICY =
  'ATOMIC_BUNDLE_INCLUDES_PLATE' as const;

export type CreateOrderPriceVersionEvidence = {
  id: string;
  code: string;
  version: number;
  sourceSha256: string;
};

export type CreateOrderPriceVersionBundle = {
  processing: CreateOrderPriceVersionEvidence;
  logistics: CreateOrderPriceVersionEvidence;
};

export type CreateOrderPriceSnapshot = {
  priceVersion: CreateOrderPriceVersionBundle;
  partial: {
    blankUnitPrices: readonly PartialBlankUnitPrice[];
    machineFee: {
      perPassBelowQuantity: number;
      fixedFeePerPass: string;
      perPiecePerPass: string;
    };
  };
  full: {
    unitPrices: readonly FullFoilUnitPrice[];
    /** Papers declared by the published rules as the zero-surcharge baseline. */
    basePapers: readonly {
      paperType: string;
      paperWeightGsm: number;
    }[];
    paperSurcharges: readonly FullFoilPaperSurcharge[];
    secondColorUnitSurcharge: string | null;
    westEnvelopeUnitSurcharge: string | null;
    specialEffects: readonly FullFoilSpecialEffectPrice[];
  };
  print: {
    perOrderPrices: readonly PrintPerOrderPrice[];
    foilPricingPolicy: typeof CREATE_ORDER_PRINT_FOIL_PRICING_POLICY;
    /** Atomic processing-plus-plate totals, selected only at an exact published tier. */
    foilPerOrderPrices: readonly PrintFoilPerOrderPrice[];
  };
  bagging: {
    standardPerBag: string;
    mixedPerBag: string;
  };
  plate: {
    label: string;
    /**
     * Plate making cannot be inferred reliably from order facts or a price
     * book rule. It always exits automatic pricing through the administrator
     * confirmation workflow.
     */
    pricingPolicy: 'ADMIN_MANUAL_ONLY';
    /** A configured amount must never become part of an automatic snapshot. */
    amount?: never;
  };
  orderCharges: {
    rules: readonly ExternalOrderChargeRule[];
    logisticsPolicy: ExternalOrderLogisticsPolicy;
  };
};

export type CreateOrderQuoteLineStatus =
  | 'QUOTED'
  | 'PENDING_AMOUNT'
  | 'EXCLUDED_MANUAL';

export type CreateOrderQuoteLine = {
  layer: 'ITEM' | 'PACKAGING_GROUP' | 'ORDER';
  itemKey: string | null;
  groupKey: string | null;
  code: string;
  label: string;
  status: CreateOrderQuoteLineStatus;
  amount: string | null;
  includedInKnownTotal: boolean;
  basis: Readonly<Record<string, string | number | boolean | null>>;
  errors: readonly string[];
};

export type CreateOrderItemQuote = {
  itemKey: string;
  fig: number;
  status: 'QUOTED' | 'PARTIAL' | 'MANUAL_PRICING_REQUIRED' | 'INVALID_INPUT';
  unitPrice: string | null;
  processingAmount: string | null;
  /** Complete processing amount. Manual items deliberately return null. */
  amount: string | null;
  /** Sum of lines that are safe to show, even if a non-manual input is pending. */
  knownAmount: string;
  lines: readonly CreateOrderQuoteLine[];
  manualReasons: readonly CreateOrderManualReason[];
  errors: readonly string[];
};

export type CreateOrderPackagingGroupQuote = {
  groupKey: string;
  status: 'QUOTED' | 'PENDING_AMOUNT' | 'EXCLUDED_MANUAL' | 'INVALID_INPUT';
  itemKeys: readonly string[];
  bagCount: number | null;
  amount: string | null;
  knownAmount: string;
  line: CreateOrderQuoteLine;
  errors: readonly string[];
};

export type CreateOrderOrderQuote = {
  amount: string | null;
  knownAmount: string;
  lines: readonly CreateOrderQuoteLine[];
  errors: readonly string[];
};

export type CreateOrderQuoteResult = {
  priceVersion: CreateOrderPriceVersionBundle;
  status: 'QUOTED' | 'PARTIAL' | 'MANUAL_PRICING_REQUIRED' | 'INVALID_INPUT';
  submittable: boolean;
  items: readonly CreateOrderItemQuote[];
  packagingGroups: readonly CreateOrderPackagingGroupQuote[];
  order: CreateOrderOrderQuote;
  /** Null unless every non-plate charge is known and no item needs manual pricing. */
  total: string | null;
  /** Deterministic sum of all included known lines. */
  knownTotal: string;
  excludedManualItemKeys: readonly string[];
  pendingLineCodes: readonly string[];
  manualReasons: readonly (CreateOrderManualReason & { itemKey: string })[];
  pendingReasons: readonly CreateOrderPendingReason[];
  errors: readonly string[];
};
