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

function formObject(formData: FormData): Record<string, FormDataEntryValue> {
  // React adds action references and state metadata on native submissions.
  // Preserve every business entry, including files, so strict schemas can
  // reject unknown keys and invalid types instead of silently dropping them.
  return Object.fromEntries(
    [...formData.entries()].filter(([key]) => !key.startsWith('$ACTION_')),
  );
}

function mappedError(error: unknown): AgentMonthlyBillActionResult | null {
  if (error instanceof AgentMonthlyBillingError) {
    return { status: 'error', message: error.message };
  }
  return null;
}

function invalid(error: z.ZodError): AgentMonthlyBillActionResult {
  const messages: Readonly<Record<string, string>> = {
    period: '账期无效，请选择有效月份',
    idempotencyKey: '表单已失效，请刷新页面后重试',
    paymentMethod: '收款方式无效，请填写 100 字以内的文字',
    referenceNo: '流水号无效，请填写 100 字以内的文字',
    sourceItemId: '账单明细无效，请刷新页面后重试',
    amount: '负项金额无效，请填写最多两位小数的正数',
    reason: '负项原因无效，请填写 1 至 500 字',
  };
  return {
    status: 'invalid',
    fieldErrors: collectFieldErrorsDeep(error.issues.map((issue) => ({
      path: issue.path,
      message: issue.code === 'unrecognized_keys'
        ? '提交内容包含页面不支持的字段，请刷新后重试'
        : messages[String(issue.path[0])] ?? '提交内容无效，请检查后重试',
    }))),
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
  const actor = await requirePermission('bill:manage');
  const parsed = generateSchema.safeParse(formObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  try {
    const result = await generateAgentMonthlyBillsForPeriod(
      parsed.data.period,
      actor,
    );
    refreshBillPages();
    if (result.errors.length > 0) {
      return { status: 'error', message: `已生成或更新 ${result.generated.length} 张账单；${result.errors.length} 个工单金额异常，所属销售当月账单未更新：${result.errors.map(error => error.message).join('；')}` };
    }
    return {
      status: 'success',
      message: `已生成或更新 ${result.generated.length} 张 ${result.period} 账单`,
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
  const actor = await requirePermission('bill:manage');
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
  // Parse every business key with a strict schema. In particular, a client
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
      message: `已收款 ¥ ${result.amount}`,
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
  const actor = await requirePermission('bill:manage');
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
          ? '已记录负项，并已抵扣后续账单'
          : '已记录负项，余额将在后续草稿账单中抵扣',
    };
  } catch (error) {
    const mapped = mappedError(error);
    if (mapped) return mapped;
    throw error;
  }
}
