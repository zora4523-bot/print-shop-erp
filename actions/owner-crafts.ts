'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '../generated/prisma/client';
import { requirePermission } from '@/lib/auth/permissions';
import { createCraftSchema, updateCraftSchema } from '@/lib/auth/schemas';
import {
  createCraft,
  updateCraft,
  setCraftActive,
  CraftInvariantError,
} from '@/lib/craft';
import type { CraftMutationResult } from './owner-crafts.types';

// NB: Next.js strips every non-async-function export from a 'use server'
// module, so re-exporting the type here would disappear at RSC compile
// time. All callers import `CraftMutationResult` from
// './owner-crafts.types' directly.

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

// P2002 → field-level error. Both `name` and `code` carry a unique
// constraint on the Craft table; Prisma's `meta.target` distinguishes them.
//
// Prisma's `meta.target` shape is connector-dependent: most connectors
// return `string[]`, but some variants return a single `string` (e.g. the
// index name). Normalize to an array of column names before matching so a
// string like `"Craft_name_key"` doesn't get substring-matched against
// `"name"` via `String.prototype.includes` and cause false positives
// (Codex round 16 / P2).
function mapPrismaError(err: unknown): CraftMutationResult | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const raw = err.meta?.target;
    const targets: string[] = Array.isArray(raw)
      ? (raw as string[])
      : typeof raw === 'string'
        ? [raw]
        : [];
    if (targets.includes('code')) {
      return { status: 'invalid', fieldErrors: { code: ['该代码已被占用'] } };
    }
    if (targets.includes('name')) {
      return { status: 'invalid', fieldErrors: { name: ['该工艺名已被占用'] } };
    }
  }
  return null;
}

function normalizeFormInput(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : undefined;
  };
  return {
    name: get('name'),
    code: get('code'),
    isOutsource: get('isOutsource'),
    defaultMachineType: get('defaultMachineType') || '',
    sortOrder: get('sortOrder') ?? '0',
    isActive: get('isActive'),
  };
}

export async function createCraftAction(
  _prev: CraftMutationResult | null,
  formData: FormData,
): Promise<CraftMutationResult> {
  await requirePermission('dict:craft:manage');

  const parsed = createCraftSchema.safeParse(normalizeFormInput(formData));
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await createCraft(parsed.data);
  } catch (err) {
    const mapped = mapPrismaError(err);
    if (mapped) return mapped;
    if (err instanceof CraftInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/owner/crafts');
  return { status: 'success' };
}

export async function updateCraftAction(
  id: string,
  _prev: CraftMutationResult | null,
  formData: FormData,
): Promise<CraftMutationResult> {
  await requirePermission('dict:craft:manage');

  const parsed = updateCraftSchema.safeParse(normalizeFormInput(formData));
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await updateCraft(id, parsed.data);
  } catch (err) {
    const mapped = mapPrismaError(err);
    if (mapped) return mapped;
    if (err instanceof CraftInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/owner/crafts');
  revalidatePath(`/owner/crafts/${id}`);
  return { status: 'success' };
}

export async function setCraftActiveAction(
  id: string,
  isActive: boolean,
): Promise<CraftMutationResult> {
  await requirePermission('dict:craft:manage');

  try {
    await setCraftActive(id, isActive);
  } catch (err) {
    if (err instanceof CraftInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/owner/crafts');
  revalidatePath(`/owner/crafts/${id}`);
  return { status: 'success' };
}
