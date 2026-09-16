'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import { payrollPassSchema, PayrollPassError, updatePayrollPassCount } from '@/lib/production/payroll-pass-admin';
import { PieceworkPriceBookAdminError } from '@/lib/salary/piecework-price-book-admin';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';

export type PayrollPassActionResult = { status: 'success' | 'error'; message: string; fieldErrors?: Record<string, string[]> };
export async function updatePayrollPassAction(_previous: PayrollPassActionResult | null, form: FormData): Promise<PayrollPassActionResult> {
  const actor = await requirePermission('salary:rule:manage');
  const parsed = payrollPassSchema.safeParse({
    operationId: form.get('operationId'), expectedRevision: form.has('expectedRevision') ? Number(form.get('expectedRevision')) : NaN,
    passCount: Number(form.get('passCount')), reason: form.get('reason'),
  });
  if (!parsed.success) return { status: 'error', message: '填写内容不正确，请检查次数和调整原因', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  try {
    const result = await updatePayrollPassCount(parsed.data, actor);
    revalidatePath(`/orders/${result.orderId}`);
    revalidatePath(`/worker/tasks/${parsed.data.operationId}`);
    revalidatePath('/worker/tasks');
    return { status: 'success', message: '计薪次数已保存' };
  } catch (error) {
    if (error instanceof PayrollPassError || error instanceof PieceworkPriceBookAdminError) return { status: 'error', message: error.message };
    throw error;
  }
}
