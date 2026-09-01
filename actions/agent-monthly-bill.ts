'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/permissions';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import {
  confirmAgentMonthlyBill,
  createAgentMonthlyBillCredit,
  markAgentMonthlyBillPaid,
} from '@/lib/agent-monthly-billing/commands';
import { AgentMonthlyBillingError } from '@/lib/agent-monthly-billing/errors';
import { generateAgentMonthlyBillsForPeriod } from '@/lib/agent-monthly-billing/generation';
import type { AgentMonthlyBillActionResult } from './agent-monthly-bill.types';

const idempotencyKey = z.string().trim().min(1).max(128);
const generateSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '请输入有效账期'),
}).strict();
const confirmSchema = z.object({ idempotencyKey }).strict();
const paidSchema = z
  .object({
    idempotencyKey,
    paymentMethod: z.string().trim().max(100).optional(),
    referenceNo: z.string().trim().max(100).optional(),
  })
  .strict();
const creditSchema = z
  .object({
    idempotencyKey,
    sourceItemId: z.string().trim().min(1).max(128),
    amount: z
      .string()
      .trim()
      .regex(/^\d+(?:\.\d{1,2})?$/, '金额必须是最多两位小数的正数'),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

function formObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

function mappedError(error: unknown): AgentMonthlyBillActionResult | null {
  if (error instanceof AgentMonthlyBillingError) {
    return { status: 'error', message: error.message };
  }
  return null;
}

function invalid(error: z.ZodError): AgentMonthlyBillActionResult {
  return {
    status: 'invalid',
    fieldErrors: collectFieldErrorsDeep(error.issues),
  };
}

function refreshBillPages(billId?: string): void {
  revalidatePath('/owner/agent-bills');
  if (billId) revalidatePath(`/owner/agent-bills/${billId}`);
}

export async function generateAgentMonthlyBillsAction(
  _previous: AgentMonthlyBillActionResult | null,
  formData: FormData,
): Promise<AgentMonthlyBillActionResult> {
  const actor = await requirePermission('bill:view:all');
  const parsed = generateSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  try {
    const result = await generateAgentMonthlyBillsForPeriod(
      parsed.data.period,
      actor,
    );
    refreshBillPages();
    return {
      status: 'success',
      message: `已同步 ${result.generated.length} 张 ${result.period} 账单`,
    };
  } catch (error) {
    const mapped = mappedError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function confirmAgentMonthlyBillAction(
  billId: string,
  _previous: AgentMonthlyBillActionResult | null,
  formData: FormData,
): Promise<AgentMonthlyBillActionResult> {
  const actor = await requirePermission('bill:view:all');
  const parsed = confirmSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  try {
    const result = await confirmAgentMonthlyBill(
      billId,
      actor,
      parsed.data.idempotencyKey,
    );
    refreshBillPages(billId);
    return {
      status: 'success',
      billStatus: result.status,
      message:
        result.status === 'PAID'
          ? '零元账单已确认并自动结清'
          : '账单已确认，成员与金额已冻结',
    };
  } catch (error) {
    const mapped = mappedError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function markAgentMonthlyBillPaidAction(
  billId: string,
  _previous: AgentMonthlyBillActionResult | null,
  formData: FormData,
): Promise<AgentMonthlyBillActionResult> {
  const actor = await requirePermission('bill:mark-paid');
  // Parse every submitted key with a strict schema. In particular, a client
  // that attempts to submit `amount` is rejected; the service reads only the
  // locked bill total.
  const parsed = paidSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  try {
    const result = await markAgentMonthlyBillPaid(
      {
        billId,
        idempotencyKey: parsed.data.idempotencyKey,
        paymentMethod: parsed.data.paymentMethod,
        referenceNo: parsed.data.referenceNo,
      },
      actor,
    );
    refreshBillPages(billId);
    return {
      status: 'success',
      billStatus: result.status,
      message: `已按锁定总额 ¥ ${result.amount} 标记已收`,
    };
  } catch (error) {
    const mapped = mappedError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function createAgentMonthlyBillCreditAction(
  billId: string,
  _previous: AgentMonthlyBillActionResult | null,
  formData: FormData,
): Promise<AgentMonthlyBillActionResult> {
  const actor = await requirePermission('bill:view:all');
  const parsed = creditSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  try {
    const result = await createAgentMonthlyBillCredit(
      { ...parsed.data, expectedBillId: billId },
      actor,
    );
    refreshBillPages(billId);
    for (const allocatedBillId of result.allocatedBillIds) {
      revalidatePath(`/owner/agent-bills/${allocatedBillId}`);
    }
    return {
      status: 'success',
      message:
        result.allocatedBillIds.length > 0
          ? '负项事实已记录，并已抵扣后续开放月份'
          : '负项事实已记录；尚无后续 DRAFT，余额会保留等待未来月份',
    };
  } catch (error) {
    const mapped = mappedError(error);
    if (mapped) return mapped;
    throw error;
  }
}
