'use server';

import {
  getFormString,
  getFormStringOr,
  invalidFromIssues,
  mapInvariantError,
  revalidatePaths,
  type MutationResult,
} from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createStockTransferSchema,
  postInventoryCountSchema,
} from '@/lib/auth/schemas';
import {
  InventoryCountInvariantError,
  postInventoryCount,
} from '@/lib/inventory-count-posting';
import {
  createStockTransfer,
  StockTransferInvariantError,
} from '@/lib/stock-transfer';

export async function createStockTransferAction(
  _prev: MutationResult | null,
  formData: FormData,
): Promise<MutationResult> {
  const actor = await requirePermission('warehouse:manage');
  const parsed = createStockTransferSchema.safeParse({
    idempotencyKey: getFormString(formData, 'idempotencyKey'),
    materialId: getFormString(formData, 'materialId'),
    sourceLocationId: getFormString(formData, 'sourceLocationId'),
    destinationLocationId: getFormString(formData, 'destinationLocationId'),
    quantity: getFormString(formData, 'quantity'),
    remark: getFormStringOr(formData, 'remark', ''),
  });
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  try {
    const transfer = await createStockTransfer(parsed.data, actor);
    revalidateInventoryPaths();
    return { status: 'success', message: `调拨单 ${transfer.transferNo} 已完成` };
  } catch (error) {
    const invariant = mapInvariantError(error, StockTransferInvariantError);
    if (invariant) return invariant;
    throw error;
  }
}

export async function postInventoryCountAction(
  _prev: MutationResult | null,
  formData: FormData,
): Promise<MutationResult> {
  const actor = await requirePermission('material:manage');
  let items: unknown = null;
  try {
    items = JSON.parse(getFormStringOr(formData, 'items', ''));
  } catch {
    return {
      status: 'invalid',
      fieldErrors: { items: ['盘点明细格式非法'] },
    };
  }
  const parsed = postInventoryCountSchema.safeParse({
    idempotencyKey: getFormString(formData, 'idempotencyKey'),
    remark: getFormStringOr(formData, 'remark', ''),
    items,
  });
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  try {
    const count = await postInventoryCount(parsed.data, actor);
    revalidateInventoryPaths();
    return { status: 'success', message: `盘点单 ${count.countNo} 已过账` };
  } catch (error) {
    const invariant = mapInvariantError(error, InventoryCountInvariantError);
    if (invariant) return invariant;
    throw error;
  }
}

function revalidateInventoryPaths() {
  revalidatePaths([
    '/owner/warehouses',
    '/owner/materials',
    '/owner/materials/count',
    '/foreman/materials',
    '/owner/purchases',
  ]);
}
