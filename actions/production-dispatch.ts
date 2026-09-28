'use server';

import { PieceworkPricingError } from '@/lib/salary/piecework-pricing';
import { AdminOrderWorkflowError } from '@/lib/order/admin-workflow';
import { ProductionOperationMaterializationError } from '@/lib/production/operation-materialization-service';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/permissions';
import { publishProductionDispatch, dispatchSchema } from '@/lib/production/dispatch';
import { registerProductionCompletion, completionSchema } from '@/lib/production/completion-registration';
import { allocateProductionWages, productionWageSchema } from '@/lib/salary/production-wages';
import { reviewProductionFact, factReviewSchema } from '@/lib/production/fact-review';

type ProductionActionState = { ok: boolean; message: string } | null;
function refreshProduction(orderIds: string[]) {
  revalidatePath('/orders');
  revalidatePath('/orders/production');
  revalidatePath('/worker/tasks');
  revalidatePath('/worker/orders');
  revalidatePath('/worker/salary');
  revalidatePath('/owner/salary/piecework');
  for (const id of orderIds) { revalidatePath(`/orders/${id}`); revalidatePath(`/worker/orders/${id}`); }
  revalidatePath('/worker/tasks/[id]', 'page');
}
function failure(error: unknown): ProductionActionState {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return { ok: false, message: '填写内容不完整，请核对后重试' };
  if (error instanceof PieceworkPricingError || error instanceof AdminOrderWorkflowError || error instanceof ProductionOperationMaterializationError) return { ok: false, message: error.message };
  // Domain errors are curated; database errors must never expose SQL or internals.
  if (error instanceof Error && error.constructor === Error && !/[\n]|Prisma|SELECT |INSERT |UPDATE /i.test(error.message)) return { ok: false, message: error.message };
  return { ok: false, message: '本次未保存，请刷新核对后重试' };
}
export async function publishProductionDispatchAction(_state: ProductionActionState, form: FormData): Promise<ProductionActionState> {
  try {
    const actor = await requirePermission('production:manage');
    const input = dispatchSchema.parse(JSON.parse(String(form.get('payload'))));
    const ids = await publishProductionDispatch(input, actor);
    refreshProduction(ids);
    return { ok: true, message: `已安排 ${ids.length} 张工单` };
  } catch (error) { return failure(error); }
}
export async function registerProductionCompletionAction(_state: ProductionActionState, form: FormData): Promise<ProductionActionState> {
  try {
    const mode = form.get('mode');
    const actor = await requirePermission(mode === 'COMPLETE' ? 'task:report' : 'production:manage');
    const itemQuantities = Object.fromEntries([...form.entries()].filter(([key]) => key.startsWith('itemQuantity:')).map(([key, value]) => [key.slice('itemQuantity:'.length), value]));
    const input = completionSchema.parse({ jobId: form.get('jobId'), revision: Number(form.get('revision')), quantity: form.get('quantity'), mode, reason: form.get('reason') ?? '', workDate: form.get('workDate') || undefined,
      notActuallyProduced: form.get('notActuallyProduced') === 'on', confirmedSettledDay: form.get('confirmedSettledDay') === 'on',
      confirmedAdditionalProduction: form.get('confirmedAdditionalProduction') === 'on',
      reviewRevision: form.has('reviewRevision') ? Number(form.get('reviewRevision')) : undefined,
      ...(Object.keys(itemQuantities).length ? { itemQuantities } : {}),
    });
    const result = await registerProductionCompletion(input, actor);
    refreshProduction([result.orderId]);
    return { ok: true, message: input.mode === 'REJECT' ? '已驳回数量申请' : result.status === 'REQUESTED' ? '数量已提交审批' : '已登记完成' };
  } catch (error) { return failure(error); }
}

export async function reviewProductionFactAction(_state: ProductionActionState, form: FormData): Promise<ProductionActionState> {
  try {
    const actor = await requirePermission('production:manage');
    const input = factReviewSchema.parse({ jobId: form.get('jobId'), jobRevision: Number(form.get('jobRevision')), reviewRevision: Number(form.get('reviewRevision')),
      mode: form.get('mode'), reason: form.get('reason'), notActuallyProduced: form.get('notActuallyProduced') === 'on',
      relatedJobId: form.get('relatedJobId') || undefined, quantity: form.get('quantity') || undefined, workDate: form.get('workDate') || undefined,
      confirmedIncluded: form.get('confirmedIncluded') === 'on' });
    const orderId = await reviewProductionFact(input, actor);
    refreshProduction([orderId]);
    return { ok: true, message: '生产核对记录已保存' };
  } catch (error) { return failure(error); }
}
export async function allocateProductionWagesAction(_state: ProductionActionState, form: FormData): Promise<ProductionActionState> {
  try {
    const actor = await requirePermission('production:manage');
    const input = productionWageSchema.parse(JSON.parse(String(form.get('payload'))));
    const id = await allocateProductionWages(input, actor);
    refreshProduction([id]);
    return { ok: true, message: '提成已登记' };
  } catch (error) { return failure(error); }
}

export async function correctProductionRegistrationAction(input: unknown): Promise<ProductionActionState> {
  try {
    const actor = await requirePermission('production:manage');
    const { correctionSchema, correctProductionRegistration } = await import('@/lib/production/correct-registration');
    const id = await correctProductionRegistration(correctionSchema.parse(input), actor);
    refreshProduction([id]);
    return { ok: true, message: '误登记已更正，工单已恢复生产中' };
  } catch (error) { return failure(error); }
}
