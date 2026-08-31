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
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';


function normalizeProductCategoryCreateInput(formData: FormData) {
  return {
    parentId: getFormStringOr(formData, 'parentId', ''),
    name: getFormString(formData, 'name'),
    legacyCategory: getFormString(formData, 'legacyCategory'),
    sortOrder: getFormStringOr(formData, 'sortOrder', '0'),
  };
}

function normalizeProductCategoryUpdateInput(formData: FormData) {
  return {
    name: getFormString(formData, 'name'),
    legacyCategory: getFormString(formData, 'legacyCategory'),
    sortOrder: getFormStringOr(formData, 'sortOrder', '0'),
  };
}

function productCategoryRouteBase(formData: FormData) {
  return getFormString(formData, 'routeBase') ===
    RULE_CENTER_HREFS.productCategories
    ? RULE_CENTER_HREFS.productCategories
    : '/owner/product-categories';
}

// path 由服务端自动生成（随机段名），撞唯一键的概率可忽略；万一发生
// （或 DB 侧 ltree 约束拒绝）给"重试"级别的一般错误——表单里没有
// path 字段可指，挂到具体字段上会误导用户改错东西。
function mapCategoryDbError(
  err: unknown,
): ProductCategoryNodeMutationResult | null {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002'
  ) {
    return { status: 'error', message: '分类创建冲突，请重试' };
  }

  if (
    (err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === 'P2004' || err.code === 'P2010')) ||
    (err instanceof Prisma.PrismaClientUnknownRequestError &&
      /ltree|ProductCategoryNode_path_ltree_safe|invalid input syntax/i.test(
        err.message,
      ))
  ) {
    return {
      status: 'error',
      message: '分类保存失败（内部路径校验未通过），请重试或联系管理员',
    };
  }

  return null;
}

export async function createProductCategoryNodeAction(
  _prev: ProductCategoryNodeMutationResult | null,
  formData: FormData,
): Promise<ProductCategoryNodeMutationResult> {
  return createProductCategoryNodeWithRoute(
    formData,
    productCategoryRouteBase(formData),
  );
}

export async function createRuleCenterProductCategoryNodeAction(
  _prev: ProductCategoryNodeMutationResult | null,
  formData: FormData,
): Promise<ProductCategoryNodeMutationResult> {
  return createProductCategoryNodeWithRoute(
    formData,
    RULE_CENTER_HREFS.productCategories,
  );
}

async function createProductCategoryNodeWithRoute(
  formData: FormData,
  redirectBase:
    | '/owner/product-categories'
    | '/owner/rules/product-categories',
): Promise<ProductCategoryNodeMutationResult> {
  await requirePermission('dict:product:manage');

  const parsed = createProductCategoryNodeSchema.safeParse(
    normalizeProductCategoryCreateInput(formData),
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
  redirect(`${redirectBase}/${createdId}`);
}

export async function updateProductCategoryNodeAction(
  id: string,
  _prev: ProductCategoryNodeMutationResult | null,
  formData: FormData,
): Promise<ProductCategoryNodeMutationResult> {
  await requirePermission('dict:product:manage');

  const parsed = updateProductCategoryNodeSchema.safeParse(
    normalizeProductCategoryUpdateInput(formData),
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
    RULE_CENTER_HREFS.productCategories,
    `${RULE_CENTER_HREFS.productCategories}/${id}`,
    '/owner/products',
    '/owner/products/new',
    '/owner/boms/new',
  ]);
}
