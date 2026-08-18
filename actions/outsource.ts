'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  confirmOutsourceAmountSchema,
  createOutsourceSchema,
  markOutsourceReceivedSchema,
  recordOutsourcePaymentSchema,
} from '@/lib/auth/schemas';
import {
  confirmOutsourceAmount,
  createOutsourceOrder,
  markOutsourceReceived,
  recordOutsourcePayment,
  cancelOutsourceOrder,
  OutsourceError,
  InvalidOutsourceTransitionError,
} from '@/lib/outsource';
import type {
  OutsourceAmountMutationResult,
  OutsourceMutationResult,
  OutsourcePaymentMutationResult,
} from './outsource.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';

function mapOutsourceError(
  err: unknown,
): { status: 'error'; message: string } | null {
  if (err instanceof OutsourceError) {
    return { status: 'error', message: err.message };
  }
  if (err instanceof InvalidOutsourceTransitionError) {
    return { status: 'error', message: err.message };
  }
  return null;
}

// Accepts structured payload (orderItemIds is an array). Foreman-only.
export async function createOutsourceAction(
  _prev: OutsourceMutationResult | null,
  raw: unknown,
): Promise<OutsourceMutationResult> {
  const actor = await requirePermission('outsource:manage');

  const parsed = createOutsourceSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }

  let createdId: string;
  try {
    const created = await createOutsourceOrder(parsed.data, actor);
    createdId = created.id;
  } catch (err) {
    const mapped = mapOutsourceError(err);
    if (mapped) return mapped;
    throw err;
  }

  revalidatePath('/foreman/outsource');
  revalidatePath(`/orders/${parsed.data.orderId}`);
  return { status: 'success', id: createdId };
}

export async function confirmOutsourceAmountAction(
  id: string,
  _prev: OutsourceAmountMutationResult | null,
  formData: FormData,
): Promise<OutsourceAmountMutationResult> {
  const actor = await requirePermission('outsource:manage');
  const parsed = confirmOutsourceAmountSchema.safeParse({
    idempotencyKey: formData.get('idempotencyKey'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const result = await confirmOutsourceAmount(id, parsed.data, actor);
    revalidatePath('/foreman/outsource');
    revalidatePath(`/foreman/outsource/${id}`);
    if (result.orderId) revalidatePath(`/orders/${result.orderId}`);
    return { status: 'success', id, amount: result.amount };
  } catch (err) {
    const mapped = mapOutsourceError(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function recordOutsourcePaymentAction(
  id: string,
  _prev: OutsourcePaymentMutationResult | null,
  formData: FormData,
): Promise<OutsourcePaymentMutationResult> {
  const actor = await requirePermission('outsource:manage');
  const parsed = recordOutsourcePaymentSchema.safeParse({
    idempotencyKey: formData.get('idempotencyKey'),
    amount: formData.get('amount'),
    paidAt: formData.get('paidAt'),
    method: formData.get('method'),
    reference: formData.get('reference'),
    remark: formData.get('remark'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const result = await recordOutsourcePayment(id, parsed.data, actor);
    revalidatePath('/foreman/outsource');
    revalidatePath(`/foreman/outsource/${id}`);
    return {
      status: 'success',
      paymentId: result.paymentId,
      totalAmount: result.totalAmount,
      newPaidAmount: result.newPaidAmount,
      remainingAmount: result.remainingAmount,
      isFullyPaid: result.isFullyPaid,
    };
  } catch (err) {
    const mapped = mapOutsourceError(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function markOutsourceReceivedAction(
  id: string,
  _prev: OutsourceMutationResult | null,
  formData: FormData,
): Promise<OutsourceMutationResult> {
  const actor = await requirePermission('outsource:manage');
  const parsed = markOutsourceReceivedSchema.safeParse({
    actualDate: formData.get('actualDate'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }
  try {
    const result = await markOutsourceReceived(id, parsed.data, actor);
    if (result.orderId) revalidatePath(`/orders/${result.orderId}`);
  } catch (err) {
    const mapped = mapOutsourceError(err);
    if (mapped) return mapped;
    throw err;
  }
  revalidatePath('/foreman/outsource');
  revalidatePath(`/foreman/outsource/${id}`);
  return { status: 'success', id };
}

export async function cancelOutsourceAction(
  id: string,
): Promise<OutsourceMutationResult> {
  const actor = await requirePermission('outsource:manage');
  try {
    const result = await cancelOutsourceOrder(id, actor);
    if (result.orderId) revalidatePath(`/orders/${result.orderId}`);
  } catch (err) {
    const mapped = mapOutsourceError(err);
    if (mapped) return mapped;
    throw err;
  }
  revalidatePath('/foreman/outsource');
  revalidatePath(`/foreman/outsource/${id}`);
  return { status: 'success', id };
}
