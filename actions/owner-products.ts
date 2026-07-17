'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { createProductSchema, updateProductSchema } from '@/lib/auth/schemas';
import {
  createProduct,
  updateProduct,
  setProductActive,
  ProductInvariantError,
} from '@/lib/product';
import type { ProductMutationResult } from './owner-products.types';
import {
  collectFieldErrors,
  mapPrismaUniqueViolation,
  type UniqueViolationMapping,
} from '@/lib/admin/action-helpers';

const PRODUCT_UNIQUE_VIOLATIONS: readonly UniqueViolationMapping[] = [
  {
    field: 'code',
    targets: ['code', 'Product_code_key'],
    message: '该产品编码已被占用',
  },
];

function mapUniqueViolation(err: unknown): ProductMutationResult | null {
  return mapPrismaUniqueViolation(err, PRODUCT_UNIQUE_VIOLATIONS);
}

function normalizeFormInput(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : undefined;
  };
  return {
    code: get('code') ?? '',
    categoryNodeId: get('categoryNodeId'),
    name: get('name'),
    specification: get('specification') ?? '',
    paperType: get('paperType') ?? '',
    baseUnitPrice: get('baseUnitPrice') ?? '',
    minOrderQty: get('minOrderQty') ?? '',
    isActive: get('isActive'),
  };
}

export async function createProductAction(
  _prev: ProductMutationResult | null,
  formData: FormData,
): Promise<ProductMutationResult> {
  await requirePermission('dict:product:manage');

  const parsed = createProductSchema.safeParse(normalizeFormInput(formData));
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  let createdId: string;
  try {
    const created = await createProduct(parsed.data);
    createdId = created.id;
  } catch (err) {
    const unique = mapUniqueViolation(err);
    if (unique) return unique;
    if (err instanceof ProductInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidateProductPaths(createdId);
  redirect(`/owner/products/${createdId}`);
}

export async function updateProductAction(
  id: string,
  _prev: ProductMutationResult | null,
  formData: FormData,
): Promise<ProductMutationResult> {
  await requirePermission('dict:product:manage');

  const parsed = updateProductSchema.safeParse(normalizeFormInput(formData));
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    await updateProduct(id, parsed.data);
  } catch (err) {
    const unique = mapUniqueViolation(err);
    if (unique) return unique;
    if (err instanceof ProductInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidateProductPaths(id);
  return { status: 'success' };
}

export async function setProductActiveAction(
  id: string,
  isActive: boolean,
): Promise<ProductMutationResult> {
  await requirePermission('dict:product:manage');

  try {
    await setProductActive(id, isActive);
  } catch (err) {
    if (err instanceof ProductInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidateProductPaths(id);
  return { status: 'success' };
}

function revalidateProductPaths(id: string) {
  revalidatePath('/owner/products');
  revalidatePath(`/owner/products/${id}`);
  revalidatePath('/orders/new');
  revalidatePath('/owner/boms/new');
  revalidatePath('/owner/prices/tiers/new');
}
