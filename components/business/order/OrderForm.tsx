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
  type KeyboardEvent,
} from 'react';
import {
  useForm,
  useFieldArray,
  useWatch,
  Controller,
  type SubmitHandler,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
} from '@/generated/prisma/enums';
import { createOrderAction, submitOrderAction } from '@/actions/order';
import { quoteOrderItemsAction } from '@/actions/order-quote';
import { quoteExternalOrderChargesAction } from '@/actions/order-logistics-quote';
import { quoteOrderPackagingGroupsAction } from '@/actions/order-packaging-quote';
import type { CreateOrderMutationResult } from '@/actions/order.types';
import type { OrderPackagingQuotePreview } from '@/actions/order-packaging-quote.types';
import type { CustomerPartyOption } from '@/lib/party';
import type { QuoteResult } from '@/lib/price/quote';
import {
  externalPriceBusinessText,
  externalPriceRuleDisplayName,
} from '@/lib/price/external-price-display';
import {
  ZTO_PROVINCE_OPTIONS,
  type ExternalOrderChargeQuote,
} from '@/lib/price/external-order-charges';
import {
  PendingDesignImages,
  type PendingDesignImage,
} from './PendingDesignImages';
import { OrderItemChoiceField } from './OrderItemChoiceField';
import { OrderFoilColorsField } from './OrderFoilColorsField';
import { ORDER_SPECIFICATION_OPTIONS } from './order-item-options';
import { uploadOrderItemDesignFile } from './design-upload-client';
import { formatDesignFileSize } from './design-file-display';
import {
  runCreateOrderAction,
  runSubmitOrderAction,
} from './order-create-invocation';
import { OrderFormRail } from './OrderFormRail';
import {
  ExternalSalesOrderFormRail,
  externalSalesOrderFormTotal,
  type ExternalSalesPackagingQuote,
} from './ExternalSalesOrderFormRail';
import {
  ExternalSalesOrderFormB,
  OrderSubmissionReviewDialog,
  OrderSubmissionSuccess,
  type ExternalSalesOrderFormBErrors,
  type OrderPaperSwatchOption,
  type OrderSubmissionReviewItem,
} from './order-form-b';
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
  PRINT_ITEM_IMAGE_WARN_COUNT,
  type OrderFormGap,
  type OrderFormQuoteStatus,
} from './order-form-gaps';
import {
  localOrderFormDraftStorageKey,
  parseLocalOrderFormDraft,
  serializeLocalOrderFormDraft,
} from './order-form-local-draft';
import {
  NEW_ORDER_PRICING_ROUTES,
  ORDER_PRICING_ROUTE_LABELS,
  findCanonicalStockLocalFoilCraft,
  isLegacyStockFoilCraft,
  normalizeCraftIdsForPricingRoute,
  normalizeFoilFactsForPricingRoute,
  productCategoryMatchesPricingRoute,
  requiredPricingCraftGroups,
} from '@/lib/order/pricing-route';
import { calculatePackagingBagCount } from '@/lib/order/packaging-bag-count';
import {
  catalogPricingFactChoices,
  inferCatalogProductStructure,
  parseCatalogDimensions,
  parseCatalogPaperWeight,
} from '@/lib/order/catalog-pricing-facts';

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
};

export type PaperOption = {
  id: string;
  code?: string | null;
  name: string;
};

export function buildStandardPaperOptions(
  paperMaterials: readonly PaperOption[],
  products: readonly ProductOption[],
) {
  const rawNames = [
    ...new Set(
      paperMaterials
        .map((paper) => paper.name.trim())
        .filter((name) => name.length > 0),
    ),
  ];
  const baseLabels = rawNames.map(
    (name) => externalPriceBusinessText(name) || '未命名纸张',
  );
  const baseCounts = new Map<string, number>();
  baseLabels.forEach((label) =>
    baseCounts.set(label, (baseCounts.get(label) ?? 0) + 1),
  );

  const qualified = rawNames.map((value, index) => {
    const baseLabel = baseLabels[index] ?? '未命名纸张';
    if ((baseCounts.get(baseLabel) ?? 0) < 2) {
      return { value, label: baseLabel };
    }

    const specifications = [
      ...new Set(
        products
          .filter((product) => product.paperType?.trim() === value)
          .map((product) =>
            product.specification
              ? externalPriceBusinessText(product.specification)
              : '',
          )
          .filter(Boolean),
      ),
    ];
    return {
      value,
      label:
        specifications.length > 0
          ? `${baseLabel}（${specifications.join('、')}）`
          : baseLabel,
    };
  });

  const qualifiedCounts = new Map<string, number>();
  qualified.forEach(({ label }) =>
    qualifiedCounts.set(label, (qualifiedCounts.get(label) ?? 0) + 1),
  );
  const occurrences = new Map<string, number>();

  return qualified.map((option) => {
    if ((qualifiedCounts.get(option.label) ?? 0) < 2) return option;
    const occurrence = (occurrences.get(option.label) ?? 0) + 1;
    occurrences.set(option.label, occurrence);
    return {
      ...option,
      label: `${option.label}（待补充 ${occurrence}）`,
    };
  });
}

export function buildRouteSpecificationOptions(
  products: readonly ProductOption[],
  route: OrderItemPricingRoute,
) {
  const catalogOptions = [
    ...new Set(
      products
        .filter((product) =>
          productCategoryMatchesPricingRoute(route, product.category),
        )
        .flatMap((product) =>
          catalogPricingFactChoices(product.specification),
        ),
    ),
  ].map((value) => ({
    value,
    label: externalPriceBusinessText(value) || value,
  }));
  return catalogOptions.length > 0
    ? catalogOptions
    : [...ORDER_SPECIFICATION_OPTIONS];
}

type Props = {
  crafts: CraftOption[];
  products: ProductOption[];
  paperMaterials?: PaperOption[];
  customers?: CustomerPartyOption[];
  settlementLabel: string;
  usesExternalSalesPricing: boolean;
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

type QuoteFacts = Parameters<typeof quoteFactsKey>[0];

type OrderCreationIntent = 'draft' | 'submit';

const PRODUCT_STRUCTURE_LABELS: Record<OrderProductStructure, string> = {
  [OrderProductStructure.UNSPECIFIED]: '未明确',
  [OrderProductStructure.STANDARD_ENVELOPE]: '普通封',
  [OrderProductStructure.WESTERN_ENVELOPE]: '西封',
  [OrderProductStructure.TEN_THOUSAND_ENVELOPE]: '万元封',
};

const FOIL_TECHNIQUE_LABELS: Record<OrderFoilTechnique, string> = {
  [OrderFoilTechnique.UNSPECIFIED]: '未明确',
  [OrderFoilTechnique.NONE]: '不烫金',
  [OrderFoilTechnique.FLAT]: '平烫',
  [OrderFoilTechnique.RELIEF]: '浮雕',
  [OrderFoilTechnique.RAISED]: '激凸',
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
  const currentWeight = args.item.paperWeightGsm ?? allowedWeights[0] ?? 160;
  const allowManualWeight =
    route === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL;
  const weight =
    allowedWeights.includes(currentWeight) || allowManualWeight
      ? currentWeight
      : (allowedWeights[0] ?? currentWeight);
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
    frontFoilColors = (frontFoilColors.length > 0
      ? frontFoilColors
      : ['亚金']
    ).slice(0, 3);
    backFoilColors = backFoilColors.slice(0, 3);
    foilTechnique = OrderFoilTechnique.FLAT;
    hasLocalFoil = true;
    printColors = [];
    lamination = OrderLamination.NONE;
  } else if (route === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL) {
    frontFoilColors = (frontFoilColors.length > 0
      ? frontFoilColors
      : ['亚金']
    ).slice(0, 3);
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
): CreateOrderInput['items'][number] {
  const blank = {
    ...createBlankItem(crafts),
    frontFoilColors: ['亚金'],
    foilColors: ['亚金'],
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
  return false;
}

function getServerLocalDraftSnapshot(): string | null {
  return null;
}

function quoteFactsKey(
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
): string {
  return JSON.stringify({
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
  paperMaterials = [],
  customers = [],
  settlementLabel,
  usesExternalSalesPricing,
  draftScope,
}: Props) {
  const router = useRouter();
  const initialItem = useMemo(
    () =>
      usesExternalSalesPricing
        ? createExternalOrderItem(crafts, products)
        : createBlankItem(crafts),
    [crafts, products, usesExternalSalesPricing],
  );
  const standardPaperOptions = useMemo(
    () => buildStandardPaperOptions(paperMaterials, products),
    [paperMaterials, products],
  );
  const form = useForm<CreateOrderInput>({
    // zodResolver's generics don't fully compose with preprocess-bearing
    // schemas (moneyOptionalField uses `z.preprocess`, which splits
    // z.input / z.output). The runtime contract still holds — we just
    // widen the compile-time seam.
    resolver: zodResolver(createOrderSchema) as never,
    mode: 'onBlur',
    defaultValues: {
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
      packagingGroups: usesExternalSalesPricing
        ? defaultPackagingGroups(1)
        : [],
      items: [initialItem],
    },
  });
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isDirty },
    setValue,
    getValues,
    reset,
  } = form;
  const itemsArray = useFieldArray({ control, name: 'items' });
  const shipmentsArray = useFieldArray({
    control,
    name: 'additionalShipments',
  });
  const packagingGroupsArray = useFieldArray({
    control,
    name: 'packagingGroups',
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
  const visibleCrafts = crafts.filter(
    (craft) => !isLegacyStockFoilCraft(craft),
  );
  const commonCrafts = visibleCrafts.filter((craft) => !craft.isLowFrequency);
  const lowFrequencyCrafts = visibleCrafts.filter(
    (craft) => craft.isLowFrequency,
  );
  const canonicalStockLocalFoilCraft = findCanonicalStockLocalFoilCraft(crafts);

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
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const [quoting, startQuote] = useTransition();
  const [logisticsQuoting, startLogisticsQuote] = useTransition();
  const [quotingFieldId, setQuotingFieldId] = useState<string | null>(null);
  const [quoteViews, setQuoteViews] = useState<Record<string, QuoteViewState>>(
    {},
  );
  const [logisticsQuote, setLogisticsQuote] =
    useState<LogisticsQuoteViewState | null>(null);
  const [packagingQuote, setPackagingQuote] =
    useState<PackagingQuoteViewState | null>(null);
  const [packagingQuoting, startPackagingQuote] = useTransition();
  const [externalValidationVisible, setExternalValidationVisible] =
    useState(false);
  const [externalInputRevision, setExternalInputRevision] = useState(0);
  const [pendingSubmission, setPendingSubmission] = useState<{
    data: CreateOrderInput;
    fieldIds: string[];
    queues: Record<string, PendingDesignImage[]>;
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
  const itemFieldIdsRef = useRef<string[]>([]);
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
    quoting,
    logisticsQuoting,
  });

  useEffect(() => {
    itemFieldIdsRef.current = itemsArray.fields.map((field) => field.id);
  }, [itemsArray.fields]);

  useEffect(() => {
    if (!usesExternalSalesPricing || !pendingLocalDraft) return;
    const timer = window.setTimeout(() => {
      reset(pendingLocalDraft.values as unknown as CreateOrderInput);
      setQuoteViews({});
      setLogisticsQuote(null);
      setPackagingQuote(null);
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
      const savedAt = new Date();
      const serialized = serializeLocalOrderFormDraft(
        getValues(),
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
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    createdDraft,
    isDirty,
    localDraftReady,
    localDraftPricingScope,
    localDraftStorageKey,
    pendingLocalDraft,
    externalInputRevision,
    getValues,
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
    try {
      const uploaded = await uploadPendingDesigns(draft, queues);
      if (!uploaded) return;

      setUploadProgress(null);
      if (draft.intent === 'submit') {
        const submitResult = await runSubmitOrderAction(() =>
          submitOrderAction(draft.orderId),
        );
        if (submitResult.status !== 'success') {
          const message =
            submitResult.status === 'error'
              ? submitResult.message
              : Object.values(submitResult.fieldErrors).flat().join('；');
          setUploadError(`草稿已安全保存，但提交失败：${message}`);
          return;
        }
      }

      if (usesExternalSalesPricing && draft.intent === 'submit') {
        setSubmittedOrder({
          orderId: draft.orderId,
          orderNo: draft.orderNo,
          manualQuote: draft.manualQuote,
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
    reset(pendingLocalDraft.values as unknown as CreateOrderInput);
    setQuoteViews({});
    setLogisticsQuote(null);
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
    manualQuote: boolean,
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
        createOrderAction(null, submittedData),
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
        manualQuote,
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
    if (!data.receiverAddress?.trim()) issues.push('收货地址必填');
    if (!data.receiverPhone?.trim()) issues.push('收货电话必填');
    data.items.forEach((item, index) => {
      const itemLabel = `第 ${index + 1} 款`;
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
      logisticsQuoting ||
      packagingQuoting
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
      setPendingSubmission({ data, fieldIds, queues: queueSnapshot });
      return;
    }

    persistOrder(data, fieldIds, queueSnapshot, intent, false);
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

  function removeItem(index: number, fieldId: string) {
    const shipments = getValues('additionalShipments');
    setValue(
      'additionalShipments',
      shipments.map((shipment) => ({
        ...shipment,
        itemQuantities: shipment.itemQuantities.filter(
          (_, itemIndex) => itemIndex !== index,
        ),
      })),
      { shouldDirty: true },
    );
    const currentGroups = getValues('packagingGroups');
    const remainingItemCount = Math.max(0, itemsArray.fields.length - 1);
    const nextGroups = currentGroups
      .filter(
        (group) =>
          !usesExternalSalesPricing ||
          group.mode === OrderPackagingMode.MIXED_STYLE ||
          (group.itemUnitsPerBag[index] ?? 0) <= 0,
      )
      .map((group) => ({
        ...group,
        mode:
          usesExternalSalesPricing && remainingItemCount < 2
            ? OrderPackagingMode.SINGLE_STYLE
            : group.mode,
        itemUnitsPerBag: group.itemUnitsPerBag.filter(
          (_, itemIndex) => itemIndex !== index,
        ),
      }));
    setValue(
      'packagingGroups',
      usesExternalSalesPricing && nextGroups.length === 0
        ? defaultPackagingGroups(remainingItemCount)
        : nextGroups,
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
    setQuoteViews((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  }

  function addItem() {
    const shipments = getValues('additionalShipments');
    setValue(
      'additionalShipments',
      shipments.map((shipment) => ({
        ...shipment,
        itemQuantities: [...shipment.itemQuantities, 0],
      })),
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
        usesExternalSalesPricing && mixed ? 10 : 0,
      ],
    }));
    if (usesExternalSalesPricing && !mixed) {
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
    itemsArray.append(
      usesExternalSalesPricing
        ? createExternalOrderItem(crafts, products)
        : createBlankItem(crafts),
    );
  }

  function duplicateItem(index: number) {
    const source = getValues(`items.${index}`);
    const shipments = getValues('additionalShipments');
    setValue(
      'additionalShipments',
      shipments.map((shipment) => ({
        ...shipment,
        itemQuantities: [...shipment.itemQuantities, 0],
      })),
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
        usesExternalSalesPricing && mixed ? sourceUnits : 0,
      ],
    }));
    if (usesExternalSalesPricing && !mixed) {
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
    itemsArray.append({
      ...source,
      name: usesExternalSalesPricing
        ? source.name
        : source.name?.trim()
          ? `${source.name} 副本`
          : '',
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

  function changeExternalRoute(index: number, route: OrderItemPricingRoute) {
    const current = getValues(`items.${index}`);
    commitExternalItem(
      index,
      {
        ...current,
        pricingRoute: route,
        frontFoilColors:
          route === OrderItemPricingRoute.COLOR_PRINT ? [] : ['亚金'],
        backFoilColors: [],
        foilColors:
          route === OrderItemPricingRoute.COLOR_PRINT ? [] : ['亚金'],
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
      )[0] ?? 160;
    commitExternalItem(
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
      { paperKey, preserveCustomSize: false },
    );
  }

  function changeExternalWeight(index: number, weight: number) {
    const current = getValues(`items.${index}`);
    commitExternalItem(index, { ...current, paperWeightGsm: weight });
  }

  function changeExternalSpecification(index: number, specification: string) {
    const current = getValues(`items.${index}`);
    commitExternalItem(index, { ...current, specification });
  }

  function changeExternalFoilSides(
    index: number,
    frontFoilColors: string[],
    backFoilColors: string[],
  ) {
    const current = getValues(`items.${index}`);
    commitExternalItem(index, {
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
    commitExternalItem(index, {
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
    commitExternalItem(index, {
      ...current,
      frontFoilColors: hasFoil
        ? current.frontFoilColors.length > 0
          ? current.frontFoilColors.slice(0, 1)
          : ['亚金']
        : [],
      backFoilColors: [],
      foilColors: hasFoil
        ? current.frontFoilColors.length > 0
          ? current.frontFoilColors.slice(0, 1)
          : ['亚金']
        : [],
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

  function updateFoilSides(
    index: number,
    frontColors: string[],
    backColors: string[],
    routeOverride?: OrderItemPricingRoute,
  ) {
    const route =
      routeOverride ??
      getValues(`items.${index}.pricingRoute`) ??
      OrderItemPricingRoute.STOCK_BLANK;
    const front =
      route === OrderItemPricingRoute.COLOR_PRINT
        ? frontColors.slice(0, 1)
        : frontColors.slice(0, 3);
    const back =
      route === OrderItemPricingRoute.STOCK_BLANK ? backColors.slice(0, 3) : [];
    const legacyColors = [...new Set([...front, ...back])];
    const options = { shouldDirty: true, shouldValidate: true } as const;

    setValue(`items.${index}.frontFoilColors`, front, options);
    setValue(`items.${index}.backFoilColors`, back, options);
    setValue(`items.${index}.foilColors`, legacyColors, options);
    setValue(`items.${index}.isDoubleSided`, back.length > 0, options);
    setValue(
      `items.${index}.isDoubleColor`,
      front.length + back.length > 1,
      options,
    );

    const foilFacts = normalizeFoilFactsForPricingRoute({
      route,
      foilColors: legacyColors,
      frontFoilColors: front,
      backFoilColors: back,
      isDoubleSided: back.length > 0,
      foilTechnique: getValues(`items.${index}.foilTechnique`),
      hasLocalFoil: getValues(`items.${index}.hasLocalFoil`),
    });
    setValue(
      `items.${index}.foilTechnique`,
      front.length === 0 && route === OrderItemPricingRoute.COLOR_PRINT
        ? OrderFoilTechnique.NONE
        : foilFacts.foilTechnique === OrderFoilTechnique.NONE
          ? OrderFoilTechnique.FLAT
          : foilFacts.foilTechnique,
      options,
    );
    setValue(
      `items.${index}.hasLocalFoil`,
      route === OrderItemPricingRoute.STOCK_BLANK
        ? true
        : route === OrderItemPricingRoute.COLOR_PRINT
          ? front.length > 0
          : foilFacts.hasLocalFoil,
      options,
    );
  }

  function resetShipmentCarrierFacts() {
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
  }

  const calculateAndApplyQuote = useCallback(
    (index: number, fieldId: string) => {
      const item = getValues(`items.${index}`);
      const facts: QuoteFacts = {
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
      const inputKey = quoteFactsKey(facts);
      const requestId = ++quoteRequestSequence.current;
      latestQuoteRequestByField.current[fieldId] = requestId;
      setQuotingFieldId(fieldId);
      startQuote(async () => {
        const response = await quoteOrderItemsAction({
          items: [facts],
          orderItemCount: getValues('items').length,
        });
        // A quote can finish after the operator has changed product/quantity/
        // craft facts, removed the row, or started a newer request for the same
        // row. Keep the old response available only as a stale-status hint; it
        // must never write prices into the current form or replace a newer view.
        if (latestQuoteRequestByField.current[fieldId] !== requestId) return;
        const sameRow = itemFieldIdsRef.current[index] === fieldId;
        const factsStillCurrent =
          sameRow && quoteFactsKey(getValues(`items.${index}`)) === inputKey;
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

  const calculateAndApplyLogisticsQuote = useCallback(() => {
    const input = currentLogisticsQuoteInput();
    const inputKey = JSON.stringify(input);
    startLogisticsQuote(async () => {
      const response = await quoteExternalOrderChargesAction(input);
      if (response.status === 'success') {
        if (JSON.stringify(currentLogisticsQuoteInput()) !== inputKey) {
          setLogisticsQuote({ inputKey, result: response.quote });
          return;
        }
        setLogisticsQuote({ inputKey, result: response.quote });
        return;
      }

      const error =
        response.status === 'error'
          ? response.message
          : Object.values(response.fieldErrors).flat().join('；');
      setLogisticsQuote({
        inputKey,
        error: error || '暂时无法获取物流报价结果',
      });
    });
  }, [currentLogisticsQuoteInput, startLogisticsQuote]);

  const automaticItemFactsKey = watchedItems
    .map((item) => quoteFactsKey(item))
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
    setValue,
    usesExternalSalesPricing,
    watchedItems,
    watchedPackagingGroups.length,
  ]);
  useEffect(() => {
    if (
      !usesExternalSalesPricing ||
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

  const automaticLogisticsFactsKey = JSON.stringify({
    isSfCollect: watchedIsSfCollect,
    destinationProvince: watchedDestinationProvince,
    items: watchedItems.map((item) => ({
      quantity: item.quantity,
      paperWeightGsm: item.paperWeightGsm,
      paperType: item.paperType,
      productStructure: item.productStructure,
    })),
    additionalShipments: watchedShipments.map((shipment) => ({
      destinationProvince: shipment.destinationProvince,
      itemQuantities: shipment.itemQuantities,
    })),
  });
  useEffect(() => {
    if (
      !usesExternalSalesPricing ||
      !localDraftReady ||
      createdDraft ||
      submitting ||
      uploading
    ) {
      return;
    }
    const input = currentLogisticsQuoteInput();
    const hasQuoteableFacts = input.shipments.every(
      (shipment) => shipment.itemQuantity > 0,
    );
    if (!hasQuoteableFacts) return;
    const timer = window.setTimeout(() => {
      calculateAndApplyLogisticsQuote();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    automaticLogisticsFactsKey,
    calculateAndApplyLogisticsQuote,
    createdDraft,
    currentLogisticsQuoteInput,
    localDraftReady,
    submitting,
    uploading,
    usesExternalSalesPricing,
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

  const calculateAndApplyPackagingQuote = useCallback(() => {
    const input = currentPackagingQuoteInput();
    const inputKey = JSON.stringify(input);
    startPackagingQuote(async () => {
      const response = await quoteOrderPackagingGroupsAction(input);
      if (response.status === 'success') {
        setPackagingQuote({ inputKey, result: response.quote });
        return;
      }
      const error =
        response.status === 'error'
          ? response.message
          : Object.values(response.fieldErrors).flat().join('；');
      setPackagingQuote({
        inputKey,
        error: error || '暂时无法获取入袋费',
      });
    });
  }, [currentPackagingQuoteInput, startPackagingQuote]);

  useEffect(() => {
    if (
      !usesExternalSalesPricing ||
      !localDraftReady ||
      createdDraft ||
      submitting ||
      uploading ||
      packagingQuoting ||
      packagingQuote?.inputKey === currentPackagingInputKey ||
      watchedPackagingGroups.length === 0 ||
      watchedPackagingGroups.some(
        (group) =>
          !Number.isSafeInteger(group.actualBagCount) ||
          group.actualBagCount < 1,
      )
    ) {
      return;
    }
    const timer = window.setTimeout(calculateAndApplyPackagingQuote, 500);
    return () => window.clearTimeout(timer);
  }, [
    calculateAndApplyPackagingQuote,
    createdDraft,
    currentPackagingInputKey,
    localDraftReady,
    packagingQuote?.inputKey,
    packagingQuoting,
    submitting,
    uploading,
    usesExternalSalesPricing,
    watchedPackagingGroups,
  ]);

  const watchedPrimaryQuantities = watchedItems.map((item, itemIndex) => {
    const allocated = watchedShipments.reduce(
      (sum, shipment) => sum + (shipment.itemQuantities[itemIndex] ?? 0),
      0,
    );
    return item.quantity - allocated;
  });
  const currentLogisticsInputKey = JSON.stringify({
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
  });
  // RHF renders client-side field errors next to their controls. The server
  // can still reject backend-only facts such as a disabled product/craft;
  // render only those business messages, never their internal dotted paths.
  const serverFieldErrors =
    state?.status === 'invalid' ? state.fieldErrors : undefined;
  const serverGeneralError = state?.status === 'error' ? state.message : null;
  const itemGapInputs = watchedItems.map((item, index) => {
    const fieldId = itemsArray.fields[index]?.id;
    const view = fieldId ? quoteViews[fieldId] : undefined;
    const currentKey = quoteFactsKey(item);
    let quoteStatus: OrderFormQuoteStatus = 'missing';
    if (fieldId && quoting && quotingFieldId === fieldId) {
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
  const totalQuantity = watchedItems.reduce(
    (sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0),
    0,
  );
  const railQuoteItems = itemGapInputs.map((item, index) => {
    const fieldId = itemsArray.fields[index]?.id ?? `item-${index}`;
    const view = quoteViews[fieldId];
    const current = view?.inputKey === quoteFactsKey(watchedItems[index]);
    const result = current ? view?.result : undefined;
    return {
      key: fieldId,
      label:
        watchedItems[index]?.name?.trim() ||
        ORDER_PRICING_ROUTE_LABELS[
          watchedItems[index]?.pricingRoute ?? OrderItemPricingRoute.STOCK_BLANK
        ],
      status: item.quoteStatus,
      amount:
        item.quoteStatus === 'complete'
          ? (result?.suggestedSubtotal ?? null)
          : null,
      components:
        item.quoteStatus === 'complete'
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
        status: logisticsQuoting
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
    status: packagingQuoting
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
  const externalRequiresManualQuote =
    railQuoteItems.some((item) => item.status !== 'complete') ||
    railPackaging.status !== 'complete' ||
    railLogistics?.status !== 'complete';
  const externalTotal = externalSalesOrderFormTotal({
    quoteItems: railQuoteItems,
    packaging: railPackaging,
    logistics: railLogistics,
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
            : [quote?.message || '当前参数需由管理员终价'];
        return {
          id: fieldId,
          number: index + 1,
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
              ? '自定义尺寸 · 需管理员核价'
              : undefined,
          processSummary,
          facts: [
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
              ? [{ label: '覆亚膜（默认）' }]
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
      }),
    );
  const externalWeightOptions = activeExternalPaper
    ? [
        ...externalOrderWeightsForSelection(
          activeExternalPaper,
          activeExternalItem.pricingRoute,
          activeExternalItem.specification ?? '',
        ),
      ]
    : [];
  const externalSpecificationOptions = externalOrderSpecificationsForRoute(
    products,
    activeExternalItem.pricingRoute,
  ).map((specification) => ({
    value: specification,
    label: externalOrderSpecificationLabel(
      specification,
      activeExternalItem.pricingRoute,
    ),
    disabled:
      activeExternalItem.pricingRoute === OrderItemPricingRoute.STOCK_BLANK &&
      specification.includes('迷你') &&
      activeExternalPaper?.key !== 'PEARL_FLASH',
  }));
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
  const externalItemErrors: ExternalSalesOrderFormBErrors['items'] =
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
          externalValidationVisible && !hasImage ? '请上传设计图' : undefined,
      };
      return Object.values(itemError).some(Boolean) ? itemError : undefined;
    });
  const externalFieldErrors: ExternalSalesOrderFormBErrors = {
    summary: [
      ...externalLocalIssues,
      ...(serverGeneralError ? [serverGeneralError] : []),
      ...(serverFieldErrors
        ? orderServerFieldErrorMessages(serverFieldErrors)
        : []),
      ...(uploadError ? [uploadError] : []),
    ],
    customName:
      errors.customName?.message ??
      (externalValidationVisible && !getValues('customName')?.trim()
        ? '工单名称必填'
        : undefined),
    receiverPhone:
      errors.receiverPhone?.message ??
      (externalValidationVisible && !getValues('receiverPhone')?.trim()
        ? '收货电话必填'
        : undefined),
    receiverAddress:
      errors.receiverAddress?.message ??
      (externalValidationVisible && !getValues('receiverAddress')?.trim()
        ? '收货地址必填'
        : undefined),
    packaging:
      activePackagingBagCount && !activePackagingBagCount.complete
        ? activePackagingBagCount.errors.join('；')
        : undefined,
    items: externalItemErrors,
  };

  function jumpToGap(gap: OrderFormGap) {
    if (gap.itemIndex !== undefined) setExpandedItem(gap.itemIndex);
    window.setTimeout(() => {
      document.getElementById(gap.fieldId)?.focus();
    }, 0);
  }

  function handleItemTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    const lastIndex = itemsArray.fields.length - 1;
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = lastIndex;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    setExpandedItem(nextIndex);
    document.getElementById(`order-item-${nextIndex}-tab`)?.focus();
  }

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
      onSubmit={handleSubmit(onValid)}
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
        {usesExternalSalesPricing ? (
          <ExternalSalesOrderFormB
            values={{
              customName: watchedCustomName ?? '',
              receiverName: watchedReceiverName ?? '',
              receiverPhone: watchedReceiverPhone ?? '',
              receiverAddress: watchedReceiverAddress ?? '',
              isSfCollect: watchedIsSfCollect,
            }}
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
            disabled={
              !localDraftReady ||
              submitting ||
              uploading ||
              Boolean(createdDraft)
            }
            savedLabel={
              lastLocalDraftSavedAt
                ? `草稿已保存 ${formatLocalDraftTime(lastLocalDraftSavedAt)}`
                : '草稿未保存'
            }
            fieldErrors={externalFieldErrors}
            rail={
              <ExternalSalesOrderFormRail
                itemCount={itemsArray.fields.length}
                quoteItems={railQuoteItems}
                packaging={railPackaging}
                logistics={railLogistics}
                busy={
                  pendingState.busy ||
                  packagingQuoting ||
                  Boolean(createdDraft)
                }
                onAttemptSubmit={() => setExternalValidationVisible(true)}
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
              commitExternalItem(expandedItem, { ...current, lamination });
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
        ) : (
          <>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div
            className="flex min-w-0 flex-wrap items-center gap-2"
            role="tablist"
            aria-label="款式"
          >
            {itemsArray.fields.map((field, index) => {
              const active = expandedItem === index;
              const hasGap = formGaps.some((gap) => gap.itemIndex === index);
              const route =
                watchedItems[index]?.pricingRoute ??
                OrderItemPricingRoute.STOCK_BLANK;
              const name = watchedItems[index]?.name?.trim();
              return (
                <Button
                  key={field.id}
                  id={`order-item-${index}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`order-item-${index}-editor`}
                  tabIndex={active ? 0 : -1}
                  variant={active ? 'default' : 'outline'}
                  className="min-h-10 max-w-full rounded-full px-4"
                  onClick={() => setExpandedItem(index)}
                  onKeyDown={(event) => handleItemTabKeyDown(event, index)}
                >
                  <span className="truncate">
                    {index + 1}. {name || ORDER_PRICING_ROUTE_LABELS[route]}
                  </span>
                  {hasGap ? (
                    <span
                      aria-label="有待补信息"
                      className="ml-1 size-2 shrink-0 rounded-full bg-destructive"
                    />
                  ) : null}
                </Button>
              );
            })}
          </div>
          <div
            className="flex min-w-0 flex-wrap items-center gap-2"
            role="group"
            aria-label="款式操作"
          >
            <Button
              type="button"
              variant="outline"
              className="min-h-10 rounded-full border-dashed"
              disabled={submitting || uploading || Boolean(createdDraft)}
              onClick={() => {
                const nextIndex = itemsArray.fields.length;
                addItem();
                setExpandedItem(nextIndex);
              }}
            >
              ＋ 添加款式
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-10 rounded-full border-dashed"
              disabled={submitting || uploading || Boolean(createdDraft)}
              onClick={() => {
                const nextIndex = itemsArray.fields.length;
                duplicateItem(expandedItem);
                setExpandedItem(nextIndex);
              }}
            >
              复制当前
            </Button>
            {itemsArray.fields.length > 1 ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-10 rounded-full text-destructive"
                disabled={submitting || uploading || Boolean(createdDraft)}
                onClick={() => {
                  const field = itemsArray.fields[expandedItem];
                  if (field) removeItem(expandedItem, field.id);
                }}
              >
                删除当前
              </Button>
            ) : null}
          </div>
          <p
            className="ml-auto text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {lastLocalDraftSavedAt
              ? `本地草稿已保存 · ${formatLocalDraftTime(lastLocalDraftSavedAt)}`
              : '尚未保存本地草稿'}
          </p>
        </div>

        {formGaps.length > 0 ? (
          <ul className="space-y-1 rounded-xl border border-destructive/30 bg-card p-3 lg:hidden">
            {formGaps.map((gap) => (
              <li key={gap.id}>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto min-h-11 justify-start whitespace-normal px-0 py-1 text-left text-sm text-destructive"
                  onClick={() => jumpToGap(gap)}
                >
                  {gap.label}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-5">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="contents">
              <div className="order-1 space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-base font-semibold">工单</h2>
                  <p className="rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                    结算路径：
                    <span className="font-medium text-foreground">
                      {settlementLabel}
                    </span>
                  </p>
                </div>

                <div id="order-customer-panel" className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <TextField
                      label="工单自定义名称"
                      hint="例如：王总中秋礼盒首批；最多 100 个字符"
                      full
                      registration={register('customName')}
                      error={errors.customName?.message}
                    />
                    <div className="space-y-1">
                      <Label htmlFor="customerPartyId">
                        客户主数据（选填）
                      </Label>
                      <select
                        id="customerPartyId"
                        className={selectClass}
                        {...register('customerPartyId', {
                          setValueAs: (value) => (value === '' ? null : value),
                          onChange: (event) => {
                            const customer = customers.find(
                              (candidate) =>
                                candidate.id === event.target.value,
                            );
                            if (!customer) return;
                            setValue(
                              'customerRef',
                              customer.shortName ?? customer.name,
                              { shouldDirty: true, shouldValidate: true },
                            );
                            if (
                              !getValues('receiverName') &&
                              customer.receiverName
                            ) {
                              setValue('receiverName', customer.receiverName, {
                                shouldDirty: true,
                              });
                            }
                            if (
                              !getValues('receiverPhone') &&
                              customer.receiverPhone
                            ) {
                              setValue(
                                'receiverPhone',
                                customer.receiverPhone,
                                {
                                  shouldDirty: true,
                                },
                              );
                            }
                            if (
                              !getValues('receiverAddress') &&
                              customer.receiverAddress
                            ) {
                              setValue(
                                'receiverAddress',
                                customer.receiverAddress,
                                {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                },
                              );
                            }
                          },
                        })}
                      >
                        <option value="">— 临时客户 / 仅填写简称 —</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.code} ·{' '}
                            {customer.shortName ?? customer.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        选择后自动带出客户简称和默认收货信息；也可保留为临时客户。
                      </p>
                    </div>
                    <TextField
                      label="客户名称/简称"
                      registration={register('customerRef')}
                      error={errors.customerRef?.message}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <TextField
                      label="承诺交期（提交前必填）"
                      type="date"
                      registration={register('promisedDate')}
                      error={errors.promisedDate?.message as string | undefined}
                    />
                  </div>
                  <TextareaField
                    label="工单备注"
                    registration={register('remark')}
                    error={errors.remark?.message}
                    rows={2}
                  />
                  <label className="flex min-w-0 items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      {...register('isUrgent')}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
                    />
                    <span>急单（提交后会推送至排产群）</span>
                  </label>
                </div>
              </div>

              <div
                id="order-shipping-panel"
                className="order-3 space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6"
              >
                <h2 className="text-base font-semibold">收货</h2>
                <TextField
                  label="快递代码"
                  registration={register('expressCode')}
                  error={errors.expressCode?.message}
                />
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextField
                    label="收货人"
                    registration={register('receiverName')}
                    error={errors.receiverName?.message}
                  />
                  <TextField
                    label="联系电话"
                    registration={register('receiverPhone')}
                    error={errors.receiverPhone?.message}
                  />
                </div>
                <ShipmentPricingFactsFields
                  idPrefix="primary"
                  provinceRegistration={register('destinationProvince')}
                  provinceError={errors.destinationProvince?.message}
                  isSfCollect={watchedIsSfCollect}
                />
                <TextareaField
                  label="详细地址 / 粘贴完整收货信息"
                  hint="粘贴后自动识别收货人、电话和省份；识别结果可修改"
                  required
                  registration={register('receiverAddress')}
                  onPaste={(event) => {
                    const parsed = parsePastedReceiverAddress(
                      pastedTextareaValue(event),
                    );
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
                  error={errors.receiverAddress?.message}
                  rows={3}
                />
                <TextareaField
                  label="包装要求"
                  registration={register('packageRequirement')}
                  error={errors.packageRequirement?.message}
                  rows={2}
                />
                <label className="flex min-w-0 items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...register('isSfCollect', {
                      onChange: resetShipmentCarrierFacts,
                    })}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
                  />
                  <span>
                    顺丰到付
                    <span className="block text-xs text-muted-foreground">
                      自行预约；物流费不计入工单金额
                    </span>
                  </span>
                </label>

                {usesExternalSalesPricing ? (
                  <section
                    aria-labelledby="primary-customer-charges-heading"
                    className="space-y-3 rounded-lg border bg-muted/20 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3
                          id="primary-customer-charges-heading"
                          className="text-sm font-medium"
                        >
                          地址 1
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          选择省份后自动核价；未匹配到价格时由管理员终价。
                        </p>
                      </div>
                      <Button
                        id="logistics-quote"
                        type="button"
                        variant="outline"
                        disabled={
                          submitting ||
                          uploading ||
                          logisticsQuoting ||
                          Boolean(createdDraft)
                        }
                        onClick={calculateAndApplyLogisticsQuote}
                      >
                        {logisticsQuoting ? '核价中…' : '立即重新核价'}
                      </Button>
                    </div>
                    <LogisticsQuoteFeedback
                      view={logisticsQuote}
                      stale={
                        Boolean(logisticsQuote) &&
                        logisticsQuote?.inputKey !== currentLogisticsInputKey
                      }
                    />
                  </section>
                ) : null}
              </div>
            </section>

            <section
              id="order-items-panel"
              className="order-2 space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6"
            >
              <h2 className="text-base font-semibold">
                当前款式 · 第 {expandedItem + 1} 款
              </h2>
              {itemsArray.fields.length >= PRINT_ITEM_IMAGE_WARN_COUNT ? (
                <p className="text-sm text-warning-foreground">
                  A4 打印最多 5 款带图。第 {PRINT_ITEM_IMAGE_WARN_COUNT}{' '}
                  款起建议分款式打印，以免车间看不清。
                </p>
              ) : null}

              {errors.items?.message ? (
                <p className="text-sm text-destructive">
                  {errors.items.message}
                </p>
              ) : null}

              <ol className="space-y-4">
                {itemsArray.fields.map((field, index) => (
                  <li
                    key={field.id}
                    id={`order-item-${index}-editor`}
                    role="tabpanel"
                    aria-labelledby={`order-item-${index}-tab`}
                    className={
                      expandedItem === index
                        ? 'min-w-0 space-y-5 text-sm'
                        : 'hidden'
                    }
                  >
                    <div className="space-y-4">
                      <fieldset className="space-y-2 rounded-lg border bg-muted/20 p-3">
                        <legend className="px-1 text-sm font-medium">
                          计价方式
                        </legend>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {NEW_ORDER_PRICING_ROUTES.map((route) => (
                            <label
                              key={route}
                              className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border bg-background p-2 text-sm"
                            >
                              <input
                                type="radio"
                                value={route}
                                {...register(`items.${index}.pricingRoute`, {
                                  onChange: (event) => {
                                    const nextRoute = event.target
                                      .value as OrderItemPricingRoute;
                                    const options = {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    } as const;
                                    setValue(
                                      `items.${index}.manualQuoteReason`,
                                      null,
                                      options,
                                    );
                                    const selectedProduct = products.find(
                                      (product) =>
                                        product.id ===
                                        getValues(`items.${index}.productId`),
                                    );
                                    if (
                                      selectedProduct &&
                                      !productCategoryMatchesPricingRoute(
                                        nextRoute,
                                        selectedProduct.category,
                                      )
                                    ) {
                                      setValue(
                                        `items.${index}.productId`,
                                        null,
                                        options,
                                      );
                                      setValue(
                                        `items.${index}.specification`,
                                        null,
                                        options,
                                      );
                                      setValue(
                                        `items.${index}.paperType`,
                                        null,
                                        options,
                                      );
                                      setValue(
                                        `items.${index}.paperWeightGsm`,
                                        null,
                                        options,
                                      );
                                      setValue(
                                        `items.${index}.actualWidthMm`,
                                        null,
                                        options,
                                      );
                                      setValue(
                                        `items.${index}.actualHeightMm`,
                                        null,
                                        options,
                                      );
                                      setValue(
                                        `items.${index}.productStructure`,
                                        OrderProductStructure.UNSPECIFIED,
                                        options,
                                      );
                                    }
                                    setValue(
                                      `items.${index}.crafts`,
                                      normalizeCraftIdsForPricingRoute(
                                        nextRoute,
                                        getValues(`items.${index}.crafts`),
                                        crafts,
                                      ),
                                      options,
                                    );
                                    const currentFront =
                                      getValues(
                                        `items.${index}.frontFoilColors`,
                                      ) ?? [];
                                    const nextFront =
                                      nextRoute ===
                                      OrderItemPricingRoute.COLOR_PRINT
                                        ? []
                                        : currentFront.length > 0
                                          ? currentFront
                                          : ['哑金'];
                                    updateFoilSides(
                                      index,
                                      nextFront,
                                      nextRoute ===
                                        OrderItemPricingRoute.STOCK_BLANK
                                        ? (getValues(
                                            `items.${index}.backFoilColors`,
                                          ) ?? [])
                                        : [],
                                      nextRoute,
                                    );
                                  },
                                })}
                                className="mt-0.5 size-4 shrink-0"
                              />
                              <span>{ORDER_PRICING_ROUTE_LABELS[route]}</span>
                            </label>
                          ))}
                        </div>
                        {errors.items?.[index]?.pricingRoute?.message ? (
                          <p role="alert" className="text-sm text-destructive">
                            {errors.items[index]?.pricingRoute?.message}
                          </p>
                        ) : null}
                      </fieldset>

                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        <TextField
                          label="款式名"
                          required
                          registration={register(`items.${index}.name`)}
                          error={errors.items?.[index]?.name?.message}
                        />
                        <div className="space-y-1">
                          <Label htmlFor={`items.${index}.productId`}>
                            报价产品
                          </Label>
                          <select
                            id={`items.${index}.productId`}
                            className={selectClass}
                            {...register(`items.${index}.productId`, {
                              setValueAs: (v) => (v === '' ? null : v),
                              onChange: (event) => {
                                const product = products.find(
                                  (candidate) =>
                                    candidate.id === event.target.value,
                                );
                                const specificationChoices =
                                  catalogPricingFactChoices(
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
                                const dimensions = parseCatalogDimensions(
                                  specification,
                                );
                                setValue(
                                  `items.${index}.specification`,
                                  specification,
                                  { shouldDirty: true, shouldValidate: true },
                                );
                                setValue(
                                  `items.${index}.paperType`,
                                  paperType,
                                  { shouldDirty: true, shouldValidate: true },
                                );
                                setValue(
                                  `items.${index}.actualWidthMm`,
                                  dimensions?.widthMm ?? null,
                                  { shouldDirty: true, shouldValidate: true },
                                );
                                setValue(
                                  `items.${index}.actualHeightMm`,
                                  dimensions?.heightMm ?? null,
                                  { shouldDirty: true, shouldValidate: true },
                                );
                                setValue(
                                  `items.${index}.paperWeightGsm`,
                                  parseCatalogPaperWeight(paperType),
                                  { shouldDirty: true, shouldValidate: true },
                                );
                                setValue(
                                  `items.${index}.productStructure`,
                                  inferCatalogProductStructure(specification),
                                  { shouldDirty: true, shouldValidate: true },
                                );
                              },
                            })}
                          >
                            <option value="">— 请选择 —</option>
                            {products
                              .filter((product) =>
                                productCategoryMatchesPricingRoute(
                                  watchedItems[index]?.pricingRoute ??
                                    OrderItemPricingRoute.STOCK_BLANK,
                                  product.category,
                                ),
                              )
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`items.${index}.productStructure`}>
                            产品结构
                          </Label>
                          <select
                            id={`items.${index}.productStructure`}
                            className={selectClass}
                            {...register(`items.${index}.productStructure`)}
                          >
                            {[
                              OrderProductStructure.UNSPECIFIED,
                              OrderProductStructure.STANDARD_ENVELOPE,
                              OrderProductStructure.WESTERN_ENVELOPE,
                              OrderProductStructure.TEN_THOUSAND_ENVELOPE,
                            ].map((structure) => (
                              <option key={structure} value={structure}>
                                {PRODUCT_STRUCTURE_LABELS[structure]}
                              </option>
                            ))}
                          </select>
                          {errors.items?.[index]?.productStructure?.message ? (
                            <p
                              role="alert"
                              className="text-sm text-destructive"
                            >
                              {errors.items[index]?.productStructure?.message}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h3 className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">
                          材料
                        </h3>
                      </div>

                      <Controller
                        control={control}
                        name={`items.${index}.specification`}
                        render={({ field: specificationField }) => (
                          <OrderItemChoiceField
                            id={`items.${index}.specification`}
                            label="规格"
                            value={specificationField.value}
                            options={buildRouteSpecificationOptions(
                              products,
                              watchedItems[index]?.pricingRoute ??
                                OrderItemPricingRoute.STOCK_BLANK,
                            )}
                            customLabel="非标定制（自定义尺寸）"
                            customInputLabel="自定义尺寸 / 规格"
                            customPlaceholder="例如：9.5 × 17.2 cm、客户来样"
                            maxLength={64}
                            disabled={
                              submitting || uploading || Boolean(createdDraft)
                            }
                            error={
                              errors.items?.[index]?.specification?.message
                            }
                            onChange={(value) => {
                              specificationField.onChange(value);
                              const dimensions = parseCatalogDimensions(value);
                              setValue(
                                `items.${index}.actualWidthMm`,
                                dimensions?.widthMm ?? null,
                                { shouldDirty: true, shouldValidate: true },
                              );
                              setValue(
                                `items.${index}.actualHeightMm`,
                                dimensions?.heightMm ?? null,
                                { shouldDirty: true, shouldValidate: true },
                              );
                              setValue(
                                `items.${index}.productStructure`,
                                inferCatalogProductStructure(value),
                                { shouldDirty: true, shouldValidate: true },
                              );
                            }}
                            onBlur={specificationField.onBlur}
                          />
                        )}
                      />

                      <Controller
                        control={control}
                        name={`items.${index}.paperType`}
                        render={({ field: paperField }) => (
                          <OrderItemChoiceField
                            id={`items.${index}.paperType`}
                            label="纸张"
                            value={paperField.value}
                            options={standardPaperOptions}
                            customLabel="自定义纸张（转管理员终价）"
                            customInputLabel="自定义纸张"
                            customPlaceholder="输入材料字典中尚未配置的纸张名称"
                            maxLength={32}
                            disabled={
                              submitting || uploading || Boolean(createdDraft)
                            }
                            error={errors.items?.[index]?.paperType?.message}
                            onChange={(value) => {
                              paperField.onChange(value);
                              setValue(
                                `items.${index}.paperWeightGsm`,
                                parseCatalogPaperWeight(value),
                                { shouldDirty: true, shouldValidate: true },
                              );
                            }}
                            onBlur={paperField.onBlur}
                          />
                        )}
                      />

                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                        <TextField
                          label="实际宽度（mm）"
                          type="number"
                          min={0.01}
                          step={0.01}
                          registration={register(
                            `items.${index}.actualWidthMm`,
                            {
                              setValueAs: (value) =>
                                value === '' ? null : Number(value),
                            },
                          )}
                          error={errors.items?.[index]?.actualWidthMm?.message}
                        />
                        <TextField
                          label="实际高度（mm）"
                          type="number"
                          min={0.01}
                          step={0.01}
                          registration={register(
                            `items.${index}.actualHeightMm`,
                            {
                              setValueAs: (value) =>
                                value === '' ? null : Number(value),
                            },
                          )}
                          error={errors.items?.[index]?.actualHeightMm?.message}
                        />
                        <TextField
                          label="纸张克重（g㎡）"
                          type="number"
                          min={1}
                          step={1}
                          registration={register(
                            `items.${index}.paperWeightGsm`,
                            {
                              setValueAs: (value) =>
                                value === '' ? null : Number(value),
                            },
                          )}
                          error={errors.items?.[index]?.paperWeightGsm?.message}
                        />
                      </div>

                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                        <TextField
                          label="稿件版本"
                          hint="例如 V1、V2 或客户确认版日期"
                          registration={register(
                            `items.${index}.artworkVersion`,
                          )}
                          error={errors.items?.[index]?.artworkVersion?.message}
                        />
                        <TextField
                          label="版组 / 模具组 ID"
                          registration={register(`items.${index}.plateGroupId`)}
                          error={errors.items?.[index]?.plateGroupId?.message}
                        />
                        <TextField
                          label="专版计价组"
                          registration={register(`items.${index}.pricingGroup`)}
                          error={errors.items?.[index]?.pricingGroup?.message}
                        />
                      </div>

                      <div className="border-t pt-4">
                        <h3 className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">
                          数量与包装
                        </h3>
                      </div>

                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:max-w-xs">
                        <TextField
                          label="数量"
                          required
                          type="number"
                          min={1}
                          step={1}
                          registration={register(`items.${index}.quantity`, {
                            valueAsNumber: true,
                          })}
                          error={errors.items?.[index]?.quantity?.message}
                        />
                      </div>

                      <div className="border-t pt-4">
                        <h3 className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">
                          工艺参数
                        </h3>
                      </div>

                      <Controller
                        control={control}
                        name={`items.${index}.frontFoilColors`}
                        render={({ field: frontColorsField }) => (
                          <div className="space-y-3">
                            <OrderFoilColorsField
                              id={`items.${index}.frontFoilColors`}
                              label={
                                watchedItems[index]?.pricingRoute ===
                                OrderItemPricingRoute.COLOR_PRINT
                                  ? '正面烫金色（可选）'
                                  : '正面烫金色'
                              }
                              value={frontColorsField.value ?? []}
                              maxColors={
                                watchedItems[index]?.pricingRoute ===
                                OrderItemPricingRoute.COLOR_PRINT
                                  ? 1
                                  : 3
                              }
                              allowNoColor={false}
                              disabled={
                                submitting || uploading || Boolean(createdDraft)
                              }
                              error={
                                errors.items?.[index]?.frontFoilColors?.message
                              }
                              onChange={(colors) =>
                                updateFoilSides(
                                  index,
                                  colors,
                                  getValues(`items.${index}.backFoilColors`) ??
                                    [],
                                )
                              }
                              onBlur={frontColorsField.onBlur}
                            />

                            {watchedItems[index]?.pricingRoute ===
                            OrderItemPricingRoute.STOCK_BLANK ? (
                              <div className="rounded-lg border p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-medium">
                                      反面烫金
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {(
                                        watchedItems[index]?.backFoilColors ??
                                        []
                                      ).length > 0
                                        ? (
                                            watchedItems[index]
                                              ?.backFoilColors ?? []
                                          ).join('、')
                                        : '不烫'}
                                    </p>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    disabled={
                                      submitting ||
                                      uploading ||
                                      Boolean(createdDraft)
                                    }
                                    onClick={() => {
                                      const back =
                                        getValues(
                                          `items.${index}.backFoilColors`,
                                        ) ?? [];
                                      const front =
                                        getValues(
                                          `items.${index}.frontFoilColors`,
                                        ) ?? [];
                                      updateFoilSides(
                                        index,
                                        front,
                                        back.length > 0
                                          ? []
                                          : [front[0] ?? '哑金'],
                                      );
                                    }}
                                  >
                                    {(watchedItems[index]?.backFoilColors ?? [])
                                      .length > 0
                                      ? '取消反面'
                                      : '＋ 加烫反面'}
                                  </Button>
                                </div>
                                {(watchedItems[index]?.backFoilColors ?? [])
                                  .length > 0 ? (
                                  <Controller
                                    control={control}
                                    name={`items.${index}.backFoilColors`}
                                    render={({ field: backColorsField }) => (
                                      <div className="mt-3 border-t pt-3">
                                        <OrderFoilColorsField
                                          id={`items.${index}.backFoilColors`}
                                          label="反面烫金色"
                                          value={backColorsField.value ?? []}
                                          maxColors={3}
                                          allowNoColor={false}
                                          disabled={
                                            submitting ||
                                            uploading ||
                                            Boolean(createdDraft)
                                          }
                                          error={
                                            errors.items?.[index]
                                              ?.backFoilColors?.message
                                          }
                                          onChange={(colors) =>
                                            updateFoilSides(
                                              index,
                                              getValues(
                                                `items.${index}.frontFoilColors`,
                                              ) ?? [],
                                              colors,
                                            )
                                          }
                                          onBlur={backColorsField.onBlur}
                                        />
                                      </div>
                                    )}
                                  />
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )}
                      />

                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor={`items.${index}.foilTechnique`}>
                            烫金方式
                          </Label>
                          <select
                            id={`items.${index}.foilTechnique`}
                            className={selectClass}
                            disabled={
                              watchedItems[index]?.pricingRoute ===
                                OrderItemPricingRoute.COLOR_PRINT &&
                              (watchedItems[index]?.frontFoilColors ?? [])
                                .length === 0
                            }
                            {...register(`items.${index}.foilTechnique`)}
                          >
                            {(watchedItems[index]?.pricingRoute ===
                            OrderItemPricingRoute.COLOR_PRINT
                              ? [
                                  OrderFoilTechnique.NONE,
                                  OrderFoilTechnique.FLAT,
                                  OrderFoilTechnique.RELIEF,
                                  OrderFoilTechnique.RAISED,
                                ]
                              : [
                                  OrderFoilTechnique.FLAT,
                                  OrderFoilTechnique.RELIEF,
                                  OrderFoilTechnique.RAISED,
                                ]
                            ).map((technique) => (
                              <option key={technique} value={technique}>
                                {FOIL_TECHNIQUE_LABELS[technique]}
                              </option>
                            ))}
                          </select>
                          {errors.items?.[index]?.foilTechnique?.message ? (
                            <p
                              role="alert"
                              className="text-sm text-destructive"
                            >
                              {errors.items[index]?.foilTechnique?.message}
                            </p>
                          ) : null}
                        </div>
                        {watchedItems[index]?.pricingRoute ===
                        OrderItemPricingRoute.COLOR_PRINT ? (
                          <Controller
                            control={control}
                            name={`items.${index}.printColors`}
                            render={({ field: printColorsField }) => (
                              <StringListField
                                id={`items.${index}.printColors`}
                                label="彩印颜色"
                                value={printColorsField.value}
                                disabled={
                                  submitting ||
                                  uploading ||
                                  Boolean(createdDraft)
                                }
                                error={
                                  errors.items?.[index]?.printColors?.message
                                }
                                onChange={printColorsField.onChange}
                                onBlur={printColorsField.onBlur}
                              />
                            )}
                          />
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <Controller
                          control={control}
                          name={`items.${index}.crafts`}
                          render={({ field }) => {
                            const selected = new Set(field.value ?? []);
                            const requiredCraftGroups =
                              requiredPricingCraftGroups({
                                route:
                                  watchedItems[index]?.pricingRoute ??
                                  OrderItemPricingRoute.STOCK_BLANK,
                                foilColors:
                                  watchedItems[index]?.foilColors ?? [],
                                frontFoilColors:
                                  watchedItems[index]?.frontFoilColors ?? [],
                                backFoilColors:
                                  watchedItems[index]?.backFoilColors ?? [],
                                isDoubleSided:
                                  (watchedItems[index]?.backFoilColors ?? [])
                                    .length > 0,
                                foilTechnique:
                                  watchedItems[index]?.foilTechnique ??
                                  OrderFoilTechnique.UNSPECIFIED,
                              });
                            const locked = new Set(
                              getValues(`items.${index}.pricingRoute`) ===
                                OrderItemPricingRoute.STOCK_BLANK &&
                              canonicalStockLocalFoilCraft
                                ? [canonicalStockLocalFoilCraft.id]
                                : [],
                            );
                            const toggle = (craftId: string) => {
                              if (locked.has(craftId)) return;
                              const next = new Set(selected);
                              if (next.has(craftId)) next.delete(craftId);
                              else next.add(craftId);
                              field.onChange([...next]);
                            };
                            const controlsDisabled =
                              submitting || uploading || Boolean(createdDraft);

                            return (
                              <fieldset
                                id={`items.${index}.crafts`}
                                tabIndex={-1}
                                aria-invalid={Boolean(
                                  errors.items?.[index]?.crafts?.message,
                                )}
                                aria-describedby={
                                  errors.items?.[index]?.crafts?.message
                                    ? `items.${index}.crafts-error`
                                    : undefined
                                }
                              >
                                <legend className="text-sm font-medium">
                                  生产工艺
                                </legend>
                                {requiredCraftGroups.length > 0 ? (
                                  <p className="mt-1 text-xs text-primary">
                                    本路线必需：
                                    {requiredCraftGroups
                                      .map((group) => group.label)
                                      .join('、')}
                                  </p>
                                ) : null}
                                <CraftToggleGrid
                                  crafts={commonCrafts}
                                  selected={selected}
                                  disabled={controlsDisabled}
                                  locked={locked}
                                  onToggle={toggle}
                                />
                                {lowFrequencyCrafts.length > 0 ? (
                                  <div className="mt-4 border-t pt-3">
                                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                                      低频工艺
                                    </p>
                                    <CraftToggleGrid
                                      crafts={lowFrequencyCrafts}
                                      selected={selected}
                                      disabled={controlsDisabled}
                                      locked={locked}
                                      onToggle={toggle}
                                      compact
                                    />
                                  </div>
                                ) : null}
                              </fieldset>
                            );
                          }}
                        />
                        {errors.items?.[index]?.crafts?.message ? (
                          <p
                            id={`items.${index}.crafts-error`}
                            role="alert"
                            className="text-sm text-destructive"
                          >
                            {errors.items?.[index]?.crafts?.message}
                          </p>
                        ) : null}
                      </div>

                      {!usesExternalSalesPricing ? (
                        <section
                          aria-labelledby={`items.${index}.price-heading`}
                          className="space-y-3 rounded-lg border bg-muted/30 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3
                                id={`items.${index}.price-heading`}
                                className="text-sm font-medium"
                              >
                                加工费报价
                              </h3>
                              <p className="mt-1 text-xs text-muted-foreground">
                                服务端核价结果
                              </p>
                            </div>
                            <Button
                              id={`items.${index}.quote`}
                              type="button"
                              variant="outline"
                              disabled={
                                submitting ||
                                uploading ||
                                Boolean(createdDraft) ||
                                (quoting && quotingFieldId === field.id)
                              }
                              onClick={() =>
                                calculateAndApplyQuote(index, field.id)
                              }
                            >
                              {quoting && quotingFieldId === field.id
                                ? '计算中…'
                                : '计算并应用建议价'}
                            </Button>
                          </div>

                          <QuoteFeedback
                            presentation="internal-editable"
                            view={quoteViews[field.id]}
                            stale={
                              Boolean(quoteViews[field.id]) &&
                              quoteViews[field.id]?.inputKey !==
                                quoteFactsKey(watchedItems[index])
                            }
                          />

                          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                            <TextField
                              label="成交单价"
                              hint="留空则使用建议价；最多 4 位小数"
                              registration={register(
                                `items.${index}.unitPrice`,
                                {
                                  setValueAs: (v) => (v === '' ? null : v),
                                },
                              )}
                              error={errors.items?.[index]?.unitPrice?.message}
                            />
                            <TextField
                              label="一次性费用"
                              hint="用于补充按张、每万个或每款计算的固定费用"
                              registration={register(
                                `items.${index}.fixedFee`,
                                {
                                  setValueAs: (v) => (v === '' ? null : v),
                                },
                              )}
                              error={errors.items?.[index]?.fixedFee?.message}
                            />
                          </div>
                          <TextareaField
                            label="人工改价说明"
                            hint="成交价与建议价不同，或规则不完整时必填；会随工单保存供对账。"
                            registration={register(
                              `items.${index}.priceOverrideReason`,
                            )}
                            error={
                              errors.items?.[index]?.priceOverrideReason
                                ?.message
                            }
                            rows={2}
                          />
                        </section>
                      ) : null}

                      <TextareaField
                        label="款式备注"
                        hint="填写颜色、方向和工艺注意事项，生产端会高亮显示"
                        registration={register(`items.${index}.remark`)}
                        error={errors.items?.[index]?.remark?.message}
                        rows={2}
                      />

                      <div className="border-t pt-4">
                        <h3 className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">
                          文件
                        </h3>
                      </div>

                      <PendingDesignImages
                        itemNumber={index + 1}
                        images={pendingDesigns[field.id] ?? []}
                        disabled={
                          submitting || uploading || Boolean(createdDraft)
                        }
                        onChange={(images) =>
                          updatePendingDesigns(field.id, images)
                        }
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="order-4 space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">
                    多地址发货
                    {shipmentsArray.fields.length > 0
                      ? `（共 ${shipmentsArray.fields.length + 1} 个地址）`
                      : ''}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    主地址承接未分配数量；这里只填写额外地址及各款式分配数量。
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

              {shipmentsArray.fields.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  当前为单地址工单。增加地址后，工单列表、详情和打印页会显示“多地址”标识。
                </p>
              ) : (
                <ol className="space-y-4">
                  {shipmentsArray.fields.map((shipment, shipmentIndex) => (
                    <li
                      key={shipment.id}
                      className="min-w-0 space-y-3 rounded-lg border p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-medium">
                          额外地址 {shipmentIndex + 1}
                        </h3>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            submitting || uploading || Boolean(createdDraft)
                          }
                          onClick={() => shipmentsArray.remove(shipmentIndex)}
                        >
                          删除地址
                        </Button>
                      </div>
                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        <TextField
                          label="收货人"
                          registration={register(
                            `additionalShipments.${shipmentIndex}.receiverName`,
                          )}
                          error={
                            errors.additionalShipments?.[shipmentIndex]
                              ?.receiverName?.message
                          }
                        />
                        <TextField
                          label="联系电话"
                          registration={register(
                            `additionalShipments.${shipmentIndex}.receiverPhone`,
                          )}
                          error={
                            errors.additionalShipments?.[shipmentIndex]
                              ?.receiverPhone?.message
                          }
                        />
                        <TextField
                          label="快递代码"
                          registration={register(
                            `additionalShipments.${shipmentIndex}.expressCode`,
                          )}
                          error={
                            errors.additionalShipments?.[shipmentIndex]
                              ?.expressCode?.message
                          }
                        />
                      </div>
                      <ShipmentPricingFactsFields
                        idPrefix={`shipment-${shipmentIndex}`}
                        provinceRegistration={register(
                          `additionalShipments.${shipmentIndex}.destinationProvince`,
                        )}
                        provinceError={
                          errors.additionalShipments?.[shipmentIndex]
                            ?.destinationProvince?.message
                        }
                        isSfCollect={watchedIsSfCollect}
                      />
                      <TextareaField
                        label="详细地址 / 粘贴完整收货信息"
                        hint="粘贴后自动识别收货人、电话和省份；识别结果可修改"
                        required
                        registration={register(
                          `additionalShipments.${shipmentIndex}.receiverAddress`,
                        )}
                        onPaste={(event) => {
                          const parsed = parsePastedReceiverAddress(
                            pastedTextareaValue(event),
                          );
                          setValue(
                            `additionalShipments.${shipmentIndex}.receiverName`,
                            parsed.receiverName,
                            { shouldDirty: true },
                          );
                          setValue(
                            `additionalShipments.${shipmentIndex}.receiverPhone`,
                            parsed.receiverPhone,
                            { shouldDirty: true },
                          );
                          setValue(
                            `additionalShipments.${shipmentIndex}.destinationProvince`,
                            parsed.province,
                            { shouldDirty: true, shouldValidate: true },
                          );
                        }}
                        error={
                          errors.additionalShipments?.[shipmentIndex]
                            ?.receiverAddress?.message
                        }
                        rows={2}
                      />
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-medium">
                          款式分配数量
                        </legend>
                        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                          {itemsArray.fields.map((itemField, itemIndex) => (
                            <TextField
                              key={itemField.id}
                              label={`#${itemIndex + 1} ${
                                watchedItems[itemIndex]?.name || '未命名款式'
                              }`}
                              type="number"
                              min={0}
                              step={1}
                              registration={register(
                                `additionalShipments.${shipmentIndex}.itemQuantities.${itemIndex}`,
                                { valueAsNumber: true },
                              )}
                              error={
                                errors.additionalShipments?.[shipmentIndex]
                                  ?.itemQuantities?.[itemIndex]?.message
                              }
                            />
                          ))}
                        </div>
                        {errors.additionalShipments?.[shipmentIndex]
                          ?.itemQuantities?.message ? (
                          <p role="alert" className="text-sm text-destructive">
                            {
                              errors.additionalShipments[shipmentIndex]
                                .itemQuantities.message
                            }
                          </p>
                        ) : null}
                      </fieldset>
                    </li>
                  ))}
                </ol>
              )}
              <section
                className="space-y-3 border-t pt-4"
                aria-labelledby="packaging-groups-heading"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2
                      id="packaging-groups-heading"
                      className="text-base font-semibold"
                    >
                      包装组
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      填写每袋数量后自动生成袋数。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      submitting ||
                      uploading ||
                      Boolean(createdDraft) ||
                      packagingGroupsArray.fields.length >= 20
                    }
                    onClick={() =>
                      packagingGroupsArray.append({
                        name: null,
                        mode: OrderPackagingMode.SINGLE_STYLE,
                        actualBagCount: 1,
                        itemUnitsPerBag: itemsArray.fields.map(
                          (_, itemIndex) => (itemIndex === 0 ? 1 : 0),
                        ),
                      })
                    }
                  >
                    添加包装组
                  </Button>
                </div>

                {packagingGroupsArray.fields.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    暂无包装组。
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {packagingGroupsArray.fields.map((group, groupIndex) => {
                      const groupValue = watchedPackagingGroups[groupIndex];
                      const bagCount = groupValue
                        ? calculatePackagingBagCount({
                            mode: groupValue.mode,
                            itemQuantities: watchedItems.map(
                              (item) => item.quantity,
                            ),
                            itemUnitsPerBag: groupValue.itemUnitsPerBag,
                          })
                        : null;
                      return (
                        <li
                          key={group.id}
                          className="space-y-3 rounded-lg border p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-medium">
                              包装组 #{groupIndex + 1}
                              {watchedPackagingGroups[groupIndex]?.name
                                ? ` · ${watchedPackagingGroups[groupIndex]?.name}`
                                : ''}
                            </h3>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={
                                submitting || uploading || Boolean(createdDraft)
                              }
                              onClick={() =>
                                packagingGroupsArray.remove(groupIndex)
                              }
                            >
                              删除包装组
                            </Button>
                          </div>
                          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                            <TextField
                              label="包装组名称（选填）"
                              registration={register(
                                `packagingGroups.${groupIndex}.name`,
                              )}
                              error={
                                errors.packagingGroups?.[groupIndex]?.name
                                  ?.message
                              }
                            />
                            <div className="space-y-1">
                              <Label
                                htmlFor={`packagingGroups.${groupIndex}.mode`}
                              >
                                装袋方式
                              </Label>
                              <select
                                id={`packagingGroups.${groupIndex}.mode`}
                                className={selectClass}
                                {...register(
                                  `packagingGroups.${groupIndex}.mode`,
                                )}
                              >
                                <option value={OrderPackagingMode.SINGLE_STYLE}>
                                  单款装
                                </option>
                                <option value={OrderPackagingMode.MIXED_STYLE}>
                                  混装
                                </option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label>袋数</Label>
                              <div className="flex min-h-11 items-center rounded-md border bg-muted/30 px-3 text-sm font-medium tabular-nums">
                                {bagCount?.complete
                                  ? `${bagCount.bagCount.toLocaleString()} 袋`
                                  : '—'}
                              </div>
                              {bagCount && !bagCount.complete ? (
                                <p className="text-xs text-destructive">
                                  {bagCount.errors.join('；')}
                                </p>
                              ) : errors.packagingGroups?.[groupIndex]
                                  ?.actualBagCount?.message ? (
                                <p className="text-xs text-destructive">
                                  {
                                    errors.packagingGroups[groupIndex]
                                      ?.actualBagCount?.message
                                  }
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <fieldset className="space-y-2">
                            <legend className="text-sm font-medium">
                              每袋数量
                            </legend>
                            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                              {itemsArray.fields.map((itemField, itemIndex) => (
                                <TextField
                                  key={itemField.id}
                                  label={`#${itemIndex + 1} ${
                                    watchedItems[itemIndex]?.name ||
                                    '未命名款式'
                                  } / 每袋`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  registration={register(
                                    `packagingGroups.${groupIndex}.itemUnitsPerBag.${itemIndex}`,
                                    { valueAsNumber: true },
                                  )}
                                  error={
                                    errors.packagingGroups?.[groupIndex]
                                      ?.itemUnitsPerBag?.[itemIndex]?.message
                                  }
                                />
                              ))}
                            </div>
                            {errors.packagingGroups?.[groupIndex]
                              ?.itemUnitsPerBag?.message ? (
                              <p
                                role="alert"
                                className="text-sm text-destructive"
                              >
                                {
                                  errors.packagingGroups[groupIndex]
                                    ?.itemUnitsPerBag?.message
                                }
                              </p>
                            ) : null}
                          </fieldset>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {errors.packagingGroups?.message ? (
                  <p role="alert" className="text-sm text-destructive">
                    {errors.packagingGroups.message}
                  </p>
                ) : null}
              </section>
              {errors.additionalShipments?.message ? (
                <p role="alert" className="text-sm text-destructive">
                  {errors.additionalShipments.message}
                </p>
              ) : null}
            </section>
          </div>
          <OrderFormRail
            itemCount={itemsArray.fields.length}
            totalQuantity={totalQuantity}
            settlementLabel={settlementLabel}
            quoteItems={railQuoteItems}
            logistics={railLogistics}
            usesExternalSalesPricing={usesExternalSalesPricing}
            gaps={formGaps}
            onJump={jumpToGap}
          />
        </div>

        {serverGeneralError ? (
          <p role="alert" className="text-sm text-destructive">
            {serverGeneralError}
          </p>
        ) : null}
        {serverFieldErrors ? (
          <p role="alert" className="text-sm text-destructive">
            提交内容需要修正：
            {orderServerFieldErrorMessages(serverFieldErrors).join('；')}
          </p>
        ) : null}

        {createdDraft ? (
          <div
            className={
              uploadError
                ? 'rounded-lg border border-warning/50 bg-warning/10 p-4'
                : 'rounded-lg border border-primary/30 bg-primary/5 p-4'
            }
          >
            <p className="font-medium text-foreground">工单草稿已创建</p>
            {uploading && uploadProgress ? (
              <p
                role="status"
                aria-live="polite"
                className="mt-1 text-sm text-muted-foreground"
              >
                正在上传设计文件：{uploadProgress.completed} /{' '}
                {uploadProgress.total}
              </p>
            ) : null}
            {uploading &&
            !uploadProgress &&
            createdDraft.intent === 'submit' ? (
              <p
                role="status"
                aria-live="polite"
                className="mt-1 text-sm text-muted-foreground"
              >
                设计文件已处理，正在提交工单…
              </p>
            ) : null}
            {uploadError ? (
              <p
                role="alert"
                className="mt-1 break-words text-sm text-warning-foreground"
              >
                {uploadError}
              </p>
            ) : null}
            {!uploading && uploadError ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() =>
                    void finishCreatedOrder(createdDraft, pendingDesigns)
                  }
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
          </div>
        ) : null}

        <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center gap-3 border-t bg-background/95 px-1 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p>
              {formGaps.length > 0
                ? `还有 ${formGaps.length} 项必填信息；可先保存草稿，补齐后再提交。`
                : '资料已完整，可创建并提交至工厂确认。'}
            </p>
            <p role="status" aria-live="polite">
              {localDraftStatusError
                ? localDraftStatusError
                : pendingLocalDraft
                  ? '等待选择如何处理本地草稿'
                  : !localDraftReady
                    ? '正在检查本地草稿…'
                    : lastLocalDraftSavedAt
                      ? `本地草稿已保存 · ${formatLocalDraftTime(lastLocalDraftSavedAt)}`
                      : '输入后将自动保存在本机（不含设计图）'}
            </p>
          </div>
          <div className="flex-1" />
          <Button
            type="submit"
            name="creationIntent"
            value="draft"
            variant="outline"
            disabled={
              submitting ||
              uploading ||
              quoting ||
              logisticsQuoting ||
              Boolean(createdDraft)
            }
          >
            {createdDraft ? '草稿已创建' : submitting ? '保存中…' : '保存草稿'}
          </Button>
          <Button
            type="submit"
            name="creationIntent"
            value="submit"
            title={
              formGaps.length > 0
                ? `请先补齐 ${formGaps.length} 项必填信息`
                : undefined
            }
            disabled={
              submitting ||
              uploading ||
              quoting ||
              logisticsQuoting ||
              Boolean(createdDraft) ||
              formGaps.length > 0
            }
          >
            {createdDraft
              ? createdDraft.intent === 'submit'
                ? '工单已创建'
                : '草稿已创建'
              : submitting
                ? '创建并提交中…'
                : formGaps.length > 0
                  ? `创建并提交（还差 ${formGaps.length} 项）`
                  : '创建并提交'}
          </Button>
          <Link
            href="/orders"
            aria-disabled={pendingState.lockNavigation || undefined}
            tabIndex={pendingState.lockNavigation ? -1 : undefined}
            onClick={
              pendingState.lockNavigation
                ? (event) => event.preventDefault()
                : undefined
            }
            className={`${buttonVariants({ variant: 'outline' })} ${
              pendingState.lockNavigation
                ? 'pointer-events-none cursor-not-allowed opacity-50'
                : ''
            }`}
          >
            返回列表
          </Link>
        </div>
          </>
        )}
      </fieldset>
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
            externalTotal === null
              ? '总价由工厂确认'
              : formatOrderCurrency(externalTotal)
          }
          totalRequiresManualQuote={externalRequiresManualQuote}
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
              : externalRequiresManualQuote
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
              externalRequiresManualQuote,
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

function StringListField({
  id,
  label,
  hint,
  value,
  disabled,
  error,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string[];
  disabled?: boolean;
  error?: string;
  onChange: (value: string[]) => void;
  onBlur: () => void;
}) {
  const valueKey = value.join('、');
  function commit(rawValue: string) {
    onChange(
      [
        ...new Set(rawValue.split(/[,，、\n]+/).map((entry) => entry.trim())),
      ].filter(Boolean),
    );
    onBlur();
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        key={valueKey}
        id={id}
        defaultValue={valueKey}
        disabled={disabled}
        placeholder="例如：红、黑"
        aria-invalid={Boolean(error)}
        aria-describedby={
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        onBlur={(event) => commit(event.currentTarget.value)}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function ShipmentPricingFactsFields({
  idPrefix,
  provinceRegistration,
  provinceError,
  isSfCollect,
}: {
  idPrefix: string;
  provinceRegistration: Registration;
  provinceError?: string;
  isSfCollect: boolean;
}) {
  return (
    <div className="max-w-sm">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${idPrefix}-province`}>省份</Label>
        <select
          id={`${idPrefix}-province`}
          className={selectClass}
          disabled={isSfCollect}
          aria-invalid={Boolean(provinceError)}
          aria-describedby={
            provinceError
              ? `${idPrefix}-province-error`
              : `${idPrefix}-province-hint`
          }
          {...provinceRegistration}
        >
          <option value="">— 请选择；未覆盖地区留空 —</option>
          {ZTO_PROVINCE_OPTIONS.map((province) => (
            <option key={province} value={province}>
              {province}
            </option>
          ))}
        </select>
        {provinceError ? (
          <p
            id={`${idPrefix}-province-error`}
            role="alert"
            className="text-xs text-destructive"
          >
            {provinceError}
          </p>
        ) : (
          <p
            id={`${idPrefix}-province-hint`}
            className="text-xs text-muted-foreground"
          >
            {isSfCollect
              ? '顺丰到付时不计物流费。'
              : '未覆盖地区可留空，创建后由管理员终价。'}
          </p>
        )}
      </div>
    </div>
  );
}

function LogisticsQuoteFeedback({
  view,
  stale,
}: {
  view: LogisticsQuoteViewState | null;
  stale: boolean;
}) {
  if (!view) return null;
  if (stale) {
    return (
      <p
        role="status"
        className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground"
      >
        信息已变化，正在重新核价。
      </p>
    );
  }
  if (view.error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
      >
        {view.error}
      </p>
    );
  }
  const quote = view.result;
  if (!quote) return null;
  return (
    <div
      role="status"
      className={
        quote.complete
          ? 'rounded-md border border-success/40 bg-success/10 p-3 text-xs'
          : 'rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground'
      }
    >
      <p className="font-medium text-foreground">
        {quote.complete
          ? `自动核价完成：快递 ¥${quote.suggestedShippingTotal}，纸箱 ¥${quote.suggestedPackagingTotal}`
          : '部分规则无法确定，创建后将进入管理员终价'}
      </p>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {quote.shipments.map((shipment) => (
          <li key={shipment.shipmentKey} className="break-words">
            地址 {shipment.shipmentKey}：快递{' '}
            {shipment.shipping.amount === null
              ? '需人工确认'
              : `¥${shipment.shipping.amount}`}
            {' · '}纸箱{' '}
            {shipment.packaging.amount === null
              ? '需人工确认'
              : `¥${shipment.packaging.amount}`}
          </li>
        ))}
      </ul>
      {quote.errors.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {quote.errors.map((error) => (
            <li key={error} className="break-words">
              {error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function QuoteFeedback({
  presentation,
  view,
  stale,
}: {
  presentation: 'external-auto' | 'internal-editable';
  view: QuoteViewState | undefined;
  stale: boolean;
}) {
  const externalAuto = presentation === 'external-auto';
  if (!view) return null;
  if (stale) {
    return (
      <p
        role="status"
        className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground"
      >
        {externalAuto
          ? '信息已变化，正在重新核价。'
          : '产品、数量或工艺条件已改变，请重新计算建议价。'}
      </p>
    );
  }
  if (view.error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
      >
        {view.error}
      </p>
    );
  }
  const quote = view.result;
  if (!quote) return null;
  const quoteBook = quote.snapshot.priceBook;
  const quoteMetadata = quoteBook
    ? `${quote.snapshot.quotedAt ? `报价日期 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(quote.snapshot.quotedAt))} · ` : ''}币种 ${quoteBook.currency ?? 'CNY'} · 报价版本 ${quoteBook.name} 第 ${quoteBook.version} 版`
    : null;
  if (!quote.complete) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
        <p className="font-medium">
          {externalAuto
            ? '未匹配到完整价格；创建后由管理员定价。'
            : '规则不完整，未自动改动成交价'}
        </p>
        {quoteMetadata ? (
          <p className="mt-1 text-muted-foreground">{quoteMetadata}</p>
        ) : null}
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {quote.errors.map((error) => (
            <li key={error} className="break-words">
              {error}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="rounded-md border border-success/40 bg-success/10 p-3 text-xs"
    >
      <p className="font-medium text-foreground">
        {externalAuto ? (
          <>自动核价完成：本款加工费 ¥{quote.suggestedSubtotal}</>
        ) : (
          <>
            建议小计 ¥{quote.suggestedSubtotal}：成交单价 ¥
            {quote.suggestedUnitPrice} + 一次性费用 ¥{quote.suggestedFixedFee}
          </>
        )}
      </p>
      {quoteMetadata ? (
        <p className="mt-1 text-muted-foreground">{quoteMetadata}</p>
      ) : null}
      <ul className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
        {quote.components.map((component, index) => (
          <li key={`${component.sourceId ?? component.source}-${index}`}>
            {externalPriceRuleDisplayName(component.name)}：¥{component.rate} ×{' '}
            {component.units} = ¥{component.amount}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CraftToggleGrid({
  crafts,
  selected,
  disabled,
  locked,
  onToggle,
  compact = false,
}: {
  crafts: CraftOption[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  locked: ReadonlySet<string>;
  onToggle: (craftId: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? 'grid grid-cols-2 gap-2 sm:grid-cols-4'
          : 'mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4'
      }
    >
      {crafts.map((craft) => {
        const checked = selected.has(craft.id);
        const isLocked = locked.has(craft.id);
        return (
          <Button
            key={craft.id}
            type="button"
            aria-pressed={checked}
            disabled={disabled || isLocked}
            variant="outline"
            size="lg"
            className={
              checked
                ? 'min-h-11 min-w-0 shrink items-center justify-start gap-2 whitespace-normal rounded-lg border-primary bg-primary/10 px-3 py-2 text-left text-xs font-medium text-primary hover:bg-primary/15 hover:text-primary'
                : 'min-h-11 min-w-0 shrink items-center justify-start gap-2 whitespace-normal rounded-lg border-input bg-background px-3 py-2 text-left text-xs text-foreground hover:bg-muted'
            }
            onClick={() => onToggle(craft.id)}
          >
            <span
              aria-hidden="true"
              className={
                checked
                  ? 'flex size-4 shrink-0 items-center justify-center rounded border border-primary bg-primary text-[10px] text-primary-foreground'
                  : 'block size-4 shrink-0 rounded border border-input'
              }
            >
              {checked ? '✓' : ''}
            </span>
            <span className="min-w-0 flex-1 break-words">{craft.name}</span>
            {craft.isOutsource ? (
              <span className="shrink-0 rounded bg-warning/10 px-1 py-0.5 text-xs text-warning-foreground">
                外协
              </span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}

type Registration = ReturnType<
  ReturnType<typeof useForm<CreateOrderInput>>['register']
>;

function TextField({
  label,
  hint,
  required,
  error,
  registration,
  type = 'text',
  min,
  step,
  full,
}: {
  label: string;
  hint?: string;
  /**
   * 画红星 **并且** 把 required 透传给控件。两件事必须一起做：
   * 之前只画星不透传，读屏器把「款式名」「数量」念成普通选填输入框。
   *
   * 和 <form noValidate> 不冲突：noValidate 关掉的是 HTML 表单提交算法里
   * 的 "interactively validate the constraints" 那一步（也就是原生气泡），
   * 不是 required 属性本身的语义。加上 required 之后仍然：
   *   - 提交时不弹任何原生气泡，错误照旧来自服务端 Zod / RHF resolver；
   *   - required 进无障碍树，读屏器念「必填」；
   *   - :required / :invalid 伪类开始匹配 —— 本仓库 globals.css 与
   *     components/** 里没有任何样式钩这两个伪类，所以零视觉影响。
   * 同一组合（noValidate + required 透传）在 CraftForm / ProductForm /
   * PartyForm / PriceTierForm / AccountForm 等 15 份后台表单里已经在跑。
   */
  required?: boolean;
  error?: string | undefined;
  registration: Registration;
  type?: string;
  min?: number;
  step?: number;
  full?: boolean;
}) {
  const fieldId = registration.name;
  const messageId = `${fieldId}-message`;
  return (
    <div className={`min-w-0 space-y-1${full ? ' sm:col-span-2' : ''}`}>
      <Label htmlFor={fieldId}>
        {label}
        {/* 星号只是给看得见的人的视觉记号，必填语义由下面的 required /
            aria-required 承担，所以这里 aria-hidden，免得读屏器把标签念成
            「款式名 星号」。写法对齐同文件的 ShipmentPricingFactsFields。 */}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            {' *'}
          </span>
        ) : null}
      </Label>
      <Input
        id={fieldId}
        type={type}
        min={min}
        step={step}
        required={required}
        aria-required={required ? true : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? messageId : undefined}
        {...registration}
      />
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function TextareaField({
  label,
  hint,
  required,
  tone = 'default',
  rows = 2,
  error,
  registration,
  onPaste,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  tone?: 'default' | 'destructive';
  rows?: number;
  error?: string | undefined;
  registration: Registration;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
}) {
  const fieldId = registration.name;
  const messageId = `${fieldId}-message`;
  const destructive = tone === 'destructive';
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={fieldId}>
        {label}
        {/* 同 TextField：星号不进无障碍名，必填由 required 表达。 */}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            {' *'}
          </span>
        ) : null}
      </Label>
      <textarea
        id={fieldId}
        rows={rows}
        required={required}
        aria-required={required ? true : undefined}
        className={
          destructive
            ? 'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-semibold text-destructive shadow-xs caret-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
            : 'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
        }
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? messageId : undefined}
        {...registration}
        onPaste={onPaste}
      />
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
