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
  InventoryCountStaleSnapshotError,
  postInventoryCount,
} from '@/lib/inventory-count-posting';
import {
  createStockTransfer,
  StockTransferInvariantError,
} from '@/lib/stock-transfer';
import type { InventoryCountMutationResult } from './owner-inventory.types';

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
  _prev: InventoryCountMutationResult | null,
  formData: FormData,
): Promise<InventoryCountMutationResult> {
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
    const posted = await postInventoryCount(parsed.data, actor);
    revalidateInventoryPaths();
    if (posted.staleKeys.length > 0) {
      // 部分过账：没冲突的行已经入库，冲突行原样退回让操作员重数。
      return {
        status: 'success',
        message:
          `盘点单 ${posted.count.countNo} 已过账 ${posted.count.items.length} 条；` +
          `${posted.staleKeys.length} 条账面数已变动未过账，请重新盘点：${posted.staleMessage}`,
        staleKeys: posted.staleKeys,
      };
    }
    return {
      status: 'success',
      message: `盘点单 ${posted.count.countNo} 已过账`,
    };
  } catch (error) {
    // 顺序有意义：InventoryCountStaleSnapshotError 继承自
    // InventoryCountInvariantError，先判子类才能把 staleKeys 带出去，否则会被
    // 下面的通用分支吃掉、页面只剩一句话没法定位到行。
    if (error instanceof InventoryCountStaleSnapshotError) {
      return {
        status: 'error',
        message: error.message,
        staleKeys: error.staleKeys,
      };
    }
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
