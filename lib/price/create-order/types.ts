import type {
  ExternalOrderChargeRule,
  ExternalOrderLogisticsPolicy,
  ExternalOrderProductStructure,
} from '../external-order-charges';

export type CreateOrderCraft = 'PARTIAL' | 'FULL' | 'PRINT';

export type CreateOrderPackagingMode = 'STANDARD' | 'MIXED';

export type CreateOrderSpecialEffect = 'NONE' | 'RELIEF' | 'RAISED';

export type CreateOrderPrintFoilMode = 'NONE' | 'PARTIAL' | 'FULL';

export type CreateOrderPricingGroup = 'MID' | 'LARGE';

export type CreateOrderManualReasonCode =
  | 'CUSTOM_PAPER'
  | 'MANUAL_PAPER_WEIGHT'
  | 'RESIZED'
  | 'PARTIAL_BLANK_PRICE_NOT_FOUND'
  | 'FULL_PRICE_NOT_FOUND'
  | 'FULL_THREE_OR_MORE_COLORS'
  | 'FULL_TEN_THOUSAND_ENVELOPE'
  | 'PRINT_PRICE_NOT_FOUND'
  | 'PRINT_QUANTITY_OVER_LIMIT'
  | 'PRINT_FOIL_PRICE_NOT_FOUND';

export type CreateOrderManualReason = {
  code: CreateOrderManualReasonCode;
  message: string;
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
  packRaw: string | null;
  pack: number | null;
  packagingMode: CreateOrderPackagingMode;
  customPaper?: boolean;
  paperWeightSource?: 'CATALOG' | 'MANUAL';
  isResized?: boolean;
  specialEffect?: CreateOrderSpecialEffect;
  printFoilMode?: CreateOrderPrintFoilMode;
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
  isSfCollect: boolean;
  shipments: readonly CreateOrderShipmentInput[];
};

export type PartialBlankUnitPrice = {
  paperType: string;
  paperWeightGsm: number;
  specification: string;
  unitPrice: string;
};

export type FullFoilUnitPrice = {
  pricingGroup: CreateOrderPricingGroup;
  minQuantity: number;
  maxQuantity: number | null;
  unitPrice: string;
};

export type FullFoilPaperSurcharge = {
  paperType: string;
  paperWeightGsm: number;
  unitSurcharge: string;
};

export type FullFoilSpecialEffectPrice = {
  effect: Exclude<CreateOrderSpecialEffect, 'NONE'>;
  unitSurcharge: string;
  setupFee: string;
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
  amount: string;
};

export type CreateOrderPriceSnapshot = {
  priceVersion: string;
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
    paperSurcharges: readonly FullFoilPaperSurcharge[];
    secondColorUnitSurcharge: string;
    specialEffects: readonly FullFoilSpecialEffectPrice[];
  };
  print: {
    perOrderPrices: readonly PrintPerOrderPrice[];
    foilPerOrderPrices: readonly PrintFoilPerOrderPrice[];
  };
  bagging: {
    standardPerBag: string;
    mixedPerBag: string;
  };
  plate: {
    label: string;
  };
  orderCharges: {
    rules: readonly ExternalOrderChargeRule[];
    logisticsPolicy: ExternalOrderLogisticsPolicy;
  };
};

export type CreateOrderQuoteLineStatus =
  | 'QUOTED'
  | 'PENDING'
  | 'EXCLUDED_MANUAL';

export type CreateOrderQuoteLine = {
  layer: 'ITEM' | 'ORDER';
  itemKey: string | null;
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
  baggingAmount: string | null;
  /** Complete item amount. Manual and missing-pack items deliberately return null. */
  amount: string | null;
  /** Sum of lines that are safe to show, even if a non-manual input is pending. */
  knownAmount: string;
  lines: readonly CreateOrderQuoteLine[];
  manualReasons: readonly CreateOrderManualReason[];
  errors: readonly string[];
};

export type CreateOrderOrderQuote = {
  amount: string | null;
  knownAmount: string;
  lines: readonly CreateOrderQuoteLine[];
  errors: readonly string[];
};

export type CreateOrderQuoteResult = {
  priceVersion: string;
  status: 'QUOTED' | 'PARTIAL' | 'MANUAL_PRICING_REQUIRED' | 'INVALID_INPUT';
  submittable: boolean;
  items: readonly CreateOrderItemQuote[];
  order: CreateOrderOrderQuote;
  /** Null unless every non-plate charge is known and no item needs manual pricing. */
  total: string | null;
  /** Deterministic sum of all included known lines. */
  knownTotal: string;
  excludedManualItemKeys: readonly string[];
  pendingLineCodes: readonly string[];
  manualReasons: readonly (CreateOrderManualReason & { itemKey: string })[];
  errors: readonly string[];
};
