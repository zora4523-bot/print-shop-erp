'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/permissions';
import {
  scheduleOrderSchema,
  type ScheduleOrderInput,
} from '@/lib/auth/schemas';
import { scheduleOrder, SchedulingError } from '@/lib/production';
import { OrderInvariantError, InvalidOrderTransitionError } from '@/lib/order';
import type { ScheduleOrderResult } from './production.types';

function collectFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// Accepts a structured payload (the UI assembles { orderId, assignments })
// rather than FormData because the assignments array would flatten poorly
// through HTML form keys. The client passes a bound server-action call.
export async function scheduleOrderAction(
  _prev: ScheduleOrderResult | null,
  raw: unknown,
): Promise<ScheduleOrderResult> {
  const actor = await requirePermission('order:schedule');

  const parsed = scheduleOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    const result = await scheduleOrder(parsed.data, actor);
    revalidatePath('/orders');
    revalidatePath(`/orders/${result.orderId}`);
    return {
      status: 'success',
      orderId: result.orderId,
      tasksCreated: result.tasksCreated,
    };
  } catch (err) {
    // Narrow the error types the lib layer throws — any stray
    // exception bubbles up as a 500 so we notice during ops.
    if (err instanceof SchedulingError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof InvalidOrderTransitionError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }
}

// Thin pass-through for trusted callers (seeds / integration tests)
// that have already validated the input.
export async function scheduleOrderFromInput(
  input: ScheduleOrderInput,
  actor: { id: string; role: import('../generated/prisma/client').Role },
) {
  return scheduleOrder(input, actor);
}
