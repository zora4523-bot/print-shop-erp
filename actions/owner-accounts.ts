'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { appendReceipt } from '@/lib/admin/receipt';
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
import type { AccountMutationResult } from './owner-accounts.types';
import { collectFieldErrors, extractPrismaUniqueTargets } from '@/lib/admin/action-helpers';

// NB: Next.js strips every non-async-function export from a 'use server'
// module, so a `export type { AccountMutationResult }` re-export here would
// be silently dropped at RSC compile time. All callers — pages, client
// components, and tests — must import the type from './owner-accounts.types'
// directly.

// Accept both query-engine targets and Prisma 7 adapter constraint fields.
// Username is a single-column constraint; extra fields or a partial name must
// not disguise an unrelated database error as a user-correctable duplicate.
const USERNAME_UNIQUE_SYNONYMS = ['username', 'User_username_key'] as const;

function mapPrismaError(err: unknown): AccountMutationResult | null {
  if (typeof err !== 'object' || err === null ||
      !('code' in err) || err.code !== 'P2002') return null;
  const targets = extractPrismaUniqueTargets('meta' in err ? err.meta : undefined);
  if (targets.length === 1 && USERNAME_UNIQUE_SYNONYMS.some((target) => target === targets[0])) {
    return { status: 'invalid', fieldErrors: { username: ['该用户名已被占用'] } };
  }
  return null;
}

function normalizeFormInput(formData: FormData) {
  // Turn FormData into a plain object. Empty strings stay empty so Zod can
  // tell "absent" from "the operator cleared this field". `isActive` is
  // passed through as-is; the schema's `formBoolean` preprocess handles
  // both the browser-default 'on'  and explicit 'true'.
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
    employmentType: get('employmentType') || null,
    employmentStartDate: get('employmentStartDate') || null,
    employmentEndDate: get('employmentEndDate') || null,
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

  let createdId: string;
  try {
    const created = await createUser(parsed.data);
    createdId = created.id;
  } catch (err) {
    const mapped = mapPrismaError(err);
    if (mapped) return mapped;
    if (err instanceof AccountInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidateAccountPickerPaths(createdId);
  // Send the operator straight to the edit page — clearer feedback than a
  // silent "✓ 已保存" and prevents accidental double-submit from a lingering
  // filled-in create form.
  redirect(appendReceipt(`/owner/accounts/${createdId}`, { created: '1' }));
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

  revalidateAccountPickerPaths(id);
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

  revalidateAccountPickerPaths(id);
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

function revalidateAccountPickerPaths(id: string) {
  revalidatePath('/owner/accounts');
  revalidatePath(`/owner/accounts/${id}`);
}
