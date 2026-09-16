'use server';

import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { createPieceworkDraft, savePieceworkDraft, publishSavedPieceworkDraft } from '@/lib/salary/piecework-admin';
import { pieceworkDraftSchema, pieceworkRevisionSchema } from '@/lib/salary/piecework-admin-input';
import { PieceworkPriceBookAdminError } from '@/lib/salary/piecework-price-book-admin';
import type { PieceworkActionResult } from './owner-piecework-rules.types';

export async function mutatePieceworkRulesAction(_previous: PieceworkActionResult | null, formData: FormData): Promise<PieceworkActionResult> {
  const actor = await requirePermission('salary:rule:manage');
  const intent = formData.get('intent');
  try {
    if (intent === 'create') {
      await createPieceworkDraft(actor);
    } else if (intent === 'save') {
      const parsed = pieceworkDraftSchema.safeParse({
        version: Number(formData.get('version')), updatedAt: formData.get('updatedAt'),
        partial: formData.get('partial'), full: formData.get('full'), bag: formData.get('bag'), box: formData.get('box'),
        sourceName: formData.get('sourceName'), publishNote: formData.get('publishNote'),
        effectiveFrom: formData.get('effectiveFrom'),
      });
      if (!parsed.success) return { status: 'error', message: '填写内容不正确，请检查金额和生效时间', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
      await savePieceworkDraft(parsed.data, actor);
    } else if (intent === 'publish') {
      const parsed = pieceworkRevisionSchema.safeParse({ version: Number(formData.get('version')), updatedAt: formData.get('updatedAt') });
      if (!parsed.success) return { status: 'error', message: '工价信息已失效，请重新加载' };
      await publishSavedPieceworkDraft(parsed.data, actor);
    } else {
      return { status: 'error', message: '操作无效，请重新加载' };
    }
    revalidatePath('/owner/rules/employee-pay');
    revalidatePath('/owner/rules');
    return { status: 'success', message: intent === 'publish' ? '工价已发布' : intent === 'save' ? '草稿已保存' : '草稿已创建' };
  } catch (error) {
    if (error instanceof PieceworkPriceBookAdminError) return { status: 'error', message: error.message };
    throw error;
  }
}
