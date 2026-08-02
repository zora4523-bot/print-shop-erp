'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  generateBillsSchema,
  recordBillPaymentSchema,
  createOrderCostEntrySchema,
} from '@/lib/auth/schemas';
import {
  generateBillsForPeriod,
  issueBill,
  recordPayment,
  addOrderCostEntry,
  BillError,
  InvalidBillTransitionError,
} from '@/lib/bill';
import type {
  BillMutationResult,
  GenerateBillsResult,
  RecordBillPaymentResult,
  OrderCostMutationResult,
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
    // Unknown error (Prisma, etc.) — rethrow so it reaches Next's
    // onRequestError → Sentry instead of leaking its message to the UI
    // as a graceful toast (matches issueBillAction / production.ts).
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

// Record a payment. `bill:mark-paid` is ADMIN-only; salesUser never
// marks their own bills paid.
export async function recordBillPaymentAction(
  billId: string,
  _prev: RecordBillPaymentResult | null,
  formData: FormData,
): Promise<RecordBillPaymentResult> {
  const actor = await requirePermission('bill:mark-paid');

  const parsed = recordBillPaymentSchema.safeParse({
    idempotencyKey: formData.get('idempotencyKey'),
    amount: formData.get('amount'),
    paidAt: formData.get('paidAt'),
    paymentMethod: formData.get('paymentMethod'),
    referenceNo: formData.get('referenceNo'),
    remark: formData.get('remark'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }

  try {
    const r = await recordPayment(
      billId,
      parsed.data.amount,
      actor,
      parsed.data.paidAt,
      {
        idempotencyKey: parsed.data.idempotencyKey,
        paymentMethod: parsed.data.paymentMethod,
        referenceNo: parsed.data.referenceNo,
        remark: parsed.data.remark,
      },
    );
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

export async function createOrderCostEntryAction(
  _prev: OrderCostMutationResult | null,
  formData: FormData,
): Promise<OrderCostMutationResult> {
  const actor = await requirePermission('bill:view:all');
  const parsed = createOrderCostEntrySchema.safeParse({
    idempotencyKey: formData.get('idempotencyKey'),
    orderId: formData.get('orderId'),
    category: formData.get('category'),
    description: formData.get('description'),
    quantity: formData.get('quantity'),
    unit: formData.get('unit'),
    unitPrice: formData.get('unitPrice'),
    amount: formData.get('amount'),
    remark: formData.get('remark'),
  });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }
  try {
    const entry = await addOrderCostEntry(parsed.data, actor);
    revalidatePath(`/orders/${parsed.data.orderId}`);
    revalidatePath('/owner/bills');
    return { status: 'success', costEntryId: entry.id };
  } catch (error) {
    const mapped = mapBillError(error);
    if (mapped) return mapped;
    throw error;
  }
}
