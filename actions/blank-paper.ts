'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  addBlankPaperSchema,
  type AddBlankPaperInput,
  type AddBlankPaperResult,
} from '@/lib/price/blank-paper';
import {
  addBlankPaperDraft,
  CustomerPriceBookAdminError,
} from '@/lib/price/customer-price-book-admin';

export async function addBlankPaperAction(
  raw: AddBlankPaperInput,
): Promise<AddBlankPaperResult> {
  const actor = await requirePermission('dict:price:manage');
  await requirePermission('material:manage');
  await requirePermission('dict:product:manage');
  const parsed = addBlankPaperSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return {
      status: 'error',
      message:
        message && /[\u4e00-\u9fff]/u.test(message)
          ? message
          : '填写内容有误，请检查后重试',
    };
  }
  try {
    const result = await addBlankPaperDraft(parsed.data, actor);
    for (const path of [
      '/owner/rules/customer-pricing',
      '/owner/rules/customer-pricing/blank/new',
      '/owner/rules/price-versions',
      '/owner/rules/papers',
      '/owner/rules/stock-skus',
      '/owner/materials',
      '/foreman/materials',
      '/orders/new',
      '/workbench',
    ]) {
      revalidatePath(path);
    }
    return { status: 'success', ...result };
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError)
      return { status: 'error', message: error.message };
    throw error;
  }
}
