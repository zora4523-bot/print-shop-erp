'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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
import type { AccountMutationResult } from './owner-accounts.types';

// NB: Next.js strips every non-async-function export from a 'use server'
// module, so a `export type { AccountMutationResult }` re-export here would
// be silently dropped at RSC compile time. All callers — pages, client
// components, and tests — must import the type from './owner-accounts.types'
// directly.

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

// P2002 on the User table's unique username column. `meta.target` comes in
// several shapes depending on the driver — `string[]` of columns, a single
// column `string`, or a single constraint/index `string` like
// `User_username_key` (Prisma's default `<Model>_<column>_key` format,
// confirmed in prisma/migrations/.../migration.sql). Accept all three via
// exact-element match against a synonym allowlist.
// Background: rounds 16 (substring match false-positives) → 17 (exact
// match too strict, drops constraint-name variants).
const USERNAME_UNIQUE_SYNONYMS = ['username', 'User_username_key'] as const;

function matchesUnique(targets: string[], synonyms: readonly string[]): boolean {
  return targets.some((t) => synonyms.includes(t));
}

function mapPrismaError(err: unknown): AccountMutationResult | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const raw = err.meta?.target;
    const targets: string[] = Array.isArray(raw)
      ? (raw as string[])
      : typeof raw === 'string'
        ? [raw]
        : [];
    if (matchesUnique(targets, USERNAME_UNIQUE_SYNONYMS)) {
      return { status: 'invalid', fieldErrors: { username: ['该用户名已被占用'] } };
    }
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

  revalidatePath('/owner/accounts');
  // Send the operator straight to the edit page — clearer feedback than a
  // silent "✓ 已保存" and prevents accidental double-submit from a lingering
  // filled-in create form.
  redirect(`/owner/accounts/${createdId}`);
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
