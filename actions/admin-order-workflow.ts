'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { OrderWorkflowReasonCode } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import {
  AdminOrderWorkflowError,
  confirmFactoryOrder,
  holdFactoryOrder,
  rejectFactoryOrder,
  releaseFactoryOrder,
  resumeFactoryOrder,
  settleFactoryOrder,
} from '@/lib/order/admin-workflow';
import { InvalidOrderTransitionError } from '@/lib/order/status-machine';
import { OrderPrintJobError } from '@/lib/order/print-jobs';
import { ProductionOperationMaterializationError } from '@/lib/production/operation-materialization-service';
import {
  ADMIN_ORDER_BATCH_COMMANDS,
  runAdminOrderBatch,
  type AdminOrderBatchResult,
} from '@/lib/order/admin-batch';

export type AdminOrderWorkflowActionResult =
  | { status: 'success'; orderId: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; code?: string; message: string };

const orderId = z.string().trim().min(1, '工单不能为空').max(128);
const expectedRevision = z.number().int().nonnegative();
const expectedWorkOrderVersion = z.number().int().positive();
const idempotencyKey = z.string().trim().min(8).max(128);

const versionedSchema = z.object({
  orderId,
  expectedRevision,
  expectedWorkOrderVersion,
});

const factoryConfirmationSchema = versionedSchema.extend({
  expectedQuoteToken: z
    .string()
    .trim()
    .regex(
      /^create-order-quote-v2:[a-f\d]{64}$/u,
      '当前价预览凭证格式错误',
    )
    .nullable(),
});

const decisionSchema = z.object({
  orderId,
  reasonCode: z.nativeEnum(OrderWorkflowReasonCode),
  reasonNote: z.string().trim().min(1).max(500),
  affectedFigs: z.array(z.number().int().positive()).max(100).default([]),
  idempotencyKey,
});

const resumeSchema = z.object({
  orderId,
  recoveryEvidence: z.record(
    z.string().trim().min(1).max(80),
    z.string().trim().min(1).max(500),
  ),
  note: z.string().trim().max(500).nullish(),
  idempotencyKey,
});

const releaseSchema = versionedSchema.extend({ printIdempotencyKey: idempotencyKey, createPrint: z.boolean().optional() });

const batchSchema = z.object({
  requestId: idempotencyKey,
  // Confirm/reject are deliberately absent: each requires an individual
  // preflight and adjudication record.
  command: z.enum(ADMIN_ORDER_BATCH_COMMANDS),
  items: z
    .array(
      versionedSchema.extend({
        requestJobId: z.string().trim().min(1).max(128).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export type AdminOrderBatchActionResult =
  | { status: 'success'; result: AdminOrderBatchResult }
  | {
      status: 'partial_failure';
      message: string;
      result: AdminOrderBatchResult;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; code?: string; message: string };

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

function handledError(error: unknown): AdminOrderWorkflowActionResult | null {
  if (
    error instanceof AdminOrderWorkflowError ||
    error instanceof InvalidOrderTransitionError ||
    error instanceof OrderPrintJobError ||
    error instanceof ProductionOperationMaterializationError
  ) {
    return {
      status: 'error',
      ...('code' in error && typeof error.code === 'string'
        ? { code: error.code }
        : {}),
      message: error.message,
    };
  }
  return null;
}

function revalidateOrder(orderIdValue: string): void {
  revalidatePath('/orders');
  revalidatePath(`/orders/${orderIdValue}`);
}

export async function confirmFactoryOrderAction(
  raw: unknown,
): Promise<AdminOrderWorkflowActionResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = factoryConfirmationSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: fieldErrors(parsed.error) };
  }
  try {
    const result = await confirmFactoryOrder(parsed.data, actor);
    revalidateOrder(result.orderId);
    return { status: 'success', orderId: result.orderId };
  } catch (error) {
    const handled = handledError(error);
    if (handled && handled.status === 'error') return handled;
    throw error;
  }
}

export async function rejectFactoryOrderAction(
  raw: unknown,
): Promise<AdminOrderWorkflowActionResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: fieldErrors(parsed.error) };
  }
  try {
    const result = await rejectFactoryOrder(parsed.data, actor);
    revalidateOrder(result.orderId);
    return { status: 'success', orderId: result.orderId };
  } catch (error) {
    const handled = handledError(error);
    if (handled) return handled;
    throw error;
  }
}

export async function holdFactoryOrderAction(
  raw: unknown,
): Promise<AdminOrderWorkflowActionResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: fieldErrors(parsed.error) };
  }
  try {
    const result = await holdFactoryOrder(parsed.data, actor);
    revalidateOrder(result.orderId);
    return { status: 'success', orderId: result.orderId };
  } catch (error) {
    const handled = handledError(error);
    if (handled) return handled;
    throw error;
  }
}

export async function resumeFactoryOrderAction(
  raw: unknown,
): Promise<AdminOrderWorkflowActionResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = resumeSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: fieldErrors(parsed.error) };
  }
  try {
    const result = await resumeFactoryOrder(parsed.data, actor);
    revalidateOrder(result.orderId);
    return { status: 'success', orderId: result.orderId };
  } catch (error) {
    const handled = handledError(error);
    if (handled) return handled;
    throw error;
  }
}

export async function releaseFactoryOrderAction(
  raw: unknown,
): Promise<AdminOrderWorkflowActionResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = releaseSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: fieldErrors(parsed.error) };
  }
  try {
    const result = await releaseFactoryOrder(parsed.data, actor);
    revalidateOrder(result.orderId);
    return { status: 'success', orderId: result.orderId };
  } catch (error) {
    const handled = handledError(error);
    if (handled) return handled;
    throw error;
  }
}

export async function settleFactoryOrderAction(
  raw: unknown,
): Promise<AdminOrderWorkflowActionResult> {
  const actor = await requirePermission('order:ship');
  const parsed = versionedSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: fieldErrors(parsed.error) };
  }
  try {
    const result = await settleFactoryOrder(parsed.data, actor);
    revalidateOrder(result.orderId);
    revalidatePath('/owner/bills');
    revalidatePath('/owner/agent-bills');
    return { status: 'success', orderId: result.orderId };
  } catch (error) {
    const handled = handledError(error);
    if (handled) return handled;
    throw error;
  }
}

export async function runAdminOrderBatchAction(
  raw: unknown,
): Promise<AdminOrderBatchActionResult> {
  const actor = await requirePermission('order:change:review');
  const parsed = batchSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: fieldErrors(parsed.error) };
  }
  try {
    const result = await runAdminOrderBatch(parsed.data, actor);
    revalidatePath('/orders');
    if (parsed.data.command === 'SETTLE') {
      revalidatePath('/owner/bills');
      revalidatePath('/owner/agent-bills');
    }
    if (result.failedCount > 0) {
      return {
        status: 'partial_failure',
        message: '批量操作发生系统异常，已刷新列表；请核对每张工单后再重试',
        result,
      };
    }
    return { status: 'success', result };
  } catch (error) {
    const handled = handledError(error);
    if (handled && handled.status === 'error') return handled;
    throw error;
  }
}
