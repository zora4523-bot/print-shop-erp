'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createOrderSchema,
  cancelOrderSchema,
  shipOrderSchema,
  updateEditableOrderSchema,
  setOrderUrgentSchema,
  type CreateOrderInput,
} from '@/lib/auth/schemas';
import {
  createOrder,
  submitOrder,
  cancelOrder,
  shipOrder,
  finishOrder,
  updateOrderFields,
  setOrderUrgent,
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
  // 'order:create' is the coarse role gate. Ownership — "you can only
  // submit your own DRAFT unless you're OWNER / FOREMAN" — is enforced
  // deeper in lib/order.submitOrder's `authz` callback (round 27), which
  // throws OrderInvariantError and is mapped to `{ status: 'error' }`
  // below. Any direct POST to this action bypassing the UI still hits
  // that guard.
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

  // Pass the raw FormDataEntryValue through to the schema so a File
  // upload (or any non-string) gets rejected as invalid instead of
  // being silently coerced to '' and proceeding with an empty reason
  // on a destructive action.
  const parsed = cancelOrderSchema.safeParse({
    reason: formData.get('reason'),
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

// COMPLETED → SHIPPED. OWNER + FOREMAN per `order:ship` permission.
// FormData carries optional trackingNo (运单号).
export async function shipOrderAction(
  orderId: string,
  _prev: OrderMutationResult | null,
  formData: FormData,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:ship');

  const parsed = shipOrderSchema.safeParse({
    trackingNo: formData.get('trackingNo'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await shipOrder(orderId, actor, parsed.data.trackingNo);
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

// SHIPPED → FINISHED (terminal close). Same permission as ship for
// MVP — no separate `order:finish` business rule today.
export async function finishOrderAction(
  orderId: string,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:ship');

  try {
    await finishOrder(orderId, actor);
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

// Accepts FormData (the edit form progressively enhances from a plain
// HTML form). updateOrderFields then enforces which subset of the
// parsed keys is actually applicable given the order's current status.
export async function updateOrderAction(
  orderId: string,
  _prev: OrderMutationResult | null,
  formData: FormData,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:create');

  const raw: Record<string, unknown> = {};
  for (const key of [
    'customerRef',
    'receiverName',
    'receiverPhone',
    'receiverAddress',
    'expressCode',
    'packageRequirement',
    'remark',
    'isUrgent',
  ] as const) {
    const value = formData.get(key);
    // Reject non-string uploads at the action boundary so File / Blob
    // can't slip into fields the schema expects text for.
    if (value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'boolean') {
      return {
        status: 'invalid',
        fieldErrors: { [key]: ['字段格式非法'] },
      };
    }
    raw[key] = value;
  }

  const parsed = updateEditableOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await updateOrderFields(orderId, parsed.data, actor);
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}`);
}

// Quick one-click 急单 toggle. Accepts `isUrgent` as a string form
// field ("true" / "false") so the button can be a zero-JS plain form.
export async function setOrderUrgentAction(
  orderId: string,
  _prev: OrderMutationResult | null,
  formData: FormData,
): Promise<OrderMutationResult> {
  const actor = await requirePermission('order:create');

  const parsed = setOrderUrgentSchema.safeParse({
    isUrgent: formData.get('isUrgent'),
  });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await setOrderUrgent(orderId, parsed.data.isUrgent, actor);
  } catch (err) {
    if (err instanceof OrderInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  return { status: 'success' };
}
