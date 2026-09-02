import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import type { ExternalOrderChargeQuote } from '../price/external-order-charges';
import type {
  CreateOrderItemQuote,
  CreateOrderPackagingGroupQuote,
  CreateOrderPriceVersionBundle,
  CreateOrderQuoteInput,
  CreateOrderQuoteLine,
  CreateOrderQuoteResult as PureCreateOrderQuoteResult,
} from '../price/create-order/types';

export type CreateOrderQuoteComponent = {
  source: 'BASE' | 'ADJUSTMENT';
  sourceId: null;
  name: string;
  adjustmentType:
    | 'PER_SHEET'
    | 'PER_PIECE'
    | 'PER_ORDER'
    | 'PER_10K'
    | 'FIXED_AMOUNT';
  rate: string;
  units: string;
  amount: string;
  categoryCode: string | null;
  categoryName: string | null;
  ruleCode: string;
  sourceSheet: null;
  sourceRange: null;
};

export type CreateOrderItemQuotePreview = {
  components: CreateOrderQuoteComponent[];
  suggestedUnitPrice: string | null;
  suggestedFixedFee: string | null;
  suggestedSubtotal: string | null;
  complete: boolean;
  errors: string[];
  snapshot: Prisma.InputJsonObject;
};

export type CreateOrderPackagingGroupQuotePreview = {
  groupKey: string;
  complete: boolean;
  errors: string[];
  suggestedUnitPrice: string | null;
  suggestedSubtotal: string | null;
  snapshot: Prisma.InputJsonObject;
};

export type CreateOrderPackagingQuotePreview = {
  groups: CreateOrderPackagingGroupQuotePreview[];
  suggestedTotal: string | null;
  requiresAdminConfirmation: boolean;
  errors: string[];
};

export type CreateOrderQuotePresentation = {
  factsKey: string;
  items: CreateOrderItemQuotePreview[];
  packaging: CreateOrderPackagingQuotePreview;
  logistics: ExternalOrderChargeQuote;
  priceVersion: CreateOrderPriceVersionBundle;
  knownTotal: string;
  total: string | null;
  hasManualPricing: boolean;
  totalSemantics: 'COMPLETE' | 'EXCLUDES_MANUAL_ITEMS';
  plateFee: CreateOrderPlateFeePreview | null;
  quoteToken: string;
};

export type CreateOrderPlateFeePreview = {
  status: 'PENDING';
  amount: null;
  displayAmount: '待定';
  label: string;
};

export type CreateOrderProcessingPresentation = {
  items: CreateOrderItemQuotePreview[];
  packaging: CreateOrderPackagingQuotePreview;
};

const BASE_LINE_CODES = new Set([
  'PARTIAL_BLANK',
  'FULL_BASE',
  'PRINT_PER_ORDER',
]);

function basisText(
  basis: CreateOrderQuoteLine['basis'],
  keys: readonly string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = basis[key];
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
  }
  return fallback;
}

function componentCalculationType(
  line: CreateOrderQuoteLine,
): CreateOrderQuoteComponent['adjustmentType'] {
  if (line.basis.pricingModel === 'PER_ORDER') return 'PER_ORDER';
  if (
    line.basis.calculation === 'FIXED_PER_PASS' ||
    line.code === 'FULL_SETUP'
  ) {
    return 'FIXED_AMOUNT';
  }
  return 'PER_PIECE';
}

function presentComponent(
  line: CreateOrderQuoteLine,
): CreateOrderQuoteComponent | null {
  if (line.amount === null) return null;
  return {
    source: BASE_LINE_CODES.has(line.code) ? 'BASE' : 'ADJUSTMENT',
    sourceId: null,
    name: line.label,
    adjustmentType: componentCalculationType(line),
    rate: basisText(
      line.basis,
      ['unitPrice', 'unitSurcharge', 'rate'],
      line.amount,
    ),
    units: basisText(
      line.basis,
      ['quantity', 'passCount', 'bagCount'],
      '1',
    ),
    amount: line.amount,
    categoryCode: null,
    categoryName: null,
    ruleCode: line.code,
    sourceSheet: null,
    sourceRange: null,
  };
}

function splitItemAmount(item: CreateOrderItemQuote, quantity: number): {
  unitPrice: string | null;
  fixedFee: string | null;
} {
  if (item.amount === null) return { unitPrice: null, fixedFee: null };
  if (item.unitPrice === null) {
    return { unitPrice: '0.0000', fixedFee: item.amount };
  }
  const fixedFee = new Decimal(item.amount)
    .minus(new Decimal(item.unitPrice).times(quantity))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (!fixedFee.isFinite() || fixedFee.isNegative()) {
    return { unitPrice: null, fixedFee: null };
  }
  return {
    unitPrice: new Decimal(item.unitPrice).toFixed(4),
    fixedFee: fixedFee.toFixed(2),
  };
}

function presentItem(
  quote: CreateOrderItemQuote,
  input: CreateOrderQuoteInput['items'][number],
  priceVersion: CreateOrderPriceVersionBundle,
): CreateOrderItemQuotePreview {
  const split = splitItemAmount(quote, input.quantity);
  const complete =
    quote.status === 'QUOTED' &&
    quote.amount !== null &&
    split.unitPrice !== null &&
    split.fixedFee !== null;
  const errors = [
    ...quote.errors,
    ...quote.manualReasons.map((reason) => reason.message),
  ];
  return {
    components: quote.lines.flatMap((line) => {
      const component = presentComponent(line);
      return component ? [component] : [];
    }),
    suggestedUnitPrice: complete ? split.unitPrice : null,
    suggestedFixedFee: complete ? split.fixedFee : null,
    suggestedSubtotal: complete ? quote.amount : null,
    complete,
    errors,
    snapshot: {
      schemaVersion: 2,
      engineVersion: 'CREATE_ORDER_PURE_V1',
      priceVersion,
      input: input as unknown as Prisma.InputJsonObject,
      status: quote.status,
      lines: quote.lines as unknown as Prisma.InputJsonArray,
      manualReasons: quote.manualReasons as unknown as Prisma.InputJsonArray,
      errors,
      suggestedUnitPrice: complete ? split.unitPrice : null,
      suggestedFixedFee: complete ? split.fixedFee : null,
      suggestedSubtotal: complete ? quote.amount : null,
      complete,
    },
  };
}

function presentPackagingGroup(
  quote: CreateOrderPackagingGroupQuote,
  priceVersion: CreateOrderPriceVersionBundle,
): CreateOrderPackagingGroupQuotePreview {
  const rate =
    typeof quote.line.basis.rate === 'string'
      ? new Decimal(quote.line.basis.rate).toFixed(4)
      : null;
  const complete =
    quote.status === 'QUOTED' && quote.amount !== null && rate !== null;
  return {
    groupKey: quote.groupKey,
    complete,
    errors: [...quote.errors],
    suggestedUnitPrice: complete ? rate : null,
    suggestedSubtotal: complete ? quote.amount : null,
    snapshot: {
      schemaVersion: 2,
      engineVersion: 'CREATE_ORDER_PURE_V1',
      priceVersion,
      status: quote.status,
      itemKeys: [...quote.itemKeys],
      bagCount: quote.bagCount,
      line: quote.line as unknown as Prisma.InputJsonObject,
      errors: [...quote.errors],
      complete,
    },
  };
}

export function presentCreateOrderQuote(args: {
  factsKey: string;
  input: CreateOrderQuoteInput;
  quote: PureCreateOrderQuoteResult;
  logistics: ExternalOrderChargeQuote;
  quoteToken: string;
}): CreateOrderQuotePresentation {
  const processing = presentCreateOrderProcessingQuote(args);
  const hasManualPricing =
    args.quote.status !== 'QUOTED' ||
    processing.packaging.requiresAdminConfirmation ||
    !args.logistics.complete;

  return {
    factsKey: args.factsKey,
    ...processing,
    logistics: args.logistics,
    priceVersion: args.quote.priceVersion,
    knownTotal: args.quote.knownTotal,
    total: args.quote.total,
    hasManualPricing,
    totalSemantics: hasManualPricing
      ? 'EXCLUDES_MANUAL_ITEMS'
      : 'COMPLETE',
    plateFee: presentCreateOrderPlateFee(args.quote),
    quoteToken: args.quoteToken,
  };
}

export function presentCreateOrderPlateFee(
  quote: PureCreateOrderQuoteResult,
): CreateOrderPlateFeePreview | null {
  const plateLine = quote.order.lines.find((line) => line.code === 'PLATE_FEE');
  return plateLine
    ? {
        status: 'PENDING',
        amount: null,
        displayAmount: '待定',
        label: plateLine.label,
      }
    : null;
}

/**
 * Shared pure-result presenter for both internal and external create flows.
 * It deliberately contains no logistics fields, tokens, or IO.
 */
export function presentCreateOrderProcessingQuote(args: {
  input: CreateOrderQuoteInput;
  quote: PureCreateOrderQuoteResult;
}): CreateOrderProcessingPresentation {
  const itemsByKey = new Map(
    args.input.items.map((item) => [item.itemKey, item]),
  );
  const items = args.quote.items.map((quote) => {
    const input = itemsByKey.get(quote.itemKey);
    if (!input) {
      throw new Error(`报价结果引用未知款式 ${quote.itemKey}`);
    }
    return presentItem(quote, input, args.quote.priceVersion);
  });
  const groups = args.quote.packagingGroups.map((group) =>
    presentPackagingGroup(group, args.quote.priceVersion),
  );
  const packagingComplete = groups.every((group) => group.complete);
  const packagingErrors = groups.flatMap((group) =>
    group.errors.map((error) => `包装组 ${group.groupKey}：${error}`),
  );
  return {
    items,
    packaging: {
      groups,
      suggestedTotal: packagingComplete
        ? args.quote.packagingGroups
            .reduce(
              (sum, group) => sum.plus(group.amount ?? 0),
              new Decimal(0),
            )
            .toFixed(2)
        : null,
      requiresAdminConfirmation: !packagingComplete,
      errors: packagingErrors,
    },
  };
}
