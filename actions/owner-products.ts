'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { createProductSchema, updateProductSchema } from '@/lib/auth/schemas';
import {
  createProduct,
  getProductCategoryNodeSummary,
  getProductSummary,
  QUOTE_PRODUCT_CATEGORIES,
  updateProduct,
  setProductActive,
  ProductInvariantError,
  type UpdateProductData,
} from '@/lib/product';
import type { ProductMutationResult } from './owner-products.types';
import {
  collectFieldErrors,
  mapPrismaUniqueViolation,
  type UniqueViolationMapping,
} from '@/lib/admin/action-helpers';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

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
    isActive: get('isActive'),
  };
}

export async function createQuoteProductAction(
  _prev: ProductMutationResult | null,
  formData: FormData,
): Promise<ProductMutationResult> {
  await requirePermission('dict:product:manage');

  const parsed = createProductSchema.safeParse(normalizeFormInput(formData));
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }
  const scopeError = await validateQuoteProductCategory(
    parsed.data.categoryNodeId,
  );
  if (scopeError) return scopeError;

  let createdId: string;
  try {
    const created = await createProduct({
      ...parsed.data,
      // Compatibility columns remain nullable for historical records, but
      // current pricing comes exclusively from published customer price books.
      baseUnitPrice: null,
    });
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
  redirect(`${RULE_CENTER_HREFS.stockSkus}/${createdId}`);
}

export async function updateQuoteProductAction(
  id: string,
  _prev: ProductMutationResult | null,
  formData: FormData,
): Promise<ProductMutationResult> {
  await requirePermission('dict:product:manage');

  const parsed = updateProductSchema.safeParse(normalizeFormInput(formData));
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  }
  const scopeError = await validateQuoteProductCategory(
    parsed.data.categoryNodeId,
  );
  if (scopeError) return scopeError;

  const updateData: UpdateProductData = {
    code: parsed.data.code,
    categoryNodeId: parsed.data.categoryNodeId,
    name: parsed.data.name,
    specification: parsed.data.specification,
    paperType: parsed.data.paperType,
  };

  try {
    await updateProduct(id, updateData);
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

export async function setQuoteProductActiveAction(
  id: string,
  isActive: boolean,
  formData?: FormData,
): Promise<ProductMutationResult> {
  // Authorization stays first: forged requests must not learn whether the
  // product exists or whether their reason would pass validation.
  const actor = await requirePermission('dict:product:manage');

  const product = await getProductSummary(id);
  if (
    !product ||
    !QUOTE_PRODUCT_CATEGORIES.some(
      (category) => category === product.category,
    )
  ) {
    return {
      status: 'error',
      message: '目标建单产品不存在或属于已排除的历史分类',
    };
  }

  const rawReason = formData?.get('reason');
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if (!isActive && reason.length === 0) {
    return {
      status: 'invalid',
      fieldErrors: { reason: ['停用产品必须填写业务理由'] },
    };
  }
  if (reason.length > 500) {
    return {
      status: 'invalid',
      fieldErrors: { reason: ['操作理由不能超过 500 个字符'] },
    };
  }

  try {
    await setProductActive(id, isActive, {
      actor,
      reason: reason || null,
    });
  } catch (err) {
    if (err instanceof ProductInvariantError) {
      return { status: 'error', message: err.message };
    }
    throw err;
  }

  revalidateProductPaths(id);
  return { status: 'success' };
}

async function validateQuoteProductCategory(
  categoryNodeId: string,
): Promise<ProductMutationResult | null> {
  const node = await getProductCategoryNodeSummary(categoryNodeId);
  if (
    node &&
    QUOTE_PRODUCT_CATEGORIES.some(
      (category) => category === node.legacyCategory,
    )
  ) {
    return null;
  }

  return {
    status: 'invalid',
    fieldErrors: {
      categoryNodeId: [
        '请选择通版现货、专版烫金或彩印范围内的产品结构分类',
      ],
    },
  };
}

function revalidateProductPaths(id: string) {
  revalidatePath(RULE_CENTER_HREFS.stockSkus);
  revalidatePath(`${RULE_CENTER_HREFS.stockSkus}/${id}`);
  revalidatePath('/orders/new');
  revalidatePath('/owner/boms/new');
  revalidatePath(RULE_CENTER_HREFS.customerPricing);
}
