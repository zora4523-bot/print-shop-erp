'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  generateBillsSchema,
  recordBillPaymentSchema,
} from '@/lib/auth/schemas';
import {
  generateBillsForPeriod,
  issueBill,
  recordPayment,
  BillError,
  InvalidBillTransitionError,
} from '@/lib/bill';
import type {
  BillMutationResult,
  GenerateBillsResult,
  RecordBillPaymentResult,
} from './bill.types';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';

function mapBillError(
  err: unknown,
): { status: 'error'; message: string } | null {
  if (err instanceof BillError) {
    return { status: 'error', message: err.message };
  }
  if (err instanceof InvalidBillTransitionError) {
    return { status: 'error', message: err.message };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Owner actions — bill:view:all / bill:mark-paid
// ─────────────────────────────────────────────────────────────────────

export async function generateBillsAction(
  _prev: GenerateBillsResult | null,
  raw: unknown,
): Promise<GenerateBillsResult> {
  const actor = await requirePermission('bill:view:all');

  const parsed = generateBillsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const r = await generateBillsForPeriod(parsed.data.period, actor);
    revalidatePath('/owner/bills');
    return {
      status: 'success',
      period: r.period,
      generatedCount: r.generated.length,
      errorCount: r.errors.length,
      errors: r.errors,
    };
  } catch (err) {
    const mapped = mapBillError(err);
    if (mapped) return mapped;
    if (err instanceof Error) return { status: 'error', message: err.message };
    throw err;
  }
}

// Issue a DRAFT bill (owner sends the bill to sales / customer service).
export async function issueBillAction(
  billId: string,
): Promise<BillMutationResult> {
  const actor = await requirePermission('bill:view:all');

  try {
    await issueBill(billId, actor);
  } catch (err) {
    const mapped = mapBillError(err);
    if (mapped) return mapped;
    throw err;
  }
  revalidatePath('/owner/bills');
  revalidatePath(`/owner/bills/${billId}`);
  return { status: 'success' };
}

// Record a payment. `bill:mark-paid` is OWNER-only; salesUser never
// marks their own bills paid.
export async function recordBillPaymentAction(
  billId: string,
  _prev: RecordBillPaymentResult | null,
  formData: FormData,
): Promise<RecordBillPaymentResult> {
  const actor = await requirePermission('bill:mark-paid');

  const parsed = recordBillPaymentSchema.safeParse({
    amount: formData.get('amount'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const r = await recordPayment(billId, parsed.data.amount, actor);
    revalidatePath('/owner/bills');
    revalidatePath(`/owner/bills/${billId}`);
    return {
      status: 'success',
      newPaidAmount: r.newPaidAmount,
      totalAmount: r.totalAmount,
      billStatus: r.status,
      csAccumulated: r.csAccumulated,
    };
  } catch (err) {
    const mapped = mapBillError(err);
    if (mapped) return mapped;
    throw err;
  }
}
