'use server';

import { DispatchPlanValidationError } from '@/lib/production/dispatch-plan-error';
import { PieceworkPricingError } from '@/lib/salary/piecework-pricing';
import { FoilWageInputError } from '@/lib/salary/foil-wage';
import { AdminOrderWorkflowError } from '@/lib/order/admin-workflow';
import { ProductionOperationMaterializationError } from '@/lib/production/operation-materialization-service';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/permissions';
import { UnauthorizedError } from '@/lib/auth/errors';
import { ProductionConflictError, ProductionInputError } from '@/lib/production/input-error';
import { DATABASE_BUSY_MESSAGE, isDatabaseBusyError } from '@/lib/database-errors';
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
  if (isDatabaseBusyError(error)) return { ok: false, message: DATABASE_BUSY_MESSAGE };
  if (error instanceof ProductionConflictError) {
    refreshProduction([error.orderId]);
    return { ok: false, message: error.message };
  }
  if (error instanceof z.ZodError) return { ok: false, message: '填写内容不完整，请核对后重试' };
  if (error instanceof PieceworkPricingError || error instanceof AdminOrderWorkflowError || error instanceof ProductionOperationMaterializationError) return { ok: false, message: error.message };
  if (error instanceof DispatchPlanValidationError) return { ok: false, message: `${error.order.name}：${error.issues.join('；')}` };
  if (error instanceof ProductionInputError || error instanceof FoilWageInputError || error instanceof UnauthorizedError) return { ok: false, message: error.message };
  throw error;
}
function parsePayload(form: FormData): unknown {
  try {
    return JSON.parse(String(form.get('payload')));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ProductionInputError('填写内容不完整，请核对后重试');
    throw error;
  }
}
export async function publishProductionDispatchAction(_state: ProductionActionState, form: FormData): Promise<ProductionActionState> {
  try {
    const actor = await requirePermission('production:manage');
    const input = dispatchSchema.parse(parsePayload(form));
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
    const input = productionWageSchema.parse(parsePayload(form));
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
