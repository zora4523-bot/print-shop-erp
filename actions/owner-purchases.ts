'use server';

import { redirect } from 'next/navigation';
import {
  getFormString,
  getFormStringOr,
  invalidFromIssues,
  mapInvariantError,
  revalidatePaths,
} from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import {
  cancelPurchaseReceiptSchema,
  createPurchaseOrderSchema,
  createPurchaseReceiptSchema,
} from '@/lib/auth/schemas';
import {
  cancelPurchaseOrder,
  cancelPurchaseReceipt,
  createPurchaseOrder,
  createPurchaseReceipt,
  PurchaseInvariantError,
} from '@/lib/purchase';
import type { PurchaseMutationResult } from './owner-purchases.types';

function normalizePurchaseOrderFormInput(formData: FormData) {
  return {
    supplierPartyId: getFormString(formData, 'supplierPartyId'),
    materialId: getFormString(formData, 'materialId'),
    quantity: getFormString(formData, 'quantity'),
    unitCost: getFormStringOr(formData, 'unitCost', ''),
    expectedDate: getFormStringOr(formData, 'expectedDate', ''),
    remark: getFormStringOr(formData, 'remark', ''),
  };
}

function normalizeReceiptFormInput(formData: FormData) {
  return {
    purchaseOrderItemId: getFormString(formData, 'purchaseOrderItemId'),
    locationId: getFormStringOr(formData, 'locationId', ''),
    quantity: getFormString(formData, 'quantity'),
    unitCost: getFormStringOr(formData, 'unitCost', ''),
    remark: getFormStringOr(formData, 'remark', ''),
  };
}

export async function createPurchaseOrderAction(
  _prev: PurchaseMutationResult | null,
  formData: FormData,
): Promise<PurchaseMutationResult> {
  await requirePermission('purchase:manage');

  const parsed = createPurchaseOrderSchema.safeParse(
    normalizePurchaseOrderFormInput(formData),
  );
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  let createdId: string;
  try {
    const created = await createPurchaseOrder(parsed.data);
    createdId = created.id;
  } catch (err) {
    const invariant = mapInvariantError(err, PurchaseInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePurchasePaths(createdId);
  redirect(`/owner/purchases/${createdId}`);
}

export async function createPurchaseReceiptAction(
  purchaseOrderId: string,
  _prev: PurchaseMutationResult | null,
  formData: FormData,
): Promise<PurchaseMutationResult> {
  const actor = await requirePermission('purchase:manage');

  const parsed = createPurchaseReceiptSchema.safeParse(
    normalizeReceiptFormInput(formData),
  );
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  try {
    await createPurchaseReceipt(purchaseOrderId, parsed.data, actor);
  } catch (err) {
    const invariant = mapInvariantError(err, PurchaseInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePurchasePaths(purchaseOrderId);
  revalidatePaths(['/owner/materials', '/foreman/materials']);
  return { status: 'success', message: '采购入库已提交' };
}

export async function cancelPurchaseReceiptAction(
  receiptId: string,
  _prev: PurchaseMutationResult | null,
  formData: FormData,
): Promise<PurchaseMutationResult> {
  const actor = await requirePermission('purchase:manage');

  const parsed = cancelPurchaseReceiptSchema.safeParse({
    reason: getFormStringOr(formData, 'reason', ''),
  });
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  let purchaseOrderId: string;
  try {
    const updated = await cancelPurchaseReceipt(
      receiptId,
      actor,
      parsed.data.reason,
    );
    purchaseOrderId = updated.id;
  } catch (err) {
    const invariant = mapInvariantError(err, PurchaseInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePurchasePaths(purchaseOrderId);
  revalidatePaths(['/owner/materials', '/foreman/materials']);
  return { status: 'success', message: '入库单已取消并写入反向库存流水' };
}

export async function cancelPurchaseOrderAction(
  purchaseOrderId: string,
): Promise<PurchaseMutationResult> {
  await requirePermission('purchase:manage');

  try {
    await cancelPurchaseOrder(purchaseOrderId);
  } catch (err) {
    const invariant = mapInvariantError(err, PurchaseInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePurchasePaths(purchaseOrderId);
  return { status: 'success', message: '采购单已取消' };
}

function revalidatePurchasePaths(id: string) {
  revalidatePaths(['/owner/purchases', `/owner/purchases/${id}`]);
}
