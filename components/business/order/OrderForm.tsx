'use client';
import {
  isMixedPackaging,
  packagingModeWithStyleCount,
  packagingType,
  packagingBoxType,
  packagingCapacity,
  packagingUnit,
  packagingShipmentQuantities,
} from '@/lib/order/packaging-mode';
import { WorkbenchOrderTransfer } from './WorkbenchOrderTransfer';
import { LocalOrderDrafts } from './LocalOrderDrafts';
import { ActionNotice } from '@/components/ui-business';
import type { WorkbenchItemQuoteInput } from '@/lib/workbench/item-quote';
import { orderItemSelectionUpdate, type OrderItemSelectionChange } from '@/lib/order/order-item-selection';
import { OrderItemProductField } from './order-form-b/OrderItemFields';
import { FieldError } from './order-form-b/OrderFieldPrimitives';
import { externalOrderCatalogCandidates } from '@/lib/order/order-item-catalog';
import { orderItemFieldOptions } from './order-item-field-options';
import {
  createBlankItem,
  createExternalOrderItem,
  normalizeExternalOrderItem,
  resolveExternalOrderCraftIds,
} from '@/lib/order/order-item-configuration';

import { externalShipmentContactIssues } from '@/lib/order/external-shipment-contact';

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
import { formatMoney } from '@/lib/dashboard/format';
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
  externalOrderPaperFromType,
  externalOrderSpecificationLabel,
  type ExternalOrderPaperKey,
} from './external-order-b-catalog';
import {
  collectOrderFormGaps,
  type OrderFormQuoteStatus,
} from './order-form-gaps';
import {
  LocalOrderFormDraft,
  localOrderFormDraftStorageKey,
  needsOrderItemLaminationSelection,
  parseLocalOrderFormDraft,
  resolveNextOrderItemFig,
  serializeLocalOrderFormDraft,
} from './order-form-local-draft';
import {
  ORDER_PRICING_ROUTE_LABELS,
  isLegacyStockFoilCraft,
  productCategoryMatchesPricingRoute,
} from '@/lib/order/pricing-route';
import { calculateCreateOrderBagCount } from '@/lib/order/create-order-packaging';
import type { ExternalSalesAccountOption } from '@/lib/order/external-sales-association';
import { ORDER_SETTLEMENT_LABELS } from '@/lib/order/settlement';
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
  workbenchTransferId?: string;
  crafts: readonly CraftOption[];
  products: readonly ProductOption[];
  customers?: readonly CustomerPartyOption[];
  externalSalesAccounts?: readonly ExternalSalesAccountOption[];
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
        mode: packagingModeWithStyleCount(group.mode, selectedItemCount),
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
    plateGroupId: null,
    pricingGroup: null,
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
  externalSalesAccounts,
  settlementLabel: defaultSettlementLabel,
  settlementType,
  externalCreateOrderOptions,
  initialExternalPriceSnapshot,
  draftScope,
  workbenchTransferId,
}: Props) {
  const isExternalSalesActor = settlementType === OrderSettlementType.EXTERNAL_SALES;
  const canAssignExternalSales = externalSalesAccounts !== undefined;
  const router = useRouter();
  const initialItem = useMemo(() => {
    const firstFoil = externalCreateOrderOptions?.foilColors[0]?.name;
    const item = createExternalOrderItem(
      crafts, products, externalCreateOrderOptions?.papers ?? [], firstFoil,
    );
    if (!isExternalSalesActor) return item;
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
    isExternalSalesActor,
  ]);
  const [clientSubmissionId] = useState(() => globalThis.crypto.randomUUID());
  const form = useForm<CreateOrderInput>({
    // zodResolver's generics don't fully compose with preprocess-bearing
    // schemas (moneyOptionalField uses `z.preprocess`, which splits
    // z.input / z.output). The runtime contract still holds — we just
    // widen the compile-time seam.
    resolver: zodResolver(createOrderSchema) as never,
    mode: 'onBlur',
    // The external editor owns one explicit error-navigation request per submit.
    shouldFocusError: !isExternalSalesActor,
    defaultValues: {
      ...initialOrderFormValues(clientSubmissionId, initialItem),
      externalSalesUserId: null,
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
  const watchedExternalSalesUserId = useWatch({
    control,
    name: 'externalSalesUserId',
  });
  const usesExternalSalesPricing =
    isExternalSalesActor ||
    (canAssignExternalSales && Boolean(watchedExternalSalesUserId));
  const settlementLabel = usesExternalSalesPricing
    ? ORDER_SETTLEMENT_LABELS.EXTERNAL_SALES
    : defaultSettlementLabel;
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
  const [errorFocusRequest, setErrorFocusRequest] = useState(0);
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
    readyForProduction: boolean;
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
  const [transferReady, setTransferReady] = useState(!workbenchTransferId);
  const existingLocalDraftKey = localOrderFormDraftStorageKey(
    draftScope,
    isExternalSalesActor,
  );
  const localDraftStorageKey = workbenchTransferId
    ? `${existingLocalDraftKey}:workbench:${workbenchTransferId}`
    : existingLocalDraftKey;
  const localDraftPricingScope = isExternalSalesActor
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
  const localDraftReady = hydrated && pendingLocalDraft === null && transferReady;
  const missingLaminationIndex = watchedItems.findIndex(
    needsOrderItemLaminationSelection,
  );
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
        return false;
      }
      try {
        window.localStorage.setItem(localDraftStorageKey, serialized);
        setLocalDraftDecisionComplete(true);
        setLastLocalDraftSavedAt(savedAt.toISOString());
        setLocalDraftError(null);
        return true;
      } catch {
        setLocalDraftError('本地草稿保存失败，请不要在创建工单前关闭页面。');
        return false;
      }
    },
    [localDraftPricingScope, localDraftStorageKey],
  );

  useEffect(() => {
    itemFieldIdsRef.current = itemsArray.fields.map((field) => field.id);
  }, [itemsArray.fields]);

  useEffect(() => {
    if (!usesExternalSalesPricing || !pendingLocalDraft || !transferReady) return;
    const timer = window.setTimeout(() => {
      nextItemFigRef.current = resolveNextOrderItemFig(
        pendingLocalDraft.values,
      );
      reset({
        ...(pendingLocalDraft.values as unknown as CreateOrderInput),
        clientSubmissionId,
      });
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
  }, [clientSubmissionId, pendingLocalDraft, reset, usesExternalSalesPricing, transferReady]);

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
    let readyForProduction = false;
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
        readyForProduction = submitResult.readyForProduction === true;
        submittedManualQuote =
          submitResult.quotedFeeCompleteness ===
          OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS;
      }

      if (usesExternalSalesPricing && draft.intent === 'submit') {
        setSubmittedOrder({
          orderId: draft.orderId,
          orderNo: draft.orderNo,
          manualQuote: submittedManualQuote,
          readyForProduction,
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

  function applyWorkbenchTransfer(input: WorkbenchItemQuoteInput): string | null {
    const requested = { ...createBlankItem(crafts), ...input.item };
    const normalized = normalizeExternalOrderItem({
      item: requested,
      crafts,
      products,
      paperMaterials: externalCreateOrderOptions?.papers,
      preserveCustomSize: true,
    });
    const facts = (item: CreateOrderInput['items'][number]) =>
      JSON.stringify([
        item.productId,
        item.pricingRoute,
        item.specification,
        item.paperType,
        item.paperWeightGsm,
        item.frontFoilColors,
        item.backFoilColors,
        item.foilTechnique,
        item.hasLocalFoil,
        item.lamination,
        item.actualWidthMm,
        item.actualHeightMm,
      ]);
    if (facts(normalized) !== facts(requested))
      return '产品资料已变更，请返回工作台重新选择';
    const values = initialOrderFormValues(clientSubmissionId, normalized);
    if (!persistLocalDraftValues(values))
      return '报价条件保存失败，请释放浏览器存储空间后返回工作台重试';
    reset(values);
    setLocalDraftDecisionComplete(true);
    setTransferReady(true);
    return null;
  }

  function restoreLocalDraft() {
    if (!pendingLocalDraft) return;
    nextItemFigRef.current = resolveNextOrderItemFig(
      pendingLocalDraft.values,
    );
    const restoredValues = {
      ...(pendingLocalDraft.values as unknown as CreateOrderInput),
      clientSubmissionId,
    };
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
        ...(canAssignExternalSales
          ? { customerPartyId: null, customerRef: null }
          : {}),
        items: data.items.map((item) => ({
          ...item,
          plateGroupId: null,
          pricingGroup: null,
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
            ? {
                ...buildExternalCreateOrderPayload(submittedData),
                ...(canAssignExternalSales
                  ? { externalSalesUserId: submittedData.externalSalesUserId }
                  : {}),
              }
            : submittedData,
        ),
      );
      setState(result);
      if (result.status !== 'success') {
        setErrorFocusRequest((current) => current + 1);
        return;
      }

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
    issues.push(...externalShipmentContactIssues(data.additionalShipments).map((issue) => issue.message));
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
    if (!localDraftReady || data.items.some(needsOrderItemLaminationSelection))
      return;
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
        setErrorFocusRequest((current) => current + 1);
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
    setErrorFocusRequest((current) => current + 1);
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
      (group) => isMixedPackaging(group.mode),
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
      (group) => isMixedPackaging(group.mode),
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
        mode: groups.find((group) => (group.itemUnitsPerBag[index] ?? 0) > 0)?.mode ?? OrderPackagingMode.SINGLE_STYLE,
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
        plateGroupId: null,
        pricingGroup: null,
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

  function changeItemSelection(index: number, change: OrderItemSelectionChange) {
    const selected = orderItemSelectionUpdate(
      getValues(`items.${index}`),
      change,
      products,
      externalCreateOrderOptions,
    );
    if (!selected) return;
    if (change.type === 'customSize') {
      setValue(`items.${index}`, selected.item, {
        shouldDirty: true,
        shouldValidate: true,
      });
    } else {
      commitOrderFormBItem(index, selected.item, selected.options);
    }
  }
  const changeExternalRoute = (index: number, value: OrderItemPricingRoute) =>
    changeItemSelection(index, { type: 'route', value });
  const changeExternalPaper = (index: number, value: string) =>
    changeItemSelection(index, { type: 'paper', value });
  const changeExternalWeight = (index: number, value: number) =>
    changeItemSelection(index, { type: 'weight', value });
  const changeExternalSpecification = (index: number, value: string) =>
    changeItemSelection(index, { type: 'specification', value });
  const changeExternalFoilSides = (
    index: number,
    front: string[],
    back: string[],
  ) => changeItemSelection(index, { type: 'foil', front, back });
  const changeExternalFoilTechnique = (
    index: number,
    value: OrderFoilTechnique,
  ) => changeItemSelection(index, { type: 'technique', value });
  const changeExternalCustomSize = (index: number, value: boolean) =>
    changeItemSelection(index, { type: 'customSize', value });
  const changeExternalPrintFoilMode = (
    index: number,
    value: 'NONE' | 'PARTIAL' | 'FULL',
  ) => changeItemSelection(index, { type: 'printFoil', value });

  function changeExternalPackagingMode(mode: OrderPackagingMode) {
    const items = getValues('items');
    const groups = getValues('packagingGroups');
    const previousMode = groups[0]?.mode ?? OrderPackagingMode.SINGLE_STYLE;
    const switchingType =
      packagingType(mode) !== packagingType(previousMode) ||
      packagingBoxType(mode) !== packagingBoxType(previousMode);
    const capacity = packagingCapacity(mode) ?? 10;
    const units = items.map((_, index) => {
      const previous =
        groups.find((group) => (group.itemUnitsPerBag[index] ?? 0) > 0)?.itemUnitsPerBag[index] ?? 10;
      return switchingType ? Math.min(previous, capacity) : previous;
    });
    if (isMixedPackaging(mode) && items.length < 2) return;
    const next = isMixedPackaging(mode)
      ? [{ name: null, mode, actualBagCount: 1, itemUnitsPerBag: units }]
      : items.map((_, index) => ({
          name: null,
          mode,
          actualBagCount: mode === OrderPackagingMode.UNPACKED ? 0 : 1,
          itemUnitsPerBag: items.map((__, candidate) => (candidate === index ? units[index] : 0)),
        }));
    items.forEach((_, index) =>
      setValue(`items.${index}.pack`, mode === OrderPackagingMode.UNPACKED ? null : units[index], {
        shouldDirty: true,
      }),
    );
    setValue('packagingGroups', next, { shouldDirty: true, shouldValidate: true });
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
        : groups[0] && isMixedPackaging(groups[0].mode)
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
  const packagingShipments = useMemo(() => packagingShipmentQuantities(watchedItems, watchedShipments), [watchedItems, watchedShipments]);
  const packagingBagFactsKey = JSON.stringify({
    shipmentQuantities: packagingShipments,
    itemQuantities: watchedItems.map((item) => item.quantity),
    groups: watchedPackagingGroups.map((group) => ({
      mode: group.mode,
      itemUnitsPerBag: group.itemUnitsPerBag,
    })),
  });
  useEffect(() => {
    watchedPackagingGroups.forEach((group, groupIndex) => {
      const result = calculateCreateOrderBagCount({
        mode: group.mode,
        itemQuantities: watchedItems.map((item) => item.quantity),
        itemUnitsPerBag: group.itemUnitsPerBag,
        shipmentQuantities: packagingShipments,
      });
      if (result.complete && result.bagCount !== group.actualBagCount) {
        setValue(
          `packagingGroups.${groupIndex}.actualBagCount`,
          result.bagCount,
          { shouldDirty: true, shouldValidate: true },
        );
      }
    });
  }, [packagingBagFactsKey, packagingShipments, setValue, watchedItems, watchedPackagingGroups]);

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
    logistics: JSON.stringify(packagingShipments),
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
        logistics: JSON.stringify(packagingShipmentQuantities(values.items, values.additionalShipments)),
        openedPriceVersion: null,
      }),
      settlementType,
      shipmentQuantities: packagingShipmentQuantities(values.items, values.additionalShipments),
      items: values.items.map(internalOrderItemQuoteFacts),
      orderItemCount: values.items.length,
      packagingGroups: packaging.groups,
    };
  }, [currentPackagingQuoteInput, getValues, settlementType]);
  const currentInternalQuoteRequestReady =
    missingLaminationIndex < 0 &&
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
        (group.mode === OrderPackagingMode.UNPACKED ? group.actualBagCount === 0 : group.actualBagCount >= 1),
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
    missingLaminationIndex < 0 &&
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
        (group.mode === OrderPackagingMode.UNPACKED ? group.actualBagCount === 0 : group.actualBagCount >= 1),
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
    requiresCustomerRef: !canAssignExternalSales,
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
          : watchedShipments.length > 0
            ? `快递费 中通 · ${watchedShipments.length + 1} 个地址`
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
    label: watchedPackagingGroups.every((group) => group.mode === OrderPackagingMode.UNPACKED) ? '不包装' : watchedPackagingGroups.map((group) => group.mode === OrderPackagingMode.UNPACKED ? '不包装' : `${packagingBoxType(group.mode) ? '装盒' : '入袋'} ${group.actualBagCount}${packagingUnit(group.mode)}`).join('、'),
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
            packagingGroup?.mode === OrderPackagingMode.UNPACKED ? '不包装' : unitsPerBag > 0 && packagingGroup
              ? `${unitsPerBag}个/${packagingUnit(packagingGroup.mode)}，共 ${packagingGroup.actualBagCount.toLocaleString('zh-CN')} ${packagingUnit(packagingGroup.mode)}`
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
            paper?.appearance === 'coated' &&
            item.lamination === OrderLamination.MATTE
              ? [{ label: '覆亚膜' }]
              : []),
            ...(packagingGroup && isMixedPackaging(packagingGroup.mode)
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
              ? formatMoney(quote.amount)
              : '待核价',
          manualQuoteReasons,
        };
      })
    : [];
  const activeExternalItem =
    watchedItems[expandedItem] ?? watchedItems[0] ?? initialItem;
  const internalAdditionalCraftOptions = additionalOrderCraftOptions(crafts);
  const {
    activeExternalPaper,
    externalPaperOptions,
    externalFoilOptions,
    externalWeightOptions,
    externalSpecificationOptions,
  } = orderItemFieldOptions(
    activeExternalItem,
    products,
    externalCreateOrderOptions,
  );
  const activeMixedPackagingGroup = watchedPackagingGroups.find(
    (group) => isMixedPackaging(group.mode),
  );
  const activePackagingGroup =
    activeMixedPackagingGroup ??
    watchedPackagingGroups.find(
      (group) => (group.itemUnitsPerBag[expandedItem] ?? 0) > 0,
    ) ??
    watchedPackagingGroups[expandedItem];
  const activePackagingBagCount = activePackagingGroup
    ? calculateCreateOrderBagCount({
        mode: activePackagingGroup.mode,
        itemQuantities: watchedItems.map((item) => item.quantity),
        itemUnitsPerBag: activePackagingGroup.itemUnitsPerBag,
        shipmentQuantities: packagingShipments,
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
        errors.remark?.message ? `工单备注：${errors.remark.message}` : null,
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
          submittedOrder.readyForProduction ? '待下发生产' : '待处理'
        }
        description={
          submittedOrder.manualQuote
            ? '这张单含系统暂时无法定价的参数，工厂核价后会通知你。核价前不会安排生产。'
            : '工单已提交，资料与费用完整后进入待下发生产。可从详情查看当前进度。'
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
      {workbenchTransferId ? (
        <WorkbenchOrderTransfer
          id={workbenchTransferId}
          scope={draftScope}
          existingDraftKey={existingLocalDraftKey}
          transferDraftKey={localDraftStorageKey}
          pricingScope={localDraftPricingScope}
          onApply={applyWorkbenchTransfer}
          onContinue={() => setTransferReady(true)}
        />
      ) : null}
      {!createdDraft ? (
        <LocalOrderDrafts
          baseKey={existingLocalDraftKey}
          pricingScope={localDraftPricingScope}
          currentId={workbenchTransferId}
          onNavigate={() =>
            !submitting && !uploading &&
            (!isDirty || !localDraftReady || persistLocalDraftValues(getValues()))
          }
        />
      ) : null}
      {localDraftReady && missingLaminationIndex >= 0 ? (
        <ActionNotice
          tone="warning"
          title={`第 ${missingLaminationIndex + 1} 款覆膜资料缺失，请重新选择覆膜`}
          action={
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={(event) => {
                const formElement = event.currentTarget.closest('form');
                setExpandedItem(missingLaminationIndex);
                window.requestAnimationFrame(() => {
                  formElement
                    ?.querySelector<HTMLElement>('button[id$="-lamination-MATTE"]')
                    ?.focus();
                });
              }}
            >
              选择覆膜
            </Button>
          }
        />
      ) : null}
      {pendingLocalDraft && !isExternalSalesActor ? (
        <LocalDraftPromptSection {...{
          pendingLocalDraft: pendingLocalDraft, restoreLocalDraft: restoreLocalDraft, discardLocalDraft: discardLocalDraft,
        }} />
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
              !isExternalSalesActor ? (
                <div
                  data-slot="order-form-order-extras"
                  className="mt-4 grid min-w-0 grid-cols-1 gap-3.5 @min-[560px]:grid-cols-2"
                >
                  {canAssignExternalSales ? (
                    <div className="@min-[560px]:col-span-2">
                      <Label htmlFor="externalSalesUserId">
                        关联外部销售（选填）
                      </Label>
                      <select
                        id="externalSalesUserId"
                        className={`${selectClass} mt-2`}
                        aria-invalid={Boolean(errors.externalSalesUserId)}
                        {...register('externalSalesUserId', {
                          setValueAs: (value) => (value === '' ? null : value),
                        })}
                        onChange={(event) => {
                          setValue(
                            'externalSalesUserId',
                            event.target.value || null,
                            { shouldDirty: true, shouldValidate: true },
                          );
                          invalidateStructuralQuotes();
                        }}
                      >
                        <option value="">工厂直接业务</option>
                        {externalSalesAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.displayName} · {account.username}
                          </option>
                        ))}
                      </select>
                      <FieldError reservedLines={1}>
                        {errors.externalSalesUserId?.message}
                      </FieldError>
                    </div>
                  ) : (
                    <>
                      <div>
                        <Label htmlFor="customerPartyId">关联客户（选填）</Label>
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
                        <FieldError reservedLines={1}>
                          {errors.customerRef?.message}
                        </FieldError>
                      </div>
                    </>
                  )}
                  <div>
                    <Label htmlFor="promisedDate">承诺交期</Label>
                    <Input
                      id="promisedDate"
                      type="date"
                      className="mt-2 h-10"
                      aria-invalid={Boolean(errors.promisedDate)}
                      {...register('promisedDate')}
                    />
                    <FieldError reservedLines={1}>
                      {errors.promisedDate?.message as string | undefined}
                    </FieldError>
                  </div>
                  <UrgentOrderField
                    control={control}
                    disabled={orderFormControlsDisabled}
                  />
                </div>
              ) : undefined
            }
            materialExtras={
              <>
                {!usesExternalSalesPricing ? (
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
                  </div>
                ) : null}
                <OrderItemProductField
                  value={activeExternalItem.productId}
                  products={externalOrderCatalogCandidates(
                    products,
                    activeExternalItem.pricingRoute,
                    activeExternalItem.paperType ?? '',
                    activeExternalItem.specification ?? '',
                  )}
                  disabled={orderFormControlsDisabled}
                  onChange={(productId) =>
                    setValue(`items.${expandedItem}.productId`, productId, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              </>
            }
            pricingExtras={
              !usesExternalSalesPricing ? (
                <section
                  aria-label="内部生产信息"
                  className="mt-4 border-t pt-4"
                >
                  <div className="grid min-w-0 grid-cols-1 gap-3.5 @min-[560px]:grid-cols-2">
                    <div className="@min-[560px]:col-span-2">
                      <Label htmlFor={`items.${expandedItem}.manualQuoteReason`}>
                        需人工核价的要求（选填）
                      </Label>
                      <Textarea
                        id={`items.${expandedItem}.manualQuoteReason`}
                        className="mt-2 min-h-20"
                        placeholder="选项中没有所需纸张、规格或工艺时，请在此填写具体要求"
                        aria-invalid={Boolean(
                          errors.items?.[expandedItem]?.manualQuoteReason,
                        )}
                        {...register(`items.${expandedItem}.manualQuoteReason`)}
                      />
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
                      <legend className="text-xs font-extrabold tracking-[0.18em] text-muted-foreground">
                        附加工艺（选填）
                      </legend>
                      <p className="mt-2 text-xs text-muted-foreground">
                        选择额外工序。
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
            packagingExtras={
              <div className="space-y-2">
                <Label htmlFor="packageRequirement">包装补充说明（选填）</Label>
                <Input
                  id="packageRequirement"
                  maxLength={500}
                  disabled={orderFormControlsDisabled}
                  aria-describedby="packageRequirement-hint"
                  aria-invalid={Boolean(errors.packageRequirement)}
                  {...register('packageRequirement')}
                />
                <FieldError
                  id="packageRequirement-hint"
                  reservedLines={2}
                  hint="用于封口、贴标等补充要求；包装数量和费用以包装明细为准。"
                >
                  {errors.packageRequirement?.message}
                </FieldError>
              </div>
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
                </div>
              ) : undefined
            }
            footerExtras={
              <section className="mt-4 border-t pt-4">
                <Label htmlFor="remark">工单备注（选填）</Label>
                <Textarea id="remark" maxLength={1000} className="mt-2 min-h-24"
                  disabled={orderFormControlsDisabled} aria-invalid={Boolean(errors.remark)}
                  aria-describedby={errors.remark ? 'order-remark-error' : undefined}
                  {...register('remark')} />
                <FieldError id="order-remark-error" reservedLines={1}>
                  {errors.remark?.message}
                </FieldError>
              </section>
            }
            afterShipping={
                <fieldset
                  disabled={orderFormControlsDisabled}
                  aria-label="多地址发货"
                  className="mt-4 border-t pt-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xs font-extrabold tracking-[0.2em] text-muted-foreground">
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
                      {shipmentsArray.fields.length >= 9 ? '已达 10 个地址' : `添加地址 ${shipmentsArray.fields.length + 2}`}
                    </Button>
                  </div>
                  {shipmentsArray.fields.length > 0 ? (
                    <ol className="mt-4 space-y-4">
                      {shipmentsArray.fields.map((shipment, shipmentIndex) => (
                        <li key={shipment.id} className="rounded-xl border p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm font-extrabold">
                              地址 {shipmentIndex + 2}
                            </h3>
                            <Button
                              type="button"
                              variant="outline"
                              className="text-destructive"
                              disabled={orderFormControlsDisabled}
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
                                required={usesExternalSalesPricing}
                                aria-invalid={usesExternalSalesPricing && externalValidationVisible && !watchedShipments[shipmentIndex]?.receiverName?.trim()}
                                aria-describedby={usesExternalSalesPricing && externalValidationVisible && !watchedShipments[shipmentIndex]?.receiverName?.trim() ? `extra-${shipmentIndex}-receiverName-error` : undefined}
                                className="mt-2 h-10"
                                {...register(
                                  `additionalShipments.${shipmentIndex}.receiverName`,
                                )}
                              />
                              <FieldError id={`extra-${shipmentIndex}-receiverName-error`} reservedLines={1}>
                                {usesExternalSalesPricing && externalValidationVisible && !watchedShipments[shipmentIndex]?.receiverName?.trim() ? '请填写收件人' : undefined}
                              </FieldError>
                            </div>
                            <div>
                              <Label
                                htmlFor={`additionalShipments.${shipmentIndex}.receiverPhone`}
                              >
                                联系电话
                              </Label>
                              <Input
                                id={`additionalShipments.${shipmentIndex}.receiverPhone`}
                                required={usesExternalSalesPricing}
                                aria-invalid={usesExternalSalesPricing && externalValidationVisible && !watchedShipments[shipmentIndex]?.receiverPhone?.trim()}
                                aria-describedby={usesExternalSalesPricing && externalValidationVisible && !watchedShipments[shipmentIndex]?.receiverPhone?.trim() ? `extra-${shipmentIndex}-receiverPhone-error` : undefined}
                                className="mt-2 h-10"
                                {...register(
                                  `additionalShipments.${shipmentIndex}.receiverPhone`,
                                )}
                              />
                              <FieldError id={`extra-${shipmentIndex}-receiverPhone-error`} reservedLines={1}>
                                {usesExternalSalesPricing && externalValidationVisible && !watchedShipments[shipmentIndex]?.receiverPhone?.trim() ? '请填写联系电话' : undefined}
                              </FieldError>
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
                              <FieldError reservedLines={1}>
                                {errors.additionalShipments?.[shipmentIndex]?.receiverAddress?.message}
                              </FieldError>
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
                            <FieldError reservedLines={2}>
                              {errors.additionalShipments?.[shipmentIndex]?.itemQuantities?.message}
                            </FieldError>
                          </fieldset>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </fieldset>
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
            errorFocusRequest={errorFocusRequest}
            rail={
              <OrderFormBRail
                itemCount={itemsArray.fields.length}
                quoteItems={railQuoteItems}
                packaging={railPackaging}
                logistics={railLogistics}
                usesExternalSalesPricing={usesExternalSalesPricing}
                allowSaveDraft={!isExternalSalesActor}
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
      {createdDraft && (!usesExternalSalesPricing || createdDraft.intent === 'draft') ? (
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
          remark={pendingSubmission.data.remark}
          items={externalReviewItems}
          receiver={{
            name: pendingSubmission.data.receiverName?.trim() || '未识别收件人',
            phone: pendingSubmission.data.receiverPhone?.trim() || '无电话',
            address: pendingSubmission.data.receiverAddress?.trim() || '—',
            quantityLabel: `${pendingSubmission.data.items.reduce((sum, item) => sum + item.quantity, 0) - pendingSubmission.data.additionalShipments.reduce((sum, shipment) => sum + shipment.itemQuantities.reduce((subtotal, quantity) => subtotal + quantity, 0), 0)} 件`,
          }}
          additionalReceivers={pendingSubmission.data.additionalShipments.map((shipment) => ({
            name: shipment.receiverName?.trim() || '未填写收件人',
            phone: shipment.receiverPhone?.trim() || '未填写电话',
            address: shipment.receiverAddress.trim(),
            quantityLabel: `${shipment.itemQuantities.reduce((sum, quantity) => sum + quantity, 0)} 件`,
          }))}
          cartonCharge={{
            label: '纸箱耗材',
            detail: `${totalQuantity.toLocaleString('zh-CN')} 个`,
            amountLabel:
              railLogistics?.status === 'complete' &&
              railLogistics.packagingAmount
                ? formatMoney(railLogistics.packagingAmount)
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
                  ? formatMoney(railLogistics.shippingAmount)
                  : '待定',
            detail:
              railLogistics?.shippingLabel?.replace(/^快递费\s*/, '') ??
              railLogistics?.message ??
              undefined,
          }}
          totalLabel={
            submitQuoteChange
              ? formatMoney(submitQuoteChange.quotedFee)
              : externalTotal === null
              ? '总价由工厂确认'
              : formatMoney(externalTotal)
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

function LocalDraftPromptSection({ pendingLocalDraft, restoreLocalDraft, discardLocalDraft }: { pendingLocalDraft: LocalOrderFormDraft; restoreLocalDraft: () => void; discardLocalDraft: () => void; }
) {
  return (
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
      <p className="mt-1 text-xs text-muted-foreground">图片和 CDR 文件不会保存在本地草稿中。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" onClick={restoreLocalDraft}>
          恢复本地草稿
        </Button>
        <Button type="button" variant="outline" onClick={discardLocalDraft}>
          放弃本地草稿
        </Button>
      </div>
    </section>
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

function initialOrderFormValues(clientSubmissionId: string, initialItem: ReturnType<typeof createExternalOrderItem>): CreateOrderInput {
  return {
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
    };
}
