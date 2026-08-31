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
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

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

function revalidateCraftPaths(id: string) {
  revalidatePath(RULE_CENTER_HREFS.crafts);
  revalidatePath(`${RULE_CENTER_HREFS.crafts}/${id}`);
}

function mapPrismaError(err: unknown): CraftMutationResult | null {
  const mapped = mapPrismaUniqueViolation(err, CRAFT_UNIQUE_VIOLATIONS);
  if (mapped?.fieldErrors.code) {
    return {
      status: 'error',
      message: '系统未能生成工艺编号，请重新提交。',
    };
  }
  return mapped;
}

function normalizeFormInput(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : undefined;
  };
  return {
    name: get('name'),
    isOutsource: get('isOutsource'),
    sortOrder: get('sortOrder') ?? '0',
    isActive: get('isActive'),
  };
}

export async function createRuleCenterCraftAction(
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

  revalidateCraftPaths(createdId);
  redirect(`${RULE_CENTER_HREFS.crafts}/${createdId}`);
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

  revalidateCraftPaths(id);
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

  revalidateCraftPaths(id);
  return { status: 'success' };
}
