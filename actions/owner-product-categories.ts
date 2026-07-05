'use server';

import { redirect } from 'next/navigation';
import { Prisma } from '../generated/prisma/client';
import {
  getFormString,
  getFormStringOr,
  invalidFromIssues,
  mapInvariantError,
  mapPrismaUniqueViolation,
  revalidatePaths,
  type UniqueViolationMapping,
} from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import {
  createProductCategoryNodeSchema,
  updateProductCategoryNodeSchema,
} from '@/lib/auth/schemas';
import {
  createProductCategoryNode,
  ProductInvariantError,
  setProductCategoryNodeActive,
  updateProductCategoryNode,
} from '@/lib/product';
import type { ProductCategoryNodeMutationResult } from './owner-product-categories.types';

const CATEGORY_UNIQUE_VIOLATIONS: readonly UniqueViolationMapping[] = [
  {
    field: 'path',
    targets: ['path', 'ProductCategoryNode_path_key'],
    message: '该分类路径已被占用',
  },
];

function normalizeProductCategoryFormInput(formData: FormData) {
  return {
    path: getFormString(formData, 'path'),
    name: getFormString(formData, 'name'),
    legacyCategory: getFormString(formData, 'legacyCategory'),
    sortOrder: getFormStringOr(formData, 'sortOrder', '0'),
  };
}

function mapCategoryDbError(
  err: unknown,
): ProductCategoryNodeMutationResult | null {
  const unique = mapPrismaUniqueViolation(err, CATEGORY_UNIQUE_VIOLATIONS);
  if (unique) return unique;

  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === 'P2004' || err.code === 'P2010')
  ) {
    return {
      status: 'invalid',
      fieldErrors: {
        path: ['分类路径不符合 PostgreSQL ltree 格式要求'],
      },
    };
  }

  if (
    err instanceof Prisma.PrismaClientUnknownRequestError &&
    /ltree|ProductCategoryNode_path_ltree_safe|invalid input syntax/i.test(
      err.message,
    )
  ) {
    return {
      status: 'invalid',
      fieldErrors: {
        path: ['分类路径不符合 PostgreSQL ltree 格式要求'],
      },
    };
  }

  return null;
}

export async function createProductCategoryNodeAction(
  _prev: ProductCategoryNodeMutationResult | null,
  formData: FormData,
): Promise<ProductCategoryNodeMutationResult> {
  await requirePermission('dict:product:manage');

  const parsed = createProductCategoryNodeSchema.safeParse(
    normalizeProductCategoryFormInput(formData),
  );
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  let createdId: string;
  try {
    const created = await createProductCategoryNode(parsed.data);
    createdId = created.id;
  } catch (err) {
    const mapped = mapCategoryDbError(err);
    if (mapped) return mapped;
    const invariant = mapInvariantError(err, ProductInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateProductCategoryPaths(createdId);
  redirect(`/owner/product-categories/${createdId}`);
}

export async function updateProductCategoryNodeAction(
  id: string,
  _prev: ProductCategoryNodeMutationResult | null,
  formData: FormData,
): Promise<ProductCategoryNodeMutationResult> {
  await requirePermission('dict:product:manage');

  const parsed = updateProductCategoryNodeSchema.safeParse(
    normalizeProductCategoryFormInput(formData),
  );
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);

  try {
    await updateProductCategoryNode(id, parsed.data);
  } catch (err) {
    const mapped = mapCategoryDbError(err);
    if (mapped) return mapped;
    const invariant = mapInvariantError(err, ProductInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateProductCategoryPaths(id);
  return { status: 'success' };
}

export async function setProductCategoryNodeActiveAction(
  id: string,
  isActive: boolean,
): Promise<ProductCategoryNodeMutationResult> {
  await requirePermission('dict:product:manage');

  try {
    await setProductCategoryNodeActive(id, isActive);
  } catch (err) {
    const invariant = mapInvariantError(err, ProductInvariantError);
    if (invariant) return invariant;
    throw err;
  }

  revalidateProductCategoryPaths(id);
  return { status: 'success' };
}

function revalidateProductCategoryPaths(id: string) {
  revalidatePaths([
    '/owner/product-categories',
    `/owner/product-categories/${id}`,
    '/owner/products',
    '/owner/products/new',
  ]);
}
