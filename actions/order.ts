'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createOrderSchema,
  createReworkOrderSchema,
  cancelOrderSchema,
  shipOrderSchema,
  updateEditableOrderSchema,
  setOrderUrgentSchema,
  setOrderSfCollectSchema,
  createOrderChangeRequestSchema,
  previewOrderChangeRequestPricingSchema,
  reviewOrderChangeRequestSchema,
  previewOrderPricingReviewSchema,
  finalizeOrderPricingSchema,
  saveOrderManualChargeSchema,
  deleteOrderManualChargeSchema,
  saveOrderPlateDetailSchema,
  deleteOrderPlateDetailSchema,
  type CreateOrderInput,
} from '@/lib/auth/schemas';
import {
  createOrder,
  submitOrder,
  cancelOrder,
  shipOrder,
  finishOrder,
  updateOrderFields,
  setOrderUrgent,
  setOrderSfCollect,
  OrderInvariantError,
  OrderQuoteChangedError,
  InvalidOrderTransitionError,
} from '@/lib/order';
import {
  createReworkOrder,
  ReworkOrderError,
} from '@/lib/order/rework';
import {
  createOrderChangeRequest,
  OrderChangeRequestError,
  previewOrderChangeRequestPricing,
  reviewOrderChangeRequest,
} from '@/lib/order/change-request';
import {
  finalizeOrderPricing,
  OrderPricingReviewError,
  previewOrderPricingReview,
  type FinalizeOrderPricingCommand,
} from '@/lib/order/pricing-review';
import {
  deleteOrderManualCharge,
  deleteOrderPlateDetail,
  OrderCommercialDetailsError,
  saveOrderManualCharge,
  saveOrderPlateDetail,
} from '@/lib/order/commercial-details';
import type {
  CreateOrderChangeRequestMutationResult,
  CreateOrderMutationResult,
  CreateReworkOrderMutationResult,
  OrderMutationResult,
  PreviewOrderChangeRequestPricingResult,
  PreviewOrderPricingReviewResult,
  ReviewOrderChangeRequestMutationResult,
  FinalizeOrderPricingMutationResult,
  OrderCommercialDetailMutationResult,
  SubmitOrderMutationResult,
} from './order.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { FULL_EDITABLE_FIELDS } from '@/lib/order/editable-fields';
import { settlementTypeForOrderCreator } from '@/lib/order/settlement';
import { parseExternalCreateOrderCommand } from '@/lib/order/external-create-order-command';
import { OrderSettlementType } from '@/generated/prisma/enums';

// Accepts a pre-parsed `CreateOrderInput` rather than FormData because
// items is a nested array and `FormData` flattens poorly. The UI layer
// (Slice B) will hand this function a structured payload via a
// progressively-enhanced form + JSON body or a bound call.
export async function createOrderAction(
  _prev: CreateOrderMutationResult | null,
  raw: unknown,
): Promise<CreateOrderMutationResult> {
  const actor = await requirePermission('order:create');
  const settlementType = settlementTypeForOrderCreator(actor.role);
  let input: CreateOrderInput;
  if (settlementType === OrderSettlementType.EXTERNAL_SALES) {
    const external = parseExternalCreateOrderCommand(raw);
    if (!external.success) {
      return {
        status: 'invalid',
        fieldErrors: collectFieldErrorsDeep(external.issues),
      };
    }
    input = external.data;
  } else {
    const parsed = createOrderSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: 'invalid',
        fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
      };
    }
    input = parsed.data;
  }

  let created: Awaited<ReturnType<typeof createOrder>>;
  try {
    created = await createOrder(input, actor);
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    console.error('[order:create] unexpected failure', {
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : 'non-Error rejection',
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }

  revalidatePath('/orders');
  return {
    status: 'success',
    orderId: created.id,
    orderNo: created.orderNo,
    itemIds: created.itemIds,
    pricingStatus: created.pricingStatus,
  };
}

export async function createReworkOrderAction(
  _prev: CreateReworkOrderMutationResult | null,
  raw: unknown,
): Promise<CreateReworkOrderMutationResult> {
  const actor = await requirePermission('order:schedule');

  const parsed = createReworkOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const created = await createReworkOrder(parsed.data, actor);
    revalidatePath('/orders');
    revalidatePath('/foreman/scheduling');
    revalidatePath(`/orders/${parsed.data.sourceOrderId}`);
    revalidatePath(`/orders/${created.id}`);
    return { status: 'success', orderId: created.id };
  } catch (error) {
    if (error instanceof ReworkOrderError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function submitOrderAction(
  orderId: string,
  expectedQuoteToken: unknown = null,
): Promise<SubmitOrderMutationResult> {
  // 'order:create' is the coarse role gate. Ownership — "you can only
  // submit your own DRAFT unless you're ADMIN" — is enforced
  // deeper in lib/order.submitOrder's `authz` callback (round 27), which
  // throws OrderInvariantError and is mapped to `{ status: 'error' }`
  // below. Any direct POST to this action bypassing the UI still hits
  // that guard.
  const actor = await requirePermission('order:create');

  if (
    expectedQuoteToken !== null &&
    (typeof expectedQuoteToken !== 'string' ||
      !/^create-order-quote-v2:[a-f\d]{64}$/u.test(expectedQuoteToken))
  ) {
    return {
      status: 'invalid',
      fieldErrors: { quoteToken: ['报价确认标识格式非法'] },
    };
  }

  try {
    const submitted = await submitOrder(
      orderId,
      actor,
      new Date(),
      expectedQuoteToken,
    );
    revalidatePath('/orders');
    revalidatePath(`/orders/${orderId}`);
    return {
      status: 'success',
      quotedFee: submitted.quotedFee,
      quotedFeeCompleteness: submitted.quotedFeeCompleteness,
    };
  } catch (err) {
    if (err instanceof OrderQuoteChangedError) {
      return {
        status: 'quote_changed',
        quoteToken: err.quoteToken,
        quotedFee: err.quotedFee,
        quotedFeeCompleteness: err.quotedFeeCompleteness,
        message: err.message,
      };
    }
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof InvalidOrderTransitionError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
}

export async function cancelOrderAction(
  orderId: string,
  _prev: OrderMutationResult | null,
  formData: FormData,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:cancel');

  // Pass the raw FormDataEntryValue through to the schema so a File
  // upload (or any non-string) gets rejected as invalid instead of
  // being silently coerced to '' and proceeding with an empty reason
  // on a destructive action.
  const parsed = cancelOrderSchema.safeParse({
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    await cancelOrder(orderId, actor, parsed.data.reason);
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof InvalidOrderTransitionError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  return { status: 'success' };
}

// COMPLETED → SHIPPED. ADMIN per `order:ship` permission.
// FormData carries optional trackingNo (运单号).
export async function shipOrderAction(
  orderId: string,
  _prev: OrderMutationResult | null,
  formData: FormData,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:ship');

  const shipmentIds = formData.getAll('shipmentId');
  const shipmentTrackingNos = formData.getAll('shipmentTrackingNo');
  const shipmentWeights = formData.getAll('shipmentWeightKg');
  const shipmentProvinces = formData.getAll('shipmentDestinationProvince');
  const shipmentShippingFees = formData.getAll('shipmentShippingFee');
  const shipmentPackingFees = formData.getAll('shipmentPackingMaterialFee');
  const shipmentChargeReasons = formData.getAll('shipmentChargeOverrideReason');
  const hasMatchingOptionalShape = (values: FormDataEntryValue[]) =>
    values.length === 0 || values.length === shipmentIds.length;
  const hasValidWeightShape =
    shipmentWeights.length === 0 || shipmentWeights.length === shipmentIds.length;
  const shipments =
    shipmentIds.length === shipmentTrackingNos.length &&
    hasValidWeightShape &&
    hasMatchingOptionalShape(shipmentProvinces) &&
    hasMatchingOptionalShape(shipmentShippingFees) &&
    hasMatchingOptionalShape(shipmentPackingFees) &&
    hasMatchingOptionalShape(shipmentChargeReasons)
      ? shipmentIds.map((shipmentId, index) => ({
          shipmentId,
          trackingNo: shipmentTrackingNos[index],
          ...(shipmentWeights.length > 0
            ? { weightKg: shipmentWeights[index] }
            : {}),
          ...(shipmentProvinces.length > 0
            ? { destinationProvince: shipmentProvinces[index] }
            : {}),
          ...(shipmentShippingFees.length > 0
            ? { shippingFee: shipmentShippingFees[index] }
            : {}),
          ...(shipmentPackingFees.length > 0
            ? { packingMaterialFee: shipmentPackingFees[index] }
            : {}),
          ...(shipmentChargeReasons.length > 0
            ? {
                customerChargeOverrideReason:
                  shipmentChargeReasons[index],
              }
            : {}),
        }))
      : [
          {
            shipmentId: null,
            trackingNo: null,
            weightKg: null,
            destinationProvince: null,
            shippingFee: null,
            packingMaterialFee: null,
            customerChargeOverrideReason: null,
          },
        ];
  const parsed = shipOrderSchema.safeParse({
    trackingNo: formData.get('trackingNo'),
    shipments,
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    await shipOrder(
      orderId,
      actor,
      parsed.data.shipments.length > 0 ? parsed.data : parsed.data.trackingNo,
    );
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof InvalidOrderTransitionError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  return { status: 'success' };
}

// SHIPPED → FINISHED (terminal close). Same permission as ship for
// MVP — no separate `order:finish` business rule today.
export async function finishOrderAction(
  orderId: string,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:ship');

  try {
    await finishOrder(orderId, actor);
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof InvalidOrderTransitionError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  return { status: 'success' };
}

// Accepts FormData (the edit form progressively enhances from a plain
// HTML form). updateOrderFields then enforces which subset of the
// parsed keys is actually applicable given the order's current status.
export async function updateOrderAction(
  orderId: string,
  _prev: OrderMutationResult | null,
  formData: FormData,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:create');

  const raw: Record<string, unknown> = {};
  for (const key of FULL_EDITABLE_FIELDS) {
    const value = formData.get(key);
    // Reject non-string uploads at the action boundary so File / Blob
    // can't slip into fields the schema expects text for.
    if (value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'boolean') {
      return {
        status: 'invalid',
        fieldErrors: { [key]: ['字段格式非法'] },
      };
    }
    raw[key] = value;
  }

  const parsed = updateEditableOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    await updateOrderFields(orderId, parsed.data, actor);
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}`);
}

// Quick one-click 急单 toggle. Accepts `isUrgent` as a string form
// field ("true" / "false") so the button can be a zero-JS plain form.
export async function setOrderUrgentAction(
  orderId: string,
  _prev: OrderMutationResult | null,
  formData: FormData,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:create');

  const parsed = setOrderUrgentSchema.safeParse({
    isUrgent: formData.get('isUrgent'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    await setOrderUrgent(orderId, parsed.data.isUrgent, actor);
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  return { status: 'success' };
}

// 独立维护顺丰到付标识：允许在普通字段冻结后继续补录，但底层仍会
// 拒绝 FINISHED / CANCELLED 终态，并记录完整变更日志。
export async function setOrderSfCollectAction(
  orderId: string,
  _prev: OrderMutationResult | null,
  formData: FormData,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:create');

  const shipmentIds = formData.getAll('sfShipmentId');
  const shipmentProvinces = formData.getAll('sfShipmentDestinationProvince');
  const shipmentWeights = formData.getAll('sfShipmentWeightKg');
  const shipmentShippingFees = formData.getAll('sfShipmentShippingFee');
  const shipmentChargeReasons = formData.getAll('sfShipmentChargeOverrideReason');
  const shipmentFieldCounts = [
    shipmentProvinces.length,
    shipmentWeights.length,
    shipmentShippingFees.length,
    shipmentChargeReasons.length,
  ];
  if (shipmentFieldCounts.some((count) => count !== shipmentIds.length)) {
    return {
      status: 'invalid',
      fieldErrors: { shipments: ['发货收费字段数量不一致'] },
    };
  }

  const parsed = setOrderSfCollectSchema.safeParse({
    isSfCollect: formData.get('isSfCollect'),
    shipments: shipmentIds.map((shipmentId, index) => ({
      shipmentId,
      destinationProvince: shipmentProvinces[index],
      weightKg: shipmentWeights[index],
      shippingFee: shipmentShippingFees[index],
      customerChargeOverrideReason: shipmentChargeReasons[index],
    })),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  try {
    await setOrderSfCollect(
      orderId,
      parsed.data.isSfCollect,
      actor,
      parsed.data.shipments,
    );
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  return { status: 'success' };
}

export async function createOrderChangeRequestAction(
  _prev: CreateOrderChangeRequestMutationResult | null,
  raw: unknown,
): Promise<CreateOrderChangeRequestMutationResult> {
  const actor = await requirePermission('order:change:request');
  const parsed = createOrderChangeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const request = await createOrderChangeRequest(parsed.data, actor);
    revalidatePath('/orders');
    revalidatePath(`/orders/${parsed.data.orderId}`);
    revalidatePath('/owner/order-changes');
    return { status: 'success', requestId: request.id };
  } catch (error) {
    if (error instanceof OrderChangeRequestError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function reviewOrderChangeRequestAction(
  _prev: ReviewOrderChangeRequestMutationResult | null,
  raw: unknown,
): Promise<ReviewOrderChangeRequestMutationResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = reviewOrderChangeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const request = await reviewOrderChangeRequest(parsed.data, actor);
    revalidatePath('/orders');
    revalidatePath(`/orders/${request.orderId}`);
    revalidatePath('/owner/order-changes');
    revalidatePath('/worker/tasks');
    revalidatePath('/worker/orders');
    return { status: 'success', requestStatus: request.status };
  } catch (error) {
    if (error instanceof OrderChangeRequestError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function previewOrderChangeRequestPricingAction(
  _prev: PreviewOrderChangeRequestPricingResult | null,
  raw: unknown,
): Promise<PreviewOrderChangeRequestPricingResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = previewOrderChangeRequestPricingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const preview = await previewOrderChangeRequestPricing(
      parsed.data.requestId,
      actor,
    );
    return { status: 'success', preview };
  } catch (error) {
    if (error instanceof OrderChangeRequestError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function previewOrderPricingReviewAction(
  _prev: PreviewOrderPricingReviewResult | null,
  raw: unknown,
): Promise<PreviewOrderPricingReviewResult> {
  const actor = await requirePermission('order:price:confirm');
  const parsed = previewOrderPricingReviewSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const preview = await previewOrderPricingReview(parsed.data.orderId, actor);
    return { status: 'success', preview };
  } catch (error) {
    if (error instanceof OrderPricingReviewError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function finalizeOrderPricingAction(
  _prev: FinalizeOrderPricingMutationResult | null,
  raw: unknown,
): Promise<FinalizeOrderPricingMutationResult> {
  const actor = await requirePermission('order:price:confirm');
  const parsed = finalizeOrderPricingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const command: FinalizeOrderPricingCommand = parsed.data;
    const finalized = await finalizeOrderPricing(command, actor);
    revalidatePath('/orders');
    revalidatePath(`/orders/${finalized.orderId}`);
    revalidatePath('/foreman/scheduling');
    revalidatePath('/owner/order-changes');
    return {
      status: 'success',
      orderId: finalized.orderId,
      priceRevision: finalized.priceRevision,
      packagingAmount: finalized.packagingAmount,
      processingAmount: finalized.processingAmount,
      totalAmount: finalized.totalAmount,
      confirmedFee: finalized.confirmedFee,
    };
  } catch (error) {
    if (error instanceof OrderPricingReviewError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

function commercialMutationFailure(
  error: unknown,
): OrderCommercialDetailMutationResult {
  if (error instanceof OrderCommercialDetailsError) {
    return { status: 'error', message: error.message };
  }
  throw error;
}

function revalidateOrderCommercialDetail(orderId: string): void {
  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/owner/bills');
}

export async function saveOrderManualChargeAction(
  _prev: OrderCommercialDetailMutationResult | null,
  raw: unknown,
): Promise<OrderCommercialDetailMutationResult> {
  const actor = await requirePermission('order:price:confirm');
  const parsed = saveOrderManualChargeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }
  try {
    const saved = await saveOrderManualCharge(parsed.data, actor);
    revalidateOrderCommercialDetail(parsed.data.orderId);
    return {
      status: 'success',
      entityId: saved.chargeId,
      priceRevision: saved.priceRevision,
      totalAmount: saved.totalAmount,
    };
  } catch (error) {
    return commercialMutationFailure(error);
  }
}

export async function deleteOrderManualChargeAction(
  _prev: OrderCommercialDetailMutationResult | null,
  raw: unknown,
): Promise<OrderCommercialDetailMutationResult> {
  const actor = await requirePermission('order:price:confirm');
  const parsed = deleteOrderManualChargeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }
  try {
    const removed = await deleteOrderManualCharge(parsed.data, actor);
    revalidateOrderCommercialDetail(parsed.data.orderId);
    return {
      status: 'success',
      entityId: removed.chargeId,
      priceRevision: removed.priceRevision,
      totalAmount: removed.totalAmount,
    };
  } catch (error) {
    return commercialMutationFailure(error);
  }
}

export async function saveOrderPlateDetailAction(
  _prev: OrderCommercialDetailMutationResult | null,
  raw: unknown,
): Promise<OrderCommercialDetailMutationResult> {
  const actor = await requirePermission('order:price:confirm');
  const parsed = saveOrderPlateDetailSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }
  try {
    const saved = await saveOrderPlateDetail(parsed.data, actor);
    revalidateOrderCommercialDetail(parsed.data.orderId);
    return {
      status: 'success',
      entityId: saved.plateDetailId,
      priceRevision: saved.priceRevision,
      totalAmount: saved.totalAmount,
    };
  } catch (error) {
    return commercialMutationFailure(error);
  }
}

export async function deleteOrderPlateDetailAction(
  _prev: OrderCommercialDetailMutationResult | null,
  raw: unknown,
): Promise<OrderCommercialDetailMutationResult> {
  const actor = await requirePermission('order:price:confirm');
  const parsed = deleteOrderPlateDetailSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }
  try {
    const removed = await deleteOrderPlateDetail(parsed.data, actor);
    revalidateOrderCommercialDetail(parsed.data.orderId);
    return {
      status: 'success',
      entityId: removed.plateDetailId,
      priceRevision: removed.priceRevision,
      totalAmount: removed.totalAmount,
    };
  } catch (error) {
    return commercialMutationFailure(error);
  }
}
