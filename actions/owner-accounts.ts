'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '../generated/prisma/client';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
} from '@/lib/auth/schemas';
import {
  createUser,
  updateUser,
  setUserActive,
  resetUserPassword,
  AccountInvariantError,
} from '@/lib/account';

export type AccountMutationResult =
  | { status: 'success' }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

function collectFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const head = issue.path[0];
    const key = head === undefined ? '_' : String(head);
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// Handles the "username already exists" race: the schema can't know what's
// in the DB, so Prisma's P2002 (unique violation) is the authoritative
// answer. Surface it as a field-level error on the right input.
function mapPrismaError(err: unknown): AccountMutationResult | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const targets = (err.meta?.target as string[] | undefined) ?? [];
    if (targets.includes('username')) {
      return { status: 'invalid', fieldErrors: { username: ['该用户名已被占用'] } };
    }
  }
  return null;
}

function normalizeFormInput(formData: FormData) {
  // Turn FormData into a plain object. Empty strings stay empty so Zod can
  // tell "absent" from "the operator cleared this field". `isActive` is
  // passed through as-is; the schema's `formBoolean` preprocess handles
  // both the browser-default 'on' (Codex round 13 / P2) and explicit 'true'.
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : undefined;
  };
  return {
    username: get('username'),
    displayName: get('displayName'),
    phone: get('phone') ?? '',
    role: get('role'),
    workerType: get('workerType') || null,
    machineType: get('machineType') || null,
    password: get('password'),
    isActive: get('isActive'),
  };
}

export async function createUserAction(
  _prev: AccountMutationResult | null,
  formData: FormData,
): Promise<AccountMutationResult> {
  await requirePermission('account:manage');

  const raw = normalizeFormInput(formData);
  const parsed = createUserSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await createUser(parsed.data);
  } catch (err) {
    const mapped = mapPrismaError(err);
    if (mapped) return mapped;
    if (err instanceof AccountInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/owner/accounts');
  return { status: 'success' };
}

export async function updateUserAction(
  id: string,
  _prev: AccountMutationResult | null,
  formData: FormData,
): Promise<AccountMutationResult> {
  const actor = await requirePermission('account:manage');

  const raw = normalizeFormInput(formData);
  const parsed = updateUserSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await updateUser(id, parsed.data, actor);
  } catch (err) {
    if (err instanceof AccountInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/owner/accounts');
  revalidatePath(`/owner/accounts/${id}`);
  return { status: 'success' };
}

export async function setUserActiveAction(
  id: string,
  isActive: boolean,
): Promise<AccountMutationResult> {
  const actor = await requirePermission('account:manage');

  try {
    await setUserActive(id, isActive, actor);
  } catch (err) {
    if (err instanceof AccountInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/owner/accounts');
  revalidatePath(`/owner/accounts/${id}`);
  return { status: 'success' };
}

export async function resetUserPasswordAction(
  id: string,
  _prev: AccountMutationResult | null,
  formData: FormData,
): Promise<AccountMutationResult> {
  await requirePermission('account:manage');

  const parsed = resetUserPasswordSchema.safeParse({ newPassword: formData.get('newPassword') });
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await resetUserPassword(id, parsed.data.newPassword);
  } catch (err) {
    if (err instanceof AccountInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath(`/owner/accounts/${id}`);
  return { status: 'success' };
}
