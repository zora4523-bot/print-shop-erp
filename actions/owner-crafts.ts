'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { createCraftSchema, updateCraftSchema } from '@/lib/auth/schemas';
import {
  createCraft,
  updateCraft,
  setCraftActive,
  CraftInvariantError,
} from '@/lib/craft';
import type { CraftMutationResult } from './owner-crafts.types';
import {
  collectFieldErrors,
  mapPrismaUniqueViolation,
  type UniqueViolationMapping,
} from '@/lib/admin/action-helpers';

// NB: Next.js strips every non-async-function export from a 'use server'
// module, so re-exporting the type here would disappear at RSC compile
// time. All callers import `CraftMutationResult` from
// './owner-crafts.types' directly.

const CRAFT_UNIQUE_VIOLATIONS: readonly UniqueViolationMapping[] = [
  {
    field: 'code',
    targets: ['code', 'Craft_code_key'],
    message: '该代码已被占用',
  },
  {
    field: 'name',
    targets: ['name', 'Craft_name_key'],
    message: '该工艺名已被占用',
  },
];

function mapPrismaError(err: unknown): CraftMutationResult | null {
  return mapPrismaUniqueViolation(err, CRAFT_UNIQUE_VIOLATIONS);
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

  let createdId: string;
  try {
    const created = await createCraft(parsed.data);
    createdId = created.id;
  } catch (err) {
    const mapped = mapPrismaError(err);
    if (mapped) return mapped;
    if (err instanceof CraftInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/owner/crafts');
  redirect(`/owner/crafts/${createdId}`);
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
