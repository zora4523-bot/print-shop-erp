'use server';

import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { newCatalogPaperSchema } from '@/lib/auth/schemas';
import { canonicalizeCreateOrderPaperFact } from '@/lib/price/create-order/canonical-facts';
import { isRetiredPaper, RETIRED_PAPER_MESSAGE } from '@/lib/rules/paper-availability';
import { createMaterial, MaterialInvariantError } from '@/lib/material';
import { collectFieldErrors, revalidatePaths, mapPrismaUniqueViolation } from '@/lib/admin/action-helpers';
import { appendReceipt } from '@/lib/admin/receipt';
import type { MaterialMutationResult } from './owner-materials.types';

export async function createCatalogPaperAction(
  _prev: MaterialMutationResult | null, formData: FormData,
): Promise<MaterialMutationResult> {
  await requirePermission('material:manage');
  const parsed = newCatalogPaperSchema.safeParse({ mode: 'new', name: formData.get('name'), weight: Number(formData.get('weight')) });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrors(parsed.error.issues.map((issue) => ({
        ...issue, message: /[\u4e00-\u9fff]/u.test(issue.message) ? issue.message : '填写内容有误，请检查后重试',
      }))),
    };
  }
  if (isRetiredPaper({ weight: parsed.data.weight })) return { status: 'error', message: RETIRED_PAPER_MESSAGE };
  if (formData.get('reviewed') !== 'yes') return { status: 'error', message: '请先复核新增纸张' };
  const fact = canonicalizeCreateOrderPaperFact(parsed.data.name, parsed.data.weight)!;
  let id: string;
  try {
    const paper = await createMaterial({ code: null, category: 'PAPER', name: `${fact.paperWeightGsm}g${fact.paperType}`,
      specification: `${fact.paperWeightGsm}g`, unit: '张', safetyStock: null, averageCost: null });
    id = paper.id;
  } catch (error) {
    if (error instanceof MaterialInvariantError) return { status: 'error', message: error.message };
    const unique = mapPrismaUniqueViolation(error, [{ field: 'name', targets: ['Material_active_paper_name_unique'], message: '已存在同名纸张，请检查纸张资料' }]);
    if (unique) return unique;
    throw error;
  }
  revalidatePaths(['/owner/rules/papers', '/owner/materials', '/foreman/materials', '/orders/new', '/workbench']);
  redirect(appendReceipt(`/owner/rules/papers/${id}`, { created: '1' }));
}
