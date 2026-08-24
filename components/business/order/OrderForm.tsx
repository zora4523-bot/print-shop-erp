'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
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
import { createOrderAction } from '@/actions/order';
import { quoteOrderItemsAction } from '@/actions/order-quote';
import { quoteExternalOrderChargesAction } from '@/actions/order-logistics-quote';
import type { CreateOrderMutationResult } from '@/actions/order.types';
import type { QuoteResult } from '@/lib/price/quote';
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
import {
  ORDER_PAPER_OPTIONS,
  ORDER_SPECIFICATION_OPTIONS,
} from './order-item-options';
import { uploadOrderItemDesignFile } from './design-upload-client';
import { OrderFormRail } from './OrderFormRail';
import {
  collectOrderFormGaps,
  ORDER_FORM_STEP_LABELS,
  PRINT_ITEM_IMAGE_WARN_COUNT,
  type OrderFormGap,
  type OrderFormQuoteStatus,
  type OrderFormStep,
} from './order-form-gaps';
import {
  localOrderFormDraftStorageKey,
  parseLocalOrderFormDraft,
  serializeLocalOrderFormDraft,
} from './order-form-local-draft';

export type CraftOption = {
  id: string;
  name: string;
  isOutsource: boolean;
  isLowFrequency: boolean;
};

export type ProductOption = {
  id: string;
  name: string;
  category: string;
  specification: string | null;
  paperType: string | null;
};

type Props = {
  crafts: CraftOption[];
  products: ProductOption[];
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

type QuoteFacts = Parameters<typeof quoteFactsKey>[0];

const BLANK_ITEM: CreateOrderInput['items'][number] = {
  name: '',
  productId: null,
  specification: null,
  paperType: null,
  quantity: 1000,
  crafts: [],
  foilColors: [],
  isDoubleSided: false,
  isDoubleColor: false,
  unitPrice: null,
  fixedFee: null,
  suggestedSubtotal: null,
  priceOverrideReason: null,
  remark: null,
};

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

function quoteFactsKey(item: {
  productId?: string | null;
  specification?: string | null;
  paperType?: string | null;
  quantity?: number;
  crafts?: string[];
  foilColors?: string[];
  isDoubleSided?: boolean;
  isDoubleColor?: boolean;
} | null | undefined): string {
  return JSON.stringify({
    productId: item?.productId ?? null,
    specification: item?.specification ?? null,
    paperType: item?.paperType ?? null,
    quantity: item?.quantity ?? null,
    crafts: [...(item?.crafts ?? [])].sort(),
    foilColors: [...(item?.foilColors ?? [])].sort(),
    isDoubleSided: item?.isDoubleSided ?? false,
    isDoubleColor: item?.isDoubleColor ?? false,
  });
}

function chargeAmountMatches(
  actual: string | null | undefined,
  suggested: string | null,
): boolean {
  const trimmed = actual?.trim() ?? '';
  if (trimmed === '') return suggested === null;
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(trimmed)) return false;
  return Number(trimmed).toFixed(2) === suggested;
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

export function OrderForm({
  crafts,
  products,
  settlementLabel,
  usesExternalSalesPricing,
  draftScope,
}: Props) {
  const router = useRouter();
  const form = useForm<CreateOrderInput>({
    // zodResolver's generics don't fully compose with preprocess-bearing
    // schemas (moneyOptionalField uses `z.preprocess`, which splits
    // z.input / z.output). The runtime contract still holds — we just
    // widen the compile-time seam.
    resolver: zodResolver(createOrderSchema) as never,
    mode: 'onBlur',
    defaultValues: {
      customName: null,
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
      items: [{ ...BLANK_ITEM }],
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
  const watchedItems = useWatch({ control, name: 'items' });
  const watchedFormValues = useWatch({ control });
  const watchedShipments = useWatch({ control, name: 'additionalShipments' });
  const watchedCustomerRef = useWatch({ control, name: 'customerRef' });
  const watchedPromisedDate = useWatch({ control, name: 'promisedDate' });
  const watchedReceiverAddress = useWatch({
    control,
    name: 'receiverAddress',
  });
  const watchedCustomerChargeOverrideReason = useWatch({
    control,
    name: 'customerChargeOverrideReason',
  });
  const watchedIsSfCollect = useWatch({ control, name: 'isSfCollect' });
  const watchedDestinationProvince = useWatch({
    control,
    name: 'destinationProvince',
  });
  const watchedQuotedWeightKg = useWatch({
    control,
    name: 'quotedWeightKg',
  });
  const watchedShippingFee = useWatch({ control, name: 'shippingFee' });
  const watchedPackingMaterialFee = useWatch({
    control,
    name: 'packingMaterialFee',
  });
  const commonCrafts = crafts.filter((craft) => !craft.isLowFrequency);
  const lowFrequencyCrafts = crafts.filter((craft) => craft.isLowFrequency);

  const [state, setState] = useState<CreateOrderMutationResult | null>(null);
  const [pendingDesigns, setPendingDesigns] = useState<
    Record<string, PendingDesignImage[]>
  >({});
  const [createdDraft, setCreatedDraft] = useState<{
    orderId: string;
    itemIds: string[];
    fieldIds: string[];
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
  const [step, setStep] = useState<OrderFormStep>('customer');
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
        ? parseLocalOrderFormDraft(localDraftSnapshot)
        : null,
    [localDraftSnapshot],
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

  useEffect(() => {
    itemFieldIdsRef.current = itemsArray.fields.map((field) => field.id);
  }, [itemsArray.fields]);

  useEffect(() => {
    if (!localDraftReady || pendingLocalDraft || createdDraft || !isDirty) {
      return;
    }
    const timer = window.setTimeout(() => {
      const savedAt = new Date();
      const serialized = serializeLocalOrderFormDraft(
        watchedFormValues,
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
    localDraftStorageKey,
    pendingLocalDraft,
    watchedFormValues,
  ]);

  async function uploadPendingDesigns(
    draft: NonNullable<typeof createdDraft>,
    queues: Record<string, PendingDesignImage[]>,
  ) {
    const total = draft.fieldIds.reduce(
      (sum, fieldId) => sum + (queues[fieldId]?.length ?? 0),
      0,
    );
    if (total === 0) {
      router.push(`/orders/${draft.orderId}`);
      return;
    }

    setUploading(true);
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
          failureMessages.push(`款式 ${itemIndex + 1} 的数据库编号缺失`);
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
    setUploading(false);
    if (failureMessages.length === 0) {
      router.push(`/orders/${draft.orderId}`);
      return;
    }
    setUploadError(
      `草稿已创建，但有 ${failureMessages.length} 张图片未上传：${failureMessages.join('；')}`,
    );
  }

  function restoreLocalDraft() {
    if (!pendingLocalDraft) return;
    reset(pendingLocalDraft.values as unknown as CreateOrderInput);
    setQuoteViews({});
    setLogisticsQuote(null);
    setPendingDesigns({});
    setStep('customer');
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
      setLocalDraftError('本地旧草稿无法删除；本次可继续填写，但请留意下次打开时的恢复提示。');
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

  const onValid: SubmitHandler<CreateOrderInput> = (data) => {
    // The disabled submit button covers clicks; this guard also blocks Enter
    // key or programmatic submits while an authoritative logistics quote is in flight.
    if (createdDraft || logisticsQuoting) return;
    const fieldIds = itemsArray.fields.map((field) => field.id);
    const queueSnapshot = Object.fromEntries(
      fieldIds.map((fieldId) => [fieldId, pendingDesigns[fieldId] ?? []]),
    );

    setState(null);
    setUploadError(null);
    startSubmit(async () => {
      const submittedData = data.isSfCollect
        ? {
            ...data,
            destinationProvince: null,
            quotedWeightKg: null,
            shippingFee: '0.00',
            additionalShipments: data.additionalShipments.map((shipment) => ({
              ...shipment,
              destinationProvince: null,
              quotedWeightKg: null,
              shippingFee: '0.00',
            })),
          }
        : data;
      const result = await createOrderAction(null, submittedData);
      setState(result);
      if (result.status !== 'success') return;

      clearLocalDraftAfterServerCreate();

      const draft = {
        orderId: result.orderId,
        itemIds: result.itemIds,
        fieldIds,
      };
      setCreatedDraft(draft);
      await uploadPendingDesigns(draft, queueSnapshot);
    });
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
    itemsArray.remove(index);
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
    itemsArray.append({ ...BLANK_ITEM });
  }

  function applySfCollectState(checked: boolean) {
    const chargeOptions = {
      shouldDirty: true,
      shouldValidate: true,
    } as const;
    setValue('destinationProvince', null, chargeOptions);
    setValue('quotedWeightKg', null, chargeOptions);
    setValue('shippingFee', checked ? '0.00' : null, chargeOptions);
    setValue(
      'additionalShipments',
      getValues('additionalShipments').map((shipment) => ({
        ...shipment,
        destinationProvince: null,
        quotedWeightKg: null,
        shippingFee: checked ? '0.00' : null,
      })),
      chargeOptions,
    );
    setLogisticsQuote(null);
  }

  function calculateAndApplyQuote(index: number, fieldId: string) {
    const item = getValues(`items.${index}`);
    const facts: QuoteFacts = {
      productId: item.productId,
      specification: item.specification,
      paperType: item.paperType,
      quantity: item.quantity,
      crafts: item.crafts,
      foilColors: item.foilColors,
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
            [fieldId]: { inputKey, error: '服务端未返回报价结果' },
          }));
        } else {
          setQuoteViews((current) => ({
            ...current,
            [fieldId]: { inputKey, result },
          }));
          if (result.complete && factsStillCurrent) {
            setValue(`items.${index}.unitPrice`, result.suggestedUnitPrice, {
              shouldDirty: true,
              shouldValidate: true,
            });
            setValue(`items.${index}.fixedFee`, result.suggestedFixedFee, {
              shouldDirty: true,
              shouldValidate: true,
            });
            setValue(`items.${index}.suggestedSubtotal`, result.suggestedSubtotal, {
              shouldDirty: true,
              shouldValidate: true,
            });
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
  }

  function currentLogisticsQuoteInput() {
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
      shipments: [
        {
          shipmentKey: '1',
          province: values.destinationProvince,
          billableWeightKg: values.quotedWeightKg,
          itemQuantity: primaryItemQuantities.reduce(
            (sum, quantity) => sum + quantity,
            0,
          ),
        },
        ...additional.map((shipment, index) => ({
          shipmentKey: String(index + 2),
          province: shipment.destinationProvince,
          billableWeightKg: shipment.quotedWeightKg,
          itemQuantity: shipment.itemQuantities.reduce(
            (sum, quantity) => sum + quantity,
            0,
          ),
        })),
      ],
    };
  }

  function calculateAndApplyLogisticsQuote() {
    const input = currentLogisticsQuoteInput();
    const inputKey = JSON.stringify(input);
    startLogisticsQuote(async () => {
      const response = await quoteExternalOrderChargesAction(input);
      if (response.status === 'success') {
        if (JSON.stringify(currentLogisticsQuoteInput()) !== inputKey) {
          setLogisticsQuote({ inputKey, result: response.quote });
          return;
        }
        for (const [index, shipment] of response.quote.shipments.entries()) {
          const shippingPath =
            index === 0
              ? 'shippingFee'
              : (`additionalShipments.${index - 1}.shippingFee` as const);
          const packingPath =
            index === 0
              ? 'packingMaterialFee'
              : (`additionalShipments.${index - 1}.packingMaterialFee` as const);
          setValue(shippingPath, shipment.shipping.amount, {
            shouldDirty: true,
            shouldValidate: true,
          });
          setValue(packingPath, shipment.packaging.amount, {
            shouldDirty: true,
            shouldValidate: true,
          });
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
        error: error || '服务端未返回物流报价结果',
      });
    });
  }

  const watchedPrimaryQuantities = watchedItems.map((item, itemIndex) => {
    const allocated = watchedShipments.reduce(
      (sum, shipment) => sum + (shipment.itemQuantities[itemIndex] ?? 0),
      0,
    );
    return item.quantity - allocated;
  });
  const currentLogisticsInputKey = JSON.stringify({
    isSfCollect: watchedIsSfCollect,
    shipments: [
      {
        shipmentKey: '1',
        province: watchedDestinationProvince,
        billableWeightKg: watchedQuotedWeightKg,
        itemQuantity: watchedPrimaryQuantities.reduce(
          (sum, quantity) => sum + quantity,
          0,
        ),
      },
      ...watchedShipments.map((shipment, index) => ({
        shipmentKey: String(index + 2),
        province: shipment.destinationProvince,
        billableWeightKg: shipment.quotedWeightKg,
        itemQuantity: shipment.itemQuantities.reduce(
          (sum, quantity) => sum + quantity,
          0,
        ),
      })),
    ],
  });
  const currentLogisticsChargeAmounts = [
    {
      shippingFee: watchedShippingFee,
      packingMaterialFee: watchedPackingMaterialFee,
    },
    ...watchedShipments.map((shipment) => ({
      shippingFee: shipment.shippingFee,
      packingMaterialFee: shipment.packingMaterialFee,
    })),
  ];
  const logisticsQuoteAmountsAdjusted = Boolean(
    logisticsQuote?.result &&
      (logisticsQuote.result.shipments.length !==
        currentLogisticsChargeAmounts.length ||
        logisticsQuote.result.shipments.some((shipment, index) => {
          const actual = currentLogisticsChargeAmounts[index];
          return (
            !actual ||
            !chargeAmountMatches(
              actual.shippingFee,
              shipment.shipping.amount,
            ) ||
            !chargeAmountMatches(
              actual.packingMaterialFee,
              shipment.packaging.amount,
            )
          );
        }))
  );

  // Zod produces dotted paths like `items.0.quantity` on the action side
  // (actions/order.ts collectFieldErrors). Those don't apply here because
  // RHF's client-side validation renders field errors via its own tree.
  // `state?.fieldErrors` from the server still captures backend-only
  // checks (craft id existence, product deactivated) that client Zod
  // doesn't know about.
  const serverFieldErrors =
    state?.status === 'invalid' ? state.fieldErrors : undefined;
  const serverGeneralError =
    state?.status === 'error' ? state.message : null;
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

    const completeQuote =
      quoteStatus === 'complete' ? view?.result : undefined;
    const manualPriceProvided =
      hasAmount(item.unitPrice) || hasAmount(item.fixedFee);
    const priceOverrideRequired = completeQuote
      ? !quoteAmountMatches(
          item.unitPrice,
          completeQuote.suggestedUnitPrice,
          4,
        ) ||
        !quoteAmountMatches(
          item.fixedFee,
          completeQuote.suggestedFixedFee,
          2,
        )
      : manualPriceProvided;
    return {
      ...item,
      quoteStatus,
      manualPriceProvided,
      priceOverrideRequired,
    };
  });

  let logisticsQuoteStatus: OrderFormQuoteStatus = 'missing';
  if (logisticsQuoting) {
    logisticsQuoteStatus = 'loading';
  } else if (
    logisticsQuote?.inputKey !== undefined &&
    logisticsQuote.inputKey !== currentLogisticsInputKey
  ) {
    logisticsQuoteStatus = 'stale';
  } else if (logisticsQuote?.error) {
    logisticsQuoteStatus = 'error';
  } else if (logisticsQuote?.result?.complete) {
    logisticsQuoteStatus = 'complete';
  } else if (logisticsQuote?.result) {
    logisticsQuoteStatus = 'incomplete';
  }
  const currentLogisticsResult =
    logisticsQuoteStatus === 'complete' ||
    logisticsQuoteStatus === 'incomplete'
      ? logisticsQuote?.result
      : undefined;
  const primaryQuoteLine = currentLogisticsResult?.shipments[0];
  const shipmentGapInputs = [
    {
      key: 'primary',
      label: '主地址',
      idPrefix: 'primary',
      receiverFieldId: 'receiverAddress',
      receiverAddress: watchedReceiverAddress,
      province: watchedDestinationProvince,
      billableWeightKg: watchedQuotedWeightKg,
      shippingFee: watchedShippingFee,
      packingMaterialFee: watchedPackingMaterialFee,
      chargeOverrideReason: watchedCustomerChargeOverrideReason,
      chargeOverrideRequired: primaryQuoteLine
        ? !chargeAmountMatches(
            watchedShippingFee,
            primaryQuoteLine.shipping.amount,
          ) ||
          !chargeAmountMatches(
            watchedPackingMaterialFee,
            primaryQuoteLine.packaging.amount,
          )
        : hasAmount(watchedShippingFee) || hasAmount(watchedPackingMaterialFee),
    },
    ...watchedShipments.map((shipment, index) => {
      const quoteLine = currentLogisticsResult?.shipments[index + 1];
      return {
        key: `additional-${index}`,
        label: `额外地址 ${index + 1}`,
        idPrefix: `shipment-${index}`,
        receiverFieldId: `additionalShipments.${index}.receiverAddress`,
        receiverAddress: shipment.receiverAddress,
        province: shipment.destinationProvince,
        billableWeightKg: shipment.quotedWeightKg,
        shippingFee: shipment.shippingFee,
        packingMaterialFee: shipment.packingMaterialFee,
        chargeOverrideReason: shipment.customerChargeOverrideReason,
        chargeOverrideRequired: quoteLine
          ? !chargeAmountMatches(
              shipment.shippingFee,
              quoteLine.shipping.amount,
            ) ||
            !chargeAmountMatches(
              shipment.packingMaterialFee,
              quoteLine.packaging.amount,
            )
          : hasAmount(shipment.shippingFee) ||
            hasAmount(shipment.packingMaterialFee),
      };
    }),
  ];
  const formGaps = collectOrderFormGaps({
    customerRef: watchedCustomerRef,
    promisedDate: watchedPromisedDate,
    items: itemGapInputs,
    shipping: {
      usesExternalSalesPricing,
      isSfCollect: watchedIsSfCollect,
      quoteStatus: logisticsQuoteStatus,
      shipments: shipmentGapInputs,
    },
  });
  const totalQuantity = watchedItems.reduce(
    (sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0),
    0,
  );

  function jumpToGap(gap: OrderFormGap) {
    setStep(gap.step);
    if (gap.itemIndex !== undefined) setExpandedItem(gap.itemIndex);
    window.setTimeout(() => {
      document.getElementById(gap.fieldId)?.focus();
    }, 0);
  }

  function handleStepKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentStep: OrderFormStep,
  ) {
    const steps = Object.keys(ORDER_FORM_STEP_LABELS) as OrderFormStep[];
    const currentIndex = steps.indexOf(currentStep);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % steps.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + steps.length) % steps.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = steps.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextStep = steps[nextIndex];
    setStep(nextStep);
    window.setTimeout(() => {
      document.getElementById(`order-step-${nextStep}-tab`)?.focus();
    }, 0);
  }

  return (
    <form
      onSubmit={handleSubmit(onValid)}
      className="space-y-4"
      noValidate
      aria-busy={!localDraftReady}
    >
      {pendingLocalDraft ? (
        <section
          role="alert"
          aria-labelledby="local-order-draft-heading"
          className="rounded-xl border border-warning/50 bg-warning/10 p-4"
        >
          <h2 id="local-order-draft-heading" className="font-semibold">
            发现本机未提交的表单草稿
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            最近保存于 {formatLocalDraftTime(pendingLocalDraft.savedAt)}。请先选择恢复或放弃；系统不会静默覆盖当前表单。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            本地草稿只包含表单字段，不包含设计图或 File；产品、工艺和价格仍按当前服务端规则校验。
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

      <fieldset disabled={!localDraftReady} className="contents">
      <div
        className="flex min-w-0 flex-col gap-2 sm:flex-row"
        role="tablist"
        aria-label="建单步骤"
      >
        {(Object.keys(ORDER_FORM_STEP_LABELS) as OrderFormStep[]).map(
          (key) => {
            const count = formGaps.filter((gap) => gap.step === key).length;
            const active = step === key;
            return (
              <Button
                key={key}
                id={`order-step-${key}-tab`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`order-step-${key}-panel`}
                tabIndex={active ? 0 : -1}
                variant={active ? 'default' : 'outline'}
                className="min-h-11 flex-1 justify-between"
                onClick={() => setStep(key)}
                onKeyDown={(event) => handleStepKeyDown(event, key)}
              >
                <span>{ORDER_FORM_STEP_LABELS[key]}</span>
                {count > 0 ? (
                  <span className="font-sans text-xs tabular-nums">
                    {count} 个缺口
                  </span>
                ) : null}
              </Button>
            );
          },
        )}
      </div>

      {formGaps.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-destructive/30 bg-card p-3 xl:hidden">
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

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start xl:gap-4">
      <div className="min-w-0 space-y-4">
      <section
        className={
          step === 'items'
            ? 'hidden'
            : 'space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6'
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-base font-semibold">
            {ORDER_FORM_STEP_LABELS[step]}
          </h2>
          <p className="rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            结算路径：<span className="font-medium text-foreground">{settlementLabel}</span>
          </p>
        </div>

        <div
          id="order-step-customer-panel"
          role="tabpanel"
          aria-labelledby="order-step-customer-tab"
          tabIndex={0}
          className={step === 'customer' ? 'space-y-4' : 'hidden'}
        >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="工单自定义名称"
            hint="例如：王总中秋礼盒首批；最多 100 个字符"
            full
            registration={register('customName')}
            error={errors.customName?.message}
          />
          <TextField
            label="客户名称/简称（选填）"
            registration={register('customerRef')}
            error={errors.customerRef?.message}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="承诺交期（选填）"
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

        <div
          id="order-step-shipping-panel"
          role="tabpanel"
          aria-labelledby="order-step-shipping-tab"
          tabIndex={0}
          className={step === 'shipping' ? 'space-y-4' : 'hidden'}
        >
        <TextField
          label="快递代码"
          registration={register('expressCode')}
          error={errors.expressCode?.message}
        />
        <TextareaField
          label="收货信息"
          hint="请在一处填写收货人、联系电话和完整地址"
          registration={register('receiverAddress')}
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
              onChange: (event) =>
                applySfCollectState(Boolean(event.target.checked)),
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
                  地址 1 · 对客快递与打包耗材费
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  中通按每票计费；重量请填承运商已进位的计费重量。纸箱金额仅作参考，需确认后保存。
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
                {logisticsQuoting ? '计算中…' : '计算全部地址建议费'}
              </Button>
            </div>
            <ShipmentCustomerChargeFields
              idPrefix="primary"
              provinceRegistration={register('destinationProvince')}
              weightRegistration={register('quotedWeightKg', {
                setValueAs: (value) => (value === '' ? null : value),
              })}
              shippingRegistration={register('shippingFee', {
                setValueAs: (value) => (value === '' ? null : value),
              })}
              packingRegistration={register('packingMaterialFee', {
                setValueAs: (value) => (value === '' ? null : value),
              })}
              reasonRegistration={register('customerChargeOverrideReason')}
              provinceError={errors.destinationProvince?.message}
              weightError={errors.quotedWeightKg?.message}
              shippingError={errors.shippingFee?.message}
              packingError={errors.packingMaterialFee?.message}
              reasonError={errors.customerChargeOverrideReason?.message}
              isSfCollect={watchedIsSfCollect}
            />
            <LogisticsQuoteFeedback
              view={logisticsQuote}
              adjusted={logisticsQuoteAmountsAdjusted}
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
        id="order-step-items-panel"
        role="tabpanel"
        aria-labelledby="order-step-items-tab"
        tabIndex={0}
        className={
          step === 'items'
            ? 'space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6'
            : 'hidden'
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">款式（{itemsArray.fields.length}）</h2>
          <Button
            type="button"
            variant="outline"
            disabled={submitting || uploading || Boolean(createdDraft)}
            onClick={() => {
              addItem();
              setExpandedItem(itemsArray.fields.length);
            }}
          >
            添加款式
          </Button>
        </div>
        {itemsArray.fields.length >= PRINT_ITEM_IMAGE_WARN_COUNT ? (
          <p className="text-sm text-warning-foreground">
            A4 打印最多 5 款带图。第 {PRINT_ITEM_IMAGE_WARN_COUNT}{' '}
            款起建议分款式打印，以免车间看不清。
          </p>
        ) : null}

        {errors.items?.message ? (
          <p className="text-sm text-destructive">{errors.items.message}</p>
        ) : null}

        <ol className="space-y-4">
          {itemsArray.fields.map((field, index) => (
            <li key={field.id} className="min-w-0 space-y-3 rounded-lg border p-3 text-sm">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  aria-expanded={expandedItem === index}
                  aria-controls={`order-item-${index}-editor`}
                  className="h-auto min-h-11 min-w-0 flex-1 justify-start whitespace-normal rounded-md px-1 py-1 text-left"
                  onClick={() =>
                    setExpandedItem(expandedItem === index ? -1 : index)
                  }
                >
                  <span className="text-xs text-muted-foreground">#{index + 1}</span>
                  <span className="ml-2 font-medium">
                    {watchedItems[index]?.name?.trim() || '未命名款式'}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {(watchedItems[index]?.quantity ?? 0).toLocaleString()} 个
                    {(watchedItems[index]?.crafts?.length ?? 0) > 0
                      ? ` · ${watchedItems[index]?.crafts.length} 项工艺`
                      : ' · 未选工艺'}
                  </span>
                </Button>
                {index > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting || uploading || Boolean(createdDraft)}
                    onClick={() => {
                      const previous = getValues(`items.${index - 1}`);
                      setValue(`items.${index}`, {
                        ...previous,
                        name: previous.name ? `${previous.name} 副本` : '',
                      });
                      setExpandedItem(index);
                    }}
                  >
                    复制上一款
                  </Button>
                ) : null}
                {itemsArray.fields.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting || uploading || Boolean(createdDraft)}
                    onClick={() => removeItem(index, field.id)}
                  >
                    删除
                  </Button>
                ) : null}
              </div>
              <div
                id={`order-item-${index}-editor`}
                className={expandedItem === index ? 'space-y-3' : 'hidden'}
              >
              <p className="text-xs text-muted-foreground">
                正在编辑 #{index + 1} · 纸张、工艺与报价选项都在这里，字段没有减少
              </p>

              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <TextField
                  label="款式名"
                  required
                  registration={register(`items.${index}.name`)}
                  error={errors.items?.[index]?.name?.message}
                />
                <div className="space-y-1">
                  <Label htmlFor={`items.${index}.productId`}>
                    报价产品（自动报价必选）
                  </Label>
                  <select
                    id={`items.${index}.productId`}
                    className={selectClass}
                    {...register(`items.${index}.productId`, {
                      setValueAs: (v) => (v === '' ? null : v),
                      onChange: (event) => {
                        const product = products.find(
                          (candidate) => candidate.id === event.target.value,
                        );
                        setValue(
                          `items.${index}.specification`,
                          product?.specification ?? null,
                          { shouldDirty: true, shouldValidate: true },
                        );
                        setValue(
                          `items.${index}.paperType`,
                          product?.paperType ?? null,
                          { shouldDirty: true, shouldValidate: true },
                        );
                      },
                    })}
                  >
                    <option value="">— 不关联（需人工报价）—</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <Controller
                control={control}
                name={`items.${index}.specification`}
                render={({ field: specificationField }) => (
                  <OrderItemChoiceField
                    id={`items.${index}.specification`}
                    label="规格"
                    value={specificationField.value}
                    options={ORDER_SPECIFICATION_OPTIONS}
                    customLabel="非标定制（自定义尺寸）"
                    customInputLabel="自定义尺寸 / 规格"
                    customPlaceholder="例如：9.5 × 17.2 cm、客户来样"
                    maxLength={64}
                    disabled={submitting || uploading || Boolean(createdDraft)}
                    error={errors.items?.[index]?.specification?.message}
                    onChange={specificationField.onChange}
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
                    options={ORDER_PAPER_OPTIONS}
                    customLabel="其他纸张（自定义）"
                    customInputLabel="自定义纸张"
                    customPlaceholder="输入特殊纸张名称"
                    maxLength={32}
                    disabled={submitting || uploading || Boolean(createdDraft)}
                    error={errors.items?.[index]?.paperType?.message}
                    onChange={paperField.onChange}
                    onBlur={paperField.onBlur}
                  />
                )}
              />

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

              <Controller
                control={control}
                name={`items.${index}.foilColors`}
                render={({ field: foilColorsField }) => (
                  <OrderFoilColorsField
                    id={`items.${index}.foilColors`}
                    value={foilColorsField.value}
                    disabled={submitting || uploading || Boolean(createdDraft)}
                    error={errors.items?.[index]?.foilColors?.message}
                    onChange={foilColorsField.onChange}
                    onBlur={foilColorsField.onBlur}
                  />
                )}
              />

              <div className="flex flex-wrap gap-4 sm:gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...register(`items.${index}.isDoubleSided`)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>双面</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    {...register(`items.${index}.isDoubleColor`)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>双色</span>
                </label>
              </div>

              <div className="space-y-2">
                <Controller
                  control={control}
                  name={`items.${index}.crafts`}
                  render={({ field }) => {
                    const selected = new Set(field.value ?? []);
                    const toggle = (craftId: string) => {
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
                        aria-invalid={Boolean(errors.items?.[index]?.crafts?.message)}
                        aria-describedby={
                          errors.items?.[index]?.crafts?.message
                            ? `items.${index}.crafts-error`
                            : undefined
                        }
                      >
                        <legend className="text-sm font-medium">
                          工艺（至少选一项，可多选）
                        </legend>
                        <p className="mt-1 text-xs text-muted-foreground">
                          点击卡片选择；外协工艺会在提交后进入外协流程
                        </p>
                        <CraftToggleGrid
                          crafts={commonCrafts}
                          selected={selected}
                          disabled={controlsDisabled}
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
                      按产品、数量、工艺与用纸读取当前生效规则；报价仅用于这个款式。
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
                    onClick={() => calculateAndApplyQuote(index, field.id)}
                  >
                    {quoting && quotingFieldId === field.id
                      ? '计算中…'
                      : '计算并应用建议价'}
                  </Button>
                </div>

                <QuoteFeedback
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
                    hint="留空时，服务端会自动应用完整建议价；最多 4 位小数"
                    registration={register(`items.${index}.unitPrice`, {
                      setValueAs: (v) => (v === '' ? null : v),
                    })}
                    error={errors.items?.[index]?.unitPrice?.message}
                  />
                  <TextField
                    label="一次性费用"
                    hint="按张、每万个、每款等费用在此对平，不摊薄后丢失分币"
                    registration={register(`items.${index}.fixedFee`, {
                      setValueAs: (v) => (v === '' ? null : v),
                    })}
                    error={errors.items?.[index]?.fixedFee?.message}
                  />
                </div>
                <TextareaField
                  label="人工改价说明"
                  hint="成交价与建议价不同，或规则不完整时必填；会随工单保存供对账。"
                  registration={register(`items.${index}.priceOverrideReason`)}
                  error={errors.items?.[index]?.priceOverrideReason?.message}
                  rows={2}
                />
              </section>

              <TextareaField
                label="款式备注"
                hint="关键颜色、方向、工艺避坑等信息会在生产端高亮显示"
                registration={register(`items.${index}.remark`)}
                error={errors.items?.[index]?.remark?.message}
                rows={2}
              />

              <PendingDesignImages
                itemNumber={index + 1}
                images={pendingDesigns[field.id] ?? []}
                disabled={submitting || uploading || Boolean(createdDraft)}
                onChange={(images) => updatePendingDesigns(field.id, images)}
              />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        className={
          step === 'shipping'
            ? 'space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6'
            : 'hidden'
        }
      >
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
                shippingFee: watchedIsSfCollect ? '0.00' : null,
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
                    disabled={submitting || uploading || Boolean(createdDraft)}
                    onClick={() => shipmentsArray.remove(shipmentIndex)}
                  >
                    删除地址
                  </Button>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextField
                    label="快递代码"
                    registration={register(
                      `additionalShipments.${shipmentIndex}.expressCode`,
                    )}
                    error={
                      errors.additionalShipments?.[shipmentIndex]?.expressCode
                        ?.message
                    }
                  />
                </div>
                <TextareaField
                  label="收货信息"
                  hint="请在一处填写收货人、联系电话和完整地址"
                  required
                  registration={register(
                    `additionalShipments.${shipmentIndex}.receiverAddress`,
                  )}
                  error={
                    errors.additionalShipments?.[shipmentIndex]?.receiverAddress
                      ?.message
                  }
                  rows={2}
                />
                {usesExternalSalesPricing ? (
                  <section
                    aria-labelledby={`shipment-${shipmentIndex}-customer-charges-heading`}
                    className="space-y-3 rounded-lg border bg-muted/20 p-3"
                  >
                    <h4
                      id={`shipment-${shipmentIndex}-customer-charges-heading`}
                      className="text-sm font-medium"
                    >
                      地址 {shipmentIndex + 2} · 对客快递与打包耗材费
                    </h4>
                    <ShipmentCustomerChargeFields
                      idPrefix={`shipment-${shipmentIndex}`}
                      provinceRegistration={register(
                        `additionalShipments.${shipmentIndex}.destinationProvince`,
                      )}
                      weightRegistration={register(
                        `additionalShipments.${shipmentIndex}.quotedWeightKg`,
                        { setValueAs: (value) => (value === '' ? null : value) },
                      )}
                      shippingRegistration={register(
                        `additionalShipments.${shipmentIndex}.shippingFee`,
                        { setValueAs: (value) => (value === '' ? null : value) },
                      )}
                      packingRegistration={register(
                        `additionalShipments.${shipmentIndex}.packingMaterialFee`,
                        { setValueAs: (value) => (value === '' ? null : value) },
                      )}
                      reasonRegistration={register(
                        `additionalShipments.${shipmentIndex}.customerChargeOverrideReason`,
                      )}
                      provinceError={
                        errors.additionalShipments?.[shipmentIndex]
                          ?.destinationProvince?.message
                      }
                      weightError={
                        errors.additionalShipments?.[shipmentIndex]?.quotedWeightKg
                          ?.message
                      }
                      shippingError={
                        errors.additionalShipments?.[shipmentIndex]?.shippingFee
                          ?.message
                      }
                      packingError={
                        errors.additionalShipments?.[shipmentIndex]
                          ?.packingMaterialFee?.message
                      }
                      reasonError={
                        errors.additionalShipments?.[shipmentIndex]
                          ?.customerChargeOverrideReason?.message
                      }
                      isSfCollect={watchedIsSfCollect}
                    />
                  </section>
                ) : null}
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">款式分配数量</legend>
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
                  {errors.additionalShipments?.[shipmentIndex]?.itemQuantities
                    ?.message ? (
                    <p role="alert" className="text-sm text-destructive">
                      {
                        errors.additionalShipments[shipmentIndex].itemQuantities
                          .message
                      }
                    </p>
                  ) : null}
                </fieldset>
              </li>
            ))}
          </ol>
        )}
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
          服务端校验失败：{Object.entries(serverFieldErrors)
            .flatMap(([k, v]) => v.map((m) => `${k}: ${m}`))
            .join('；')}
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
            <p role="status" aria-live="polite" className="mt-1 text-sm text-muted-foreground">
              正在上传设计图：{uploadProgress.completed} / {uploadProgress.total}
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
                onClick={() => void uploadPendingDesigns(createdDraft, pendingDesigns)}
              >
                重试未上传图片
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
              ? `还有 ${formGaps.length} 个缺口。创建草稿始终可用；缺口可点右侧清单跳转。`
              : '没有阻断缺口。'}
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
          disabled={
            submitting ||
            uploading ||
            logisticsQuoting ||
            Boolean(createdDraft)
          }
        >
          {createdDraft
            ? '草稿已创建'
            : submitting
              ? '创建中…'
              : formGaps.length > 0
                ? `创建工单（还有 ${formGaps.length} 个缺口）`
                : '创建工单（草稿）'}
        </Button>
        <Link href="/orders" className={buttonVariants({ variant: 'outline' })}>
          返回列表
        </Link>
      </div>
      </fieldset>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Field primitives — keep the big form body readable
// ──────────────────────────────────────────────────────────────────────

const selectClass =
  'flex min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function ShipmentCustomerChargeFields({
  idPrefix,
  provinceRegistration,
  weightRegistration,
  shippingRegistration,
  packingRegistration,
  reasonRegistration,
  provinceError,
  weightError,
  shippingError,
  packingError,
  reasonError,
  isSfCollect,
}: {
  idPrefix: string;
  provinceRegistration: Registration;
  weightRegistration: Registration;
  shippingRegistration: Registration;
  packingRegistration: Registration;
  reasonRegistration: Registration;
  provinceError?: string;
  weightError?: string;
  shippingError?: string;
  packingError?: string;
  reasonError?: string;
  isSfCollect: boolean;
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${idPrefix}-province`}>中通计费省份</Label>
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
          <option value="">— 请选择；不在表内时留空并人工填写 —</option>
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
              ? '顺丰到付无需选择中通计费省份。'
              : '不在价目表内时可留空，改为人工确认快递费。'}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${idPrefix}-weight`}>承运商计费重量（kg）</Label>
        <Input
          id={`${idPrefix}-weight`}
          type="text"
          inputMode="decimal"
          disabled={isSfCollect}
          placeholder={isSfCollect ? '顺丰到付无需填写' : '例如：12 或 12.5'}
          aria-invalid={Boolean(weightError)}
          aria-describedby={
            weightError ? `${idPrefix}-weight-error` : `${idPrefix}-weight-hint`
          }
          {...weightRegistration}
        />
        {weightError ? (
          <p
            id={`${idPrefix}-weight-error`}
            role="alert"
            className="text-xs text-destructive"
          >
            {weightError}
          </p>
        ) : (
          <p
            id={`${idPrefix}-weight-hint`}
            className="text-xs text-muted-foreground"
          >
            {isSfCollect
              ? '顺丰到付的计费重量不计入工单应收。'
              : '普通地区填整 kg；新疆等偏远地区可填 0.5kg 档。系统不会擅自进位。'}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${idPrefix}-shipping-fee`}>
          对客快递费（元）{' '}
          {!isSfCollect ? (
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
          ) : null}
        </Label>
        <Input
          id={`${idPrefix}-shipping-fee`}
          type="text"
          inputMode="decimal"
          disabled={isSfCollect}
          required={!isSfCollect}
          aria-required={!isSfCollect}
          placeholder={isSfCollect ? '顺丰到付固定为 0' : '可用报价表自动计算'}
          aria-invalid={Boolean(shippingError)}
          aria-describedby={
            shippingError
              ? `${idPrefix}-shipping-fee-error`
              : `${idPrefix}-shipping-fee-hint`
          }
          {...shippingRegistration}
        />
        {shippingError ? (
          <p
            id={`${idPrefix}-shipping-fee-error`}
            role="alert"
            className="text-xs text-destructive"
          >
            {shippingError}
          </p>
        ) : (
          <p
            id={`${idPrefix}-shipping-fee-hint`}
            className="text-xs text-muted-foreground"
          >
            {isSfCollect
              ? '顺丰到付固定提交 0 元；打包耗材仍需单独确认。'
              : '必填；可先用价目表计算建议金额后再确认。'}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={`${idPrefix}-packing-fee`}>
          打包耗材费（元）{' '}
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        </Label>
        <Input
          id={`${idPrefix}-packing-fee`}
          type="text"
          inputMode="decimal"
          required
          aria-required="true"
          placeholder="需确认纸箱等耗材实际收费"
          aria-invalid={Boolean(packingError)}
          aria-describedby={
            packingError
              ? `${idPrefix}-packing-fee-error`
              : `${idPrefix}-packing-fee-hint`
          }
          {...packingRegistration}
        />
        {packingError ? (
          <p
            id={`${idPrefix}-packing-fee-error`}
            role="alert"
            className="text-xs text-destructive"
          >
            {packingError}
          </p>
        ) : (
          <p
            id={`${idPrefix}-packing-fee-hint`}
            className="text-xs text-muted-foreground"
          >
            纸箱表未写明计费粒度；系统按本票分配数量给建议，最终以这里确认的金额为准。
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-charge-reason`}>收费调整说明</Label>
        <textarea
          id={`${idPrefix}-charge-reason`}
          rows={2}
          className={`${selectClass} min-h-20 resize-y py-2`}
          placeholder="实际收费与建议不同、超 5000 个或价目未覆盖时必填"
          aria-invalid={Boolean(reasonError)}
          aria-describedby={
            reasonError ? `${idPrefix}-reason-error` : `${idPrefix}-reason-hint`
          }
          {...reasonRegistration}
        />
        {reasonError ? (
          <p
            id={`${idPrefix}-reason-error`}
            role="alert"
            className="text-xs text-destructive"
          >
            {reasonError}
          </p>
        ) : (
          <p
            id={`${idPrefix}-reason-hint`}
            className="text-xs text-muted-foreground"
          >
            仅在人工调整、超出价目或价目未覆盖时填写。当前结构化运费只支持中通与顺丰到付。
          </p>
        )}
      </div>
    </div>
  );
}

function LogisticsQuoteFeedback({
  view,
  stale,
  adjusted,
}: {
  view: LogisticsQuoteViewState | null;
  stale: boolean;
  adjusted: boolean;
}) {
  if (!view) return null;
  if (stale) {
    return (
      <p
        role="status"
        className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground"
      >
        数量、地址、计费省份或重量已改变，请重新计算快递与耗材建议费。
      </p>
    );
  }
  if (adjusted) {
    return (
      <p
        role="status"
        className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground"
      >
        实际快递费或耗材费已调整，请填写收费调整说明；如需恢复当前价目簿建议，请重新计算。
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
          ? `已填写建议：快递 ¥${quote.suggestedShippingTotal}，耗材 ¥${quote.suggestedPackagingTotal}`
          : '部分规则无法自动计算，已填写能够确定的建议金额'}
      </p>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {quote.shipments.map((shipment) => (
          <li key={shipment.shipmentKey} className="break-words">
            地址 {shipment.shipmentKey}：快递{' '}
            {shipment.shipping.amount === null
              ? '需人工确认'
              : `¥${shipment.shipping.amount}`}
            {' · '}耗材{' '}
            {shipment.packaging.amount === null
              ? '需人工确认'
              : `建议 ¥${shipment.packaging.amount}`}
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

function QuoteFeedback({
  view,
  stale,
}: {
  view: QuoteViewState | undefined;
  stale: boolean;
}) {
  if (!view) return null;
  if (stale) {
    return (
      <p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground">
        产品、数量或工艺条件已改变，请重新计算建议价。
      </p>
    );
  }
  if (view.error) {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
        {view.error}
      </p>
    );
  }
  const quote = view.result;
  if (!quote) return null;
  if (!quote.complete) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
        <p className="font-medium">规则不完整，未自动改动成交价</p>
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
    <div role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-xs">
      <p className="font-medium text-foreground">
        建议小计 ¥{quote.suggestedSubtotal}：成交单价 ¥
        {quote.suggestedUnitPrice} + 一次性费用 ¥
        {quote.suggestedFixedFee}
      </p>
      <ul className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
        {quote.components.map((component, index) => (
          <li key={`${component.sourceId ?? component.source}-${index}`}>
            {component.name}：¥{component.rate} × {component.units} = ¥
            {component.amount}
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
  onToggle,
  compact = false,
}: {
  crafts: CraftOption[];
  selected: ReadonlySet<string>;
  disabled: boolean;
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
        return (
          <Button
            key={craft.id}
            type="button"
            aria-pressed={checked}
            disabled={disabled}
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

type Registration = ReturnType<ReturnType<typeof useForm<CreateOrderInput>>['register']>;

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
            「款式名 星号」。写法对齐同文件的 ShipmentCustomerChargeFields。 */}
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
}: {
  label: string;
  hint?: string;
  required?: boolean;
  tone?: 'default' | 'destructive';
  rows?: number;
  error?: string | undefined;
  registration: Registration;
}) {
  const fieldId = registration.name;
  const messageId = `${fieldId}-message`;
  const destructive = tone === 'destructive';
  return (
    <div
      className="min-w-0 space-y-1"
    >
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
      />
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p
          id={messageId}
          className="text-xs text-muted-foreground"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
