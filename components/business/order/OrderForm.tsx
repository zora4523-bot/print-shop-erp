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
  Controller,
  useForm,
  useFieldArray,
  useWatch,
  type Control,
  type SubmitHandler,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { quoteExternalCreateOrderAction } from '@/actions/create-order-quote';
import { quoteInternalCreateOrderAction } from '@/actions/create-order-quote';
import type { CreateOrderMutationResult } from '@/actions/order.types';
import type { CreateOrderPackagingQuotePreview } from '@/lib/order/create-order-quote-presentation';
import type {
  CreateOrderItemQuotePreview,
  CreateOrderQuoteResult,
  InternalCreateOrderQuoteResult,
} from '@/lib/order/create-order-quote-service';
import type { CustomerPartyOption } from '@/lib/party';
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
  externalOrderWeightOptionsForSelection,
  findExternalOrderCatalogProduct,
  type ExternalOrderPaper,
  type ExternalOrderPaperKey,
  type ExternalOrderPaperMaterial,
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

/**
 * These production facts are already owned by the structured controls in the
 * main B form. Showing them again as checkboxes creates two competing inputs
 * for the same fact; PACKING is derived from packaging groups instead.
 */
const ORDER_FORM_DERIVED_CRAFT_CODES = new Set([
  'FLAT_FOIL_PARTIAL',
  'STOCK_FOIL',
  'FLAT_FOIL_SINGLE',
  'FLAT_FOIL_DOUBLE',
  'FLAT_FOIL_TRIPLE',
  'EMBOSS',
  'BUMP',
  'COATED_COLOR_PRINT',
  'COATED_COLOR_PRINT_FOIL',
  'COLOR_PRINT',
  'COLOR_PRINT_FOIL',
  'PACKING',
]);

function isAdditionalOrderCraft(craft: CraftOption): boolean {
  return (
    !isLegacyStockFoilCraft(craft) &&
    (!craft.code || !ORDER_FORM_DERIVED_CRAFT_CODES.has(craft.code))
  );
}

export function additionalOrderCraftOptions(
  crafts: readonly CraftOption[],
): CraftOption[] {
  return crafts.filter(isAdditionalOrderCraft);
}

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
  result?: CreateOrderItemQuotePreview;
  error?: string;
};

type LogisticsQuoteViewState = {
  inputKey: string;
  result?: ExternalOrderChargeQuote;
  error?: string;
};

type PackagingQuoteViewState = {
  inputKey: string;
  result?: CreateOrderPackagingQuotePreview;
  error?: string;
};

type ExternalCreateOrderQuoteViewState = {
  inputKey: string;
  result?: CreateOrderQuoteResult;
  error?: string;
};

type InternalCreateOrderQuoteViewState = {
  inputKey: string;
  result?: InternalCreateOrderQuoteResult;
  error?: string;
};

type QuoteFacts = Parameters<typeof quoteFactsKey>[0];

type OrderCreationIntent = 'draft' | 'submit';

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

/**
 * Keep only genuinely additional production steps from the previous value and
 * replace every route-owned craft with the facts derived from the current
 * structured selections. This also cleans stale route crafts from recovered
 * local drafts and from PARTIAL/FULL/PRINT route switches.
 */
export function resolveInternalOrderCraftIds(
  item: CreateOrderInput['items'][number],
  crafts: readonly CraftOption[],
): string[] {
  const craftById = new Map(crafts.map((craft) => [craft.id, craft]));
  const additionalIds = item.crafts.filter((id) => {
    const craft = craftById.get(id);
    return craft ? isAdditionalOrderCraft(craft) : false;
  });
  return [
    ...new Set([
      ...resolveExternalOrderCraftIds(item, crafts),
      ...additionalIds,
    ]),
  ];
}

function normalizeExternalOrderItem(args: {
  item: CreateOrderInput['items'][number];
  crafts: readonly CraftOption[];
  products: readonly ProductOption[];
  paperMaterials?: readonly ExternalOrderPaperMaterial[];
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
  const routePapers = externalOrderPapersForRoute(
    args.products,
    route,
    args.paperMaterials,
  );
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
  const availableRoutePapers = routePapers.filter((candidate) =>
    externalOrderWeightOptionsForSelection(
      candidate,
      route,
      specification,
    ).some((option) => !option.disabled),
  );
  const inferredPaper = externalOrderPaperFromType(
    args.products,
    args.item.paperType,
    args.paperMaterials,
  );
  const requestedPaper = args.paperKey
    ? availableRoutePapers.find((paper) => paper.key === args.paperKey)
    : undefined;
  const paper =
    requestedPaper ??
    (!args.resetPaper &&
    inferredPaper &&
    availableRoutePapers.some(
      (candidate) => candidate.key === inferredPaper.key,
    )
      ? inferredPaper
      : availableRoutePapers[0]);
  if (!paper) return args.item;

  const weightOptions = externalOrderWeightOptionsForSelection(
    paper,
    route,
    specification,
  );
  const enabledWeights = weightOptions
    .filter((option) => !option.disabled)
    .map((option) => option.value);
  const currentWeight = args.item.paperWeightGsm ?? enabledWeights[0] ?? null;
  const configuredCurrentWeight = weightOptions.find(
    (option) => option.value === currentWeight,
  );
  const weight =
    currentWeight !== null &&
    configuredCurrentWeight && !configuredCurrentWeight.disabled
      ? currentWeight
      : (enabledWeights[0] ?? currentWeight);
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
  paperMaterials: readonly ExternalOrderPaperMaterial[],
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
    paperMaterials,
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
  component: CreateOrderItemQuotePreview['components'][number],
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

function internalOrderItemQuoteFacts(
  item: CreateOrderInput['items'][number],
): NonNullable<QuoteFacts> {
  return {
    ...orderItemQuoteFacts(item),
    manualQuoteReason: item.manualQuoteReason,
  };
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

function UrgentOrderField({
  control,
  disabled,
}: {
  control: Control<CreateOrderInput>;
  disabled: boolean;
}) {
  return (
    <Controller
      control={control}
      name="isUrgent"
      render={({ field }) => (
        <label
          htmlFor="isUrgent"
          data-slot="urgent-order-field"
          className="flex min-h-16 min-w-0 cursor-pointer items-center gap-2 self-end rounded-xl border bg-background py-2 pr-2 pl-3 transition-colors hover:bg-muted/50 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60"
        >
          <span id="urgent-order-accessible-label" className="sr-only">
            急单（提交后会推送至排产群）
          </span>
          <span className="min-w-0 flex-1">
            <span
              data-slot="urgent-order-title"
              className="block text-sm font-semibold"
            >
              急单
            </span>
            <span
              data-slot="urgent-order-description"
              className="mt-0.5 block text-xs leading-5 text-muted-foreground"
            >
              提交后会推送至排产群
            </span>
          </span>
          <Checkbox
            id="isUrgent"
            name={field.name}
            checked={field.value ?? false}
            disabled={disabled}
            inputRef={field.ref}
            aria-labelledby="urgent-order-accessible-label"
            onBlur={field.onBlur}
            onCheckedChange={field.onChange}
          />
        </label>
      )}
    />
  );
}

function InternalAdditionalCraftChoices({
  options,
  selectedIds,
  disabled,
  onToggle,
}: {
  options: readonly CraftOption[];
  selectedIds: readonly string[];
  disabled: boolean;
  onToggle: (craftId: string, checked: boolean) => void;
}) {
  return (
    <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 @min-[560px]:grid-cols-2">
      {options.map((craft) => (
        <label
          key={craft.id}
          className="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border pr-3 text-sm font-semibold has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60"
        >
          <Checkbox
            checked={selectedIds.includes(craft.id)}
            disabled={disabled}
            aria-label={`${craft.name}${craft.isOutsource ? ' · 外协' : ''}${craft.isLowFrequency ? ' · 低频' : ''}`}
            onCheckedChange={(checked) => onToggle(craft.id, checked)}
          />
          <span className="min-w-0">
            {craft.name}
            {craft.isOutsource ? ' · 外协' : ''}
            {craft.isLowFrequency ? ' · 低频' : ''}
          </span>
        </label>
      ))}
    </div>
  );
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
  const usesExternalSalesPricing = settlementType === OrderSettlementType.EXTERNAL_SALES;
  const router = useRouter();
  const initialItem = useMemo(() => {
    const firstFoil = externalCreateOrderOptions?.foilColors[0]?.name;
    const item = createExternalOrderItem(
      crafts, products, externalCreateOrderOptions?.papers ?? [], firstFoil,
    );
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
    externalCreateOrderOptions?.papers,
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
  const [quoteViews, setQuoteViews] = useState<Record<string, QuoteViewState>>(
    {},
  );
  const [logisticsQuote, setLogisticsQuote] =
    useState<LogisticsQuoteViewState | null>(null);
  const [packagingQuote, setPackagingQuote] =
    useState<PackagingQuoteViewState | null>(null);
  const [externalOrderQuote, setExternalOrderQuote] =
    useState<ExternalCreateOrderQuoteViewState | null>(null);
  const [internalOrderQuote, setInternalOrderQuote] =
    useState<InternalCreateOrderQuoteViewState | null>(null);
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
  const externalQuoteRequestGate = useRef(createOrderQuoteRequestGate());
  const internalQuoteRequestGate = useRef(createOrderQuoteRequestGate());
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
  const orderFormControlsDisabled =
    !localDraftReady || submitting || uploading;
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
    const restoredValues =
      pendingLocalDraft.values as unknown as CreateOrderInput;
    reset(
      usesExternalSalesPricing
        ? restoredValues
        : {
            ...restoredValues,
            items: restoredValues.items.map((item) => ({
              ...item,
              crafts: resolveInternalOrderCraftIds(item, crafts),
            })),
          },
    );
    setQuoteViews({});
    setLogisticsQuote(null);
    setPackagingQuote(null);
    setExternalOrderQuote(null);
    setInternalOrderQuote(null);
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
        items: data.items.map((item) => ({
          ...item,
          crafts: usesExternalSalesPricing
            ? item.crafts
            : resolveInternalOrderCraftIds(item, crafts),
          // Prices are always server-owned on the create screen. Internal
          // operators may only describe an out-of-catalog item; the factory
          // confirmation step records the confirmed amount later.
          manualQuoteReason: usesExternalSalesPricing
            ? null
            : item.manualQuoteReason,
          unitPrice: null,
          fixedFee: null,
          suggestedSubtotal: null,
          priceOverrideReason: null,
        })),
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
    invalidateOrderQuoteRequests(externalQuoteRequestGate.current);
    invalidateOrderQuoteRequests(internalQuoteRequestGate.current);
    setQuoteViews({});
    setLogisticsQuote(null);
    setPackagingQuote(null);
    setExternalOrderQuote(null);
    setInternalOrderQuote(null);
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
        externalCreateOrderOptions?.papers ?? [],
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
        paperMaterials: externalCreateOrderOptions?.papers,
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
      paperMaterials: externalCreateOrderOptions?.papers,
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
        crafts: resolveInternalOrderCraftIds(
          { ...normalized, crafts: current.crafts },
          crafts,
        ),
        artworkVersion: current.artworkVersion,
        plateGroupId: current.plateGroupId,
        pricingGroup: current.pricingGroup,
        manualQuoteReason: current.manualQuoteReason,
        unitPrice: null,
        fixedFee: null,
        suggestedSubtotal: null,
        priceOverrideReason: null,
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
      externalCreateOrderOptions?.papers,
    ).find(
      (candidate) => candidate.key === paperKey,
    );
    if (!paper) return;
    const nextWeight =
      externalOrderWeightOptionsForSelection(
        paper,
        current.pricingRoute,
        current.specification ??
          externalOrderDefaultSpecification(
            products,
            current.pricingRoute,
          ),
      ).find((option) => !option.disabled)?.value ?? current.paperWeightGsm;
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
        paperMaterials: externalCreateOrderOptions?.papers,
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
    externalCreateOrderOptions?.papers,
    externalCreateOrderOptions?.foilColors,
    setValue,
    usesExternalSalesPricing,
    watchedItems,
    watchedPackagingGroups.length,
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
        itemUnitsPerBag: group.itemUnitsPerBag,
      })),
    }),
    [getValues],
  );
  const currentPackagingInputKey = JSON.stringify({
    groups: watchedPackagingGroups.map((group, index) => ({
      groupKey: String(index + 1),
      mode: group.mode,
      actualBagCount: group.actualBagCount,
      itemUnitsPerBag: group.itemUnitsPerBag,
    })),
  });

  const currentInternalQuoteFactsKey = compactOrderQuoteFactsKey({
    itemFacts: watchedItems.map((item) =>
      quoteFactsKey(item, watchedItems.length),
    ),
    packaging: currentPackagingInputKey,
    logistics: 'INTERNAL_NO_ORDER_CHARGES',
    openedPriceVersion: null,
  });
  const currentInternalQuoteInput = useCallback(() => {
    const values = getValues();
    const packaging = currentPackagingQuoteInput();
    return {
      factsKey: compactOrderQuoteFactsKey({
        itemFacts: values.items.map((item) =>
          quoteFactsKey(item, values.items.length),
        ),
        packaging: JSON.stringify(packaging),
        logistics: 'INTERNAL_NO_ORDER_CHARGES',
        openedPriceVersion: null,
      }),
      settlementType,
      items: values.items.map(internalOrderItemQuoteFacts),
      orderItemCount: values.items.length,
      packagingGroups: packaging.groups,
    };
  }, [currentPackagingQuoteInput, getValues, settlementType]);
  const currentInternalQuoteRequestReady =
    watchedItems.length > 0 &&
    watchedItems.every(
      (item) =>
        (Boolean(item.manualQuoteReason?.trim()) ||
          (Boolean(item.productId) && item.crafts.length > 0)) &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity >= 1,
    ) &&
    watchedPackagingGroups.length > 0 &&
    watchedPackagingGroups.every(
      (group) =>
        Number.isSafeInteger(group.actualBagCount) &&
        group.actualBagCount >= 1,
    );

  useEffect(() => {
    if (
      usesExternalSalesPricing ||
      !localDraftReady ||
      createdDraft ||
      submitting ||
      uploading ||
      !currentInternalQuoteRequestReady ||
      internalOrderQuote?.inputKey === currentInternalQuoteFactsKey
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      const input = currentInternalQuoteInput();
      if (input.factsKey !== currentInternalQuoteFactsKey) return;
      const requestId = beginOrderQuoteRequest(
        internalQuoteRequestGate.current,
      );
      const fieldIds = [...itemFieldIdsRef.current];
      const packagingInputKey = JSON.stringify({
        groups: input.packagingGroups,
      });
      setInternalOrderQuote({ inputKey: input.factsKey });
      startQuote(async () => {
        const response = await quoteInternalCreateOrderAction(input);
        if (
          !isCurrentOrderQuoteResponse({
            gate: internalQuoteRequestGate.current,
            requestId,
            inputKey: input.factsKey,
            currentInputKey: currentInternalQuoteInput().factsKey,
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
          setInternalOrderQuote({
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
        setInternalOrderQuote({ inputKey: input.factsKey, error });
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    createdDraft,
    currentInternalQuoteFactsKey,
    currentInternalQuoteInput,
    currentInternalQuoteRequestReady,
    internalOrderQuote?.inputKey,
    localDraftReady,
    startQuote,
    submitting,
    uploading,
    usesExternalSalesPricing,
  ]);

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
        : quoting)
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

    return {
      ...item,
      quoteStatus,
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
    const manualPricingRequested =
      !usesExternalSalesPricing && Boolean(item.manualQuoteReason?.trim());
    return {
      key: fieldId,
      label:
        watchedItems[index]?.name?.trim() ||
        ORDER_PRICING_ROUTE_LABELS[
          watchedItems[index]?.pricingRoute ?? OrderItemPricingRoute.STOCK_BLANK
        ],
      status: manualPricingRequested ? 'incomplete' : item.quoteStatus,
      amount:
        !manualPricingRequested && item.quoteStatus === 'complete'
          ? (result?.suggestedSubtotal ?? null)
          : null,
      components:
        !manualPricingRequested && item.quoteStatus === 'complete'
            ? (result?.components ?? []).map((component) => ({
                label: externalQuoteComponentLabel(
                  watchedItems[index] ?? item,
                  component,
                ),
                amount: component.amount,
              }))
            : [],
      message:
        manualPricingRequested
          ? `配置外项目：${item.manualQuoteReason?.trim()}`
          : item.quoteStatus === 'error'
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
    status: (usesExternalSalesPricing ? externalQuoteQuoting : quoting)
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
  const currentInternalOrderQuote =
    internalOrderQuote?.inputKey === currentInternalQuoteFactsKey
      ? internalOrderQuote.result
      : undefined;
  const currentCreateOrderQuote = usesExternalSalesPricing
    ? currentExternalOrderQuote
    : currentInternalOrderQuote;
  const externalRequiresManualQuote =
    railQuoteItems.some((item) => item.status !== 'complete') ||
    railPackaging.status !== 'complete' ||
    railLogistics?.status !== 'complete' ||
    currentExternalOrderQuote?.hasManualPricing === true;
  const externalReviewRequiresManualQuote = submitQuoteChange
    ? submitQuoteChange.quotedFeeCompleteness ===
      OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS
    : externalRequiresManualQuote;
  const externalTotal = externalSalesOrderFormTotal({
    quoteItems: railQuoteItems,
    packaging: railPackaging,
    logistics: railLogistics,
    knownTotal: currentCreateOrderQuote?.knownTotal,
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
        const paper = externalOrderPaperFromType(
          products, item.paperType, externalCreateOrderOptions?.papers,
        );
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
  const internalAdditionalCraftOptions = additionalOrderCraftOptions(crafts);
  const activeExternalPaper = externalOrderPaperFromType(
    products, activeExternalItem.paperType, externalCreateOrderOptions?.papers,
  );
  const externalPaperOptions: OrderPaperSwatchOption[] =
    externalOrderPapersForRoute(
      products,
      activeExternalItem.pricingRoute,
      externalCreateOrderOptions?.papers,
    ).map(
      (paper) => ({
        value: paper.key,
        label: paper.label,
        texture: externalPaperSwatchTexture(paper.appearance),
        disabled: (() => {
          const weightOptions = externalOrderWeightOptionsForSelection(
            paper,
            activeExternalItem.pricingRoute,
            activeExternalItem.specification ?? '',
          );
          return (
            weightOptions.length === 0 ||
            weightOptions.every((option) => option.disabled)
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
    ? externalOrderWeightOptionsForSelection(
        activeExternalPaper,
        activeExternalItem.pricingRoute,
        activeExternalItem.specification ?? '',
      )
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
        disabled={orderFormControlsDisabled}
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
                <div
                  data-slot="order-form-order-extras"
                  className="mt-4 grid min-w-0 grid-cols-1 gap-3.5 @min-[560px]:grid-cols-2"
                >
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
                  <UrgentOrderField
                    control={control}
                    disabled={orderFormControlsDisabled}
                  />
                  <div className="@min-[560px]:col-span-2">
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
                <div className="mb-5 grid min-w-0 grid-cols-1 gap-3.5 @min-[560px]:grid-cols-2">
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
                  aria-label="内部生产信息"
                  className="mt-[1.125rem] border-t pt-[1.125rem]"
                >
                  <div className="grid min-w-0 grid-cols-1 gap-3.5 @min-[560px]:grid-cols-2">
                    <div className="@min-[560px]:col-span-2">
                      <Label htmlFor={`items.${expandedItem}.manualQuoteReason`}>
                        配置外项目说明（转人工核价）
                      </Label>
                      <Textarea
                        id={`items.${expandedItem}.manualQuoteReason`}
                        className="mt-2 min-h-20"
                        placeholder="仅当规则配置里没有所需纸张、规格或工艺时填写；请记录完整客需，金额由工厂确认时录入"
                        aria-invalid={Boolean(
                          errors.items?.[expandedItem]?.manualQuoteReason,
                        )}
                        {...register(`items.${expandedItem}.manualQuoteReason`)}
                      />
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        不会在创建页录入人工单价；填写后该款式进入工厂人工核价。
                      </p>
                    </div>
                    <div className="@min-[560px]:col-span-2">
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
                  {internalAdditionalCraftOptions.length > 0 ? (
                    <fieldset className="mt-5 border-t pt-4">
                      <legend className="text-[0.6875rem] font-extrabold tracking-[0.18em] text-muted-foreground">
                        附加工艺（选填）
                      </legend>
                      <p className="mt-2 text-xs text-muted-foreground">
                        主工艺已由上方工艺类型、烫金和包装选择自动生成；这里只选择额外工序。
                      </p>
                      <InternalAdditionalCraftChoices
                        options={internalAdditionalCraftOptions}
                        selectedIds={watchedItems[expandedItem]?.crafts ?? []}
                        disabled={orderFormControlsDisabled}
                        onToggle={(craftId, checked) => {
                          const currentItem = getValues(`items.${expandedItem}`);
                          const next = new Set(currentItem.crafts);
                          if (checked) next.add(craftId);
                          else next.delete(craftId);
                          setValue(
                            `items.${expandedItem}.crafts`,
                            resolveInternalOrderCraftIds(
                              { ...currentItem, crafts: [...next] },
                              crafts,
                            ),
                            { shouldDirty: true, shouldValidate: true },
                          );
                        }}
                      />
                    </fieldset>
                  ) : null}
                </section>
              ) : undefined
            }
            shippingExtras={
              !usesExternalSalesPricing ? (
                <div className="mb-4 grid min-w-0 grid-cols-1 gap-3.5 @min-[560px]:grid-cols-2">
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
                          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 @min-[560px]:grid-cols-2">
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
                            <div className="@min-[560px]:col-span-2">
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
                            <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 @min-[560px]:grid-cols-2">
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
            foilOptions={externalCreateOrderOptions ? externalFoilOptions : undefined}
            allowManualWeight={false}
            allowCustomSize={usesExternalSalesPricing}
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
                knownTotal={currentCreateOrderQuote?.knownTotal}
                totalSemantics={currentCreateOrderQuote?.totalSemantics}
                plateFee={currentCreateOrderQuote?.plateFee ?? null}
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
              ? currentCreateOrderQuote?.plateFee
                ? '不含制版费。'
                : '当前已知费用已完整。'
              : currentCreateOrderQuote?.plateFee
                ? '不含制版费与快递费。'
                : '不含快递费。')
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
