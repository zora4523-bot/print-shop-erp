'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createOrderSchema,
  cancelOrderSchema,
  type CreateOrderInput,
} from '@/lib/auth/schemas';
import {
  createOrder,
  submitOrder,
  cancelOrder,
  OrderInvariantError,
  InvalidOrderTransitionError,
} from '@/lib/order';
import type { OrderMutationResult } from './order.types';

function collectFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    // Compound paths like ['items', 0, 'quantity'] flatten to
    // 'items.0.quantity' so the client form can target the right row.
    const key = issue.path.length ? issue.path.map(String).join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// Accepts a pre-parsed `CreateOrderInput` rather than FormData because
// items is a nested array and `FormData` flattens poorly. The UI layer
// (Slice B) will hand this function a structured payload via a
// progressively-enhanced form + JSON body or a bound call.
export async function createOrderAction(
  _prev: OrderMutationResult | null,
  raw: unknown,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:create');

  const parsed = createOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  let createdId: string;
  try {
    const created = await createOrder(parsed.data, actor);
    createdId = created.id;
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  redirect(`/orders/${createdId}`);
}

// A thin no-permission-check helper for callers that have already resolved
// the input via a trusted path (tests, seed scripts). Not exported via
// `'use server'` semantics.
export async function createOrderFromInput(
  input: CreateOrderInput,
  actor: { id: string; role: import('../generated/prisma/client').Role },
) {
  return createOrder(input, actor);
}

export async function submitOrderAction(
  orderId: string,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:create');

  try {
    await submitOrder(orderId, actor);
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof InvalidOrderTransitionError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  return { status: 'success' };
}

export async function cancelOrderAction(
  orderId: string,
  _prev: OrderMutationResult | null,
  formData: FormData,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:cancel');

  const reasonRaw = formData.get('reason');
  const parsed = cancelOrderSchema.safeParse({
    reason: typeof reasonRaw === 'string' ? reasonRaw : '',
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await cancelOrder(orderId, actor, parsed.data.reason);
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof InvalidOrderTransitionError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  return { status: 'success' };
}
