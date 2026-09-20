'use server';

import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { enableBlankSpecificationsSchema } from '@/lib/auth/schemas';
import { collectFieldErrors, revalidatePaths } from '@/lib/admin/action-helpers';
import { appendReceipt } from '@/lib/admin/receipt';
import { enableBlankSpecifications } from '@/lib/price/enable-blank-specifications';
import { BlankPaperCatalogError } from '@/lib/price/blank-paper-catalog';
import { ProductInvariantError } from '@/lib/product';
import type { PaperSpecificationsMutationResult } from './paper-specifications.types';

export async function enablePaperSpecificationsAction(
  paperId: string,
  _prev: PaperSpecificationsMutationResult | null,
  formData: FormData,
): Promise<PaperSpecificationsMutationResult> {
  const actor = await requirePermission('material:manage');
  await requirePermission('dict:product:manage');
  const parsed = enableBlankSpecificationsSchema.safeParse({ paperId, specifications: formData.getAll('specifications') });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrors(parsed.error.issues.map((issue) => ({
        ...issue, message: /[\u4e00-\u9fff]/u.test(issue.message) ? issue.message : '填写内容有误，请检查后重试',
      }))),
    };
  }
  if (formData.get('reviewed') !== 'yes') return { status: 'error', message: '请先复核本次启用规格' };
  try {
    await enableBlankSpecifications(parsed.data, actor);
  } catch (error) {
    if (error instanceof BlankPaperCatalogError || error instanceof ProductInvariantError) return { status: 'error', message: error.message };
    throw error;
  }
  const path = `/owner/rules/papers/${parsed.data.paperId}`;
  revalidatePaths([path, '/owner/rules/stock-skus', '/owner/rules/customer-pricing', '/orders/new', '/workbench']);
  redirect(appendReceipt(path, { updated: '1' }));
}
