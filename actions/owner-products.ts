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

function normalizeFormInput(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : undefined;
  };
  return {
    category: get('category'),
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
    if (err instanceof ProductInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/owner/products');
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
    if (err instanceof ProductInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidatePath('/owner/products');
  revalidatePath(`/owner/products/${id}`);
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

  revalidatePath('/owner/products');
  revalidatePath(`/owner/products/${id}`);
  return { status: 'success' };
}
