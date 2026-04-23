'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createOutsourceSchema,
  markOutsourceReceivedSchema,
} from '@/lib/auth/schemas';
import {
  createOutsourceOrder,
  markOutsourceReceived,
  cancelOutsourceOrder,
  OutsourceError,
  InvalidOutsourceTransitionError,
} from '@/lib/outsource';
import type { OutsourceMutationResult } from './outsource.types';

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

function mapOutsourceError(err: unknown): OutsourceMutationResult | null {
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
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
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
  redirect(`/foreman/outsource/${createdId}`);
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
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }
  try {
    await markOutsourceReceived(id, parsed.data, actor);
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
    await cancelOutsourceOrder(id, actor);
  } catch (err) {
    const mapped = mapOutsourceError(err);
    if (mapped) return mapped;
    throw err;
  }
  revalidatePath('/foreman/outsource');
  revalidatePath(`/foreman/outsource/${id}`);
  return { status: 'success', id };
}
