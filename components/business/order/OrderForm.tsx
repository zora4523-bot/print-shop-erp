'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ClipboardEventHandler,
} from 'react';
import {
  useForm,
  useFieldArray,
  useWatch,
  type SubmitHandler,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Decimal from 'decimal.js';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createOrderSchema, type CreateOrderInput } from '@/lib/auth/schemas';
import {
  DesignFileType,
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
  OrderQuotedFeeCompleteness,
  OrderSettlementType,
} from '@/generated/prisma/enums';
import { createOrderAction, submitOrderAction } from '@/actions/order';
import { quoteOrderItemsAction } from '@/actions/order-quote';
import { quoteExternalCreateOrderAction } from '@/actions/create-order-quote';
import type { CreateOrderMutationResult } from '@/actions/order.types';
import type { OrderPackagingQuotePreview } from '@/actions/order-packaging-quote.types';
import type { CreateOrderQuoteResult } from '@/lib/order/create-order-quote-service';
import type { CustomerPartyOption } from '@/lib/party';
import type { QuoteResult } from '@/lib/price/quote';
import { externalPriceRuleDisplayName } from '@/lib/price/external-price-display';
import {
  ZTO_PROVINCE_OPTIONS,
  type ExternalOrderChargeQuote,
} from '@/lib/price/external-order-charges';
import type { PendingDesignImage } from './pending-design-image';
import { uploadOrderItemDesignFile } from './design-upload-client';
import { formatDesignFileSize } from './design-file-display';
import {
  runCreateOrderAction,
  runSubmitOrderAction,
} from './order-create-invocation';
import {
  OrderFormBRail,
  externalSalesOrderFormTotal,
  type ExternalSalesPackagingQuote,
} from './ExternalSalesOrderFormRail';
import {
  OrderFormB,
  OrderSubmissionReviewDialog,
  OrderSubmissionSuccess,
  type OrderFormBErrors,
  type OrderFoilSwatchOption,
  type OrderPaperSwatchOption,
  type OrderSubmissionReviewItem,
} from './order-form-b';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import type { ExternalCreateOrderPriceSnapshot } from '@/lib/order/create-order-price-snapshot';
import { buildExternalCreateOrderPayload } from '@/lib/order/external-create-order-payload';
import {
  beginOrderQuoteRequest,
  createOrderQuoteRequestGate,
  invalidateOrderQuoteRequests,
  isCurrentOrderQuoteResponse,
} from './create-order-quote-request';
import {
  externalOrderDefaultSpecification,
  externalOrderDimensions,
  externalOrderPaperFromType,
  externalOrderPapersForRoute,
  externalOrderPaperType,
  externalOrderProductStructure,
  externalOrderSpecificationsForRoute,
  externalOrderSpecificationLabel,
  externalOrderStyleName,
  externalOrderWeightsForSelection,
  findExternalOrderCatalogProduct,
  type ExternalOrderPaper,
  type ExternalOrderPaperKey,
} from './external-order-b-catalog';
import {
  collectOrderFormGaps,
  type OrderFormQuoteStatus,
} from './order-form-gaps';
import {
  localOrderFormDraftStorageKey,
  parseLocalOrderFormDraft,
  resolveNextOrderItemFig,
  serializeLocalOrderFormDraft,
} from './order-form-local-draft';
import {
  ORDER_PRICING_ROUTE_LABELS,
  isLegacyStockFoilCraft,
  normalizeCraftIdsForPricingRoute,
  productCategoryMatchesPricingRoute,
  requiredPricingCraftGroups,
} from '@/lib/order/pricing-route';
import { calculatePackagingBagCount } from '@/lib/order/packaging-bag-count';
import { ORDER_PRICING_STATUS } from '@/lib/order/pricing-status';
import {
  catalogPricingFactChoices,
  inferCatalogProductStructure,
  parseCatalogDimensions,
  parseCatalogPaperWeight,
} from '@/lib/order/catalog-pricing-facts';
import {
  shouldProtectOrderFormLeave,
  useOrderFormLeaveGuard,
} from './use-order-form-leave-guard';

export type CraftOption = {
  id: string;
  code?: string | null;
  name: string;
  isOutsource: boolean;
  isLowFrequency: boolean;
};

export type ProductOption = {
  id: string;
  code?: string | null;
  name: string;
  category: string;
  specification: string | null;
  paperType: string | null;
  paperMaterialId?: string | null;
  weight?: number | null;
};

type Props = {
  crafts: readonly CraftOption[];
  products: readonly ProductOption[];
  customers?: readonly CustomerPartyOption[];
  settlementLabel: string;
  settlementType: OrderSettlementType;
  externalCreateOrderOptions?: ExternalCreateOrderOptions;
  initialExternalPriceSnapshot?: ExternalCreateOrderPriceSnapshot;
  draftScope: string;
};

type QuoteViewState = {
  inputKey: string;
  result?: QuoteResult;
  error?: string;
};

type LogisticsQuoteViewState = {
  inputKey: string;
  result?: ExternalOrderChargeQuote;
  error?: string;
};

type PackagingQuoteViewState = {
  inputKey: string;
  result?: OrderPackagingQuotePreview;
  error?: string;
};

type ExternalCreateOrderQuoteViewState = {
  inputKey: string;
  result?: CreateOrderQuoteResult;
  error?: string;
};

type QuoteFacts = Parameters<typeof quoteFactsKey>[0];

type OrderCreationIntent = 'draft' | 'submit';

const PRODUCT_STRUCTURE_LABELS: Record<OrderProductStructure, string> = {
  [OrderProductStructure.UNSPECIFIED]: '未明确',
  [OrderProductStructure.STANDARD_ENVELOPE]: '普通封',
  [OrderProductStructure.WESTERN_ENVELOPE]: '西封',
  [OrderProductStructure.TEN_THOUSAND_ENVELOPE]: '万元封',
};

const LAMINATION_LABELS: Record<OrderLamination, string> = {
  [OrderLamination.NONE]: '不覆膜',
  [OrderLamination.MATTE]: '亚膜',
  [OrderLamination.SOFT_TOUCH]: '触感膜',
  [OrderLamination.NEW_GLOSS]: '新光膜',
  [OrderLamination.LASER]: '雷射',
};

type OrderFormPendingStateInput = {
  localDraftReady: boolean;
  submitting: boolean;
  uploading: boolean;
  quoting: boolean;
  logisticsQuoting: boolean;
};

export function resolveOrderFormPendingState({
  localDraftReady,
  submitting,
  uploading,
  quoting,
  logisticsQuoting,
}: OrderFormPendingStateInput) {
  return {
    busy:
      !localDraftReady ||
      submitting ||
      uploading ||
      quoting ||
      logisticsQuoting,
    lockNavigation: submitting || uploading,
  };
}

function createBlankItem(
  crafts: readonly CraftOption[],
): CreateOrderInput['items'][number] {
  return {
    fig: 1,
    name: '',
    productId: null,
    pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
    productStructure: OrderProductStructure.UNSPECIFIED,
    artworkVersion: null,
    plateGroupId: null,
    pricingGroup: null,
    manualQuoteReason: null,
    specification: null,
    actualWidthMm: null,
    actualHeightMm: null,
    paperType: null,
    paperWeightGsm: null,
    quantity: 1000,
    pack: 10,
    crafts: normalizeCraftIdsForPricingRoute(
      OrderItemPricingRoute.STOCK_BLANK,
      [],
      crafts,
    ),
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilColors: ['哑金'],
    foilTechnique: OrderFoilTechnique.FLAT,
    hasLocalFoil: true,
    printColors: [],
    lamination: OrderLamination.NONE,
    isDoubleSided: false,
    isDoubleColor: false,
    unitPrice: null,
    fixedFee: null,
    suggestedSubtotal: null,
    priceOverrideReason: null,
    remark: null,
  };
}

function defaultPackagingGroups(itemCount: number): CreateOrderInput['packagingGroups'] {
  return Array.from({ length: itemCount }, (_, itemIndex) => ({
    name: null,
    mode: OrderPackagingMode.SINGLE_STYLE,
    actualBagCount: 100,
    itemUnitsPerBag: Array.from(
      { length: itemCount },
      (__, candidateIndex) => (candidateIndex === itemIndex ? 10 : 0),
    ),
  }));
}

export function removeOrderItemRelations({
  index,
  remainingItemCount,
  additionalShipments,
  packagingGroups,
  usesExternalSalesPricing,
}: {
  index: number;
  remainingItemCount: number;
  additionalShipments: CreateOrderInput['additionalShipments'];
  packagingGroups: CreateOrderInput['packagingGroups'];
  usesExternalSalesPricing: boolean;
}): {
  additionalShipments: CreateOrderInput['additionalShipments'];
  packagingGroups: CreateOrderInput['packagingGroups'];
} {
  const nextShipments = additionalShipments
    .map((shipment) => ({
      ...shipment,
      itemQuantities: shipment.itemQuantities.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    }))
    .filter((shipment) =>
      shipment.itemQuantities.some((quantity) => quantity > 0),
    );
  const nextGroups = packagingGroups.flatMap((group) => {
    const itemUnitsPerBag = group.itemUnitsPerBag.filter(
      (_, itemIndex) => itemIndex !== index,
    );
    if (!usesExternalSalesPricing) {
      return [{ ...group, itemUnitsPerBag }];
    }
    const selectedItemCount = itemUnitsPerBag.filter(
      (quantity) => quantity > 0,
    ).length;
    if (selectedItemCount === 0) return [];
    return [
      {
        ...group,
        mode:
          selectedItemCount === 1
            ? OrderPackagingMode.SINGLE_STYLE
            : OrderPackagingMode.MIXED_STYLE,
        itemUnitsPerBag,
      },
    ];
  });
  return {
    additionalShipments: nextShipments,
    packagingGroups:
      usesExternalSalesPricing && nextGroups.length === 0
        ? defaultPackagingGroups(remainingItemCount)
        : nextGroups,
  };
}

function resolveExternalOrderCraftIds(
  item: CreateOrderInput['items'][number],
  crafts: readonly CraftOption[],
): string[] {
  const groups = requiredPricingCraftGroups({
    route: item.pricingRoute,
    foilColors: item.foilColors,
    frontFoilColors: item.frontFoilColors,
    backFoilColors: item.backFoilColors,
    isDoubleSided: item.isDoubleSided,
    foilTechnique: item.foilTechnique,
  });
  const resolved = groups.flatMap((group) => {
    const craft = crafts.find(
      (candidate) =>
        candidate.code && group.anyOfCodes.includes(candidate.code),
    );
    return craft ? [craft.id] : [];
  });
  return normalizeCraftIdsForPricingRoute(
    item.pricingRoute,
    resolved,
    crafts,
  );
}

function normalizeExternalOrderItem(args: {
  item: CreateOrderInput['items'][number];
  crafts: readonly CraftOption[];
  products: readonly ProductOption[];
  paperKey?: ExternalOrderPaperKey;
  resetPaper?: boolean;
  resetSpecification?: boolean;
  preserveCustomSize?: boolean;
}): CreateOrderInput['items'][number] {
  const normalizeExternalFoilColor = (color: string) =>
    ({
      哑金: '亚金',
      浅金: '浅色',
      红金: '红色',
      黑金: '黑色',
      蓝金: '蓝色',
      透明金: '透明色',
    })[color] ?? color;
  const route = args.item.pricingRoute;
  const routePapers = externalOrderPapersForRoute(args.products, route);
  const inferredPaper = externalOrderPaperFromType(
    args.products,
    args.item.paperType,
  );
  const requestedPaper = args.paperKey
    ? routePapers.find((paper) => paper.key === args.paperKey)
    : undefined;
  const paper =
    requestedPaper ??
    (!args.resetPaper &&
    inferredPaper &&
    routePapers.some((candidate) => candidate.key === inferredPaper.key)
      ? inferredPaper
      : routePapers[0]);
  if (!paper) return args.item;

  const specifications = externalOrderSpecificationsForRoute(
    args.products,
    route,
  );
  const requestedSpecification = args.item.specification ?? '';
  const specification =
    !args.resetSpecification && specifications.includes(requestedSpecification)
      ? requestedSpecification
      : externalOrderDefaultSpecification(args.products, route) ||
        specifications[0] ||
        '';
  const allowedWeights = [
    ...externalOrderWeightsForSelection(paper, route, specification),
  ];
  const currentWeight = args.item.paperWeightGsm ?? allowedWeights[0] ?? null;
  const allowManualWeight =
    route === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL;
  const weight =
    currentWeight !== null &&
    (allowedWeights.includes(currentWeight) || allowManualWeight)
      ? currentWeight
      : (allowedWeights[0] ?? currentWeight);
  if (weight === null) return args.item;
  const paperType = externalOrderPaperType(
    paper,
    route,
    specification,
    weight,
  );
  if (!paperType) return args.item;

  let frontFoilColors = args.item.frontFoilColors.map(
    normalizeExternalFoilColor,
  );
  let backFoilColors = args.item.backFoilColors.map(
    normalizeExternalFoilColor,
  );
  let foilTechnique = args.item.foilTechnique;
  let hasLocalFoil = args.item.hasLocalFoil;
  let printColors = [...args.item.printColors];
  let lamination = args.item.lamination;
  if (route === OrderItemPricingRoute.STOCK_BLANK) {
    frontFoilColors = frontFoilColors.slice(0, 3);
    backFoilColors = backFoilColors.slice(0, 3);
    foilTechnique = OrderFoilTechnique.FLAT;
    hasLocalFoil = true;
    printColors = [];
    lamination = OrderLamination.NONE;
  } else if (route === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL) {
    frontFoilColors = frontFoilColors.slice(0, 3);
    backFoilColors = [];
    foilTechnique =
      foilTechnique === OrderFoilTechnique.RELIEF ||
      foilTechnique === OrderFoilTechnique.RAISED
        ? foilTechnique
        : OrderFoilTechnique.FLAT;
    hasLocalFoil = false;
    printColors = [];
    lamination = OrderLamination.NONE;
  } else if (route === OrderItemPricingRoute.COLOR_PRINT) {
    frontFoilColors = frontFoilColors.slice(0, 1);
    backFoilColors = [];
    printColors = ['彩印'];
    if (frontFoilColors.length === 0) {
      foilTechnique = OrderFoilTechnique.NONE;
      hasLocalFoil = false;
    } else if (
      foilTechnique === OrderFoilTechnique.NONE ||
      foilTechnique === OrderFoilTechnique.UNSPECIFIED
    ) {
      foilTechnique = OrderFoilTechnique.FLAT;
    }
    lamination =
      paper.key === 'COATED'
        ? lamination === OrderLamination.NONE
          ? OrderLamination.MATTE
          : lamination
        : OrderLamination.NONE;
  }

  const foilColors = [...new Set([...frontFoilColors, ...backFoilColors])];
  const dimensions = externalOrderDimensions(specification);
  const catalogProduct = findExternalOrderCatalogProduct(
    args.products,
    route,
    paperType,
    specification,
  );
  const routeLabel = ORDER_PRICING_ROUTE_LABELS[route];
  const next: CreateOrderInput['items'][number] = {
    ...args.item,
    name: externalOrderStyleName({
      routeLabel,
      paperLabel: paper.label,
      weight,
      specification,
    }),
    productId: catalogProduct?.id ?? null,
    pricingRoute: route,
    productStructure: externalOrderProductStructure(specification),
    specification,
    actualWidthMm:
      args.preserveCustomSize && args.item.actualWidthMm === null
        ? null
        : (dimensions?.widthMm ?? null),
    actualHeightMm:
      args.preserveCustomSize && args.item.actualHeightMm === null
        ? null
        : (dimensions?.heightMm ?? null),
    paperType,
    paperWeightGsm: weight,
    frontFoilColors,
    backFoilColors,
    foilColors,
    foilTechnique,
    hasLocalFoil,
    lamination,
    printColors,
    isDoubleSided: backFoilColors.length > 0,
    isDoubleColor: frontFoilColors.length + backFoilColors.length > 1,
    manualQuoteReason: null,
    unitPrice: null,
    fixedFee: null,
    suggestedSubtotal: null,
    priceOverrideReason: null,
  };
  return { ...next, crafts: resolveExternalOrderCraftIds(next, args.crafts) };
}

function createExternalOrderItem(
  crafts: readonly CraftOption[],
  products: readonly ProductOption[],
  defaultFoilColor?: string | null,
): CreateOrderInput['items'][number] {
  const blank = {
    ...createBlankItem(crafts),
    frontFoilColors: defaultFoilColor ? [defaultFoilColor] : [],
    foilColors: defaultFoilColor ? [defaultFoilColor] : [],
  };
  return normalizeExternalOrderItem({
    item: blank,
    crafts,
    products,
    resetPaper: true,
    resetSpecification: true,
  });
}

function formatOrderCurrency(value: string | number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(Number(value));
}

function compactDecimal(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : value;
}

function externalQuoteComponentLabel(
  item: CreateOrderInput['items'][number],
  component: QuoteResult['components'][number],
): string {
  const displayName = externalPriceRuleDisplayName(component.name);
  if (
    item.pricingRoute === OrderItemPricingRoute.STOCK_BLANK &&
    component.source === 'BASE'
  ) {
    return displayName.startsWith('空白封')
      ? displayName
      : `空白封 ${displayName}`;
  }
  if (
    item.pricingRoute === OrderItemPricingRoute.STOCK_BLANK &&
    component.ruleCode?.startsWith('STOCK_LOCAL_FOIL_')
  ) {
    const foilSummary =
      item.backFoilColors.length > 0
        ? `正 ${item.frontFoilColors.join('+')} / 反 ${item.backFoilColors.join('+')}`
        : item.frontFoilColors.join('+');
    const passCount =
      item.frontFoilColors.length + item.backFoilColors.length;
    const calculation =
      component.adjustmentType === 'FIXED_AMOUNT'
        ? `${passCount}次过版 × ${compactDecimal(component.rate)}元`
        : `${Number(component.units).toLocaleString('zh-CN')}次印刷 × ${compactDecimal(component.rate)}`;
    return `机烫金 ${foilSummary} · ${calculation}`;
  }
  return displayName;
}

function externalPaperSwatchTexture(
  appearance: ExternalOrderPaper['appearance'],
): OrderPaperSwatchOption['texture'] {
  switch (appearance) {
    case 'pearl':
      return 'pearl';
    case 'pearl-red':
      return 'pearl-red';
    case 'solid-red':
      return 'solid-red';
    case 'matte-red':
      return 'matte-red';
    case 'variegated':
      return 'variegated-pearl';
    case 'glitter':
      return 'glitter-red';
    case 'linen':
      return 'linen-red';
    case 'ice-white':
      return 'ice-white';
    case 'coated':
      return 'coated-white';
  }
}

const CHINESE_DIGITS = '零一二三四五六七八九';

function formatChineseInteger(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) return '';
  if (value >= 100_000_000) {
    return `${Math.round(value / 10_000_000) / 10}亿`;
  }
  let result = '';
  let remainder = value;
  let needsZero = false;
  if (remainder >= 10_000) {
    result += `${formatChineseInteger(Math.floor(remainder / 10_000))}万`;
    remainder %= 10_000;
    needsZero = remainder > 0 && remainder < 1_000;
  }
  for (const [unit, divisor] of [
    ['千', 1_000],
    ['百', 100],
    ['十', 10],
  ] as const) {
    const digit = Math.floor(remainder / divisor);
    if (digit > 0) {
      if (needsZero) result += '零';
      result += `${CHINESE_DIGITS[digit]}${unit}`;
      remainder %= divisor;
      needsZero = false;
    } else if (result && remainder > 0) {
      needsZero = true;
    }
  }
  if (remainder > 0) {
    if (needsZero) result += '零';
    result += CHINESE_DIGITS[remainder];
  }
  return result.replace(/^一十/, '十');
}

const LOCAL_DRAFT_STORAGE_UNAVAILABLE = '__local-draft-storage-unavailable__';

function subscribeToBrowserStorage(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange);
  return () => window.removeEventListener('storage', onStoreChange);
}

function subscribeToHydration() {
  return () => undefined;
}

function getHydratedSnapshot() {
  return true;
}

function getServerHydratedSnapshot() {
  // Keep controls inert until React can reconcile browser-local drafts and
  // attach handlers; getHydratedSnapshot enables them after hydration.
  return false;
}

function getServerLocalDraftSnapshot(): string | null {
  return null;
}

export function quoteFactsKey(
  item:
    | {
        productId?: string | null;
        specification?: string | null;
        paperType?: string | null;
        pricingRoute?: OrderItemPricingRoute;
        productStructure?: OrderProductStructure;
        artworkVersion?: string | null;
        plateGroupId?: string | null;
        pricingGroup?: string | null;
        manualQuoteReason?: string | null;
        actualWidthMm?: number | null;
        actualHeightMm?: number | null;
        paperWeightGsm?: number | null;
        quantity?: number;
        crafts?: string[];
        frontFoilColors?: string[];
        backFoilColors?: string[];
        foilColors?: string[];
        foilTechnique?: OrderFoilTechnique;
        hasLocalFoil?: boolean | null;
        printColors?: string[];
        lamination?: OrderLamination;
        isDoubleSided?: boolean;
        isDoubleColor?: boolean;
      }
    | null
    | undefined,
  orderItemCount: number,
): string {
  return JSON.stringify({
    orderItemCount,
    productId: item?.productId ?? null,
    specification: item?.specification ?? null,
    paperType: item?.paperType ?? null,
    pricingRoute: item?.pricingRoute ?? null,
    productStructure: item?.productStructure ?? null,
    artworkVersion: item?.artworkVersion ?? null,
    plateGroupId: item?.plateGroupId ?? null,
    pricingGroup: item?.pricingGroup ?? null,
    manualQuoteReason: item?.manualQuoteReason ?? null,
    actualWidthMm: item?.actualWidthMm ?? null,
    actualHeightMm: item?.actualHeightMm ?? null,
    paperWeightGsm: item?.paperWeightGsm ?? null,
    quantity: item?.quantity ?? null,
    crafts: [...(item?.crafts ?? [])].sort(),
    frontFoilColors: [...(item?.frontFoilColors ?? [])],
    backFoilColors: [...(item?.backFoilColors ?? [])],
    foilColors: [...(item?.foilColors ?? [])].sort(),
    foilTechnique: item?.foilTechnique ?? null,
    hasLocalFoil: item?.hasLocalFoil ?? null,
    printColors: [...(item?.printColors ?? [])].sort(),
    lamination: item?.lamination ?? OrderLamination.NONE,
    isDoubleSided: item?.isDoubleSided ?? false,
    isDoubleColor: item?.isDoubleColor ?? false,
  });
}

/**
 * The preview action echoes this opaque key so late responses cannot replace
 * a newer B-form quote. It is deliberately compact because a complete order
 * projection can exceed the action boundary's key length; quoteToken remains
 * the cryptographic, server-issued proof used for submission.
 */
export function compactOrderQuoteFactsKey(value: unknown): string {
  const serialized = JSON.stringify(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
    right ^= right >>> 13;
  }
  return `order-form-b-v1:${serialized.length}:${(left >>> 0).toString(16)}:${(
    right >>> 0
  ).toString(16)}`;
}

function orderItemQuoteFacts(
  item: CreateOrderInput['items'][number],
): NonNullable<QuoteFacts> {
  return {
    productId: item.productId,
    pricingRoute: item.pricingRoute,
    productStructure: item.productStructure,
    artworkVersion: item.artworkVersion,
    plateGroupId: item.plateGroupId,
    pricingGroup: item.pricingGroup,
    manualQuoteReason: item.manualQuoteReason,
    specification: item.specification,
    actualWidthMm: item.actualWidthMm,
    actualHeightMm: item.actualHeightMm,
    paperType: item.paperType,
    paperWeightGsm: item.paperWeightGsm,
    quantity: item.quantity,
    crafts: item.crafts,
    frontFoilColors: item.frontFoilColors,
    backFoilColors: item.backFoilColors,
    foilColors: item.foilColors,
    foilTechnique: item.foilTechnique,
    hasLocalFoil: item.hasLocalFoil,
    printColors: item.printColors,
    lamination: item.lamination,
    isDoubleSided: item.isDoubleSided,
    isDoubleColor: item.isDoubleColor,
  };
}

function quoteAmountMatches(
  actual: string | null | undefined,
  suggested: string | null,
  scale: number,
): boolean {
  const trimmed = actual?.trim() ?? '';
  if (trimmed === '') return suggested === null;
  if (!/^\d{1,10}(?:\.\d{1,4})?$/.test(trimmed) || suggested === null) {
    return false;
  }
  return Number(trimmed).toFixed(scale) === Number(suggested).toFixed(scale);
}

function hasAmount(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function internalOrderItemAmount(
  item: CreateOrderInput['items'][number] | undefined,
): string | null {
  if (!item || (!hasAmount(item.unitPrice) && !hasAmount(item.fixedFee))) {
    return null;
  }
  try {
    return new Decimal(item.unitPrice || 0)
      .mul(item.quantity)
      .plus(item.fixedFee || 0)
      .toDecimalPlaces(2)
      .toFixed(2);
  } catch {
    return null;
  }
}

function formatLocalDraftTime(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function parsePastedReceiverAddress(value: string): {
  receiverName: string | null;
  receiverPhone: string | null;
  province: string | null;
} {
  const normalized = value
    .trim()
    .replace(/[\r\n\t,，|]+/g, ' ')
    .replace(/\s+/g, ' ');
  const phoneMatch = normalized.match(
    /(?<!\d)(1[3-9](?:[-\s]?\d){9}|0\d{2,3}[-\s]?\d{7,8})(?!\d)/,
  );
  const receiverPhone = phoneMatch?.[1]?.replace(/\s/g, '') ?? null;
  const province =
    ZTO_PROVINCE_OPTIONS.find((candidate) =>
      new RegExp(`${candidate}(?:省|市|壮族自治区|回族自治区|维吾尔自治区|自治区)?`).test(
        normalized,
      ),
    ) ?? null;
  const explicitName = normalized.match(
    /(?:收货人|联系人|姓名)\s*[:：]?\s*([\p{Script=Han}A-Za-z·]{2,32}?)(?=\s|1[3-9]|0\d{2,3}|$)/u,
  )?.[1];
  const nameCandidates = normalized
    .replace(phoneMatch?.[0] ?? '', ' ')
    .replace(/(?:收货人|联系人|姓名|电话|手机|地址)\s*[:：]?/g, ' ')
    .split(/\s+/)
    .map((candidate) => candidate.trim())
    .filter(
      (candidate) =>
        /^[\p{Script=Han}A-Za-z·]{2,32}$/u.test(candidate) &&
        !/[省市区县旗镇乡街道路巷号弄栋座单元室村组社区花园大厦]/u.test(candidate) &&
        !ZTO_PROVINCE_OPTIONS.includes(candidate),
    );
  const receiverName = (explicitName ?? nameCandidates[0] ?? null)?.slice(
    0,
    64,
  ) ?? null;
  return { receiverName, receiverPhone, province };
}

function pastedTextareaValue(
  event: Parameters<ClipboardEventHandler<HTMLTextAreaElement>>[0],
): string {
  const pasted = event.clipboardData.getData('text');
  const textarea = event.currentTarget;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  return `${textarea.value.slice(0, start)}${pasted}${textarea.value.slice(end)}`;
}

export function OrderForm({
  crafts,
  products,
  customers = [],
  settlementLabel,
  settlementType,
  externalCreateOrderOptions,
  initialExternalPriceSnapshot,
  draftScope,
}: Props) {
  const usesExternalSalesPricing =
    settlementType === OrderSettlementType.EXTERNAL_SALES;
  const router = useRouter();
  const initialItem = useMemo(() => {
    const firstFoil = externalCreateOrderOptions?.foilColors[0]?.name;
    const item = createExternalOrderItem(crafts, products, firstFoil);
    if (!usesExternalSalesPricing) return item;
    return {
      ...item,
      frontFoilColors: firstFoil ? [firstFoil] : [],
      backFoilColors: [],
      foilColors: firstFoil ? [firstFoil] : [],
      isDoubleSided: false,
      isDoubleColor: false,
    };
  }, [
    crafts,
    externalCreateOrderOptions?.foilColors,
    products,
    usesExternalSalesPricing,
  ]);
  const [clientSubmissionId] = useState(() => globalThis.crypto.randomUUID());
  const form = useForm<CreateOrderInput>({
    // zodResolver's generics don't fully compose with preprocess-bearing
    // schemas (moneyOptionalField uses `z.preprocess`, which splits
    // z.input / z.output). The runtime contract still holds — we just
    // widen the compile-time seam.
    resolver: zodResolver(createOrderSchema) as never,
    mode: 'onBlur',
    defaultValues: {
      clientSubmissionId,
      nextItemFig: 2,
      customName: null,
      customerPartyId: null,
      customerRef: null,
      receiverName: null,
      receiverPhone: null,
      receiverAddress: null,
      expressCode: null,
      destinationProvince: null,
      quotedWeightKg: null,
      shippingFee: null,
      packingMaterialFee: null,
      customerChargeOverrideReason: null,
      packageRequirement: null,
      remark: null,
      promisedDate: null,
      isUrgent: false,
      isSfCollect: false,
      additionalShipments: [],
      packagingGroups: defaultPackagingGroups(1),
      items: [initialItem],
    },
  });
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isDirty, dirtyFields },
    setValue,
    getValues,
    reset,
  } = form;
  const itemsArray = useFieldArray({ control, name: 'items' });
  const shipmentsArray = useFieldArray({
    control,
    name: 'additionalShipments',
  });
  const watchedItems = useWatch({ control, name: 'items' });
  const watchedFormValues = useWatch({ control });
  const watchedShipments = useWatch({ control, name: 'additionalShipments' });
  const watchedPackagingGroups = useWatch({
    control,
    name: 'packagingGroups',
  });
  const watchedCustomName = useWatch({ control, name: 'customName' });
  const watchedCustomerRef = useWatch({ control, name: 'customerRef' });
  const watchedPromisedDate = useWatch({ control, name: 'promisedDate' });
  const watchedReceiverAddress = useWatch({
    control,
    name: 'receiverAddress',
  });
  const watchedReceiverName = useWatch({ control, name: 'receiverName' });
  const watchedReceiverPhone = useWatch({ control, name: 'receiverPhone' });
  const watchedIsSfCollect = useWatch({ control, name: 'isSfCollect' });
  const watchedDestinationProvince = useWatch({
    control,
    name: 'destinationProvince',
  });
  const [state, setState] = useState<CreateOrderMutationResult | null>(null);
  const [pendingDesigns, setPendingDesigns] = useState<
    Record<string, PendingDesignImage[]>
  >({});
  const [createdDraft, setCreatedDraft] = useState<{
    orderId: string;
    orderNo: string;
    itemIds: string[];
    fieldIds: string[];
    intent: OrderCreationIntent;
    manualQuote: boolean;
    quoteToken: string | null;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const [quoting, startQuote] = useTransition();
  const [externalQuoteQuoting, startExternalQuote] = useTransition();
  const [quotingFieldId, setQuotingFieldId] = useState<string | null>(null);
  const [quoteViews, setQuoteViews] = useState<Record<string, QuoteViewState>>(
    {},
  );
  const [logisticsQuote, setLogisticsQuote] =
    useState<LogisticsQuoteViewState | null>(null);
  const [packagingQuote, setPackagingQuote] =
    useState<PackagingQuoteViewState | null>(null);
  const [externalOrderQuote, setExternalOrderQuote] =
    useState<ExternalCreateOrderQuoteViewState | null>(null);
  const [externalValidationVisible, setExternalValidationVisible] =
    useState(false);
  const [externalInputRevision, setExternalInputRevision] = useState(0);
  const [pendingSubmission, setPendingSubmission] = useState<{
    data: CreateOrderInput;
    fieldIds: string[];
    queues: Record<string, PendingDesignImage[]>;
    quoteToken: string;
  } | null>(null);
  const [submitQuoteChange, setSubmitQuoteChange] = useState<{
    quoteToken: string;
    quotedFee: string;
    quotedFeeCompleteness: OrderQuotedFeeCompleteness;
  } | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<{
    orderId: string;
    orderNo: string;
    manualQuote: boolean;
  } | null>(null);
  const [expandedItem, setExpandedItem] = useState(0);
  const [localDraftDecisionComplete, setLocalDraftDecisionComplete] =
    useState(false);
  const [lastLocalDraftSavedAt, setLastLocalDraftSavedAt] = useState<
    string | null
  >(null);
  const [localDraftError, setLocalDraftError] = useState<string | null>(null);
  const quoteRequestSequence = useRef(0);
  const latestQuoteRequestByField = useRef<Record<string, number>>({});
  const externalQuoteRequestGate = useRef(createOrderQuoteRequestGate());
  const itemFieldIdsRef = useRef<string[]>([]);
  const nextItemFigRef = useRef(2);
  const localDraftStorageKey = localOrderFormDraftStorageKey(
    draftScope,
    usesExternalSalesPricing,
  );
  const localDraftPricingScope = usesExternalSalesPricing
    ? 'external-sales'
    : 'internal';
  const getLocalDraftSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(localDraftStorageKey);
    } catch {
      return LOCAL_DRAFT_STORAGE_UNAVAILABLE;
    }
  }, [localDraftStorageKey]);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );
  const localDraftSnapshot = useSyncExternalStore(
    subscribeToBrowserStorage,
    getLocalDraftSnapshot,
    getServerLocalDraftSnapshot,
  );
  const storedLocalDraft = useMemo(
    () =>
      localDraftSnapshot &&
      localDraftSnapshot !== LOCAL_DRAFT_STORAGE_UNAVAILABLE
        ? parseLocalOrderFormDraft(localDraftSnapshot, localDraftPricingScope)
        : null,
    [localDraftPricingScope, localDraftSnapshot],
  );
  const pendingLocalDraft = localDraftDecisionComplete
    ? null
    : storedLocalDraft;
  const localDraftReady = hydrated && pendingLocalDraft === null;
  const detectedLocalDraftError = !hydrated
    ? null
    : localDraftSnapshot === LOCAL_DRAFT_STORAGE_UNAVAILABLE
      ? '浏览器暂时无法使用本地草稿；本次填写不会自动保存在本机。'
      : localDraftSnapshot && !storedLocalDraft
        ? '本地旧草稿已损坏或版本过旧，已安全忽略。'
        : null;
  const localDraftStatusError = localDraftError ?? detectedLocalDraftError;
  const pendingState = resolveOrderFormPendingState({
    localDraftReady,
    submitting,
    uploading,
    quoting: quoting || externalQuoteQuoting,
    logisticsQuoting: externalQuoteQuoting,
  });
  const pendingDesignFileCount = Object.values(pendingDesigns).reduce(
    (total, queue) => total + queue.length,
    0,
  );
  useOrderFormLeaveGuard(
    shouldProtectOrderFormLeave({
      enabled: usesExternalSalesPricing,
      dirty: isDirty,
      pendingFileCount: pendingDesignFileCount,
      submitted: Boolean(submittedOrder),
    }),
  );
  const persistLocalDraftValues = useCallback(
    (values: CreateOrderInput) => {
      const savedAt = new Date();
      const serialized = serializeLocalOrderFormDraft(
        { ...values, nextItemFig: nextItemFigRef.current },
        localDraftPricingScope,
        savedAt,
      );
      if (!serialized) {
        setLocalDraftError('当前表单无法安全序列化，本地草稿未更新。');
        return;
      }
      try {
        window.localStorage.setItem(localDraftStorageKey, serialized);
        setLocalDraftDecisionComplete(true);
        setLastLocalDraftSavedAt(savedAt.toISOString());
        setLocalDraftError(null);
      } catch {
        setLocalDraftError('本地草稿保存失败，请不要在创建工单前关闭页面。');
      }
    },
    [localDraftPricingScope, localDraftStorageKey],
  );

  useEffect(() => {
    itemFieldIdsRef.current = itemsArray.fields.map((field) => field.id);
  }, [itemsArray.fields]);

  useEffect(() => {
    if (!usesExternalSalesPricing || !pendingLocalDraft) return;
    const timer = window.setTimeout(() => {
      nextItemFigRef.current = resolveNextOrderItemFig(
        pendingLocalDraft.values,
      );
      reset(pendingLocalDraft.values as unknown as CreateOrderInput);
      setQuoteViews({});
      setLogisticsQuote(null);
      setPackagingQuote(null);
      setExternalOrderQuote(null);
      setPendingDesigns({});
      setExpandedItem(0);
      setLastLocalDraftSavedAt(pendingLocalDraft.savedAt);
      setLocalDraftDecisionComplete(true);
      setLocalDraftError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingLocalDraft, reset, usesExternalSalesPricing]);

  useEffect(() => {
    if (!localDraftReady || pendingLocalDraft || createdDraft || !isDirty) {
      return;
    }
    const timer = window.setTimeout(() => {
      persistLocalDraftValues(getValues());
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    createdDraft,
    isDirty,
    localDraftReady,
    pendingLocalDraft,
    externalInputRevision,
    getValues,
    persistLocalDraftValues,
    watchedCustomName,
    watchedReceiverAddress,
    watchedReceiverName,
    watchedReceiverPhone,
    watchedFormValues,
  ]);

  async function uploadPendingDesigns(
    draft: NonNullable<typeof createdDraft>,
    queues: Record<string, PendingDesignImage[]>,
  ): Promise<boolean> {
    const total = draft.fieldIds.reduce(
      (sum, fieldId) => sum + (queues[fieldId]?.length ?? 0),
      0,
    );
    if (total === 0) {
      setUploadProgress(null);
      return true;
    }

    setUploadError(null);
    setUploadProgress({ completed: 0, total });
    const failed: Record<string, PendingDesignImage[]> = {};
    const failureMessages: string[] = [];
    let completed = 0;

    for (const [itemIndex, fieldId] of draft.fieldIds.entries()) {
      const itemId = draft.itemIds[itemIndex];
      const images = queues[fieldId] ?? [];
      if (!itemId) {
        if (images.length > 0) {
          failed[fieldId] = images;
          failureMessages.push(
            `款式 ${itemIndex + 1} 的设计文件暂时无法上传，请刷新后重试`,
          );
        }
        completed += images.length;
        setUploadProgress({ completed, total });
        continue;
      }

      for (const image of images) {
        const result = await uploadOrderItemDesignFile({
          orderId: draft.orderId,
          orderItemId: itemId,
          prepared: image.prepared,
        });
        completed += 1;
        setUploadProgress({ completed, total });
        if (!result.ok) {
          (failed[fieldId] ??= []).push(image);
          failureMessages.push(
            `款式 ${itemIndex + 1} · ${image.prepared.file.name}：${result.message}`,
          );
        }
      }
    }

    setPendingDesigns(failed);
    if (failureMessages.length === 0) {
      return true;
    }
    setUploadError(
      `草稿已创建，但有 ${failureMessages.length} 个设计文件未上传：${failureMessages.join('；')}`,
    );
    return false;
  }

  async function finishCreatedOrder(
    draft: NonNullable<typeof createdDraft>,
    queues: Record<string, PendingDesignImage[]>,
  ) {
    setUploading(true);
    setUploadError(null);
    let submittedManualQuote = draft.manualQuote;
    try {
      const uploaded = await uploadPendingDesigns(draft, queues);
      if (!uploaded) return;

      setUploadProgress(null);
      if (draft.intent === 'submit') {
        const submitResult = await runSubmitOrderAction(() =>
          submitOrderAction(draft.orderId, draft.quoteToken),
        );
        if (submitResult.status === 'quote_changed') {
          setSubmitQuoteChange({
            quoteToken: submitResult.quoteToken,
            quotedFee: submitResult.quotedFee,
            quotedFeeCompleteness: submitResult.quotedFeeCompleteness,
          });
          setCreatedDraft((current) =>
            current?.orderId === draft.orderId
              ? { ...current, quoteToken: submitResult.quoteToken }
              : current,
          );
          setUploadError(
            `草稿已安全保存：${submitResult.message}`,
          );
          return;
        }
        if (submitResult.status !== 'success') {
          const message =
            submitResult.status === 'error'
              ? submitResult.message
              : Object.values(submitResult.fieldErrors).flat().join('；');
          setUploadError(`草稿已安全保存，但提交失败：${message}`);
          return;
        }
        submittedManualQuote =
          submitResult.quotedFeeCompleteness ===
          OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS;
      }

      if (usesExternalSalesPricing && draft.intent === 'submit') {
        setSubmittedOrder({
          orderId: draft.orderId,
          orderNo: draft.orderNo,
          manualQuote: submittedManualQuote,
        });
        setPendingSubmission(null);
      } else {
        router.push(`/orders/${draft.orderId}`);
      }
    } catch {
      setUploadProgress(null);
      setUploadError('草稿已安全保存，但后续处理未完成，请重试。');
    } finally {
      setUploading(false);
    }
  }

  function restoreLocalDraft() {
    if (!pendingLocalDraft) return;
    nextItemFigRef.current = resolveNextOrderItemFig(
      pendingLocalDraft.values,
    );
    reset(pendingLocalDraft.values as unknown as CreateOrderInput);
    setQuoteViews({});
    setLogisticsQuote(null);
    setPackagingQuote(null);
    setExternalOrderQuote(null);
    setPendingDesigns({});
    setExpandedItem(0);
    setLastLocalDraftSavedAt(pendingLocalDraft.savedAt);
    setLocalDraftDecisionComplete(true);
    setLocalDraftError(null);
  }

  function discardLocalDraft() {
    try {
      window.localStorage.removeItem(localDraftStorageKey);
      setLocalDraftError(null);
    } catch {
      setLocalDraftError(
        '本地旧草稿无法删除；本次可继续填写，但请留意下次打开时的恢复提示。',
      );
    }
    setLocalDraftDecisionComplete(true);
    setLastLocalDraftSavedAt(null);
  }

  function clearLocalDraftAfterServerCreate() {
    try {
      window.localStorage.removeItem(localDraftStorageKey);
      setLocalDraftError(null);
    } catch {
      setLocalDraftError('工单草稿已创建，但本机的表单草稿未能清除。');
    }
    setLocalDraftDecisionComplete(true);
    setLastLocalDraftSavedAt(null);
  }

  function persistOrder(
    data: CreateOrderInput,
    fieldIds: string[],
    queueSnapshot: Record<string, PendingDesignImage[]>,
    intent: OrderCreationIntent,
    expectedQuoteToken: string | null = null,
  ) {
    setState(null);
    setUploadError(null);
    startSubmit(async () => {
      const submittedData: CreateOrderInput = {
        ...data,
        items: data.items.map((item) => {
          const normalizedItem = {
            ...item,
            manualQuoteReason: null,
          };
          return usesExternalSalesPricing
            ? {
                ...normalizedItem,
                unitPrice: null,
                fixedFee: null,
                suggestedSubtotal: null,
                priceOverrideReason: null,
              }
            : normalizedItem;
        }),
        destinationProvince: data.isSfCollect ? null : data.destinationProvince,
        quotedWeightKg: data.isSfCollect ? null : data.quotedWeightKg,
        shippingFee: null,
        packingMaterialFee: null,
        customerChargeOverrideReason: null,
        additionalShipments: data.additionalShipments.map((shipment) => ({
          ...shipment,
          destinationProvince: data.isSfCollect
            ? null
            : shipment.destinationProvince,
          quotedWeightKg: data.isSfCollect ? null : shipment.quotedWeightKg,
          shippingFee: null,
          packingMaterialFee: null,
          customerChargeOverrideReason: null,
        })),
      };
      // A rejected async invocation inside startTransition would otherwise
      // replace the whole route with its error boundary. Convert it to the
      // same inline result shape as expected business failures instead.
      const result = await runCreateOrderAction(() =>
        createOrderAction(
          null,
          usesExternalSalesPricing
            ? buildExternalCreateOrderPayload(submittedData)
            : submittedData,
        ),
      );
      setState(result);
      if (result.status !== 'success') return;

      clearLocalDraftAfterServerCreate();

      const draft = {
        orderId: result.orderId,
        orderNo: result.orderNo,
        itemIds: result.itemIds,
        fieldIds,
        intent,
        manualQuote:
          result.pricingStatus ===
          ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
        quoteToken:
          usesExternalSalesPricing && intent === 'submit'
            ? expectedQuoteToken
            : null,
      };
      setCreatedDraft(draft);
      await finishCreatedOrder(draft, queueSnapshot);
    });
  }

  function externalSubmissionIssues(
    data: CreateOrderInput,
    fieldIds: readonly string[],
    queueSnapshot: Record<string, PendingDesignImage[]>,
  ): string[] {
    const issues: string[] = [];
    if (!data.customName?.trim()) issues.push('工单名称必填');
    if (!data.receiverName?.trim()) issues.push('收件人必填');
    if (!data.receiverAddress?.trim()) issues.push('收货地址必填');
    if (!data.receiverPhone?.trim()) issues.push('收货电话必填');
    if (!currentExternalOrderQuote?.quoteToken) {
      issues.push('请等待最新费用报价完成');
    }
    data.items.forEach((item, index) => {
      const itemLabel = `第 ${item.fig ?? index + 1} 款`;
      const fieldId = fieldIds[index];
      const files = fieldId ? queueSnapshot[fieldId] ?? [] : [];
      if (
        !files.some(
          (file) => file.prepared.fileType === DesignFileType.IMAGE,
        )
      ) {
        issues.push(`${itemLabel}：请上传设计图`);
      }
      const inPackagingGroup = data.packagingGroups.some(
        (group) => (group.itemUnitsPerBag[index] ?? 0) > 0,
      );
      if (!inPackagingGroup) {
        issues.push(`${itemLabel}：请填写每包数量`);
      }
    });
    return issues;
  }

  const onValid: SubmitHandler<CreateOrderInput> = (data, event) => {
    // The disabled submit button covers clicks; this guard also blocks Enter
    // key or programmatic submits while an authoritative quote is in flight.
    if (
      createdDraft ||
      quoting ||
      externalQuoteQuoting ||
      externalQuoteNeedsRefresh
    ) {
      return;
    }
    const fieldIds = itemsArray.fields.map((field) => field.id);
    const queueSnapshot = Object.fromEntries(
      fieldIds.map((fieldId) => [fieldId, pendingDesigns[fieldId] ?? []]),
    );
    const submitter = (event?.nativeEvent as SubmitEvent | undefined)
      ?.submitter as HTMLButtonElement | null | undefined;
    const intent: OrderCreationIntent =
      submitter?.value === 'submit' ? 'submit' : 'draft';

    if (usesExternalSalesPricing && intent === 'submit') {
      setExternalValidationVisible(true);
      if (externalSubmissionIssues(data, fieldIds, queueSnapshot).length > 0) {
        return;
      }
      const quoteToken = currentExternalOrderQuote?.quoteToken;
      if (!quoteToken) return;
      setSubmitQuoteChange(null);
      setPendingSubmission({
        data,
        fieldIds,
        queues: queueSnapshot,
        quoteToken,
      });
      return;
    }

    if (!usesExternalSalesPricing && intent === 'submit' && formGaps.length > 0) {
      return;
    }

    persistOrder(data, fieldIds, queueSnapshot, intent);
  };

  const onInvalid = () => {
    if (!usesExternalSalesPricing) return;
    setExternalValidationVisible(true);
    setPendingSubmission(null);
  };

  function updatePendingDesigns(fieldId: string, images: PendingDesignImage[]) {
    setPendingDesigns((current) => {
      if (images.length === 0) {
        const next = { ...current };
        delete next[fieldId];
        return next;
      }
      return { ...current, [fieldId]: images };
    });
  }

  function invalidateStructuralQuotes() {
    latestQuoteRequestByField.current = {};
    invalidateOrderQuoteRequests(externalQuoteRequestGate.current);
    setQuoteViews({});
    setQuotingFieldId(null);
    setLogisticsQuote(null);
    setPackagingQuote(null);
    setExternalOrderQuote(null);
    setPendingSubmission(null);
  }

  function removeItem(index: number, fieldId: string) {
    const currentItems = getValues('items');
    if (currentItems.length <= 1) return;
    const remainingItems = currentItems.filter(
      (_, itemIndex) => itemIndex !== index,
    );
    const relations = removeOrderItemRelations({
      index,
      remainingItemCount: remainingItems.length,
      additionalShipments: getValues('additionalShipments'),
      packagingGroups: getValues('packagingGroups'),
      // The single-page editor always owns one packaging relation per item;
      // pricing mode must not decide whether those UI relations are maintained.
      usesExternalSalesPricing: true,
    });
    setValue(
      'additionalShipments',
      relations.additionalShipments,
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      'packagingGroups',
      relations.packagingGroups,
      { shouldDirty: true, shouldValidate: true },
    );
    itemsArray.remove(index);
    setExpandedItem((current) => {
      if (current > index) return current - 1;
      if (current === index) {
        return Math.max(0, Math.min(index, itemsArray.fields.length - 2));
      }
      return current;
    });
    updatePendingDesigns(fieldId, []);
    invalidateStructuralQuotes();
    persistLocalDraftValues({
      ...getValues(),
      items: remainingItems,
      additionalShipments: relations.additionalShipments,
      packagingGroups: relations.packagingGroups,
    });
  }

  function addItem() {
    const currentItems = getValues('items');
    const shipments = getValues('additionalShipments');
    const nextShipments = shipments.map((shipment) => ({
      ...shipment,
      itemQuantities: [...shipment.itemQuantities, 0],
    }));
    setValue(
      'additionalShipments',
      nextShipments,
      { shouldDirty: true },
    );
    const groups = getValues('packagingGroups');
    const nextItemIndex = itemsArray.fields.length;
    const mixed = groups.some(
      (group) => group.mode === OrderPackagingMode.MIXED_STYLE,
    );
    const extendedGroups = groups.map((group) => ({
      ...group,
      itemUnitsPerBag: [
        ...group.itemUnitsPerBag,
        mixed ? 10 : 0,
      ],
    }));
    if (!mixed) {
      extendedGroups.push({
        name: null,
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 100,
        itemUnitsPerBag: Array.from(
          { length: nextItemIndex + 1 },
          (_, index) => (index === nextItemIndex ? 10 : 0),
        ),
      });
    }
    setValue('packagingGroups', extendedGroups, {
      shouldDirty: true,
      shouldValidate: true,
    });
    const nextFig = nextItemFigRef.current;
    nextItemFigRef.current += 1;
    setValue('nextItemFig', nextItemFigRef.current, { shouldDirty: true });
    const nextItem = {
      ...createExternalOrderItem(
        crafts,
        products,
        externalCreateOrderOptions?.foilColors[0]?.name ?? null,
      ),
      fig: nextFig,
    };
    itemsArray.append(nextItem);
    invalidateStructuralQuotes();
    persistLocalDraftValues({
      ...getValues(),
      items: [...currentItems, nextItem],
      additionalShipments: nextShipments,
      packagingGroups: extendedGroups,
    });
  }

  function duplicateItem(index: number) {
    const currentItems = getValues('items');
    const source = getValues(`items.${index}`);
    const shipments = getValues('additionalShipments');
    const nextShipments = shipments.map((shipment) => ({
      ...shipment,
      itemQuantities: [...shipment.itemQuantities, 0],
    }));
    setValue(
      'additionalShipments',
      nextShipments,
      { shouldDirty: true },
    );
    const groups = getValues('packagingGroups');
    const nextItemIndex = itemsArray.fields.length;
    const mixed = groups.some(
      (group) => group.mode === OrderPackagingMode.MIXED_STYLE,
    );
    const sourceUnits =
      groups.find((group) => (group.itemUnitsPerBag[index] ?? 0) > 0)
        ?.itemUnitsPerBag[index] ?? 10;
    const nextGroups = groups.map((group) => ({
      ...group,
      itemUnitsPerBag: [
        ...group.itemUnitsPerBag,
        mixed ? sourceUnits : 0,
      ],
    }));
    if (!mixed) {
      nextGroups.push({
        name: null,
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 100,
        itemUnitsPerBag: Array.from(
          { length: nextItemIndex + 1 },
          (_, itemIndex) =>
            itemIndex === nextItemIndex ? sourceUnits : 0,
        ),
      });
    }
    setValue('packagingGroups', nextGroups, {
      shouldDirty: true,
      shouldValidate: true,
    });
    const nextItem = {
      ...source,
      fig: nextItemFigRef.current,
      name: usesExternalSalesPricing
        ? source.name
        : source.name?.trim()
          ? `${source.name} 副本`
          : '',
    };
    nextItemFigRef.current += 1;
    setValue('nextItemFig', nextItemFigRef.current, { shouldDirty: true });
    itemsArray.append(nextItem);
    invalidateStructuralQuotes();
    persistLocalDraftValues({
      ...getValues(),
      items: [...currentItems, nextItem],
      additionalShipments: nextShipments,
      packagingGroups: nextGroups,
    });
  }

  function commitExternalItem(
    index: number,
    item: CreateOrderInput['items'][number],
    options: {
      paperKey?: ExternalOrderPaperKey;
      resetPaper?: boolean;
      resetSpecification?: boolean;
      preserveCustomSize?: boolean;
    } = {},
  ) {
    setValue(
      `items.${index}`,
      normalizeExternalOrderItem({
        item,
        crafts,
        products,
        ...options,
        preserveCustomSize: options.preserveCustomSize ?? true,
      }),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function commitOrderFormBItem(
    index: number,
    item: CreateOrderInput['items'][number],
    options: {
      paperKey?: ExternalOrderPaperKey;
      resetPaper?: boolean;
      resetSpecification?: boolean;
      preserveCustomSize?: boolean;
      internalMaterialChange?:
        | 'route'
        | 'paper'
        | 'weight'
        | 'specification';
    } = {},
  ) {
    if (usesExternalSalesPricing) {
      const externalOptions = {
        paperKey: options.paperKey,
        resetPaper: options.resetPaper,
        resetSpecification: options.resetSpecification,
        preserveCustomSize: options.preserveCustomSize,
      };
      commitExternalItem(index, item, externalOptions);
      return;
    }

    const current = getValues(`items.${index}`);
    const {
      internalMaterialChange = null,
      ...normalizationOptions
    } = options;
    const normalized = normalizeExternalOrderItem({
      item,
      crafts,
      products,
      ...normalizationOptions,
      preserveCustomSize: normalizationOptions.preserveCustomSize ?? true,
    });
    const selectedProduct = products.find(
      (product) => product.id === current.productId,
    );
    const selectedProductStillMatches = Boolean(
      selectedProduct &&
        productCategoryMatchesPricingRoute(
          normalized.pricingRoute,
          selectedProduct.category,
        ) &&
        catalogPricingFactChoices(selectedProduct.specification).includes(
          normalized.specification ?? '',
        ) &&
        catalogPricingFactChoices(selectedProduct.paperType).includes(
          normalized.paperType ?? '',
        ),
    );
    setValue(
      `items.${index}`,
      {
        ...normalized,
        name: current.name,
        productId:
          internalMaterialChange === null
            ? current.productId
            : normalized.productId ??
              (selectedProductStillMatches ? current.productId : null),
        productStructure:
          internalMaterialChange === 'route'
            ? normalized.productStructure
            : current.productStructure,
        specification:
          internalMaterialChange === 'route' ||
          internalMaterialChange === 'specification'
            ? item.specification
            : current.specification,
        paperType:
          internalMaterialChange === 'route' ||
          internalMaterialChange === 'paper'
            ? normalized.paperType
            : current.paperType,
        paperWeightGsm:
          internalMaterialChange === 'route' ||
          internalMaterialChange === 'paper'
            ? normalized.paperWeightGsm
            : internalMaterialChange === 'weight'
              ? item.paperWeightGsm
              : current.paperWeightGsm,
        actualWidthMm:
          internalMaterialChange === 'route' ||
          internalMaterialChange === 'specification'
            ? normalized.actualWidthMm
            : current.actualWidthMm,
        actualHeightMm:
          internalMaterialChange === 'route' ||
          internalMaterialChange === 'specification'
            ? normalized.actualHeightMm
            : current.actualHeightMm,
        crafts: normalizeCraftIdsForPricingRoute(
          normalized.pricingRoute,
          [...current.crafts, ...normalized.crafts],
          crafts,
        ),
        artworkVersion: current.artworkVersion,
        plateGroupId: current.plateGroupId,
        pricingGroup: current.pricingGroup,
        unitPrice: current.unitPrice,
        fixedFee: current.fixedFee,
        suggestedSubtotal: current.suggestedSubtotal,
        priceOverrideReason: current.priceOverrideReason,
        remark: current.remark,
      },
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function changeExternalRoute(index: number, route: OrderItemPricingRoute) {
    const current = getValues(`items.${index}`);
    const defaultFoilColor =
      externalCreateOrderOptions?.foilColors[0]?.name ?? null;
    commitOrderFormBItem(
      index,
      {
        ...current,
        pricingRoute: route,
        frontFoilColors:
          route === OrderItemPricingRoute.COLOR_PRINT || !defaultFoilColor
            ? []
            : [defaultFoilColor],
        backFoilColors: [],
        foilColors:
          route === OrderItemPricingRoute.COLOR_PRINT || !defaultFoilColor
            ? []
            : [defaultFoilColor],
        foilTechnique:
          route === OrderItemPricingRoute.COLOR_PRINT
            ? OrderFoilTechnique.NONE
            : OrderFoilTechnique.FLAT,
        hasLocalFoil: route === OrderItemPricingRoute.STOCK_BLANK,
        lamination: OrderLamination.NONE,
      },
      {
        resetPaper: true,
        resetSpecification: true,
        preserveCustomSize: false,
        internalMaterialChange: 'route',
      },
    );
  }

  function changeExternalPaper(index: number, paperKey: ExternalOrderPaperKey) {
    const current = getValues(`items.${index}`);
    const paper = externalOrderPapersForRoute(
      products,
      current.pricingRoute,
    ).find(
      (candidate) => candidate.key === paperKey,
    );
    if (!paper) return;
    const nextWeight =
      externalOrderWeightsForSelection(
        paper,
        current.pricingRoute,
        current.specification ??
          externalOrderDefaultSpecification(
            products,
            current.pricingRoute,
          ),
      )[0] ?? current.paperWeightGsm;
    commitOrderFormBItem(
      index,
      {
        ...current,
        paperWeightGsm: nextWeight,
        lamination:
          current.pricingRoute === OrderItemPricingRoute.COLOR_PRINT &&
          paper.key === 'COATED'
            ? OrderLamination.MATTE
            : OrderLamination.NONE,
      },
      {
        paperKey,
        preserveCustomSize: false,
        internalMaterialChange: 'paper',
      },
    );
  }

  function changeExternalWeight(index: number, weight: number) {
    const current = getValues(`items.${index}`);
    commitOrderFormBItem(
      index,
      { ...current, paperWeightGsm: weight },
      { internalMaterialChange: 'weight' },
    );
  }

  function changeExternalSpecification(index: number, specification: string) {
    const current = getValues(`items.${index}`);
    commitOrderFormBItem(
      index,
      { ...current, specification },
      { internalMaterialChange: 'specification' },
    );
  }

  function changeExternalFoilSides(
    index: number,
    frontFoilColors: string[],
    backFoilColors: string[],
  ) {
    const current = getValues(`items.${index}`);
    commitOrderFormBItem(index, {
      ...current,
      frontFoilColors,
      backFoilColors,
      foilColors: [...new Set([...frontFoilColors, ...backFoilColors])],
      isDoubleSided: backFoilColors.length > 0,
      isDoubleColor: frontFoilColors.length + backFoilColors.length > 1,
    });
  }

  function changeExternalFoilTechnique(
    index: number,
    technique: OrderFoilTechnique,
  ) {
    const current = getValues(`items.${index}`);
    commitOrderFormBItem(index, {
      ...current,
      foilTechnique:
        current.foilTechnique === technique
          ? OrderFoilTechnique.FLAT
          : technique,
    });
  }

  function changeExternalCustomSize(index: number, custom: boolean) {
    const current = getValues(`items.${index}`);
    const dimensions = externalOrderDimensions(current.specification ?? '');
    const next = {
      ...current,
      actualWidthMm: custom ? null : (dimensions?.widthMm ?? null),
      actualHeightMm: custom ? null : (dimensions?.heightMm ?? null),
    };
    setValue(`items.${index}`, next, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function changeExternalPrintFoilMode(
    index: number,
    mode: 'NONE' | 'PARTIAL' | 'FULL',
  ) {
    const current = getValues(`items.${index}`);
    const hasFoil = mode !== 'NONE';
    const configuredDefaultFoil =
      externalCreateOrderOptions?.foilColors[0]?.name ?? '';
    const selectedFoil = current.frontFoilColors[0] ?? configuredDefaultFoil;
    commitOrderFormBItem(index, {
      ...current,
      frontFoilColors: hasFoil && selectedFoil ? [selectedFoil] : [],
      backFoilColors: [],
      foilColors: hasFoil && selectedFoil ? [selectedFoil] : [],
      foilTechnique: hasFoil
        ? OrderFoilTechnique.FLAT
        : OrderFoilTechnique.NONE,
      hasLocalFoil: mode === 'PARTIAL',
    });
  }

  function changeExternalPackagingMode(mode: OrderPackagingMode) {
    const items = getValues('items');
    const groups = getValues('packagingGroups');
    if (mode === OrderPackagingMode.MIXED_STYLE) {
      if (items.length < 2) return;
      const itemUnitsPerBag = items.map(
        (_, itemIndex) =>
          groups.find((group) => (group.itemUnitsPerBag[itemIndex] ?? 0) > 0)
            ?.itemUnitsPerBag[itemIndex] ?? 10,
      );
      setValue(
        'packagingGroups',
        [
          {
            name: null,
            mode,
            actualBagCount: 1,
            itemUnitsPerBag,
          },
        ],
        { shouldDirty: true, shouldValidate: true },
      );
      return;
    }
    const mixedGroup = groups.find(
      (group) => group.mode === OrderPackagingMode.MIXED_STYLE,
    );
    setValue(
      'packagingGroups',
      items.map((_, itemIndex) => ({
        name: null,
        mode,
        actualBagCount: 1,
        itemUnitsPerBag: items.map((__, candidateIndex) =>
          candidateIndex === itemIndex
            ? (mixedGroup?.itemUnitsPerBag[itemIndex] ?? 10)
            : 0,
        ),
      })),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function changeExternalUnitsPerBag(index: number, unitsPerBag: number) {
    setValue(
      `items.${index}.pack`,
      Number.isSafeInteger(unitsPerBag) && unitsPerBag > 0
        ? unitsPerBag
        : null,
      { shouldDirty: true, shouldValidate: true },
    );
    const groups = getValues('packagingGroups');
    const matchedGroupIndex = groups.findIndex(
      (group) => (group.itemUnitsPerBag[index] ?? 0) > 0,
    );
    const groupIndex =
      matchedGroupIndex >= 0
        ? matchedGroupIndex
        : groups[0]?.mode === OrderPackagingMode.MIXED_STYLE
          ? 0
          : index;
    if (groupIndex < 0) return;
    const next = groups.map((group, candidateGroupIndex) => ({
      ...group,
      itemUnitsPerBag:
        candidateGroupIndex === groupIndex
          ? group.itemUnitsPerBag.map((value, itemIndex) =>
              itemIndex === index ? unitsPerBag : value,
            )
          : [...group.itemUnitsPerBag],
    }));
    setValue('packagingGroups', next, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function resetShipmentCarrierFacts() {
    invalidateOrderQuoteRequests(externalQuoteRequestGate.current);
    const chargeOptions = {
      shouldDirty: true,
      shouldValidate: true,
    } as const;
    setValue('destinationProvince', null, chargeOptions);
    setValue('quotedWeightKg', null, chargeOptions);
    setValue(
      'additionalShipments',
      getValues('additionalShipments').map((shipment) => ({
        ...shipment,
        destinationProvince: null,
        quotedWeightKg: null,
      })),
      chargeOptions,
    );
    setLogisticsQuote(null);
    setExternalOrderQuote(null);
  }

  const calculateAndApplyQuote = useCallback(
    (index: number, fieldId: string) => {
      const item = getValues(`items.${index}`);
      const facts = orderItemQuoteFacts(item);
      const orderItemCount = getValues('items').length;
      const inputKey = quoteFactsKey(facts, orderItemCount);
      const requestId = ++quoteRequestSequence.current;
      latestQuoteRequestByField.current[fieldId] = requestId;
      setQuotingFieldId(fieldId);
      startQuote(async () => {
        const response = await quoteOrderItemsAction({
          items: [facts],
          orderItemCount,
        });
        // A quote can finish after the operator has changed product/quantity/
        // craft facts, removed the row, or started a newer request for the same
        // row. Keep the old response available only as a stale-status hint; it
        // must never write prices into the current form or replace a newer view.
        if (latestQuoteRequestByField.current[fieldId] !== requestId) return;
        const sameRow = itemFieldIdsRef.current[index] === fieldId;
        if (!sameRow) {
          setQuotingFieldId((current) =>
            current === fieldId ? null : current,
          );
          return;
        }
        const factsStillCurrent =
          quoteFactsKey(
            getValues(`items.${index}`),
            getValues('items').length,
          ) === inputKey;
        if (response.status === 'success') {
          const result = response.items[0];
          if (!result) {
            setQuoteViews((current) => ({
              ...current,
              [fieldId]: { inputKey, error: '暂时无法获取报价结果' },
            }));
          } else {
            setQuoteViews((current) => ({
              ...current,
              [fieldId]: { inputKey, result },
            }));
            if (
              result.complete &&
              factsStillCurrent &&
              !usesExternalSalesPricing
            ) {
              setValue(`items.${index}.unitPrice`, result.suggestedUnitPrice, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setValue(`items.${index}.fixedFee`, result.suggestedFixedFee, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setValue(
                `items.${index}.suggestedSubtotal`,
                result.suggestedSubtotal,
                {
                  shouldDirty: true,
                  shouldValidate: true,
                },
              );
            }
          }
        } else {
          const error =
            response.status === 'error'
              ? response.message
              : Object.values(response.fieldErrors).flat().join('；');
          setQuoteViews((current) => ({
            ...current,
            [fieldId]: { inputKey, error },
          }));
        }
        if (latestQuoteRequestByField.current[fieldId] === requestId) {
          setQuotingFieldId((current) =>
            current === fieldId ? null : current,
          );
        }
      });
    },
    [getValues, setValue, startQuote, usesExternalSalesPricing],
  );

  const currentLogisticsQuoteInput = useCallback(() => {
    const values = getValues();
    const additional = values.additionalShipments ?? [];
    const primaryItemQuantities = values.items.map((item, itemIndex) => {
      const allocated = additional.reduce(
        (sum, shipment) => sum + (shipment.itemQuantities[itemIndex] ?? 0),
        0,
      );
      return item.quantity - allocated;
    });
    return {
      isSfCollect: values.isSfCollect,
      items: values.items.map((item, index) => ({
        itemKey: String(index + 1),
        quantity: item.quantity,
        paperWeightGsm: item.paperWeightGsm,
        paperType: item.paperType,
        productStructure: item.productStructure,
      })),
      shipments: [
        {
          shipmentKey: '1',
          province: values.destinationProvince,
          billableWeightKg: null,
          itemQuantity: primaryItemQuantities.reduce(
            (sum, quantity) => sum + quantity,
            0,
          ),
          itemQuantities: primaryItemQuantities,
        },
        ...additional.map((shipment, index) => ({
          shipmentKey: String(index + 2),
          province: shipment.destinationProvince,
          billableWeightKg: null,
          itemQuantity: shipment.itemQuantities.reduce(
            (sum, quantity) => sum + quantity,
            0,
          ),
          itemQuantities: shipment.itemQuantities,
        })),
      ],
    };
  }, [getValues]);

  const automaticItemFactsKey = watchedItems
    .map((item) => quoteFactsKey(item, watchedItems.length))
    .join('|');
  useEffect(() => {
    if (!usesExternalSalesPricing || !localDraftReady || createdDraft) return;
    watchedItems.forEach((item, index) => {
      const normalized = normalizeExternalOrderItem({
        item,
        crafts,
        products,
        resetPaper: !item.paperType,
        resetSpecification: !item.specification,
        preserveCustomSize: true,
      });
      if (JSON.stringify(normalized) !== JSON.stringify(item)) {
        setValue(`items.${index}`, normalized, {
          shouldDirty: false,
          shouldValidate: false,
        });
      }
    });
    if (watchedPackagingGroups.length === 0 && watchedItems.length > 0) {
      setValue('packagingGroups', defaultPackagingGroups(watchedItems.length), {
        shouldDirty: false,
        shouldValidate: false,
      });
    }
  }, [
    automaticItemFactsKey,
    crafts,
    createdDraft,
    localDraftReady,
    products,
    externalCreateOrderOptions?.foilColors,
    setValue,
    usesExternalSalesPricing,
    watchedItems,
    watchedPackagingGroups.length,
  ]);
  useEffect(() => {
    if (
      usesExternalSalesPricing ||
      !localDraftReady ||
      createdDraft ||
      submitting ||
      uploading
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      itemsArray.fields.forEach((field, index) => {
        const item = watchedItems[index];
        if (
          !item ||
          !item.productId ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity < 1 ||
          item.crafts.length === 0
        ) {
          return;
        }
        calculateAndApplyQuote(index, field.id);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    automaticItemFactsKey,
    calculateAndApplyQuote,
    createdDraft,
    itemsArray.fields,
    localDraftReady,
    submitting,
    uploading,
    usesExternalSalesPricing,
    watchedItems,
  ]);

  const packagingBagFactsKey = JSON.stringify({
    itemQuantities: watchedItems.map((item) => item.quantity),
    groups: watchedPackagingGroups.map((group) => ({
      mode: group.mode,
      itemUnitsPerBag: group.itemUnitsPerBag,
    })),
  });
  useEffect(() => {
    watchedPackagingGroups.forEach((group, groupIndex) => {
      const result = calculatePackagingBagCount({
        mode: group.mode,
        itemQuantities: watchedItems.map((item) => item.quantity),
        itemUnitsPerBag: group.itemUnitsPerBag,
      });
      if (result.complete && result.bagCount !== group.actualBagCount) {
        setValue(
          `packagingGroups.${groupIndex}.actualBagCount`,
          result.bagCount,
          { shouldDirty: true, shouldValidate: true },
        );
      }
    });
  }, [packagingBagFactsKey, setValue, watchedItems, watchedPackagingGroups]);

  const currentPackagingQuoteInput = useCallback(
    () => ({
      groups: getValues('packagingGroups').map((group, index) => ({
        groupKey: String(index + 1),
        mode: group.mode,
        actualBagCount: group.actualBagCount,
      })),
    }),
    [getValues],
  );
  const currentPackagingInputKey = JSON.stringify({
    groups: watchedPackagingGroups.map((group, index) => ({
      groupKey: String(index + 1),
      mode: group.mode,
      actualBagCount: group.actualBagCount,
    })),
  });

  const watchedPrimaryQuantities = watchedItems.map((item, itemIndex) => {
    const allocated = watchedShipments.reduce(
      (sum, shipment) => sum + (shipment.itemQuantities[itemIndex] ?? 0),
      0,
    );
    return item.quantity - allocated;
  });
  const currentPrimaryQuantitiesValid = watchedPrimaryQuantities.every(
    (quantity) => quantity >= 0,
  );
  const currentLogisticsProjection = {
    isSfCollect: watchedIsSfCollect,
    items: watchedItems.map((item, index) => ({
      itemKey: String(index + 1),
      quantity: item.quantity,
      paperWeightGsm: item.paperWeightGsm,
      paperType: item.paperType,
      productStructure: item.productStructure,
    })),
    shipments: [
      {
        shipmentKey: '1',
        province: watchedDestinationProvince,
        billableWeightKg: null,
        itemQuantity: watchedPrimaryQuantities.reduce(
          (sum, quantity) => sum + quantity,
          0,
        ),
        itemQuantities: watchedPrimaryQuantities,
      },
      ...watchedShipments.map((shipment, index) => ({
        shipmentKey: String(index + 2),
        province: shipment.destinationProvince,
        billableWeightKg: null,
        itemQuantity: shipment.itemQuantities.reduce(
          (sum, quantity) => sum + quantity,
          0,
        ),
        itemQuantities: shipment.itemQuantities,
      })),
    ],
  };
  const currentLogisticsInputKey = JSON.stringify(currentLogisticsProjection);
  const currentLogisticsQuoteReady = currentLogisticsProjection.shipments.every(
    (shipment) => shipment.itemQuantity > 0,
  );
  const currentExternalQuoteFactsKey = compactOrderQuoteFactsKey({
    itemFacts: watchedItems.map((item) =>
      quoteFactsKey(item, watchedItems.length),
    ),
    packaging: currentPackagingInputKey,
    logistics: currentLogisticsInputKey,
    openedPriceVersion: initialExternalPriceSnapshot
      ? {
          processing: initialExternalPriceSnapshot.processing.version,
          logistics: initialExternalPriceSnapshot.logistics.version,
        }
      : null,
  });
  const currentExternalQuoteInput = useCallback(() => {
    const values = getValues();
    const packaging = currentPackagingQuoteInput();
    const logistics = currentLogisticsQuoteInput();
    const factsKey = compactOrderQuoteFactsKey({
      itemFacts: values.items.map((item) =>
        quoteFactsKey(item, values.items.length),
      ),
      packaging: JSON.stringify(packaging),
      logistics: JSON.stringify(logistics),
      openedPriceVersion: initialExternalPriceSnapshot
        ? {
            processing: initialExternalPriceSnapshot.processing.version,
            logistics: initialExternalPriceSnapshot.logistics.version,
          }
        : null,
    });
    return {
      factsKey,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      items: values.items.map(orderItemQuoteFacts),
      orderItemCount: values.items.length,
      packagingGroups: packaging.groups,
      logistics,
    };
  }, [
    currentLogisticsQuoteInput,
    currentPackagingQuoteInput,
    getValues,
    initialExternalPriceSnapshot,
  ]);
  const currentExternalQuoteRequestReady =
    watchedItems.length > 0 &&
    watchedItems.every(
      (item) =>
        Boolean(item.productId) &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity >= 1 &&
        item.crafts.length > 0,
    ) &&
    watchedPackagingGroups.length > 0 &&
    watchedPackagingGroups.every(
      (group) =>
        Number.isSafeInteger(group.actualBagCount) &&
        group.actualBagCount >= 1,
    ) &&
    currentPrimaryQuantitiesValid &&
    currentLogisticsQuoteReady;
  const externalQuoteHasCurrentResponse = Boolean(
    externalOrderQuote?.inputKey === currentExternalQuoteFactsKey &&
      (externalOrderQuote.result || externalOrderQuote.error),
  );
  const externalQuoteNeedsRefresh =
    usesExternalSalesPricing &&
    currentExternalQuoteRequestReady &&
    !externalQuoteHasCurrentResponse;

  useEffect(() => {
    if (
      !usesExternalSalesPricing ||
      !localDraftReady ||
      createdDraft ||
      submitting ||
      uploading ||
      externalOrderQuote?.inputKey === currentExternalQuoteFactsKey ||
      !currentExternalQuoteRequestReady
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const input = currentExternalQuoteInput();
      if (input.factsKey !== currentExternalQuoteFactsKey) return;
      const requestId = beginOrderQuoteRequest(
        externalQuoteRequestGate.current,
      );
      const fieldIds = [...itemFieldIdsRef.current];
      const packagingInputKey = JSON.stringify({
        groups: input.packagingGroups,
      });
      const logisticsInputKey = JSON.stringify(input.logistics);
      setExternalOrderQuote({ inputKey: input.factsKey });
      startExternalQuote(async () => {
        const response = await quoteExternalCreateOrderAction(input);
        if (
          !isCurrentOrderQuoteResponse({
            gate: externalQuoteRequestGate.current,
            requestId,
            inputKey: input.factsKey,
            currentInputKey: currentExternalQuoteInput().factsKey,
            fieldIds,
            currentFieldIds: itemFieldIdsRef.current,
          })
        ) {
          return;
        }

        if (
          response.status === 'success' &&
          response.quote.factsKey === input.factsKey
        ) {
          setQuoteViews(
            Object.fromEntries(
              fieldIds.map((fieldId, index) => [
                fieldId,
                {
                  inputKey: quoteFactsKey(
                    input.items[index],
                    input.orderItemCount,
                  ),
                  result: response.quote.items[index],
                },
              ]),
            ),
          );
          setPackagingQuote({
            inputKey: packagingInputKey,
            result: response.quote.packaging,
          });
          setLogisticsQuote({
            inputKey: logisticsInputKey,
            result: response.quote.logistics,
          });
          setExternalOrderQuote({
            inputKey: input.factsKey,
            result: response.quote,
          });
          return;
        }

        const error =
          response.status === 'error'
            ? response.message
            : response.status === 'invalid'
              ? Object.values(response.fieldErrors).flat().join('；')
              : '报价响应与当前工单不一致，请重试';
        setQuoteViews(
          Object.fromEntries(
            fieldIds.map((fieldId, index) => [
              fieldId,
              {
                inputKey: quoteFactsKey(
                  input.items[index],
                  input.orderItemCount,
                ),
                error,
              },
            ]),
          ),
        );
        setPackagingQuote({ inputKey: packagingInputKey, error });
        setLogisticsQuote({ inputKey: logisticsInputKey, error });
        setExternalOrderQuote({ inputKey: input.factsKey, error });
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    createdDraft,
    currentExternalQuoteFactsKey,
    currentExternalQuoteInput,
    currentExternalQuoteRequestReady,
    currentLogisticsInputKey,
    externalOrderQuote?.inputKey,
    localDraftReady,
    startExternalQuote,
    submitting,
    uploading,
    usesExternalSalesPricing,
  ]);
  // RHF renders client-side field errors next to their controls. The server
  // can still reject backend-only facts such as a disabled product/craft;
  // render only those business messages, never their internal dotted paths.
  const serverFieldErrors =
    state?.status === 'invalid' ? state.fieldErrors : undefined;
  const serverGeneralError = state?.status === 'error' ? state.message : null;
  const itemGapInputs = watchedItems.map((item, index) => {
    const fieldId = itemsArray.fields[index]?.id;
    const view = fieldId ? quoteViews[fieldId] : undefined;
    const currentKey = quoteFactsKey(item, watchedItems.length);
    let quoteStatus: OrderFormQuoteStatus = 'missing';
    if (
      fieldId &&
      (usesExternalSalesPricing
        ? externalQuoteQuoting
        : quoting && quotingFieldId === fieldId)
    ) {
      quoteStatus = 'loading';
    } else if (view?.inputKey !== undefined && view.inputKey !== currentKey) {
      quoteStatus = 'stale';
    } else if (view?.error) {
      quoteStatus = 'error';
    } else if (view?.result?.complete) {
      quoteStatus = 'complete';
    } else if (view?.result) {
      quoteStatus = 'incomplete';
    }

    const completeQuote = quoteStatus === 'complete' ? view?.result : undefined;
    const manualPriceProvided =
      hasAmount(item.unitPrice) || hasAmount(item.fixedFee);
    const priceOverrideRequired = completeQuote
      ? !quoteAmountMatches(
          item.unitPrice,
          completeQuote.suggestedUnitPrice,
          4,
        ) ||
        !quoteAmountMatches(item.fixedFee, completeQuote.suggestedFixedFee, 2)
      : manualPriceProvided;
    return {
      ...item,
      quoteStatus,
      manualPriceProvided,
      priceOverrideRequired,
    };
  });

  const shipmentGapInputs = [
    {
      key: 'primary',
      label: '主地址',
      idPrefix: 'primary',
      receiverFieldId: 'receiverAddress',
      receiverAddress: watchedReceiverAddress,
      province: watchedDestinationProvince,
      billableWeightKg: usesExternalSalesPricing ? 'automatic' : null,
    },
    ...watchedShipments.map((shipment, index) => ({
      key: `additional-${index}`,
      label: `额外地址 ${index + 1}`,
      idPrefix: `shipment-${index}`,
      receiverFieldId: `additionalShipments.${index}.receiverAddress`,
      receiverAddress: shipment.receiverAddress,
      province: shipment.destinationProvince,
      billableWeightKg: usesExternalSalesPricing ? 'automatic' : null,
    })),
  ];
  const formGaps = collectOrderFormGaps({
    customerRef: watchedCustomerRef,
    promisedDate: watchedPromisedDate,
    items: itemGapInputs,
    shipping: {
      usesExternalSalesPricing,
      isSfCollect: watchedIsSfCollect,
      shipments: shipmentGapInputs,
    },
  });
  const orderFormBGaps = usesExternalSalesPricing
    ? []
    : formGaps.map((gap) => gap.label);
  const totalQuantity = watchedItems.reduce(
    (sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0),
    0,
  );
  const railQuoteItems = itemGapInputs.map((item, index) => {
    const fieldId = itemsArray.fields[index]?.id ?? `item-${index}`;
    const view = quoteViews[fieldId];
    const current =
      view?.inputKey === quoteFactsKey(watchedItems[index], watchedItems.length);
    const result = current ? view?.result : undefined;
    const manualPriceResolved =
      !usesExternalSalesPricing &&
      item.manualPriceProvided &&
      Boolean(item.priceOverrideReason?.trim());
    const manualAmount = manualPriceResolved
      ? internalOrderItemAmount(watchedItems[index])
      : null;
    const effectiveStatus =
      manualPriceResolved && manualAmount !== null
        ? ('complete' as const)
        : item.quoteStatus;
    return {
      key: fieldId,
      label:
        watchedItems[index]?.name?.trim() ||
        ORDER_PRICING_ROUTE_LABELS[
          watchedItems[index]?.pricingRoute ?? OrderItemPricingRoute.STOCK_BLANK
        ],
      status: effectiveStatus,
      amount:
        manualAmount ??
        (item.quoteStatus === 'complete'
          ? (result?.suggestedSubtotal ?? null)
          : null),
      components:
        manualAmount !== null
          ? [
              {
                label: '人工成交金额',
                amount: manualAmount,
              },
            ]
          : item.quoteStatus === 'complete'
            ? (result?.components ?? []).map((component) => ({
                label: externalQuoteComponentLabel(
                  watchedItems[index] ?? item,
                  component,
                ),
                amount: component.amount,
              }))
            : [],
      message:
        item.quoteStatus === 'error'
          ? view?.error
          : item.quoteStatus === 'incomplete'
            ? result?.errors.join('；')
            : null,
    };
  });
  const logisticsQuoteStale =
    Boolean(logisticsQuote) &&
    logisticsQuote?.inputKey !== currentLogisticsInputKey;
  const currentLogisticsResult = logisticsQuoteStale
    ? undefined
    : logisticsQuote?.result;
  const primaryLogisticsShipment = currentLogisticsResult?.shipments[0];
  const billableWeight =
    primaryLogisticsShipment?.shipping.basis.billableWeightKg;
  const railLogistics = usesExternalSalesPricing
    ? {
        status: externalQuoteQuoting
          ? ('loading' as const)
          : !logisticsQuote
            ? ('missing' as const)
            : logisticsQuoteStale
              ? ('stale' as const)
              : logisticsQuote.error
                ? ('error' as const)
                : !watchedIsSfCollect && !watchedDestinationProvince
                  ? ('missing' as const)
                  : currentLogisticsResult?.complete
                  ? ('complete' as const)
                  : ('incomplete' as const),
        shippingAmount: currentLogisticsResult?.suggestedShippingTotal ?? null,
        packagingAmount:
          currentLogisticsResult?.suggestedPackagingTotal ?? null,
        totalAmount: currentLogisticsResult?.suggestedTotal ?? null,
        shippingLabel: watchedIsSfCollect
          ? '快递费 · 顺丰到付'
          : `快递费 中通${watchedDestinationProvince ? ` · ${watchedDestinationProvince}` : ' · 未填地址'}${typeof billableWeight === 'string' || typeof billableWeight === 'number' ? ` · ${billableWeight}kg` : ''}`,
        packagingLabel: `纸箱耗材 ${totalQuantity.toLocaleString('zh-CN')}个`,
        message:
          logisticsQuote?.error ??
          currentLogisticsResult?.errors.join('；') ??
          null,
      }
    : null;
  const packagingQuoteStale =
    Boolean(packagingQuote) &&
    packagingQuote?.inputKey !== currentPackagingInputKey;
  const currentPackagingResult = packagingQuoteStale
    ? undefined
    : packagingQuote?.result;
  const railPackaging: ExternalSalesPackagingQuote = {
    status: externalQuoteQuoting
      ? 'loading'
      : !packagingQuote
        ? 'missing'
        : packagingQuoteStale
          ? 'stale'
          : packagingQuote.error
            ? 'error'
            : currentPackagingResult?.suggestedTotal !== null &&
                !currentPackagingResult?.requiresAdminConfirmation
              ? 'complete'
              : 'incomplete',
    amount: currentPackagingResult?.suggestedTotal ?? null,
    label: `${watchedPackagingGroups.some((group) => group.mode === OrderPackagingMode.MIXED_STYLE) ? '混装' : '入袋'} ${watchedPackagingGroups.reduce((sum, group) => sum + (Number.isSafeInteger(group.actualBagCount) ? group.actualBagCount : 0), 0).toLocaleString('zh-CN')}袋`,
    message:
      packagingQuote?.error ??
      currentPackagingResult?.errors.join('；') ??
      null,
  };
  const currentExternalOrderQuote =
    externalOrderQuote?.inputKey === currentExternalQuoteFactsKey
      ? externalOrderQuote.result
      : undefined;
  const externalRequiresManualQuote =
    railQuoteItems.some((item) => item.status !== 'complete') ||
    railPackaging.status !== 'complete' ||
    railLogistics?.status !== 'complete';
  const externalReviewRequiresManualQuote = submitQuoteChange
    ? submitQuoteChange.quotedFeeCompleteness ===
      OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS
    : externalRequiresManualQuote;
  const externalTotal = externalSalesOrderFormTotal({
    quoteItems: railQuoteItems,
    packaging: railPackaging,
    logistics: railLogistics,
    knownTotal: currentExternalOrderQuote?.knownTotal,
  });
  const externalReviewItems: OrderSubmissionReviewItem[] = pendingSubmission
    ? pendingSubmission.data.items.map((item, index) => {
        const fieldId = pendingSubmission.fieldIds[index] ?? `item-${index}`;
        const files = pendingSubmission.queues[fieldId] ?? [];
        const image = files.find(
          (file) => file.prepared.fileType === DesignFileType.IMAGE,
        );
        const cdr = files.find(
          (file) => file.prepared.fileType === DesignFileType.CDR,
        );
        const packagingGroup = pendingSubmission.data.packagingGroups.find(
          (group) => (group.itemUnitsPerBag[index] ?? 0) > 0,
        );
        const unitsPerBag = packagingGroup?.itemUnitsPerBag[index] ?? 0;
        const quote = railQuoteItems[index];
        const paper = externalOrderPaperFromType(products, item.paperType);
        const specification = externalOrderSpecificationLabel(
          item.specification ?? '—',
          item.pricingRoute,
        );
        const dimensions =
          item.actualWidthMm !== null && item.actualHeightMm !== null
            ? `${item.actualWidthMm}×${item.actualHeightMm}mm`
            : '尺寸由工厂核定';
        const foilSummary =
          item.frontFoilColors.length > 0
            ? item.backFoilColors.length > 0
              ? `正 ${item.frontFoilColors.join('+')} / 反 ${item.backFoilColors.join('+')}`
              : item.frontFoilColors.join('+')
            : '不烫金';
        const processSummary =
          item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT
            ? `彩印${item.lamination !== OrderLamination.NONE ? ` · 覆${LAMINATION_LABELS[item.lamination]}` : ''}${item.frontFoilColors.length > 0 ? ` · ${item.hasLocalFoil ? '局部烫金' : '专版烫金'} ${foilSummary}` : ''}`
            : `烫金 ${foilSummary}${item.foilTechnique === OrderFoilTechnique.RELIEF ? ' · 浮雕' : item.foilTechnique === OrderFoilTechnique.RAISED ? ' · 激凸' : ''}`;
        const manualQuoteReasons =
          quote?.status === 'complete'
            ? []
            : [quote?.message || '当前参数需由工厂核价'];
        return {
          id: fieldId,
          number: item.fig ?? index + 1,
          quantityLabel: item.quantity.toLocaleString('zh-CN'),
          quantityInWords: `${formatChineseInteger(item.quantity)}个`,
          quantityDetail:
            unitsPerBag > 0 && packagingGroup
              ? `${unitsPerBag}个一包，共 ${packagingGroup.actualBagCount.toLocaleString('zh-CN')} 包`
              : undefined,
          specification,
          dimensions,
          materialSummary: `${ORDER_PRICING_ROUTE_LABELS[item.pricingRoute]} · ${paper?.label ?? item.paperType ?? '未选纸张'} ${item.paperWeightGsm ?? '—'}g`,
          specificationWarning:
            item.actualWidthMm === null
              ? '自定义尺寸 · 需工厂核价'
              : undefined,
          processSummary,
          facts: [
            ...(item.quantity === 1_000 &&
            !dirtyFields.items?.[index]?.quantity
              ? [
                  {
                    label: '数量未改过默认值 1,000',
                    critical: true,
                  },
                ]
              : []),
            ...(item.pricingRoute === OrderItemPricingRoute.STOCK_BLANK &&
            item.backFoilColors.length === 0
              ? [{ label: '不烫反面', critical: true }]
              : []),
            ...((item.pricingRoute === OrderItemPricingRoute.STOCK_BLANK ||
              (item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT &&
                item.hasLocalFoil)) &&
            item.frontFoilColors.length + item.backFoilColors.length > 1
              ? [
                  {
                    label: `${item.frontFoilColors.length + item.backFoilColors.length} 次过版`,
                  },
                ]
              : []),
            ...(item.pricingRoute ===
              OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL &&
            item.foilTechnique === OrderFoilTechnique.FLAT
              ? [{ label: '无浮雕 / 无激凸' }]
              : []),
            ...(item.pricingRoute ===
              OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL &&
            item.actualWidthMm !== null &&
            item.actualHeightMm !== null
              ? [{ label: '不改尺寸' }]
              : []),
            ...(item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT &&
            item.frontFoilColors.length === 0
              ? [{ label: '不加烫金', critical: true }]
              : []),
            ...(item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT &&
            paper?.key === 'COATED' &&
            item.lamination === OrderLamination.MATTE
              ? [{ label: '覆亚膜' }]
              : []),
            ...(packagingGroup?.mode === OrderPackagingMode.MIXED_STYLE
              ? [{ label: '混装' }]
              : []),
            ...(!cdr ? [{ label: '未上传 CDR', critical: true }] : []),
          ],
          artwork: {
            name: image?.prepared.file.name ?? '未上传设计图',
            meta: image
              ? formatDesignFileSize(image.prepared.file.size)
              : undefined,
            missing: !image,
            previewImage: image?.prepared,
          },
          amountLabel:
            quote?.status === 'complete' && quote.amount
              ? formatOrderCurrency(quote.amount)
              : '待核价',
          manualQuoteReasons,
        };
      })
    : [];
  const activeExternalItem =
    watchedItems[expandedItem] ?? watchedItems[0] ?? initialItem;
  const activeRequiredCraftIds = new Set(
    resolveExternalOrderCraftIds(activeExternalItem, crafts),
  );
  const internalCraftOptions = crafts.filter(
    (craft) => !isLegacyStockFoilCraft(craft),
  );
  const activeExternalPaper = externalOrderPaperFromType(
    products,
    activeExternalItem.paperType,
  );
  const externalPaperOptions: OrderPaperSwatchOption[] =
    externalOrderPapersForRoute(
      products,
      activeExternalItem.pricingRoute,
    ).map(
      (paper) => ({
        value: paper.key,
        label: paper.label,
        texture: externalPaperSwatchTexture(paper.appearance),
        disabled: (() => {
          const materialIds = [
            ...new Set(
              paper.variants
                .filter(
                  (variant) =>
                    variant.route === activeExternalItem.pricingRoute,
                )
                .flatMap((variant) =>
                  variant.paperMaterialId ? [variant.paperMaterialId] : [],
                ),
            ),
          ];
          return (
            materialIds.length > 0 &&
            materialIds.every(
              (materialId) =>
                externalCreateOrderOptions?.papers.find(
                  (option) => option.id === materialId,
                )?.outOfStock === true,
            )
          );
        })(),
      }),
    );
  const externalFoilOptions: OrderFoilSwatchOption[] =
    externalCreateOrderOptions?.foilColors.map((foil) => ({
      value: foil.name,
      label: foil.name,
      color: foil.displayColor,
      imageSrc: foil.displayImage,
    })) ?? [];
  const externalWeightOptions = activeExternalPaper
    ? [
        ...externalOrderWeightsForSelection(
          activeExternalPaper,
          activeExternalItem.pricingRoute,
          activeExternalItem.specification ?? '',
        ),
      ]
    : [];
  const configuredExternalSpecifications = externalCreateOrderOptions
    ? externalCreateOrderOptions.specifications
        .filter((specification) =>
          specification.productCategories.some((category) =>
            productCategoryMatchesPricingRoute(
              activeExternalItem.pricingRoute,
              category,
            ),
          ),
        )
        .map((specification) => specification.label)
    : externalOrderSpecificationsForRoute(
        products,
        activeExternalItem.pricingRoute,
      );
  const externalSpecificationOptions = configuredExternalSpecifications.map(
    (specification) => ({
    value: specification,
    label: externalOrderSpecificationLabel(
      specification,
      activeExternalItem.pricingRoute,
    ),
    disabled:
      activeExternalItem.pricingRoute === OrderItemPricingRoute.STOCK_BLANK &&
      specification.includes('迷你') &&
      activeExternalPaper?.key !== 'PEARL_FLASH',
    }),
  );
  const activeMixedPackagingGroup = watchedPackagingGroups.find(
    (group) => group.mode === OrderPackagingMode.MIXED_STYLE,
  );
  const activePackagingGroup =
    activeMixedPackagingGroup ??
    watchedPackagingGroups.find(
      (group) => (group.itemUnitsPerBag[expandedItem] ?? 0) > 0,
    ) ??
    watchedPackagingGroups[expandedItem];
  const activePackagingBagCount = activePackagingGroup
    ? calculatePackagingBagCount({
        mode: activePackagingGroup.mode,
        itemQuantities: watchedItems.map((item) => item.quantity),
        itemUnitsPerBag: activePackagingGroup.itemUnitsPerBag,
      })
    : null;
  const externalLocalIssues = externalValidationVisible
    ? externalSubmissionIssues(
        getValues(),
        itemsArray.fields.map((field) => field.id),
        pendingDesigns,
      )
    : [];
  const externalItemErrors: OrderFormBErrors['items'] =
    watchedItems.map((item, index) => {
      const fieldId = itemsArray.fields[index]?.id;
      const hasImage = fieldId
        ? (pendingDesigns[fieldId] ?? []).some(
            (file) => file.prepared.fileType === DesignFileType.IMAGE,
          )
        : false;
      const quantityMessage = errors.items?.[index]?.quantity?.message;
      const itemError = {
        route: errors.items?.[index]?.pricingRoute?.message,
        paper: errors.items?.[index]?.paperType?.message,
        weight: errors.items?.[index]?.paperWeightGsm?.message,
        specification: errors.items?.[index]?.specification?.message,
        foilColors:
          errors.items?.[index]?.frontFoilColors?.message ??
          errors.items?.[index]?.backFoilColors?.message ??
          errors.items?.[index]?.foilColors?.message,
        quantity:
          quantityMessage,
        designImage:
          usesExternalSalesPricing && externalValidationVisible && !hasImage
            ? '请上传设计图'
            : undefined,
      };
      return Object.values(itemError).some(Boolean) ? itemError : undefined;
    });
  const externalRHFItemIssues = externalValidationVisible
    ? externalItemErrors.flatMap((itemError, index) => {
        if (!itemError) return [];
        const fig = watchedItems[index]?.fig ?? index + 1;
        return [
          ...new Set(
            Object.values(itemError)
              .filter((message): message is string => Boolean(message))
              .map((message) => `第 ${fig} 款：${message}`),
          ),
        ];
      })
    : [];
  const externalRHFOrderIssues = externalValidationVisible
    ? [
        errors.customName?.message
          ? `工单名称：${errors.customName.message}`
          : null,
        errors.receiverName?.message
          ? `收件人：${errors.receiverName.message}`
          : null,
        errors.receiverAddress?.message
          ? `收货地址：${errors.receiverAddress.message}`
          : null,
        errors.receiverPhone?.message
          ? `收货电话：${errors.receiverPhone.message}`
          : null,
      ].filter((message): message is string => Boolean(message))
    : [];
  const externalFieldErrors: OrderFormBErrors = {
    summary: [
      ...new Set([
        ...externalLocalIssues,
        ...externalRHFOrderIssues,
        ...externalRHFItemIssues,
        ...(serverGeneralError ? [serverGeneralError] : []),
        ...(serverFieldErrors
          ? orderServerFieldErrorMessages(serverFieldErrors)
          : []),
        ...(externalOrderQuote?.inputKey === currentExternalQuoteFactsKey &&
        externalOrderQuote.error
          ? [externalOrderQuote.error]
          : []),
        ...(uploadError ? [uploadError] : []),
      ]),
    ],
    customName:
      errors.customName?.message ??
      (usesExternalSalesPricing &&
      externalValidationVisible &&
      !getValues('customName')?.trim()
        ? '工单名称必填'
        : undefined),
    receiverName:
      errors.receiverName?.message ??
      (usesExternalSalesPricing &&
      externalValidationVisible &&
      !getValues('receiverName')?.trim()
        ? '收件人必填'
        : undefined),
    receiverPhone:
      errors.receiverPhone?.message ??
      (usesExternalSalesPricing &&
      externalValidationVisible &&
      !getValues('receiverPhone')?.trim()
        ? '收货电话必填'
        : undefined),
    receiverAddress:
      errors.receiverAddress?.message ??
      (usesExternalSalesPricing &&
      externalValidationVisible &&
      !getValues('receiverAddress')?.trim()
        ? '收货地址必填'
        : undefined),
    packaging:
      activePackagingBagCount && !activePackagingBagCount.complete
        ? activePackagingBagCount.errors.join('；')
        : undefined,
    items: externalItemErrors,
  };
  const activeItemField = itemsArray.fields[expandedItem];
  const activeQuoteView = activeItemField
    ? quoteViews[activeItemField.id]
    : undefined;
  const activeQuoteIsStale = Boolean(
    activeQuoteView &&
      activeQuoteView.inputKey !==
        quoteFactsKey(watchedItems[expandedItem], watchedItems.length),
  );
  if (usesExternalSalesPricing && submittedOrder) {
    return (
      <OrderSubmissionSuccess
        orderNumber={submittedOrder.orderNo}
        statusLabel={
          submittedOrder.manualQuote ? '待工厂核价确认' : '待工厂确认'
        }
        description={
          submittedOrder.manualQuote
            ? '这张单含系统暂时无法定价的参数，工厂核价后会通知你。核价前不会安排生产。'
            : '工厂确认后进入生产。确认前仍可从工单详情撤回修改。'
        }
        manualQuote={submittedOrder.manualQuote}
        primaryAction={{
          label: '再建一单',
          onClick: () => window.location.assign('/orders/new'),
        }}
        secondaryAction={{
          label: '返回工单列表',
          onClick: () => router.push('/orders'),
        }}
      />
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onValid, onInvalid)}
      className="space-y-4"
      noValidate
      aria-busy={pendingState.busy}
    >
      {pendingLocalDraft && !usesExternalSalesPricing ? (
        <section
          role="alert"
          aria-labelledby="local-order-draft-heading"
          className="rounded-xl border border-warning/50 bg-warning/10 p-4"
        >
          <h2 id="local-order-draft-heading" className="font-semibold">
            发现本机未提交的表单草稿
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            最近保存于 {formatLocalDraftTime(pendingLocalDraft.savedAt)}
            ，请选择恢复或放弃。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            图片和 CDR 文件不会保存在本地草稿中。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={restoreLocalDraft}>
              恢复本地草稿
            </Button>
            <Button type="button" variant="outline" onClick={discardLocalDraft}>
              放弃本地草稿
            </Button>
          </div>
        </section>
      ) : null}

      <fieldset
        disabled={!localDraftReady || submitting || uploading}
        className="contents"
      >
        {(
          <OrderFormB
            title="新建工单"
            settlementLabel={settlementLabel}
            customNameRequired={usesExternalSalesPricing}
            designImageRequired={usesExternalSalesPricing}
            receiverNameRequired={usesExternalSalesPricing}
            receiverPhoneRequired={usesExternalSalesPricing}
            values={{
              customName: watchedCustomName ?? '',
              receiverName: watchedReceiverName ?? '',
              receiverPhone: watchedReceiverPhone ?? '',
              receiverAddress: watchedReceiverAddress ?? '',
              isSfCollect: watchedIsSfCollect,
            }}
            orderExtras={
              !usesExternalSalesPricing ? (
                <div className="mt-4 grid min-w-0 grid-cols-1 gap-3.5 min-[560px]:grid-cols-2">
                  <div>
                    <Label htmlFor="customerPartyId">客户主数据（选填）</Label>
                    <select
                      id="customerPartyId"
                      className={`${selectClass} mt-2`}
                      {...register('customerPartyId', {
                        setValueAs: (value) => (value === '' ? null : value),
                        onChange: (event) => {
                          const customer = customers.find(
                            (candidate) => candidate.id === event.target.value,
                          );
                          if (!customer) return;
                          setValue(
                            'customerRef',
                            customer.shortName ?? customer.name,
                            { shouldDirty: true, shouldValidate: true },
                          );
                          if (!getValues('receiverName') && customer.receiverName) {
                            setValue('receiverName', customer.receiverName, {
                              shouldDirty: true,
                            });
                          }
                          if (!getValues('receiverPhone') && customer.receiverPhone) {
                            setValue('receiverPhone', customer.receiverPhone, {
                              shouldDirty: true,
                            });
                          }
                          if (!getValues('receiverAddress') && customer.receiverAddress) {
                            setValue('receiverAddress', customer.receiverAddress, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }
                        },
                      })}
                    >
                      <option value="">— 临时客户 / 仅填写简称 —</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.code} · {customer.shortName ?? customer.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="customerRef">客户名称/简称</Label>
                    <Input
                      id="customerRef"
                      className="mt-2 h-10"
                      aria-invalid={Boolean(errors.customerRef)}
                      {...register('customerRef')}
                    />
                    {errors.customerRef?.message ? (
                      <p role="alert" className="mt-1.5 text-xs font-semibold text-destructive">
                        {errors.customerRef.message}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <Label htmlFor="promisedDate">承诺交期</Label>
                    <Input
                      id="promisedDate"
                      type="date"
                      className="mt-2 h-10"
                      aria-invalid={Boolean(errors.promisedDate)}
                      {...register('promisedDate')}
                    />
                    {errors.promisedDate?.message ? (
                      <p role="alert" className="mt-1.5 text-xs font-semibold text-destructive">
                        {errors.promisedDate.message as string}
                      </p>
                    ) : null}
                  </div>
                  <label className="flex min-h-10 items-center gap-2 self-end rounded-lg border px-3 text-sm font-semibold">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      {...register('isUrgent')}
                    />
                    急单（提交后会推送至排产群）
                  </label>
                  <div className="min-[560px]:col-span-2">
                    <Label htmlFor="remark">工单备注</Label>
                    <Textarea
                      id="remark"
                      className="mt-2 min-h-20"
                      {...register('remark')}
                    />
                  </div>
                </div>
              ) : undefined
            }
            materialExtras={
              !usesExternalSalesPricing ? (
                <div className="mb-5 grid min-w-0 grid-cols-1 gap-3.5 min-[560px]:grid-cols-2">
                  <div>
                    <Label htmlFor={`items.${expandedItem}.name`}>款式名</Label>
                    <Input
                      id={`items.${expandedItem}.name`}
                      className="mt-2 h-10"
                      aria-invalid={Boolean(errors.items?.[expandedItem]?.name)}
                      {...register(`items.${expandedItem}.name`)}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`items.${expandedItem}.productId`}>
                      报价产品
                    </Label>
                    <select
                      id={`items.${expandedItem}.productId`}
                      className={`${selectClass} mt-2`}
                      {...register(`items.${expandedItem}.productId`, {
                        setValueAs: (value) => (value === '' ? null : value),
                        onChange: (event) => {
                          const product = products.find(
                            (candidate) => candidate.id === event.target.value,
                          );
                          const specificationChoices = catalogPricingFactChoices(
                            product?.specification,
                          );
                          const paperChoices = catalogPricingFactChoices(
                            product?.paperType,
                          );
                          const specification =
                            specificationChoices.length === 1
                              ? (specificationChoices[0] ?? null)
                              : null;
                          const paperType =
                            paperChoices.length === 1
                              ? (paperChoices[0] ?? null)
                              : null;
                          const dimensions = parseCatalogDimensions(specification);
                          const options = {
                            shouldDirty: true,
                            shouldValidate: true,
                          } as const;
                          if (product && !getValues(`items.${expandedItem}.name`)?.trim()) {
                            setValue(`items.${expandedItem}.name`, product.name, options);
                          }
                          setValue(
                            `items.${expandedItem}.specification`,
                            specification,
                            options,
                          );
                          setValue(
                            `items.${expandedItem}.paperType`,
                            paperType,
                            options,
                          );
                          setValue(
                            `items.${expandedItem}.actualWidthMm`,
                            dimensions?.widthMm ?? null,
                            options,
                          );
                          setValue(
                            `items.${expandedItem}.actualHeightMm`,
                            dimensions?.heightMm ?? null,
                            options,
                          );
                          setValue(
                            `items.${expandedItem}.paperWeightGsm`,
                            parseCatalogPaperWeight(paperType),
                            options,
                          );
                          setValue(
                            `items.${expandedItem}.productStructure`,
                            inferCatalogProductStructure(specification),
                            options,
                          );
                        },
                      })}
                    >
                      <option value="">— 请选择 —</option>
                      {products
                        .filter((product) =>
                          productCategoryMatchesPricingRoute(
                            watchedItems[expandedItem]?.pricingRoute ??
                              OrderItemPricingRoute.STOCK_BLANK,
                            product.category,
                          ),
                        )
                        .map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                    </select>
                    {errors.items?.[expandedItem]?.productId?.message ? (
                      <p role="alert" className="mt-1.5 text-xs font-semibold text-destructive">
                        {errors.items[expandedItem]?.productId?.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="min-[560px]:col-span-2 border-t pt-4">
                    <p className="text-[0.6875rem] font-extrabold tracking-[0.18em] text-muted-foreground">
                      内部生产参数 · 非标时填写
                    </p>
                  </div>
                  <div>
                    <Label htmlFor={`items.${expandedItem}.productStructure`}>
                      产品结构
                    </Label>
                    <select
                      id={`items.${expandedItem}.productStructure`}
                      className={`${selectClass} mt-2`}
                      {...register(`items.${expandedItem}.productStructure`)}
                    >
                      {Object.values(OrderProductStructure).map((structure) => (
                        <option key={structure} value={structure}>
                          {PRODUCT_STRUCTURE_LABELS[structure]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`items.${expandedItem}.specification`}>
                      自定义规格
                    </Label>
                    <Input
                      id={`items.${expandedItem}.specification`}
                      className="mt-2 h-10"
                      placeholder="例如：9.5 × 17.2 cm、客户来样"
                      {...register(`items.${expandedItem}.specification`, {
                        onChange: (event) => {
                          const specification = event.target.value || null;
                          const dimensions = parseCatalogDimensions(specification);
                          setValue(
                            `items.${expandedItem}.actualWidthMm`,
                            dimensions?.widthMm ?? null,
                            { shouldDirty: true, shouldValidate: true },
                          );
                          setValue(
                            `items.${expandedItem}.actualHeightMm`,
                            dimensions?.heightMm ?? null,
                            { shouldDirty: true, shouldValidate: true },
                          );
                          setValue(
                            `items.${expandedItem}.productStructure`,
                            inferCatalogProductStructure(specification),
                            { shouldDirty: true, shouldValidate: true },
                          );
                        },
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`items.${expandedItem}.paperType`}>
                      自定义纸张
                    </Label>
                    <Input
                      id={`items.${expandedItem}.paperType`}
                      className="mt-2 h-10"
                      placeholder="输入材料字典中尚未配置的纸张"
                      {...register(`items.${expandedItem}.paperType`, {
                        onChange: (event) => {
                          setValue(
                            `items.${expandedItem}.paperWeightGsm`,
                            parseCatalogPaperWeight(event.target.value),
                            { shouldDirty: true, shouldValidate: true },
                          );
                        },
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`items.${expandedItem}.paperWeightGsm`}>
                      纸张克重（g㎡）
                    </Label>
                    <Input
                      id={`items.${expandedItem}.paperWeightGsm`}
                      type="number"
                      min={1}
                      step={1}
                      className="mt-2 h-10"
                      {...register(`items.${expandedItem}.paperWeightGsm`, {
                        setValueAs: (value) =>
                          value === '' ? null : Number(value),
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`items.${expandedItem}.actualWidthMm`}>
                      实际宽度（mm）
                    </Label>
                    <Input
                      id={`items.${expandedItem}.actualWidthMm`}
                      type="number"
                      min={0.01}
                      step={0.01}
                      className="mt-2 h-10"
                      {...register(`items.${expandedItem}.actualWidthMm`, {
                        setValueAs: (value) =>
                          value === '' ? null : Number(value),
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`items.${expandedItem}.actualHeightMm`}>
                      实际高度（mm）
                    </Label>
                    <Input
                      id={`items.${expandedItem}.actualHeightMm`}
                      type="number"
                      min={0.01}
                      step={0.01}
                      className="mt-2 h-10"
                      {...register(`items.${expandedItem}.actualHeightMm`, {
                        setValueAs: (value) =>
                          value === '' ? null : Number(value),
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`items.${expandedItem}.artworkVersion`}>
                      稿件版本
                    </Label>
                    <Input
                      id={`items.${expandedItem}.artworkVersion`}
                      className="mt-2 h-10"
                      {...register(`items.${expandedItem}.artworkVersion`)}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`items.${expandedItem}.plateGroupId`}>
                      版组 / 模具组 ID
                    </Label>
                    <Input
                      id={`items.${expandedItem}.plateGroupId`}
                      className="mt-2 h-10"
                      {...register(`items.${expandedItem}.plateGroupId`)}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`items.${expandedItem}.pricingGroup`}>
                      专版计价组
                    </Label>
                    <Input
                      id={`items.${expandedItem}.pricingGroup`}
                      className="mt-2 h-10"
                      {...register(`items.${expandedItem}.pricingGroup`)}
                    />
                  </div>
                </div>
              ) : undefined
            }
            pricingExtras={
              !usesExternalSalesPricing ? (
                <section
                  aria-label="加工费报价"
                  className="mt-[1.125rem] border-t pt-[1.125rem]"
                >
                  <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[0.6875rem] font-extrabold tracking-[0.2em] text-muted-foreground">
                        加工费报价
                      </h2>
                      <p className="mt-1.5 text-xs font-semibold text-muted-foreground">
                        {quoting && quotingFieldId === activeItemField?.id
                          ? '正在核价…'
                          : activeQuoteIsStale
                            ? '报价条件已变化，正在重新核价'
                            : activeQuoteView?.error
                              ? activeQuoteView.error
                              : activeQuoteView?.result?.complete
                                ? `系统建议小计 ¥${activeQuoteView.result.suggestedSubtotal ?? '—'}`
                                : activeQuoteView?.result
                                  ? activeQuoteView.result.errors.join('；')
                                  : '系统会自动核价；规则不完整时可填人工成交价。'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !activeItemField ||
                        submitting ||
                        uploading ||
                        Boolean(createdDraft) ||
                        (quoting && quotingFieldId === activeItemField.id)
                      }
                      onClick={() => {
                        if (activeItemField) {
                          calculateAndApplyQuote(expandedItem, activeItemField.id);
                        }
                      }}
                    >
                      {quoting && quotingFieldId === activeItemField?.id
                        ? '计算中…'
                        : '重新核价'}
                    </Button>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-3.5 min-[560px]:grid-cols-2">
                    <div>
                      <Label htmlFor={`items.${expandedItem}.unitPrice`}>
                        成交单价
                      </Label>
                      <Input
                        id={`items.${expandedItem}.unitPrice`}
                        inputMode="decimal"
                        className="mt-2 h-10"
                        aria-invalid={Boolean(errors.items?.[expandedItem]?.unitPrice)}
                        {...register(`items.${expandedItem}.unitPrice`, {
                          setValueAs: (value) => (value === '' ? null : value),
                        })}
                      />
                      {errors.items?.[expandedItem]?.unitPrice?.message ? (
                        <p role="alert" className="mt-1.5 text-xs font-semibold text-destructive">
                          {errors.items[expandedItem]?.unitPrice?.message}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <Label htmlFor={`items.${expandedItem}.fixedFee`}>
                        一次性费用
                      </Label>
                      <Input
                        id={`items.${expandedItem}.fixedFee`}
                        inputMode="decimal"
                        className="mt-2 h-10"
                        aria-invalid={Boolean(errors.items?.[expandedItem]?.fixedFee)}
                        {...register(`items.${expandedItem}.fixedFee`, {
                          setValueAs: (value) => (value === '' ? null : value),
                        })}
                      />
                      {errors.items?.[expandedItem]?.fixedFee?.message ? (
                        <p role="alert" className="mt-1.5 text-xs font-semibold text-destructive">
                          {errors.items[expandedItem]?.fixedFee?.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="min-[560px]:col-span-2">
                      <Label htmlFor={`items.${expandedItem}.priceOverrideReason`}>
                        人工改价说明
                      </Label>
                      <Textarea
                        id={`items.${expandedItem}.priceOverrideReason`}
                        className="mt-2 min-h-16"
                        placeholder="成交价与建议价不同，或规则不完整时必填"
                        aria-invalid={Boolean(
                          errors.items?.[expandedItem]?.priceOverrideReason,
                        )}
                        {...register(`items.${expandedItem}.priceOverrideReason`)}
                      />
                    </div>
                    <div className="min-[560px]:col-span-2">
                      <Label htmlFor={`items.${expandedItem}.remark`}>
                        款式备注
                      </Label>
                      <Textarea
                        id={`items.${expandedItem}.remark`}
                        className="mt-2 min-h-16"
                        placeholder="颜色、方向和工艺注意事项"
                        {...register(`items.${expandedItem}.remark`)}
                      />
                    </div>
                  </div>
                  <fieldset className="mt-5 border-t pt-4">
                    <legend className="text-[0.6875rem] font-extrabold tracking-[0.18em] text-muted-foreground">
                      生产工艺
                    </legend>
                    <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 min-[560px]:grid-cols-2">
                      {internalCraftOptions.map((craft) => {
                        const selected = (
                          watchedItems[expandedItem]?.crafts ?? []
                        ).includes(craft.id);
                        const required = activeRequiredCraftIds.has(craft.id);
                        return (
                          <label
                            key={craft.id}
                            className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold"
                          >
                            <input
                              type="checkbox"
                              className="size-4 shrink-0"
                              checked={selected}
                              disabled={required}
                              onChange={(event) => {
                                const current = getValues(
                                  `items.${expandedItem}.crafts`,
                                );
                                const next = new Set(current);
                                if (event.target.checked) next.add(craft.id);
                                else next.delete(craft.id);
                                setValue(
                                  `items.${expandedItem}.crafts`,
                                  normalizeCraftIdsForPricingRoute(
                                    getValues(
                                      `items.${expandedItem}.pricingRoute`,
                                    ),
                                    [...next],
                                    crafts,
                                  ),
                                  { shouldDirty: true, shouldValidate: true },
                                );
                              }}
                            />
                            <span className="min-w-0">
                              {craft.name}
                              {required ? '（计价必需）' : ''}
                              {craft.isOutsource ? ' · 外协' : ''}
                              {craft.isLowFrequency ? ' · 低频' : ''}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </section>
              ) : undefined
            }
            shippingExtras={
              !usesExternalSalesPricing ? (
                <div className="mb-4 grid min-w-0 grid-cols-1 gap-3.5 min-[560px]:grid-cols-2">
                  <div>
                    <Label htmlFor="expressCode">快递代码</Label>
                    <Input
                      id="expressCode"
                      className="mt-2 h-10"
                      {...register('expressCode')}
                    />
                  </div>
                  <div>
                    <Label htmlFor="packageRequirement">包装要求</Label>
                    <Input
                      id="packageRequirement"
                      className="mt-2 h-10"
                      {...register('packageRequirement')}
                    />
                  </div>
                </div>
              ) : undefined
            }
            afterShipping={
              !usesExternalSalesPricing ? (
                <section
                  aria-label="多地址发货"
                  className="mt-[1.125rem] border-t pt-[1.125rem]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[0.6875rem] font-extrabold tracking-[0.2em] text-muted-foreground">
                        多地址发货
                      </h2>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        主地址承接未分配数量；需要时再增加额外地址。
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        submitting ||
                        uploading ||
                        Boolean(createdDraft) ||
                        shipmentsArray.fields.length >= 9
                      }
                      onClick={() =>
                        shipmentsArray.append({
                          receiverName: null,
                          receiverPhone: null,
                          receiverAddress: '',
                          expressCode: null,
                          destinationProvince: null,
                          quotedWeightKg: null,
                          shippingFee: null,
                          packingMaterialFee: null,
                          customerChargeOverrideReason: null,
                          itemQuantities: itemsArray.fields.map(() => 0),
                        })
                      }
                    >
                      增加收货地址
                    </Button>
                  </div>
                  {shipmentsArray.fields.length > 0 ? (
                    <ol className="mt-4 space-y-4">
                      {shipmentsArray.fields.map((shipment, shipmentIndex) => (
                        <li key={shipment.id} className="rounded-xl border p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm font-extrabold">
                              额外地址 {shipmentIndex + 1}
                            </h3>
                            <Button
                              type="button"
                              variant="outline"
                              className="text-destructive"
                              onClick={() => shipmentsArray.remove(shipmentIndex)}
                            >
                              删除地址
                            </Button>
                          </div>
                          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 min-[560px]:grid-cols-2">
                            <div>
                              <Label
                                htmlFor={`additionalShipments.${shipmentIndex}.receiverName`}
                              >
                                收货人
                              </Label>
                              <Input
                                id={`additionalShipments.${shipmentIndex}.receiverName`}
                                className="mt-2 h-10"
                                {...register(
                                  `additionalShipments.${shipmentIndex}.receiverName`,
                                )}
                              />
                            </div>
                            <div>
                              <Label
                                htmlFor={`additionalShipments.${shipmentIndex}.receiverPhone`}
                              >
                                联系电话
                              </Label>
                              <Input
                                id={`additionalShipments.${shipmentIndex}.receiverPhone`}
                                className="mt-2 h-10"
                                {...register(
                                  `additionalShipments.${shipmentIndex}.receiverPhone`,
                                )}
                              />
                            </div>
                            <div>
                              <Label
                                htmlFor={`additionalShipments.${shipmentIndex}.expressCode`}
                              >
                                快递代码
                              </Label>
                              <Input
                                id={`additionalShipments.${shipmentIndex}.expressCode`}
                                className="mt-2 h-10"
                                {...register(
                                  `additionalShipments.${shipmentIndex}.expressCode`,
                                )}
                              />
                            </div>
                            <div className="min-[560px]:col-span-2">
                              <Label
                                htmlFor={`additionalShipments.${shipmentIndex}.receiverAddress`}
                              >
                                详细地址
                              </Label>
                              <Textarea
                                id={`additionalShipments.${shipmentIndex}.receiverAddress`}
                                className="mt-2 min-h-16"
                                {...register(
                                  `additionalShipments.${shipmentIndex}.receiverAddress`,
                                  {
                                    onChange: (event) => {
                                      const parsed = parsePastedReceiverAddress(
                                        event.target.value,
                                      );
                                      if (parsed.receiverName) {
                                        setValue(
                                          `additionalShipments.${shipmentIndex}.receiverName`,
                                          parsed.receiverName,
                                          { shouldDirty: true },
                                        );
                                      }
                                      if (parsed.receiverPhone) {
                                        setValue(
                                          `additionalShipments.${shipmentIndex}.receiverPhone`,
                                          parsed.receiverPhone,
                                          { shouldDirty: true },
                                        );
                                      }
                                      setValue(
                                        `additionalShipments.${shipmentIndex}.destinationProvince`,
                                        parsed.province,
                                        {
                                          shouldDirty: true,
                                          shouldValidate: true,
                                        },
                                      );
                                    },
                                  },
                                )}
                              />
                              {errors.additionalShipments?.[shipmentIndex]
                                ?.receiverAddress?.message ? (
                                <p role="alert" className="mt-1.5 text-xs font-semibold text-destructive">
                                  {
                                    errors.additionalShipments[shipmentIndex]
                                      ?.receiverAddress?.message
                                  }
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <fieldset className="mt-4">
                            <legend className="text-xs font-bold tracking-[0.14em] text-muted-foreground">
                              款式分配数量
                            </legend>
                            <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 min-[560px]:grid-cols-2">
                              {itemsArray.fields.map((itemField, itemIndex) => (
                                <div key={itemField.id}>
                                  <Label
                                    htmlFor={`additionalShipments.${shipmentIndex}.itemQuantities.${itemIndex}`}
                                  >
                                    #{itemIndex + 1}{' '}
                                    {watchedItems[itemIndex]?.name || '未命名款式'}
                                  </Label>
                                  <Input
                                    id={`additionalShipments.${shipmentIndex}.itemQuantities.${itemIndex}`}
                                    type="number"
                                    min={0}
                                    step={1}
                                    className="mt-2 h-10"
                                    {...register(
                                      `additionalShipments.${shipmentIndex}.itemQuantities.${itemIndex}`,
                                      { valueAsNumber: true },
                                    )}
                                  />
                                </div>
                              ))}
                            </div>
                            {errors.additionalShipments?.[shipmentIndex]
                              ?.itemQuantities?.message ? (
                              <p role="alert" className="mt-2 text-xs font-semibold text-destructive">
                                {
                                  errors.additionalShipments[shipmentIndex]
                                    ?.itemQuantities?.message
                                }
                              </p>
                            ) : null}
                          </fieldset>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </section>
              ) : undefined
            }
            items={watchedItems}
            itemFields={itemsArray.fields}
            activeIndex={expandedItem}
            pendingDesigns={pendingDesigns}
            packaging={{
              mode:
                activePackagingGroup?.mode ??
                OrderPackagingMode.SINGLE_STYLE,
              unitsPerBag:
                activePackagingGroup?.itemUnitsPerBag[expandedItem] ?? 0,
              bagCount:
                activePackagingBagCount?.complete === true
                  ? activePackagingBagCount.bagCount
                  : null,
              error:
                activePackagingBagCount && !activePackagingBagCount.complete
                  ? activePackagingBagCount.errors.join('；')
                  : null,
            }}
            paperOptions={externalPaperOptions}
            paperKey={activeExternalPaper?.key ?? null}
            weightOptions={externalWeightOptions}
            specificationOptions={externalSpecificationOptions}
            foilOptions={
              usesExternalSalesPricing ? externalFoilOptions : undefined
            }
            disabled={
              !localDraftReady ||
              submitting ||
              uploading ||
              Boolean(createdDraft)
            }
            savedLabel={
              localDraftStatusError
                ? localDraftStatusError
                : lastLocalDraftSavedAt
                ? `草稿已保存 ${formatLocalDraftTime(lastLocalDraftSavedAt)}`
                : initialExternalPriceSnapshot && usesExternalSalesPricing
                  ? `加工 v${initialExternalPriceSnapshot.processing.version} / 物流 v${initialExternalPriceSnapshot.logistics.version} · 草稿未保存`
                  : '草稿未保存'
            }
            fieldErrors={externalFieldErrors}
            rail={
              <OrderFormBRail
                itemCount={itemsArray.fields.length}
                quoteItems={railQuoteItems}
                packaging={railPackaging}
                logistics={railLogistics}
                usesExternalSalesPricing={usesExternalSalesPricing}
                settlementLabel={settlementLabel}
                knownTotal={currentExternalOrderQuote?.knownTotal}
                totalSemantics={currentExternalOrderQuote?.totalSemantics}
                gaps={orderFormBGaps}
                busy={
                  pendingState.busy ||
                  externalQuoteQuoting ||
                  externalQuoteNeedsRefresh ||
                  Boolean(createdDraft)
                }
                onAttemptSubmit={(intent) => {
                  if (usesExternalSalesPricing && intent === 'submit') {
                    setExternalValidationVisible(true);
                  }
                }}
              />
            }
            onActiveIndexChange={setExpandedItem}
            onAdd={() => {
              const nextIndex = itemsArray.fields.length;
              addItem();
              setExpandedItem(nextIndex);
            }}
            onDuplicate={(index) => {
              const nextIndex = itemsArray.fields.length;
              duplicateItem(index);
              setExpandedItem(nextIndex);
            }}
            onRemove={(index) => {
              const field = itemsArray.fields[index];
              if (field) removeItem(index, field.id);
            }}
            onCustomNameChange={(value) => {
              setValue('customName', value, {
                shouldDirty: true,
              });
              setExternalInputRevision((current) => current + 1);
            }}
            onRouteChange={(route) =>
              changeExternalRoute(expandedItem, route)
            }
            onPaperChange={(paperKey) =>
              changeExternalPaper(
                expandedItem,
                paperKey as ExternalOrderPaperKey,
              )
            }
            onWeightChange={(weight) =>
              changeExternalWeight(expandedItem, weight)
            }
            onSpecificationChange={(specification) =>
              changeExternalSpecification(expandedItem, specification)
            }
            onFoilSidesChange={(front, back) =>
              changeExternalFoilSides(expandedItem, front, back)
            }
            onBackFoilToggle={(enabled) => {
              const front =
                getValues(`items.${expandedItem}.frontFoilColors`) ?? [];
              changeExternalFoilSides(
                expandedItem,
                front,
                enabled ? [...front] : [],
              );
            }}
            onFoilTechniqueChange={(technique) =>
              changeExternalFoilTechnique(expandedItem, technique)
            }
            onCustomSizeChange={(custom) =>
              changeExternalCustomSize(expandedItem, custom)
            }
            onPrintFoilModeChange={(mode) =>
              changeExternalPrintFoilMode(expandedItem, mode)
            }
            onLaminationChange={(lamination) => {
              const current = getValues(`items.${expandedItem}`);
              commitOrderFormBItem(expandedItem, { ...current, lamination });
            }}
            onQuantityChange={(quantity) => {
              setValue(`items.${expandedItem}.quantity`, quantity, {
                shouldDirty: true,
                shouldValidate: true,
              });
            }}
            onPackagingModeChange={changeExternalPackagingMode}
            onUnitsPerBagChange={(units) =>
              changeExternalUnitsPerBag(expandedItem, units)
            }
            onPendingDesignsChange={(images) => {
              const field = itemsArray.fields[expandedItem];
              if (field) updatePendingDesigns(field.id, images);
            }}
            onReceiverAddressChange={(value) => {
              setValue('receiverAddress', value, {
                shouldDirty: true,
              });
              const parsed = parsePastedReceiverAddress(value);
              if (parsed.receiverName && !getValues('receiverName')) {
                setValue('receiverName', parsed.receiverName, {
                  shouldDirty: true,
                });
              }
              if (parsed.receiverPhone && !getValues('receiverPhone')) {
                setValue('receiverPhone', parsed.receiverPhone, {
                  shouldDirty: true,
                });
              }
              setValue('destinationProvince', parsed.province, {
                shouldDirty: true,
              });
              setExternalInputRevision((current) => current + 1);
            }}
            onReceiverAddressPaste={(event) => {
              event.preventDefault();
              const value = pastedTextareaValue(event);
              const parsed = parsePastedReceiverAddress(value);
              setValue('receiverAddress', value || null, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setValue('receiverName', parsed.receiverName, {
                shouldDirty: true,
              });
              setValue('receiverPhone', parsed.receiverPhone, {
                shouldDirty: true,
              });
              setValue('destinationProvince', parsed.province, {
                shouldDirty: true,
                shouldValidate: true,
              });
            }}
            onReceiverNameChange={(value) => {
              setValue('receiverName', value, {
                shouldDirty: true,
              });
              setExternalInputRevision((current) => current + 1);
            }}
            onReceiverPhoneChange={(value) => {
              setValue('receiverPhone', value, {
                shouldDirty: true,
              });
              setExternalInputRevision((current) => current + 1);
            }}
            onSfCollectChange={(value) => {
              setValue('isSfCollect', value, {
                shouldDirty: true,
                shouldValidate: true,
              });
              if (value) {
                resetShipmentCarrierFacts();
              } else {
                setValue(
                  'destinationProvince',
                  parsePastedReceiverAddress(
                    getValues('receiverAddress') ?? '',
                  ).province,
                  { shouldDirty: true, shouldValidate: true },
                );
              }
            }}
          />
        )}
      </fieldset>
      {!usesExternalSalesPricing && createdDraft ? (
        <section
          className={
            uploadError
              ? 'rounded-xl border border-warning/50 bg-warning/10 p-4'
              : 'rounded-xl border border-primary/30 bg-primary/5 p-4'
          }
        >
          <p className="font-semibold text-foreground">工单草稿已创建</p>
          {uploading && uploadProgress ? (
            <p role="status" aria-live="polite" className="mt-1 text-sm text-muted-foreground">
              正在上传设计文件：{uploadProgress.completed} / {uploadProgress.total}
            </p>
          ) : null}
          {uploadError ? (
            <p role="alert" className="mt-1 break-words text-sm text-warning-foreground">
              {uploadError}
            </p>
          ) : null}
          {!uploading && uploadError ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void finishCreatedOrder(createdDraft, pendingDesigns)}
              >
                继续完成
              </Button>
              <Link
                href={`/orders/${createdDraft.orderId}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                打开草稿
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}
      {usesExternalSalesPricing && pendingSubmission ? (
        <OrderSubmissionReviewDialog
          open
          onOpenChange={(open) => {
            if (!open && !submitting && !uploading && !createdDraft) {
              setPendingSubmission(null);
            }
          }}
          orderName={pendingSubmission.data.customName?.trim() || '未命名工单'}
          items={externalReviewItems}
          receiver={{
            name: pendingSubmission.data.receiverName?.trim() || '未识别收件人',
            phone: pendingSubmission.data.receiverPhone?.trim() || '无电话',
            address: pendingSubmission.data.receiverAddress?.trim() || '—',
          }}
          cartonCharge={{
            label: '纸箱耗材',
            detail: `${totalQuantity.toLocaleString('zh-CN')} 个`,
            amountLabel:
              railLogistics?.status === 'complete' &&
              railLogistics.packagingAmount
                ? formatOrderCurrency(railLogistics.packagingAmount)
                : '待定',
          }}
          shippingCharge={{
            label: pendingSubmission.data.isSfCollect
              ? '快递费 · 顺丰到付'
              : '快递费 · 中通',
            amountLabel:
              pendingSubmission.data.isSfCollect
                ? '—'
                : railLogistics?.status === 'complete' &&
                    railLogistics.shippingAmount
                  ? formatOrderCurrency(railLogistics.shippingAmount)
                  : '待定',
            detail:
              railLogistics?.shippingLabel?.replace(/^快递费\s*/, '') ??
              railLogistics?.message ??
              undefined,
          }}
          totalLabel={
            submitQuoteChange
              ? formatOrderCurrency(submitQuoteChange.quotedFee)
              : externalTotal === null
              ? '总价由工厂确认'
              : formatOrderCurrency(externalTotal)
          }
          totalRequiresManualQuote={
            externalReviewRequiresManualQuote
          }
          totalNote={
            uploadError ??
            serverGeneralError ??
            (railLogistics?.status === 'complete'
              ? '不含制版费。'
              : '不含制版费与快递费。')
          }
          confirmLabel={
            createdDraft && uploadError
              ? '继续完成'
              : externalReviewRequiresManualQuote
              ? '确认提交并申请核价'
              : '确认无误，提交'
          }
          confirmPending={submitting || uploading}
          confirmDisabled={submitting || uploading}
          onBack={() => {
            if (!createdDraft) setPendingSubmission(null);
          }}
          onConfirm={() => {
            if (createdDraft) {
              void finishCreatedOrder(createdDraft, pendingDesigns);
              return;
            }
            persistOrder(
              pendingSubmission.data,
              pendingSubmission.fieldIds,
              pendingSubmission.queues,
              'submit',
              pendingSubmission.quoteToken,
            );
          }}
        />
      ) : null}
    </form>
  );
}

export function orderServerFieldErrorMessages(
  fieldErrors: Record<string, string[]>,
): string[] {
  return [
    ...new Set(
      Object.values(fieldErrors)
        .flat()
        .map((message) => message.trim())
        .filter(Boolean),
    ),
  ];
}

// ──────────────────────────────────────────────────────────────────────
// Field primitives — keep the big form body readable
// ──────────────────────────────────────────────────────────────────────

const selectClass =
  'flex min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';
