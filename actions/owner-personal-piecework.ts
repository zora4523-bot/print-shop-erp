'use server';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { createPersonalPieceworkDraft, savePersonalPieceworkDraft, publishPersonalPieceworkDraft, personalPieceworkSchema } from '@/lib/salary/personal-piecework-admin';
import { PieceworkPriceBookAdminError } from '@/lib/salary/piecework-price-book-admin';
import { pieceworkRevisionSchema } from '@/lib/salary/piecework-admin-input';
import type { PieceworkActionResult } from './owner-piecework-rules.types';
export async function mutatePersonalPieceworkAction(workerId: string, _previous: PieceworkActionResult | null, form: FormData): Promise<PieceworkActionResult> {
  const actor = await requirePermission('salary:rule:manage');
  const intent = form.get('intent');
  try {
    if (intent === 'create') await createPersonalPieceworkDraft(workerId, actor);
    else if (intent === 'save') {
      const parsed = personalPieceworkSchema.safeParse({
        workerId, version: Number(form.get('version')), updatedAt: form.get('updatedAt'),
        useUnifiedRates: form.get('useUnifiedRates') === 'true' ? true : form.get('useUnifiedRates') === 'false' ? false : undefined,
        partial: form.get('partial') ?? '', full: form.get('full') ?? '', bag: form.get('bag') ?? '', box: form.get('box') ?? '',
        sourceName: form.get('sourceName'), publishNote: form.get('publishNote'), effectiveFrom: form.get('effectiveFrom'),
      });
      if (!parsed.success) return { status: 'error', message: '请检查工价、生效时间和调整说明', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
      await savePersonalPieceworkDraft(parsed.data, actor);
    } else if (intent === 'publish') {
      const parsed = pieceworkRevisionSchema.safeParse({ version: Number(form.get('version')), updatedAt: form.get('updatedAt') });
      if (!parsed.success) return { status: 'error', message: '工价已变化，请重新加载' };
      await publishPersonalPieceworkDraft({ workerId, ...parsed.data }, actor);
    } else return { status: 'error', message: '操作无效，请重新加载' };
    revalidatePath(`/owner/accounts/${workerId}`);
    revalidatePath('/worker/tasks', 'layout');
    return { status: 'success', message: intent === 'publish' ? '工价已发布' : intent === 'save' ? '草稿已保存' : '草稿已创建' };
  } catch (error) {
    if (error instanceof PieceworkPriceBookAdminError) return { status: 'error', message: error.message };
    throw error;
  }
}
