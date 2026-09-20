'use server';

import type { CustomerPriceBookMutationResult } from './customer-price-books.types';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  addBlankPaperSchema,
  blankPriceMatrixSchema,
  type BlankPriceMatrixInput,
  type AddBlankPaperInput,
  type AddBlankPaperResult,
} from '@/lib/price/blank-paper';
import {
  addBlankPaperDraft,
  updateBlankPriceMatrixDraft,
  CustomerPriceBookAdminError,
} from '@/lib/price/customer-price-book-admin';

export async function addBlankPaperAction(
  raw: AddBlankPaperInput,
): Promise<AddBlankPaperResult> {
  const actor = await requirePermission('dict:price:manage');
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
  if (parsed.data.paper.mode === 'new') await requirePermission('material:manage');
  try {
    const result = await addBlankPaperDraft(parsed.data, actor);
    for (const path of [
      '/owner/rules/customer-pricing',
      '/owner/rules/customer-pricing/blank/new',
      '/owner/rules/price-versions',
      '/owner/rules/papers',
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

export async function updateBlankPriceMatrixFormAction(
  context: { priceBookId: string; expectedUpdatedAt: string; cells: Array<{ inputName: string; paperId: string; specificationKey: BlankPriceMatrixInput['cells'][number]['specificationKey'] }> },
  _previous: CustomerPriceBookMutationResult | null,
  form: FormData,
): Promise<CustomerPriceBookMutationResult> {
  const actor = await requirePermission('dict:price:manage');
  const parsed = blankPriceMatrixSchema.safeParse({
    priceBookId: context.priceBookId, expectedUpdatedAt: context.expectedUpdatedAt,
    cells: context.cells.filter((cell) => form.has(cell.inputName)).map((cell) => ({
      paperId: cell.paperId, specificationKey: cell.specificationKey,
      amount: typeof form.get(cell.inputName) === 'string' ? String(form.get(cell.inputName)).trim() || null : 'invalid',
    })),
  });
  if (!parsed.success) return { status: 'error', message: '单价须为非负数字，最多四位小数，请检查后重试' };
  try {
    const result = await updateBlankPriceMatrixDraft(parsed.data, actor);
    revalidatePath('/owner/rules/customer-pricing');
    revalidatePath('/owner/rules/price-versions');
    return { status: 'success', ...result };
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError) return { status: 'error', message: error.message };
    throw error;
  }
}
