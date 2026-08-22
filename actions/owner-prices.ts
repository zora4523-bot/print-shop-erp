'use server';

import { redirect } from 'next/navigation';
import { Prisma } from '../generated/prisma/client';
import {
  getFormString,
  getFormStringOr,
  invalidFromIssues,
  mapInvariantError,
  revalidatePaths,
} from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createPriceAdjustmentSchema,
  createPriceTierSchema,
  updatePriceAdjustmentSchema,
  updatePriceTierSchema,
} from '@/lib/auth/schemas';
import {
  createPriceAdjustment,
  createPriceTier,
  PriceDictionaryInvariantError,
  setPriceAdjustmentActive,
  updatePriceAdjustment,
  updatePriceTier,
} from '@/lib/price';
import type { PriceMutationResult } from './owner-prices.types';

function normalizePriceTierFormInput(formData: FormData) {
  return {
    productId: getFormString(formData, 'productId'),
    minQty: getFormString(formData, 'minQty'),
    unitPrice: getFormString(formData, 'unitPrice'),
    effectiveFrom: getFormString(formData, 'effectiveFrom'),
    effectiveTo: getFormStringOr(formData, 'effectiveTo', ''),
  };
}

function normalizePriceAdjustmentFormInput(formData: FormData) {
  return {
    name: getFormString(formData, 'name'),
    adjustmentType: getFormString(formData, 'adjustmentType'),
    amount: getFormString(formData, 'amount'),
    triggerCondition: getFormStringOr(formData, 'triggerCondition', ''),
  };
}

function errorText(err: unknown): string {
  const meta =
    err instanceof Prisma.PrismaClientKnownRequestError && err.meta
      ? JSON.stringify(err.meta)
      : '';
  return `${err instanceof Error ? err.message : String(err)} ${meta}`;
}

function mapPriceConstraintError(err: unknown): PriceMutationResult | null {
  const text = errorText(err);
  if (
    text.includes('PriceTier_product_minQty_effective_no_overlap') ||
    text.includes('conflicting key value violates exclusion constraint') ||
    text.includes('overlapping effective windows')
  ) {
    return {
      status: 'invalid',
      fieldErrors: {
        effectiveFrom: ['同一产品、同一起订量的有效期不能重叠'],
        effectiveTo: ['同一产品、同一起订量的有效期不能重叠'],
      },
    };
  }
  if (text.includes('PriceTier_effective_window_valid')) {
    return {
      status: 'invalid',
      fieldErrors: { effectiveTo: ['有效截止日期必须晚于有效起始日期'] },
    };
  }
  if (
    text.includes('PriceAdjustment_triggerCondition_object') ||
    text.includes('jsonb_matches_schema')
  ) {
    return {
      status: 'invalid',
      fieldErrors: { triggerCondition: ['触发条件必须是 JSON object'] },
    };
  }
  return null;
}

export async function createPriceTierAction(
  _prev: PriceMutationResult | null,
  formData: FormData,
): Promise<PriceMutationResult> {
  await requirePermission('dict:price:manage');

  const parsed = createPriceTierSchema.safeParse(
    normalizePriceTierFormInput(formData),
  );
  if (!parsed.success) {
    return invalidFromIssues(parsed.error.issues);
  }

  let createdId: string;
  try {
    const created = await createPriceTier(parsed.data);
    createdId = created.id;
  } catch (err) {
    const constraint = mapPriceConstraintError(err);
    if (constraint) return constraint;
    const invariant = mapInvariantError(err, PriceDictionaryInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePriceTierPaths(createdId);
  redirect(`/owner/prices/tiers/${createdId}`);
}

export async function updatePriceTierAction(
  id: string,
  _prev: PriceMutationResult | null,
  formData: FormData,
): Promise<PriceMutationResult> {
  await requirePermission('dict:price:manage');

  const parsed = updatePriceTierSchema.safeParse(
    normalizePriceTierFormInput(formData),
  );
  if (!parsed.success) {
    return invalidFromIssues(parsed.error.issues);
  }

  try {
    await updatePriceTier(id, parsed.data);
  } catch (err) {
    const constraint = mapPriceConstraintError(err);
    if (constraint) return constraint;
    const invariant = mapInvariantError(err, PriceDictionaryInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePriceTierPaths(id);
  return { status: 'success' };
}

export async function createPriceAdjustmentAction(
  _prev: PriceMutationResult | null,
  formData: FormData,
): Promise<PriceMutationResult> {
  await requirePermission('dict:price:manage');

  const parsed = createPriceAdjustmentSchema.safeParse(
    normalizePriceAdjustmentFormInput(formData),
  );
  if (!parsed.success) {
    return invalidFromIssues(parsed.error.issues);
  }

  let createdId: string;
  try {
    const created = await createPriceAdjustment(parsed.data);
    createdId = created.id;
  } catch (err) {
    const constraint = mapPriceConstraintError(err);
    if (constraint) return constraint;
    throw err;
  }

  revalidatePriceAdjustmentPaths(createdId);
  redirect(`/owner/prices/adjustments/${createdId}`);
}

export async function updatePriceAdjustmentAction(
  id: string,
  _prev: PriceMutationResult | null,
  formData: FormData,
): Promise<PriceMutationResult> {
  await requirePermission('dict:price:manage');

  const parsed = updatePriceAdjustmentSchema.safeParse(
    normalizePriceAdjustmentFormInput(formData),
  );
  if (!parsed.success) {
    return invalidFromIssues(parsed.error.issues);
  }

  try {
    await updatePriceAdjustment(id, parsed.data);
  } catch (err) {
    const constraint = mapPriceConstraintError(err);
    if (constraint) return constraint;
    const invariant = mapInvariantError(err, PriceDictionaryInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePriceAdjustmentPaths(id);
  return { status: 'success' };
}

export async function setPriceAdjustmentActiveAction(
  id: string,
  isActive: boolean,
): Promise<PriceMutationResult> {
  await requirePermission('dict:price:manage');

  try {
    await setPriceAdjustmentActive(id, isActive);
  } catch (err) {
    const invariant = mapInvariantError(err, PriceDictionaryInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidatePriceAdjustmentPaths(id);
  return { status: 'success' };
}

function revalidatePriceTierPaths(id: string) {
  revalidatePaths(['/owner/prices', `/owner/prices/tiers/${id}`]);
}

function revalidatePriceAdjustmentPaths(id: string) {
  revalidatePaths(['/owner/prices', `/owner/prices/adjustments/${id}`]);
}
