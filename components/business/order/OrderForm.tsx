'use client';

import {
  appendCreatePackagingGroup, applyOrderPackagingMixing, applyOrderPackagingType, applySpecPackagingType,
  createPackagingGroupIndex, createPackagingRows, orderPackagingSelection, summarizeCreatePackaging,
} from '@/lib/order/create-packaging-selection';
import type { OrderPackagingView } from './order-form-b/OrderPackagingSection';
import { parsePastedReceiverAddress, pastedTextareaValue } from '@/lib/order/receiver-address-paste';
import { ReceiverAddressPasteField } from './ReceiverAddressPasteField';
// Tests and older callers import the parser from here.
export { parsePastedReceiverAddress } from '@/lib/order/receiver-address-paste';
import { foilColorLabel } from '@/lib/order/foil-colors';
import { paperDisplayLabel } from '@/lib/rules/paper-label';
import type { OrderEditorSnapshot, OrderCreationEditor, OrderCreationLifecycle, SampleOrderEditorSnapshot } from './order-creation-editor';
import { orderDesignGroups, designItemIndexes, designFileQueues } from '@/lib/order/design-groups';
import { planOrderItemRemoval, remapDesignNameRecords } from './order-form-item-removal';
import {
  DESIGN_NAME_MAX_LENGTH,
  designNameIssueSummary,
  designNameIssues,
  followingDesignName,
  hasOnlyDesignNameErrors,
  unifyDesignNames,
} from './order-form-design-names';
import { MAX_ORDER_ITEMS_PER_ORDER } from '@/lib/order/limits';
import { OrderSampleEntry, prepareSampleOrderEntry, useSampleOrderEntry } from './OrderSampleEntry';
import { OrderCreateFeeDetails } from './OrderCreateFeeDetails';
import { orderCreateFeeSummary } from './order-create-fee-summary';
import {
  isMixedPackaging,
  packagingModeWithStyleCount,
  packagingBoxType,
  packagingUnit,
  packagingShipmentQuantities,
  type PackagingBoxType,
  type PackagingType,
} from '@/lib/order/packaging-mode';
import { AdminCreatePriceFields } from './AdminCreatePriceFields';
import { adminCreatePriceFactsKey, calculateAdminCreatePrice, sumCreateKnownAmounts, adminPackagingPriceFactsKey, calculateAdminPackagingPrice } from '@/lib/order/admin-create-price';
import { WorkbenchOrderTransfer } from './WorkbenchOrderTransfer';
import { LocalOrderDrafts } from './LocalOrderDrafts';
import { ActionNotice } from '@/components/ui-business';
import type { WorkbenchItemQuoteInput } from '@/lib/workbench/item-quote';
import { orderItemSelectionUpdate, type OrderItemSelectionChange } from '@/lib/order/order-item-selection';
import { OrderItemProductField } from './order-form-b/OrderItemFields';
import { FieldError, FieldLabel } from './order-form-b/OrderFieldPrimitives';
import { externalOrderCatalogCandidates } from '@/lib/order/order-item-catalog';
import { orderItemFieldOptions } from './order-item-field-options';
import {
  createBlankItem,
  createExternalOrderItem,
  normalizeExternalOrderItem,
} from '@/lib/order/order-item-configuration';

import { externalShipmentContactIssues } from '@/lib/order/external-shipment-contact';

import {
  type BaseSyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { formatMoney } from '@/lib/dashboard/format';
import {
  Controller,
  useForm,
  useFieldArray,
  useWatch,
  type Control,
  type FieldErrors,
  type SubmitHandler,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { OrderCreationLeaveBoundary, useOrderCompletion, useOrderLeaveReport, type LocalDraftSaveFailure } from './order-creation-leave';
import { OrderCreatedSuccessView } from './OrderCreatedSuccessView';
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
import type { CreateOrderMutationResult } from '@/actions/order.types';
import type { CreateOrderPackagingQuotePreview } from '@/lib/order/create-order-quote-presentation';
import type {
  CreateOrderItemQuotePreview,
  CreateOrderQuoteResult,
} from '@/lib/order/create-order-quote-service';
import { externalPriceRuleDisplayName } from '@/lib/price/external-price-display';
import {
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
} from '@/lib/order/pricing-route';
import { calculateCreateOrderBagCount } from '@/lib/order/create-order-packaging';
import type { ExternalSalesAccountOption } from '@/lib/order/external-sales-association';
import { ADMIN_EXTERNAL_SALES_REQUIRED_MESSAGE, ORDER_SETTLEMENT_LABELS } from '@/lib/order/settlement';
import { ORDER_PRICING_STATUS } from '@/lib/order/pricing-status';
import { RequiredMark } from '@/components/business/form/RequiredMark';

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
  id: string | null;
  selectionKey?: string;
  code?: string | null;
  name: string;
  category: string;
  specification: string | null;
  paperType: string | null;
  paperMaterialId?: string | null;
  weight?: number | null;
};

export type OrderFormProps = {
  initialEditor?: OrderEditorSnapshot;
  submissionId?: string;
  registerEditor?: (editor: OrderCreationEditor | null) => void;
  /**
   * 批量建单保活（审查 #47）：非当前工单的实例保持挂载但不在文档中，
   * 此时不登记 editor、不挂离开守卫；草稿自动保存照常（各自独立的 draftScope）。
   */
  active?: boolean;
  lifecycle?: OrderCreationLifecycle;
  workbenchTransferId?: string;
  crafts: readonly CraftOption[];
  products: readonly ProductOption[];
  /** Present only for administrators, who must pick the external salesperson. */
  externalSalesAccounts?: readonly ExternalSalesAccountOption[];
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

type QuoteFacts = Parameters<typeof quoteFactsKey>[0];

type OrderCreationIntent = 'draft' | 'submit' | 'fees';

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
  index: number | readonly number[];
  remainingItemCount: number;
  additionalShipments: CreateOrderInput['additionalShipments'];
  packagingGroups: CreateOrderInput['packagingGroups'];
  usesExternalSalesPricing: boolean;
}): {
  additionalShipments: CreateOrderInput['additionalShipments'];
  packagingGroups: CreateOrderInput['packagingGroups'];
} {
  const removed = new Set(typeof index === 'number' ? [index] : index);
  const nextShipments = additionalShipments
    .map((shipment) => ({
      ...shipment,
      itemQuantities: shipment.itemQuantities.filter(
        (_, itemIndex) => !removed.has(itemIndex),
      ),
    }))
    .filter((shipment) =>
      shipment.itemQuantities.some((quantity) => quantity > 0),
    );
  const nextGroups = packagingGroups.flatMap((group) => {
    const itemUnitsPerBag = group.itemUnitsPerBag.filter(
      (_, itemIndex) => !removed.has(itemIndex),
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
        ? `正 ${item.frontFoilColors.map(foilColorLabel).join('+')} / 反 ${item.backFoilColors.map(foilColorLabel).join('+')}`
        : item.frontFoilColors.map(foilColorLabel).join('+');
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
    // DOM registration may turn restored null text into an empty string without
    // notifying useWatch. Match the optional-text schema before comparing quote facts.
    artworkVersion: item?.artworkVersion?.trim() || null,
    plateGroupId: item?.plateGroupId ?? null,
    pricingGroup: item?.pricingGroup ?? null,
    manualQuoteReason: item?.manualQuoteReason?.trim() || null,
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
        // 与左侧“承诺交期”同一结构：标签行 + 44px 控件行，勾选框与日期输入框对齐。
        <label
          htmlFor="isUrgent"
          data-slot="urgent-order-field"
          className="grid min-w-0 cursor-pointer gap-2 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted-foreground"
        >
          <span id="urgent-order-accessible-label" className="sr-only">
            急单（提交后会推送至排产群）
          </span>
          <span
            data-slot="urgent-order-title"
            className="text-sm leading-none font-medium"
          >
            急单
          </span>
          <span className="flex min-w-0 items-start gap-1">
            {/* 44px 触控目标里的 20px 勾选框与标题左对齐；说明折行时勾选框对准首行（§8.1） */}
            <span className="-ml-3 shrink-0">
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
            </span>
            <span
              data-slot="urgent-order-description"
              className="min-w-0 pt-3.5 text-xs leading-4 text-muted-foreground"
            >
              提交后会推送至排产群
            </span>
          </span>
        </label>
      )}
    />
  );
}

export { GuardedOrderForm as OrderForm };

function GuardedOrderForm(props: OrderFormProps) {
  return <OrderCreationLeaveBoundary><OrderForm {...props} /></OrderCreationLeaveBoundary>;
}

function OrderForm({
  crafts,
  products,
  externalSalesAccounts,
  externalCreateOrderOptions,
  initialExternalPriceSnapshot,
  draftScope,
  workbenchTransferId,
  initialEditor,
  submissionId,
  registerEditor, active = true,
  lifecycle,
}: OrderFormProps) {
  const sampleEditorRef = useRef(initialEditor?.sample);
  const [restoredSample, setRestoredSample] = useState(initialEditor?.sample);
  const { samplePurpose, chooseSamplePurpose: persistSamplePurpose } = useSampleOrderEntry(
    draftScope, workbenchTransferId, initialEditor ? initialEditor.sample?.purpose ?? null : undefined,
  );
  const captureSampleEditor = useCallback((snapshot: SampleOrderEditorSnapshot) => {
    sampleEditorRef.current = snapshot;
  }, []);
  function chooseSamplePurpose(value: 'SAMPLE_SHIPMENT' | 'PROOF' | null) {
    if (!value) { sampleEditorRef.current = undefined; setRestoredSample(undefined); }
    persistSamplePurpose(value);
  }
  // 业主 2026-09-24：所有工单都按外部销售结算。销售本人建单；管理员
  // （持有 externalSalesAccounts）代建时必须选择外部销售。
  const canAssignExternalSales = externalSalesAccounts !== undefined;
  const isExternalSalesActor = !canAssignExternalSales;
  const initialItem = useMemo(() => {
    const firstFoil = externalCreateOrderOptions?.foilColors[0]?.name;
    const item = createExternalOrderItem(
      crafts, products, externalCreateOrderOptions?.papers ?? [], firstFoil,
    );
    item.designGroupKey = globalThis.crypto.randomUUID();
    return {
      ...item,
      // 设计款名称由建单人填写（DECISIONS 2026-09-26）：单款默认跟随工单名称。
      name: '',
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
  ]);
  const [clientSubmissionId] = useState(() => submissionId ?? globalThis.crypto.randomUUID());
  const form = useForm<CreateOrderInput>({
    // zodResolver's generics don't fully compose with preprocess-bearing
    // schemas (moneyOptionalField uses `z.preprocess`, which splits
    // z.input / z.output). The runtime contract still holds — we just
    // widen the compile-time seam.
    resolver: zodResolver(createOrderSchema) as never,
    mode: 'onBlur',
    // The shared editor owns one explicit error-navigation request per submit.
    shouldFocusError: false,
    defaultValues: {
      ...initialOrderFormValues(clientSubmissionId, initialItem),
      externalSalesUserId: null,
      ...initialEditor?.values,
      clientSubmissionId,
    },
  });
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, dirtyFields },
    setValue,
    setError,
    clearErrors,
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
  const settlementLabel = ORDER_SETTLEMENT_LABELS.EXTERNAL_SALES;
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
  >(() => Object.fromEntries(itemsArray.fields.map((field, index) => [field.id, initialEditor?.files[index] ?? []])));
  const [createdDraft, setCreatedDraft] = useState<{
    orderId: string;
    orderNo: string;
    itemIds: string[];
    fieldIds: string[];
    intent: OrderCreationIntent;
    manualQuote: boolean;
    quoteToken: string | null;
  } | null>(null);
  const selectedDesignQueues = createdDraft ? pendingDesigns : designFileQueues(
    watchedItems as CreateOrderInput['items'], itemsArray.fields, pendingDesigns,
  );
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
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
  const [submissionValidationVisible, setSubmissionValidationVisible] =
    useState(false);
  // 保存草稿只因设计款名称被拦时，只提示设计款名称与外部销售，不打开提交阶段校验。
  const [designNameValidationVisible, setDesignNameValidationVisible] =
    useState(false);
  // 本次编辑中各设计款是否手动命名（按设计款分组键）；没有记录时按值推断。
  const handNamedDesignsRef = useRef(new Map<string, boolean>());
  const [errorFocusRequest, setErrorFocusRequest] = useState(0);
  const [errorFocusMessage, setErrorFocusMessage] = useState<string>();
  const [externalInputRevision, setExternalInputRevision] = useState(0);
  const [pendingSubmission, setPendingSubmission] = useState<{
    intent: OrderCreationIntent;
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
    useState(Boolean(initialEditor));
  const [lastLocalDraftSavedAt, setLastLocalDraftSavedAt] = useState<
    string | null
  >(null);
  const [localDraftError, setLocalDraftError] = useState<string | null>(null);
  const externalQuoteRequestGate = useRef(createOrderQuoteRequestGate());
  const itemFieldIdsRef = useRef<string[]>([]);
  const nextItemFigRef = useRef(initialEditor ? resolveNextOrderItemFig(initialEditor.values) : 2);
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
    quoting: externalQuoteQuoting,
    logisticsQuoting: externalQuoteQuoting,
  });
  const orderFormControlsDisabled =
    !localDraftReady || submitting || uploading;
  const pendingDesignFileCount = Object.values(pendingDesigns).reduce(
    (total, queue) => total + queue.length,
    0,
  );
  const [persistedValues, setPersistedValues] = useState<CreateOrderInput>(() => initialEditor?.persistedValues ?? structuredClone(getValues()));
  const persistedValuesRef = useRef(persistedValues);
  const unsavedContent = JSON.stringify(getValues()) !== JSON.stringify(persistedValues);
  const [completion, setCompletion] = useState<{ draft: NonNullable<typeof createdDraft>; manualQuote: boolean; readyForProduction: boolean } | null>(null);
  const draftFailureRef = useRef<LocalDraftSaveFailure>('storage');
  const persistLocalDraftValues = useCallback(
    (values: CreateOrderInput) => {
      const savedAt = new Date();
      const serialized = serializeLocalOrderFormDraft(
        { ...values, nextItemFig: nextItemFigRef.current },
        localDraftPricingScope,
        savedAt,
      );
      if (!serialized) {
        draftFailureRef.current = 'unserializable';
        setLocalDraftError('当前表单无法安全序列化，本地草稿未更新。');
        return false;
      }
      try {
        window.localStorage.setItem(localDraftStorageKey, serialized);
        setLocalDraftDecisionComplete(true);
        setLastLocalDraftSavedAt(savedAt.toISOString());
        setLocalDraftError(null);
        persistedValuesRef.current = structuredClone(values);
        setPersistedValues(persistedValuesRef.current);
        return true;
      } catch {
        draftFailureRef.current = 'storage';
        setLocalDraftError('本地草稿保存失败，请不要在创建工单前关闭页面。');
        return false;
      }
    },
    [localDraftPricingScope, localDraftStorageKey],
  );
  // 离开保护由工作台统一管理（order-creation-leave）；这里只上报本单状态并取页头返回。
  const leave = useOrderLeaveReport(clientSubmissionId, { active, dirty: unsavedContent, pendingFileCount: pendingDesignFileCount,
    submitted: Boolean(submittedOrder), busy: submitting || uploading }, () => (persistLocalDraftValues(getValues()) ? null : draftFailureRef.current));

  useEffect(() => {
    if (!registerEditor || !active) return;
    registerEditor({
      canLeave: localDraftReady && !submitting && !uploading && !createdDraft && !pendingSubmission,
      capture: () => {
        const values = getValues();
        return { persistedValues: structuredClone(persistedValuesRef.current), sample: samplePurpose ? structuredClone(sampleEditorRef.current) : undefined, values: structuredClone(values), files: itemsArray.fields.map((field) => selectedDesignQueues[field.id] ?? []) };
      },
    });
    return () => registerEditor(null);
  }, [registerEditor, active, getValues, persistedValues, itemsArray.fields, selectedDesignQueues, samplePurpose,
    localDraftReady, submitting, uploading, createdDraft, pendingSubmission]);

  useEffect(() => {
    itemFieldIdsRef.current = itemsArray.fields.map((field) => field.id);
  }, [itemsArray.fields]);

  useEffect(() => {
    // 只有外部销售账号自动恢复；管理员（代建）须在恢复/放弃提示里明确选择，
    // 该提示同时说明图片和 CDR 文件不会保存在本地草稿中。
    if (!isExternalSalesActor || !pendingLocalDraft || !transferReady) return;
    const timer = window.setTimeout(() => {
      nextItemFigRef.current = resolveNextOrderItemFig(
        pendingLocalDraft.values,
      );
      const restored = pendingLocalDraft.values as unknown as CreateOrderInput;
      handNamedDesignsRef.current.clear();
      reset({
        ...restored,
        items: unifyDesignNames(restored.items),
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
  }, [clientSubmissionId, isExternalSalesActor, pendingLocalDraft, reset, transferReady]);

  useEffect(() => {
    if (!localDraftReady || pendingLocalDraft || createdDraft || !unsavedContent) {
      return;
    }
    const timer = window.setTimeout(() => {
      persistLocalDraftValues(getValues());
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    createdDraft,
    unsavedContent,
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
      if (draft.intent !== 'draft') {
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

      setCompletion({ draft, manualQuote: submittedManualQuote, readyForProduction });
    } catch {
      setUploadProgress(null);
      setUploadError('草稿已安全保存，但后续处理未完成，请重试。');
    } finally {
      setUploading(false);
    }
  }

  useOrderCompletion(completion, submitting || uploading, ({ draft, manualQuote, readyForProduction }) => {
    setCompletion(null);
    leave.finishOrder?.(clientSubmissionId);
    lifecycle?.onCompleted({ orderId: draft.orderId, orderNo: draft.orderNo, intent: draft.intent });
    setPendingSubmission(null);
    if (lifecycle?.retainResult && draft.intent !== 'fees') return;
    if (draft.intent === 'submit') {
      setSubmittedOrder({ orderId: draft.orderId, orderNo: draft.orderNo, manualQuote, readyForProduction });
    } else {
      leave.navigate?.(`/orders/${draft.orderId}${draft.intent === 'fees' ? '#admin-fee-editor' : ''}`);
    }
  });

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
    const values = initialOrderFormValues(clientSubmissionId, {
      ...normalized,
      name: '',
      designGroupKey: globalThis.crypto.randomUUID(),
    });
    if (!persistLocalDraftValues(values))
      return '报价条件保存失败，请释放浏览器存储空间后返回工作台重试';
    handNamedDesignsRef.current.clear();
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
    const restored = pendingLocalDraft.values as unknown as CreateOrderInput;
    handNamedDesignsRef.current.clear();
    reset({
      ...restored,
      items: unifyDesignNames(restored.items),
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
        packagingGroups: data.packagingGroups.map((group) => group.mode === OrderPackagingMode.UNPACKED ? { ...group, adminPrice: undefined } : group),
        items: data.items.map((item) => ({
          ...item,
          plateGroupId: null,
          pricingGroup: null,
          // Automatic amounts remain server-owned; explicit adminPrice is separately authorized.
          manualQuoteReason: null,
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
          canAssignExternalSales
            ? submittedData
            : buildExternalCreateOrderPayload(submittedData),
        ),
      );
      setState(result);
      if (result.status !== 'success') {
        setErrorFocusRequest((current) => current + 1);
        return;
      }

      lifecycle?.onCreated({ orderId: result.orderId, orderNo: result.orderNo, intent });
      // The server now owns the text; only unsuccessful uploads remain at risk.
      persistedValuesRef.current = structuredClone(getValues());
      setPersistedValues(persistedValuesRef.current);
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
        quoteToken: intent !== 'draft' ? expectedQuoteToken : null,
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
      externalQuoteQuoting ||
      externalQuoteNeedsRefresh
    ) {
      return;
    }
    const fieldIds = itemsArray.fields.map((field) => field.id);
    const queueSnapshot = Object.fromEntries(
      fieldIds.map((fieldId) => [fieldId, selectedDesignQueues[fieldId] ?? []]),
    );
    const submitter = (event?.nativeEvent as SubmitEvent | undefined)
      ?.submitter as HTMLButtonElement | null | undefined;
    const intent: OrderCreationIntent =
      submitter?.value === 'fees' && canAssignExternalSales ? 'fees' : submitter?.value === 'submit' ? 'submit' : 'draft';

    if (canAssignExternalSales && !data.externalSalesUserId?.trim()) {
      setError('externalSalesUserId', { type: 'required', message: ADMIN_EXTERNAL_SALES_REQUIRED_MESSAGE });
      // 与费用栏一致：保存草稿只拦外部销售，不亮出提交阶段才要求的名称、收货、设计图等校验。
      if (intent !== 'draft') setSubmissionValidationVisible(true);
      setErrorFocusMessage(ADMIN_EXTERNAL_SALES_REQUIRED_MESSAGE);
      setErrorFocusRequest((current) => current + 1);
      return;
    }
    if (adminPriceGaps.length) {
      setSubmissionValidationVisible(true);
      setErrorFocusMessage(adminPriceGaps[0].label);
      setErrorFocusRequest((current) => current + 1);
      return;
    }
    if (intent !== 'draft') {
      setSubmissionValidationVisible(true);
      setErrorFocusMessage(undefined);
      const issues = externalSubmissionIssues(data, fieldIds, queueSnapshot);
      if (issues.length > 0) {
        setErrorFocusRequest((current) => current + 1);
        return;
      }
      const quoteToken = currentCreateOrderQuote?.quoteToken ?? '';
      if (!quoteToken) return;
      setSubmitQuoteChange(null);
      setPendingSubmission({ intent, data, fieldIds, queues: queueSnapshot, quoteToken });
      return;
    }

    persistOrder(data, fieldIds, queueSnapshot, intent);
  };

  const onInvalid = (invalid: FieldErrors<CreateOrderInput>, event?: BaseSyntheticEvent) => {
    setPendingSubmission(null);
    const submitter = (event?.nativeEvent as SubmitEvent | undefined)
      ?.submitter as HTMLButtonElement | null | undefined;
    if (submitter?.value === 'draft' && hasOnlyDesignNameErrors(invalid)) {
      // 与草稿的外部销售拦截一致：只提示外部销售与设计款名称，不亮出提交阶段校验。
      setDesignNameValidationVisible(true);
      const salespersonMissing =
        canAssignExternalSales && !getValues('externalSalesUserId')?.trim();
      if (salespersonMissing) {
        setError('externalSalesUserId', { type: 'required', message: ADMIN_EXTERNAL_SALES_REQUIRED_MESSAGE });
      }
      const firstNameIssue = designNameIssues(getValues('items'))[0];
      setErrorFocusMessage(
        salespersonMissing
          ? ADMIN_EXTERNAL_SALES_REQUIRED_MESSAGE
          : firstNameIssue ? designNameIssueSummary(firstNameIssue) : undefined,
      );
      setErrorFocusRequest((current) => current + 1);
      return;
    }
    setErrorFocusMessage(undefined);
    setSubmissionValidationVisible(true);
    setErrorFocusRequest((current) => current + 1);
  };

  function updatePendingDesigns(fieldId: string, images: PendingDesignImage[]) {
    const index = itemsArray.fields.findIndex((field) => field.id === fieldId);
    const indexes = designItemIndexes(getValues('items'), index);
    setPendingDesigns((current) => {
      const next = { ...current };
      for (const member of indexes) {
        const id = itemsArray.fields[member]?.id;
        if (id) next[id] = images;
      }
      return next;
    });
  }

  function changeExternalSales(externalSalesUserId: string | null) {
    setValue('externalSalesUserId', externalSalesUserId, { shouldDirty: true });
    if (externalSalesUserId) clearErrors('externalSalesUserId');
    invalidateStructuralQuotes();
  }

  function invalidateStructuralQuotes() {
    invalidateOrderQuoteRequests(externalQuoteRequestGate.current);
    setQuoteViews({});
    setLogisticsQuote(null);
    setPackagingQuote(null);
    setExternalOrderQuote(null);
    setPendingSubmission(null);
  }

  function removeItems(indexes: readonly number[]) {
    const currentItems = getValues('items');
    const plan = planOrderItemRemoval(currentItems, indexes, expandedItem);
    if (!plan) return;
    const remainingItems = plan.keptIndexes.map((index) => currentItems[index]);
    const remainingFiles = Object.fromEntries(plan.keptIndexes.map((index) => {
      const id = itemsArray.fields[index].id;
      return [id, selectedDesignQueues[id] ?? []];
    }));
    const relations = removeOrderItemRelations({
      index: plan.removedIndexes,
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
    handNamedDesignsRef.current = remapDesignNameRecords(currentItems, plan.keptIndexes, handNamedDesignsRef.current);
    itemsArray.remove(plan.removedIndexes);
    // 回到单个设计款时，未手动命名的设计款重新跟随工单名称。
    const following = syncSingleDesignName(getValues('customName'), getValues('customName'));
    const persistedItems = following
      ? remainingItems.map((item, itemIndex) =>
          following.indexes.includes(itemIndex) ? { ...item, name: following.name } : item)
      : remainingItems;
    setExpandedItem(plan.activeIndex);
    // Preserve the selected design files when removing its first specification.
    setPendingDesigns(remainingFiles);
    invalidateStructuralQuotes();
    persistLocalDraftValues({
      ...getValues(),
      items: persistedItems,
      additionalShipments: relations.additionalShipments,
      packagingGroups: relations.packagingGroups,
    });
  }

  function duplicateItem(index: number, sameDesign = false) {
    if (getValues('items').length >= MAX_ORDER_ITEMS_PER_ORDER) return;
    const currentItems = getValues('items');
    const source = getValues(`items.${index}`);
    const designGroupKey = sameDesign
      ? source.designGroupKey ?? globalThis.crypto.randomUUID()
      : globalThis.crypto.randomUUID();
    if (sameDesign) {
      if (!source.designGroupKey) {
        // 无分组键的设计款（历史 / 工作台转入）在此获得键，手动命名记录随之迁移。
        const recorded = handNamedDesignsRef.current.get(`legacy:${index}`);
        if (recorded !== undefined) handNamedDesignsRef.current.set(designGroupKey, recorded);
      }
      source.designGroupKey = designGroupKey;
      setValue(`items.${index}.designGroupKey`, designGroupKey, { shouldDirty: true });
      currentItems[index] = source;
    }
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
    const nextGroups = appendCreatePackagingGroup(getValues('packagingGroups'), index, currentItems.length);
    setValue('packagingGroups', nextGroups, {
      shouldDirty: true,
      shouldValidate: true,
    });
    const nextItem = {
      ...source,
      designGroupKey,
      adminPrice: undefined,
      fig: nextItemFigRef.current,
      // 新增设计款须手动命名；同一设计款的规格共用名称。
      name: sameDesign ? source.name : '',
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
        preserveName: true,
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
    } = {},
  ) {
    commitExternalItem(index, item, {
      paperKey: options.paperKey,
      resetPaper: options.resetPaper,
      resetSpecification: options.resetSpecification,
      preserveCustomSize: options.preserveCustomSize,
    });
  }

  function applyItemSelection(index: number, change: OrderItemSelectionChange) {
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
  function changeDesignText(index: number, field: 'name' | 'artworkVersion', value: string) {
    const items = getValues('items');
    if (field === 'name') {
      // 输入非空名称即视为手动命名，清空则恢复跟随工单名称。
      const design = orderDesignGroups(items).find((group) => group.indexes.includes(index));
      if (design) handNamedDesignsRef.current.set(design.key, Boolean(value.trim()));
    }
    for (const member of designItemIndexes(items, index)) {
      setValue(`items.${member}.${field}`, value, { shouldDirty: true, shouldValidate: true });
    }
  }
  /** 单个且未手动命名的设计款跟随工单名称（DECISIONS 2026-09-26）。 */
  function syncSingleDesignName(
    orderName: string | null | undefined,
    orderNameForInference: string | null | undefined,
  ) {
    const items = getValues('items');
    const following = followingDesignName(
      items, orderName, orderNameForInference,
      (key) => handNamedDesignsRef.current.get(key),
    );
    if (!following) return null;
    handNamedDesignsRef.current.set(following.key, false);
    for (const index of following.indexes) {
      if (items[index]?.name === following.name) continue;
      setValue(`items.${index}.name`, following.name, {
        shouldDirty: true,
        shouldValidate: form.getFieldState(`items.${index}.name`).invalid,
      });
    }
    return following;
  }

  function changeItemSelection(index: number, change: OrderItemSelectionChange) {
    const indexes = change.type === 'specification' || change.type === 'customSize'
      ? [index] : designItemIndexes(getValues('items'), index);
    if (change.type === 'specification') {
      // A specification is local to one line, but normalizing it may move the
      // paper/weight; the design group must keep one material (schema refines
      // designGroupKey on that), so refuse instead of silently diverging.
      const sibling = designItemIndexes(getValues('items'), index).find((member) => member !== index);
      if (sibling !== undefined) {
        const selected = orderItemSelectionUpdate(getValues(`items.${index}`), change, products, externalCreateOrderOptions);
        const candidate = selected ? normalizeExternalOrderItem({ item: selected.item, crafts, products,
          paperMaterials: externalCreateOrderOptions?.papers, ...selected.options }) : null;
        const other = getValues(`items.${sibling}`);
        if (!candidate || candidate.paperType !== other.paperType || candidate.paperWeightGsm !== other.paperWeightGsm) {
          setState({ status: 'error', message: '该规格在当前材料或克重下不可用，无法与设计款的其他规格共用，请先调整材料或增加独立设计款。' });
          return;
        }
      }
    }
    if (indexes.length > 1 && (change.type === 'paper' || change.type === 'weight')) {
      const candidates = indexes.map((member) => {
        const selected = orderItemSelectionUpdate(getValues(`items.${member}`), change, products, externalCreateOrderOptions);
        return selected ? normalizeExternalOrderItem({ item: selected.item, crafts, products,
          paperMaterials: externalCreateOrderOptions?.papers, ...selected.options }) : null;
      });
      if (candidates.some((candidate) => !candidate || candidate.paperType !== candidates[0]?.paperType || candidate.paperWeightGsm !== candidates[0]?.paperWeightGsm)) {
        setState({ status: 'error', message: '该材料或克重无法同时用于当前设计款的所有规格，请先调整规格或增加独立设计款。' });
        return;
      }
    }
    for (const member of indexes) applyItemSelection(member, change);
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

  function commitPackagingGroups(next: CreateOrderInput['packagingGroups']) {
    getValues('items').forEach((_, index) => {
      const group = next[createPackagingGroupIndex(next, index)];
      setValue(`items.${index}.pack`, group?.mode === OrderPackagingMode.UNPACKED ? null : group?.itemUnitsPerBag[index] ?? null, { shouldDirty: true });
    });
    setValue('packagingGroups', next, { shouldDirty: true, shouldValidate: true });
  }

  /** 整单包装区：itemIndex 缺省时统一作用于全部规格（DECISIONS 2026-09-23）。 */
  function changePackagingType(type: PackagingType, box: PackagingBoxType, itemIndex?: number) {
    const groups = getValues('packagingGroups');
    const itemCount = getValues('items').length;
    commitPackagingGroups(itemIndex === undefined
      ? applyOrderPackagingType(groups, itemCount, type, box)
      : applySpecPackagingType(groups, itemCount, itemIndex, type, box));
  }

  function changePackagingMixing(mixed: boolean) {
    commitPackagingGroups(applyOrderPackagingMixing(getValues('packagingGroups'), getValues('items').length, mixed));
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
    const groupIndex = createPackagingGroupIndex(groups, index);
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
    if (!localDraftReady || createdDraft) return;
    watchedItems.forEach((item, index) => {
      const normalized = normalizeExternalOrderItem({
        item,
        crafts,
        products,
        paperMaterials: externalCreateOrderOptions?.papers,
        resetPaper: !item.paperType,
        resetSpecification: !item.specification,
        preserveCustomSize: true,
        preserveName: true,
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
        (Boolean(item.productId) || (item.pricingRoute === OrderItemPricingRoute.STOCK_BLANK && Boolean(item.paperType && item.specification))) &&
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
    currentExternalQuoteRequestReady &&
    !externalQuoteHasCurrentResponse;

  useEffect(() => {
    if (
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
        const response = await quoteExternalCreateOrderAction(input).catch(() => ({
          status: 'error' as const,
          message: '自动核价请求失败，请检查网络后点击重新报价',
        }));
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
  ]);
  // RHF renders client-side field errors next to their controls. The server
  // can still reject backend-only facts such as a disabled product/craft;
  // render only those business messages, never their internal dotted paths.
  const serverFieldErrors =
    state?.status === 'invalid' ? state.fieldErrors : undefined;
  const serverGeneralError = state?.status === 'error' ? state.message : null;
  const { adminPriceFacts, adminPackagingFacts, adminPrices, adminPackagingPrices, hasAdminPrices } = adminCreatePricingState(watchedItems, watchedPackagingGroups, watchedShipments, canAssignExternalSales);

  const itemGapInputs = watchedItems.map((item, index) => {
    const fieldId = itemsArray.fields[index]?.id;
    const view = fieldId ? quoteViews[fieldId] : undefined;
    const currentKey = quoteFactsKey(item, watchedItems.length);
    let quoteStatus: OrderFormQuoteStatus = 'missing';
    if (
      fieldId &&
      externalQuoteQuoting
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
      quoteStatus: adminPrices[index]?.error ? 'error' as const : adminPrices[index]?.price ? 'complete' as const : quoteStatus,
      quoteError: adminPrices[index]?.error ?? view?.error,
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
      billableWeightKg: 'automatic',
    },
    ...watchedShipments.map((shipment, index) => ({
      key: `additional-${index}`,
      label: `额外地址 ${index + 1}`,
      idPrefix: `shipment-${index}`,
      receiverFieldId: `additionalShipments.${index}.receiverAddress`,
      receiverAddress: shipment.receiverAddress,
      province: shipment.destinationProvince,
      billableWeightKg: 'automatic',
    })),
  ];
  const formGaps = collectOrderFormGaps({
    promisedDate: watchedPromisedDate,
    items: itemGapInputs,
    shipping: {
      usesExternalSalesPricing: true,
      isSfCollect: watchedIsSfCollect,
      shipments: shipmentGapInputs,
    },
  });
  const adminPriceGaps: Array<{ label: string; fieldId: string; itemIndex?: number }> = [
    ...adminPrices.flatMap((value, index) => value?.error ? [{ label: `款式 #${index + 1}：${value.error}`, fieldId: `items.${index}.adminPrice.amount`, itemIndex: index }] : []),
    ...adminPackagingPrices.flatMap((value, index) => value?.error ? [{ label: `包装组 ${index + 1}：${value.error}`, fieldId: `packagingGroups.${index}.adminPrice.amount`, itemIndex: watchedPackagingGroups[index].itemUnitsPerBag.findIndex((units) => units > 0) }] : []),
  ];
  const orderFormBGaps = adminPriceGaps.map((gap) => gap.label);
  const totalQuantity = watchedItems.reduce(
    (sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0),
    0,
  );
  const designGroups = orderDesignGroups(watchedItems);
  const railQuoteItems = itemGapInputs.map((item, index) => {
    const fieldId = itemsArray.fields[index]?.id ?? `item-${index}`;
    const view = quoteViews[fieldId];
    const current =
      view?.inputKey === quoteFactsKey(watchedItems[index], watchedItems.length);
    const result = current ? view?.result : undefined;
    const manualPrice = adminPrices[index]?.price;
    return {
      key: fieldId,
      design: { key: watchedItems[index]?.designGroupKey ?? fieldId,
        label: `设计款 ${designGroups.findIndex((group) => group.indexes.includes(index)) + 1}` },
      specificationLabel: `${watchedItems[index]?.specification || '待选规格'} · ${watchedItems[index]?.quantity ?? 0} 个`,
      label:
        watchedItems[index]?.name?.trim() ||
        ORDER_PRICING_ROUTE_LABELS[
          watchedItems[index]?.pricingRoute ?? OrderItemPricingRoute.STOCK_BLANK
        ],
      status: item.quoteStatus,
      amount: manualPrice?.subtotal ?? (
        item.quoteStatus === 'complete'
          ? (result?.suggestedSubtotal ?? null)
          : null),
      components:
        !manualPrice && item.quoteStatus === 'complete'
            ? (result?.components ?? []).map((component) => ({
                label: externalQuoteComponentLabel(
                  watchedItems[index] ?? item,
                  component,
                ),
                amount: component.amount,
              }))
            : [],
      pricingSource: manualPrice ? 'ADMIN' as const : 'AUTO' as const,
      message: manualPrice ? '人工定价' :
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
  // Every billing settlement quotes delivery from the published logistics book.
  const railLogistics = {
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
      };
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
    label: watchedPackagingGroups.every((group) => group.mode === OrderPackagingMode.UNPACKED) ? '不包装' : watchedPackagingGroups.map((group) => group.mode === OrderPackagingMode.UNPACKED ? '不包装' : `${packagingBoxType(group.mode) ? '装盒' : '入袋'} ${group.actualBagCount}${packagingUnit(group.mode)}`).join('、'),
    message:
      packagingQuote?.error ??
      currentPackagingResult?.errors.join('；') ??
      null,
  };
  if (adminPackagingPrices.some(Boolean)) {
    const groups = watchedPackagingGroups.map((_, index) => adminPackagingPrices[index]?.price?.subtotal ?? currentPackagingResult?.groups[index]?.suggestedSubtotal ?? null);
    railPackaging.amount = sumCreateKnownAmounts(groups);
    railPackaging.status = groups.every((amount) => amount !== null) && !adminPackagingPrices.some((price) => price?.error) ? 'complete' : 'incomplete';
    railPackaging.pricingSource = watchedPackagingGroups.every((_, index) => adminPackagingPrices[index]?.price) ? 'ADMIN' : 'MIXED';
    railPackaging.message = railPackaging.status === 'complete' ? null : '请核对包装价格';
  }
  const currentExternalOrderQuote =
    externalOrderQuote?.inputKey === currentExternalQuoteFactsKey
      ? externalOrderQuote.result
      : undefined;
  const currentCreateOrderQuote = currentExternalOrderQuote;
  const displayedKnownTotal = hasAdminPrices ? sumCreateKnownAmounts([
    ...railQuoteItems.map((item) => item.status === 'complete' ? item.amount : null),
    ...watchedPackagingGroups.map((_, index) => adminPackagingPrices[index]
      ? adminPackagingPrices[index]?.price?.subtotal
      : currentPackagingResult?.groups[index]?.suggestedSubtotal),
    railLogistics?.shippingAmount, railLogistics?.packagingAmount,
  ]) : currentCreateOrderQuote?.knownTotal;
  const displayedTotalSemantics = resolveCreatePriceTotalSemantics(hasAdminPrices, railQuoteItems, railPackaging.status, railLogistics.status, currentCreateOrderQuote);

  const externalRequiresManualQuote =
    railQuoteItems.some((item) => item.status !== 'complete') ||
    railPackaging.status !== 'complete' ||
    railLogistics.status !== 'complete' ||
    displayedTotalSemantics === 'EXCLUDES_MANUAL_ITEMS';
  const externalReviewRequiresManualQuote = submitQuoteChange
    ? submitQuoteChange.quotedFeeCompleteness ===
      OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS
    : externalRequiresManualQuote;
  const externalTotal = externalSalesOrderFormTotal({
    quoteItems: railQuoteItems,
    packaging: railPackaging,
    logistics: railLogistics,
    knownTotal: displayedKnownTotal,
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
              ? `正 ${item.frontFoilColors.map(foilColorLabel).join('+')} / 反 ${item.backFoilColors.map(foilColorLabel).join('+')}`
              : item.frontFoilColors.map(foilColorLabel).join('+')
            : '不烫金';
        const processSummary =
          item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT
            ? `彩印${item.lamination !== OrderLamination.NONE ? ` · 覆${LAMINATION_LABELS[item.lamination]}` : ''}${item.frontFoilColors.length > 0 ? ` · ${item.hasLocalFoil ? '局部烫金' : '专版烫金'} ${foilSummary}` : ''}`
            : `烫金 ${foilSummary}${item.foilTechnique === OrderFoilTechnique.RELIEF ? ' · 浮雕' : item.foilTechnique === OrderFoilTechnique.RAISED ? ' · 激凸' : ''}`;
        // The signed quote keeps the engine's wording; only the rail shows current paper names.
        const manualQuoteReasons =
          quote?.status === 'complete'
            ? []
            : [paperDisplayLabel(quote?.message || '当前参数需由工厂核价')];
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
          materialSummary: `${ORDER_PRICING_ROUTE_LABELS[item.pricingRoute]} · ${paper?.label ?? (item.paperType ? paperDisplayLabel(item.paperType) : '未选纸张')} ${item.paperWeightGsm ?? '—'}g`,
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
  // 复制 / 新增款式后 setExpandedItem(nextIndex) 先于 watch('items') 更新一帧，
  // 这一帧 watchedItems[expandedItem] 为 undefined；凡按下标取当前款的渲染都要经此别名守卫，
  // 否则管理员人工定价区会抛 TypeError 把整页送进错误边界（PR #19 CI 首次暴露）。
  const expandedWatchedItem = watchedItems[expandedItem];
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
  const packagingRows = createPackagingRows({
    groups: watchedPackagingGroups,
    itemQuantities: watchedItems.map((item) => item.quantity),
    shipmentQuantities: packagingShipments,
  });
  const packagingRowLabel = (index: number) =>
    `设计款 ${designGroups.findIndex((group) => group.indexes.includes(index)) + 1} · ${watchedItems[index]?.specification || '待选规格'}`;
  const packagingView: OrderPackagingView = {
    rows: packagingRows.map((row, index) => ({
      label: packagingRowLabel(index),
      quantity: watchedItems[index]?.quantity ?? 0,
      mode: row.mode,
      unitsPerBag: row.unitsPerBag,
      bagCount: row.bagCount,
      error: row.error,
    })),
    selection: orderPackagingSelection(watchedPackagingGroups, watchedItems.length),
    summary: summarizeCreatePackaging({
      rows: packagingRows,
      itemQuantities: watchedItems.map((item) => item.quantity),
      designCount: designGroups.length,
    }),
  };
  const externalLocalIssues = submissionValidationVisible
    ? externalSubmissionIssues(getValues(), itemsArray.fields.map((field) => field.id), selectedDesignQueues)
    : [];
  // 缺名只在尝试保存/提交后提示；超长与重名随输随提示。
  const shownDesignNameIssues = designNameIssues(watchedItems).filter(
    (issue) => submissionValidationVisible || designNameValidationVisible || issue.kind !== 'missing',
  );
  const activeDesignNameIssue = shownDesignNameIssues.find((issue) =>
    designItemIndexes(watchedItems, expandedItem).includes(issue.index),
  );
  const externalItemErrors: OrderFormBErrors['items'] =
    watchedItems.map((item, index) => {
      const fieldId = itemsArray.fields[index]?.id;
      const hasImage = fieldId
        ? (selectedDesignQueues[fieldId] ?? []).some(
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
          submissionValidationVisible && !hasImage
            ? '请上传设计图'
            : undefined,
      };
      return Object.values(itemError).some(Boolean) ? itemError : undefined;
    });
  const externalRHFItemIssues = submissionValidationVisible
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
  const externalRHFOrderIssues = submissionValidationVisible
    ? [
        errors.externalSalesUserId?.message ?? null,
        errors.promisedDate?.message ? `承诺交期：${errors.promisedDate.message}` : null,
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
    designs: Object.fromEntries(shownDesignNameIssues.map((issue) => [issue.index, issue.message])),
    targets: {
      ...Object.fromEntries([...formGaps, ...adminPriceGaps].map((gap) => [gap.label, { fieldId: gap.fieldId, itemIndex: gap.itemIndex }])),
      ...Object.fromEntries(shownDesignNameIssues.map((issue) => [
        designNameIssueSummary(issue), { fieldId: `items.${issue.index}.name`, itemIndex: issue.index },
      ])),
      [ADMIN_EXTERNAL_SALES_REQUIRED_MESSAGE]: { fieldId: 'externalSalesUserId' },
    },
    summary: [
      ...new Set([
        ...externalLocalIssues,
        ...externalRHFOrderIssues,
        ...(designNameValidationVisible && errors.externalSalesUserId?.message
          ? [errors.externalSalesUserId.message]
          : []),
        ...(submissionValidationVisible || designNameValidationVisible
          ? shownDesignNameIssues.map(designNameIssueSummary)
          : []),
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
      (submissionValidationVisible &&
      !getValues('customName')?.trim()
        ? '工单名称必填'
        : undefined),
    receiverName:
      errors.receiverName?.message ??
      (submissionValidationVisible &&
      !getValues('receiverName')?.trim()
        ? '收件人必填'
        : undefined),
    receiverPhone:
      errors.receiverPhone?.message ??
      (submissionValidationVisible &&
      !getValues('receiverPhone')?.trim()
        ? '收货电话必填'
        : undefined),
    receiverAddress:
      errors.receiverAddress?.message ??
      (submissionValidationVisible &&
      !getValues('receiverAddress')?.trim()
        ? '收货地址必填'
        : undefined),
    items: externalItemErrors,
  };
  if (samplePurpose && externalCreateOrderOptions) {
    return <OrderSampleEntry orderKey={clientSubmissionId} active={active} editorSnapshot={restoredSample} onEditorSnapshot={captureSampleEditor} lifecycle={lifecycle} canEditFees={canAssignExternalSales} form={form} purpose={samplePurpose} options={externalCreateOrderOptions}
      crafts={crafts} draftScope={draftScope} itemIndex={expandedItem}
      initialItem={initialItem} choosePurpose={chooseSamplePurpose} onRouteChange={changeExternalRoute}
      externalSalesAccounts={externalSalesAccounts} onExternalSalesChange={changeExternalSales} />;
  }
  if (submittedOrder) {
    // 成功页只保留页头这一个返回入口（§8.3）；离开保护与提交锁同表单页。
    return <OrderCreatedSuccessView order={submittedOrder} back={leave.back('/orders', '返回工单列表')} />;
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
          onNavigate={(href, event) => leave.guard?.(href)(event)}
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
            // 页头唯一返回入口；提交 / 上传中锁住，避免中途离开（§8.3）。
            back={leave.back('/orders', '返回工单列表')}
            settlementLabel={settlementLabel}
            customNameRequired
            designImageRequired
            receiverNameRequired
            receiverPhoneRequired
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
                  className="mt-4 grid min-w-0 grid-cols-1 gap-3.5"
                >
                  {canAssignExternalSales ? (
                    <div>
                      <Label htmlFor="externalSalesUserId">
                        关联外部销售<RequiredMark />
                      </Label>
                      <NativeSelect
                        id="externalSalesUserId"
                        className="mt-2"
                        required
                        aria-required="true"
                        aria-invalid={Boolean(errors.externalSalesUserId)}
                        aria-describedby="externalSalesUserId-hint"
                        {...register('externalSalesUserId', {
                          setValueAs: (value) => (value === '' ? null : value),
                        })}
                        onChange={(event) => {
                          setValue(
                            'externalSalesUserId',
                            event.target.value || null,
                            { shouldDirty: true, shouldValidate: true },
                          );
                          if (event.target.value) clearErrors('externalSalesUserId');
                          invalidateStructuralQuotes();
                        }}
                      >
                        <option value="">请选择外部销售</option>
                        {externalSalesAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.displayName} · {account.username}
                          </option>
                        ))}
                      </NativeSelect>
                      <FieldError
                        id="externalSalesUserId-hint"
                        reservedLines={1}
                        hint="工单归属所选外部销售并按外部销售结算。"
                      >
                        {errors.externalSalesUserId?.message}
                      </FieldError>
                    </div>
                  ) : null}
                  {/* 交期只需放下一个日期，固定窄列；急单并排在右侧，不再单独占一整行。 */}
                  <div
                    data-slot="order-form-schedule"
                    className="grid min-w-0 grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-start gap-3.5"
                  >
                    <div className="min-w-0">
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
                </div>
              ) : undefined
            }
            materialExtras={
              <>
                <div
                  className={`mb-5 grid min-w-0 gap-3.5 ${isExternalSalesActor ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_minmax(0,8rem)]'}`}
                >
                  {/* 设计款名称由建单人填写（DECISIONS 2026-09-26）：单款默认跟随工单名称，
                      新增设计款须手动命名，同一工单内不重名；同一设计款的规格共用名称。 */}
                  <div>
                    <FieldLabel htmlFor={`items.${expandedItem}.name`} required>
                      设计款名称
                    </FieldLabel>
                    <Input
                      // 同一个输入框在各设计款 / 规格间复用；按行重挂载，RHF 才会写入该行的值，
                      // 否则切换后显示上一款的文字，失焦时还会写回当前行。
                      key={itemsArray.fields[expandedItem]?.id}
                      id={`items.${expandedItem}.name`}
                      className="h-10"
                      maxLength={DESIGN_NAME_MAX_LENGTH}
                      placeholder="如：福字款"
                      aria-required="true"
                      aria-invalid={Boolean(activeDesignNameIssue)}
                      aria-describedby={activeDesignNameIssue ? `items.${expandedItem}.name-error` : undefined}
                      {...register(`items.${expandedItem}.name`, { onChange: (event) => changeDesignText(expandedItem, 'name', event.target.value) })}
                    />
                    <FieldError id={`items.${expandedItem}.name-error`} reservedLines={1}>
                      {activeDesignNameIssue?.message}
                    </FieldError>
                  </div>
                  {!isExternalSalesActor ? (
                    <div className="min-w-0">
                      {/* 稿件版本是次要信息，窄列放在设计款名称右侧 */}
                      <FieldLabel htmlFor={`items.${expandedItem}.artworkVersion`}>
                        稿件版本
                      </FieldLabel>
                      <Input
                        key={itemsArray.fields[expandedItem]?.id}
                        id={`items.${expandedItem}.artworkVersion`}
                        className="h-10"
                        {...register(`items.${expandedItem}.artworkVersion`, { onChange: (event) => changeDesignText(expandedItem, 'artworkVersion', event.target.value) })}
                      />
                    </div>
                  ) : null}
                </div>
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
            pricingExtras={canAssignExternalSales || quoteViews[itemsArray.fields[expandedItem]?.id]?.error ? <>
              {canAssignExternalSales && expandedWatchedItem ? <AdminCreatePriceFields
                divided={false}
                amountId={`items.${expandedItem}.adminPrice.amount`}
                value={expandedWatchedItem.adminPrice}
                factsKey={adminPriceFacts(expandedWatchedItem)}
                disabled={orderFormControlsDisabled}
                suggestedAmount={quoteViews[itemsArray.fields[expandedItem]?.id]?.result?.suggestedSubtotal}
                error={adminPrices[expandedItem]?.error}
                onChange={(price) => setValue(`items.${expandedItem}.adminPrice`, price, { shouldDirty: true, shouldValidate: true })}
              /> : null}
              {quoteViews[itemsArray.fields[expandedItem]?.id]?.error ? <div className="mt-3"><Button type="button" variant="outline" disabled={orderFormControlsDisabled || externalQuoteQuoting} onClick={() => { setExternalOrderQuote(null); }}>重新报价</Button></div> : null}
            </> : undefined}
            packagingExtras={canAssignExternalSales ?
              <div className="space-y-3">
                {watchedPackagingGroups.map((group, index) => group.mode !== OrderPackagingMode.UNPACKED ? (
                  <AdminCreatePriceFields key={index} amountId={`packagingGroups.${index}.adminPrice.amount`} value={group.adminPrice} factsKey={adminPackagingFacts(group)} disabled={orderFormControlsDisabled}
                    divided={false}
                    title={`包装组 ${index + 1} 单价`} priceLabel={`包装单价（元 / ${packagingUnit(group.mode)}）`}
                    scope={packagingRows.flatMap((row, item) => row.groupIndex === index ? [packagingRowLabel(item)] : []).join('、')}
                    note={packagingBoxType(group.mode) ? '包含盒子和装盒费用。' : ''}
                    suggestedAmount={currentPackagingResult?.groups[index]?.suggestedUnitPrice}
                    error={adminPackagingPrices[index]?.error}
                    onChange={(price) => setValue(`packagingGroups.${index}.adminPrice`, price, { shouldDirty: true, shouldValidate: true })}
                  />
                ) : null)}
              </div>
            : undefined}
            orderPackagingExtras={
              <div className="space-y-3">
                <Label htmlFor="packageRequirement">包装补充说明</Label>
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
            footerExtras={
              <section className="space-y-3">
                <Label htmlFor="remark">工单备注</Label>
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
                      <h2 className="text-xs font-semibold tracking-widest text-muted-foreground">
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
                            <h3 className="text-sm font-semibold">
                              地址 {shipmentIndex + 2}
                            </h3>
                            {/* 从本单拿掉一个地址 = 移除，不是永久删除；用中性 outline，不手写红色（§8.2）。 */}
                            <Button
                              type="button"
                              variant="outline"
                              disabled={orderFormControlsDisabled}
                              onClick={() => shipmentsArray.remove(shipmentIndex)}
                            >
                              移除地址
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
                                required
                                aria-invalid={submissionValidationVisible && !watchedShipments[shipmentIndex]?.receiverName?.trim()}
                                aria-describedby={submissionValidationVisible && !watchedShipments[shipmentIndex]?.receiverName?.trim() ? `extra-${shipmentIndex}-receiverName-error` : undefined}
                                className="mt-2 h-10"
                                {...register(
                                  `additionalShipments.${shipmentIndex}.receiverName`,
                                )}
                              />
                              <FieldError id={`extra-${shipmentIndex}-receiverName-error`} reservedLines={1}>
                                {submissionValidationVisible && !watchedShipments[shipmentIndex]?.receiverName?.trim() ? '请填写收件人' : undefined}
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
                                required
                                aria-invalid={submissionValidationVisible && !watchedShipments[shipmentIndex]?.receiverPhone?.trim()}
                                aria-describedby={submissionValidationVisible && !watchedShipments[shipmentIndex]?.receiverPhone?.trim() ? `extra-${shipmentIndex}-receiverPhone-error` : undefined}
                                className="mt-2 h-10"
                                {...register(
                                  `additionalShipments.${shipmentIndex}.receiverPhone`,
                                )}
                              />
                              <FieldError id={`extra-${shipmentIndex}-receiverPhone-error`} reservedLines={1}>
                                {submissionValidationVisible && !watchedShipments[shipmentIndex]?.receiverPhone?.trim() ? '请填写联系电话' : undefined}
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
                              <ReceiverAddressPasteField
                                id={`additionalShipments.${shipmentIndex}.receiverAddress`}
                                label="详细地址"
                                value={watchedShipments[shipmentIndex]?.receiverAddress ?? ''}
                                invalid={Boolean(errors.additionalShipments?.[shipmentIndex]?.receiverAddress)}
                                onChange={(next, parsed) => {
                                  setValue(`additionalShipments.${shipmentIndex}.receiverAddress`, next, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  });
                                  if (parsed.receiverName) {
                                    setValue(`additionalShipments.${shipmentIndex}.receiverName`, parsed.receiverName, { shouldDirty: true });
                                  }
                                  if (parsed.receiverPhone) {
                                    setValue(`additionalShipments.${shipmentIndex}.receiverPhone`, parsed.receiverPhone, { shouldDirty: true });
                                  }
                                  setValue(`additionalShipments.${shipmentIndex}.destinationProvince`, parsed.province, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  });
                                }}
                              />
                              <FieldError reservedLines={1}>
                                {errors.additionalShipments?.[shipmentIndex]?.receiverAddress?.message}
                              </FieldError>
                            </div>
                          </div>
                          <fieldset className="mt-4">
                            <legend className="text-xs font-bold tracking-widest text-muted-foreground">
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
            pendingDesigns={selectedDesignQueues}
            packaging={packagingView}
            paperOptions={externalPaperOptions}
            paperKey={activeExternalPaper?.key ?? null}
            weightOptions={externalWeightOptions}
            specificationOptions={externalSpecificationOptions}
            foilOptions={externalCreateOrderOptions ? externalFoilOptions : undefined}
            allowManualWeight={canAssignExternalSales}
            allowCustomSize
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
                : initialExternalPriceSnapshot
                  ? `加工 v${initialExternalPriceSnapshot.processing.version} / 物流 v${initialExternalPriceSnapshot.logistics.version} · 草稿未保存`
                  : '草稿未保存'
            }
            fieldErrors={externalFieldErrors}
            errorFocusRequest={errorFocusRequest}
            errorFocusMessage={errorFocusMessage}
            rail={
              <OrderFormBRail allowEditFees={canAssignExternalSales}
                itemCount={itemsArray.fields.length}
                quoteItems={railQuoteItems}
                packaging={railPackaging}
                logistics={railLogistics}
                usesExternalSalesPricing
                allowSaveDraft={!isExternalSalesActor}
                settlementLabel={settlementLabel}
                knownTotal={displayedKnownTotal}
                totalSemantics={displayedTotalSemantics}
                plateFee={currentCreateOrderQuote?.plateFee ?? null}
                gaps={orderFormBGaps}
                busy={
                  pendingState.busy ||
                  externalQuoteQuoting ||
                  externalQuoteNeedsRefresh ||
                  Boolean(createdDraft)
                }
                onAttemptSubmit={(intent) => {
                  setErrorFocusMessage(undefined);
                  if (intent !== 'draft') setSubmissionValidationVisible(true);
                }}
                onItemClick={(key) => {
                  const index = itemsArray.fields.findIndex((field) => field.id === key);
                  if (index >= 0) setExpandedItem(index);
                }}
                onGapClick={(index) => {
                  setSubmissionValidationVisible(true);
                  setErrorFocusMessage(orderFormBGaps[index]);
                  setErrorFocusRequest((current) => current + 1);
                }}
              />
            }
            onActiveIndexChange={setExpandedItem}
            onAdd={() => {
              const nextIndex = itemsArray.fields.length;
              duplicateItem(expandedItem);
              setExpandedItem(nextIndex);
            }}
            onAddSpecification={() => {
              const nextIndex = itemsArray.fields.length;
              duplicateItem(expandedItem, true);
              setExpandedItem(nextIndex);
            }}
            onDuplicate={(index) => {
              const nextIndex = itemsArray.fields.length;
              duplicateItem(index);
              setExpandedItem(nextIndex);
            }}
            onRemove={(index) => {
              if (designItemIndexes(getValues('items'), index).length > 1) removeItems([index]);
            }}
            onRemoveDesign={(index) => removeItems(designItemIndexes(getValues('items'), index))}
            onCustomNameChange={(value) => {
              syncSingleDesignName(value, getValues('customName'));
              setValue('customName', value, {
                shouldDirty: true,
              });
              setExternalInputRevision((current) => current + 1);
            }}
            onPurposeChange={externalCreateOrderOptions && !createdDraft ? (purpose) => {
              prepareSampleOrderEntry(getValues(), expandedItem, draftScope, purpose);
              chooseSamplePurpose(purpose);
            } : undefined}
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
              for (const member of designItemIndexes(getValues('items'), expandedItem)) {
                const current = getValues(`items.${member}`);
                commitOrderFormBItem(member, { ...current, lamination });
              }
            }}
            onQuantityChange={(quantity) => {
              setValue(`items.${expandedItem}.quantity`, quantity, {
                shouldDirty: true,
                shouldValidate: true,
              });
            }}
            onPackagingTypeChange={changePackagingType}
            onPackagingMixingChange={changePackagingMixing}
            onUnitsPerBagChange={changeExternalUnitsPerBag}
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
      {createdDraft && createdDraft.intent === 'draft' ? (
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
                onNavigate={leave.guard?.(`/orders/${createdDraft.orderId}`)}
                className={buttonVariants({ variant: 'outline' })}
              >
                打开草稿
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}
      {pendingSubmission ? (
        <OrderSubmissionReviewDialog
          open
          onOpenChange={(open) => {
            if (!open && !submitting && !uploading && !createdDraft) {
              setPendingSubmission(null);
            }
          }}
          orderName={pendingSubmission.data.customName?.trim() || pendingSubmission.data.items[0]?.name || '新建工单'}
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
          feeDetails={<OrderCreateFeeDetails
            quoteItems={railQuoteItems} packaging={railPackaging} logistics={railLogistics}
            usesExternalSalesPricing plateFee={currentCreateOrderQuote?.plateFee}
          />}
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
          totalNote={uploadError ?? serverGeneralError ?? orderCreateFeeSummary({
            quoteItems: railQuoteItems, packaging: railPackaging, logistics: railLogistics,
            usesExternalSalesPricing: true, totalSemantics: displayedTotalSemantics,
            plateFee: currentCreateOrderQuote?.plateFee,
          }).totalNote ?? undefined}
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
              pendingSubmission.intent,
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

function initialOrderFormValues(clientSubmissionId: string, initialItem: ReturnType<typeof createExternalOrderItem>): CreateOrderInput {
  return {
      clientSubmissionId,
      nextItemFig: 2,
      customName: null,
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

function adminCreatePricingState(
  watchedItems: CreateOrderInput['items'],
  watchedPackagingGroups: CreateOrderInput['packagingGroups'],
  watchedShipments: CreateOrderInput['additionalShipments'],
  canAssignExternalSales: boolean,
) {
  function adminPriceFacts(item: CreateOrderInput['items'][number]) {
    return adminCreatePriceFactsKey({ ...item, manualQuoteReason: null });
  }
  const adminPrices = watchedItems.map((item) => {
    if (!canAssignExternalSales || !item.adminPrice) return null;
    if (item.adminPrice.factsKey !== adminPriceFacts(item))
      return { error: '款式条件已变化，请重新确认人工价格' };
    try {
      return { price: calculateAdminCreatePrice(item.adminPrice) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : '请核对人工价格',
      };
    }
  });
  function adminPackagingFacts(
    group: CreateOrderInput['packagingGroups'][number],
  ) {
    return adminPackagingPriceFactsKey(
      group,
      watchedItems.map((item) => item.quantity),
      watchedShipments.map((shipment) => shipment.itemQuantities),
    );
  }
  const adminPackagingPrices = watchedPackagingGroups.map((group) => {
    if (
      !canAssignExternalSales ||
      !group.adminPrice ||
      group.mode === OrderPackagingMode.UNPACKED
    )
      return null;
    if (group.adminPrice.factsKey !== adminPackagingFacts(group))
      return { error: '包装条件已变化，请重新确认包装价格' };
    try {
      return {
        price: calculateAdminPackagingPrice(
          group.adminPrice,
          group.actualBagCount,
        ),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : '请核对包装价格',
      };
    }
  });
  const hasAdminPrices =
    adminPrices.some(Boolean) || adminPackagingPrices.some(Boolean);

  return {
    adminPriceFacts,
    adminPackagingFacts,
    adminPrices,
    adminPackagingPrices,
    hasAdminPrices,
  };
}

function resolveCreatePriceTotalSemantics(
  manual: boolean,
  items: readonly { status: string }[],
  packagingStatus: string,
  logisticsStatus: string | undefined,
  automatic:
    | {
        plateFee?: unknown;
        totalSemantics: 'COMPLETE' | 'EXCLUDES_MANUAL_ITEMS';
      }
    | undefined,
): 'COMPLETE' | 'EXCLUDES_MANUAL_ITEMS' | undefined {
  if (!manual) return automatic?.totalSemantics;
  return items.every((item) => item.status === 'complete') &&
    packagingStatus === 'complete' &&
    logisticsStatus === 'complete' &&
    !automatic?.plateFee
    ? 'COMPLETE'
    : 'EXCLUDES_MANUAL_ITEMS';
}
