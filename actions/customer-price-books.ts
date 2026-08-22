'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
} from '../generated/prisma/enums';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import { parseStrictShanghaiDateTimeLocal } from '@/lib/auth/schemas';
import {
  createCustomerPriceBookDraft,
  CustomerPriceBookAdminError,
  CustomerPriceBookValidationError,
  discardCustomerPriceBookDraft,
  publishCustomerPriceBookDraft,
  updateCustomerPriceRuleDraft,
  updateCustomerPriceRuleDraftGroup,
} from '@/lib/price/customer-price-book-admin';
import type {
  CreateCustomerPriceBookDraftActionInput,
  CustomerPriceBookMutationResult,
  DiscardCustomerPriceBookDraftActionInput,
  PublishCustomerPriceBookDraftActionInput,
  UpdateCustomerPriceRuleDraftActionInput,
  UpdateCustomerPriceRuleDraftGroupActionInput,
} from './customer-price-books.types';

const safeId = z
  .string()
  .trim()
  .min(1, '标识不能为空')
  .max(128, '标识过长')
  .regex(/^[A-Za-z0-9_-]+$/, '标识格式非法');

const nullableDecimal = (label: string, integerDigits: number, decimalPlaces: number) =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    z
      .string()
      .trim()
      .regex(
        new RegExp(`^(?:0|[1-9]\\d{0,${integerDigits - 1}})(?:\\.\\d{1,${decimalPlaces}})?$`),
        `${label}必须是非负数字，最多 ${decimalPlaces} 位小数`,
      )
      .nullable(),
  );

const requiredAmount = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/,
    '金额必须是非负数字，最多 4 位小数',
  );

const nullableQuantity = z.preprocess(
  (value) => (value === '' ? null : value),
  z.number().int('数量必须是整数').min(1).max(9_999_999).nullable(),
);

const nullableUnitsPerSheet = z.preprocess(
  (value) => (value === '' ? null : value),
  z
    .number()
    .int('每张含几个必须是整数')
    .min(1, '每张含几个必须大于 0')
    .max(9_999_999, '每张含几个不能超过 9999999')
    .nullable(),
);

const strictIsoInstant = z.string().trim().transform((value, ctx) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    ctx.addIssue({ code: 'custom', message: '版本时间格式非法，请刷新后重试' });
    return z.NEVER;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    ctx.addIssue({ code: 'custom', message: '版本时间格式非法，请刷新后重试' });
    return z.NEVER;
  }
  return parsed;
});

const createDraftSchema = z
  .object({
    purpose: z.enum(CustomerPriceBookPurpose),
    changeReason: z
      .string()
      .trim()
      .min(2, '请填写至少 2 个字符的调价原因')
      .max(500, '调价原因最多 500 字'),
  })
  .strict();

const updateDraftRuleSchema = z
  .object({
    priceBookId: safeId,
    ruleId: safeId,
    expectedUpdatedAt: strictIsoInstant,
    name: z.string().trim().min(1, '规则名称不能为空').max(120, '规则名称最多 120 字'),
    amount: nullableDecimal('金额', 10, 4),
    isActive: z.boolean(),
    categoryId: safeId.optional(),
    productId: z
      .preprocess((value) => (value === '' ? null : value), safeId.nullable())
      .optional(),
    kind: z.enum(CustomerPriceRuleKind).optional(),
    calculationType: z.enum(CustomerPriceCalculationType).nullable().optional(),
    unitsPerSheet: nullableUnitsPerSheet.optional(),
    minQty: nullableQuantity.optional(),
    maxQty: nullableQuantity.optional(),
    blocksAutomaticQuote: z.boolean().optional(),
    includedUnits: nullableDecimal('首重单位', 7, 3).optional(),
    incrementUnits: nullableDecimal('续重单位', 7, 3).optional(),
    incrementAmount: nullableDecimal('续重金额', 10, 4).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      input.minQty !== undefined &&
      input.minQty !== null &&
      input.maxQty !== undefined &&
      input.maxQty !== null &&
      input.minQty > input.maxQty
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxQty'],
        message: '最大数量不能小于最小数量',
      });
    }
    if (
      input.calculationType !== undefined &&
      (input.calculationType === null) !== (input.amount === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: '计价方式和金额必须同时填写或同时留空',
      });
    }
    if (
      input.kind !== undefined &&
      input.kind !== 'REFERENCE' &&
      input.calculationType === null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['calculationType'],
        message: '自动报价规则必须填写计价方式和金额',
      });
    }
    if (
      input.calculationType === CustomerPriceCalculationType.PER_SHEET &&
      (input.unitsPerSheet === null || input.unitsPerSheet === undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['unitsPerSheet'],
        message: '按张计价必须填写每张含几个',
      });
    }
    if (input.kind === 'BASE' && input.productId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['productId'],
        message: '基础报价规则必须选择产品',
      });
    }
    if (
      input.blocksAutomaticQuote &&
      input.kind !== undefined &&
      input.kind !== 'REFERENCE'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['blocksAutomaticQuote'],
        message: '只有人工参考规则可以阻断自动报价',
      });
    }
    const logisticsValues = [
      input.includedUnits,
      input.incrementUnits,
      input.incrementAmount,
    ];
    const suppliedLogisticsValues = logisticsValues.filter(
      (value) => value !== undefined,
    );
    if (
      suppliedLogisticsValues.length > 0 &&
      (suppliedLogisticsValues.length !== logisticsValues.length ||
        (suppliedLogisticsValues.some((value) => value !== null) &&
          suppliedLogisticsValues.some((value) => value === null)))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['includedUnits'],
        message: '首重、续重单位和续重金额必须同时填写或同时留空',
      });
    }
  });

const updateDraftRuleGroupSchema = z
  .object({
    priceBookId: safeId,
    anchorRuleId: safeId,
    rows: z
      .array(
        z
          .object({
            ruleId: safeId,
            expectedUpdatedAt: strictIsoInstant,
            amount: requiredAmount,
            isActive: z.boolean(),
          })
          .strict(),
      )
      .min(1, '价格阶梯至少需要一项')
      .max(100, '一次最多保存 100 个数量档'),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.rows.forEach((row, index) => {
      if (seen.has(row.ruleId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rows', index, 'ruleId'],
          message: '收费项重复，请刷新后重试',
        });
      }
      seen.add(row.ruleId);
    });
    if (!seen.has(input.anchorRuleId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['anchorRuleId'],
        message: '价格阶梯定位信息已失效，请刷新后重试',
      });
    }
  });

const publishDraftSchema = z
  .object({
    priceBookId: safeId,
    expectedDraftUpdatedAt: strictIsoInstant,
    effectiveFrom: z.string().trim().transform((value, ctx) => {
      const parsed = parseStrictShanghaiDateTimeLocal(value);
      if (!parsed) {
        ctx.addIssue({ code: 'custom', message: '请选择合法的上海生效时间' });
        return z.NEVER;
      }
      return parsed;
    }),
  })
  .strict();

const discardDraftSchema = z
  .object({
    priceBookId: safeId,
    expectedDraftUpdatedAt: strictIsoInstant,
  })
  .strict();

function invalidFromDomain(
  error: CustomerPriceBookValidationError,
): CustomerPriceBookMutationResult {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    (fieldErrors[issue.path] ??= []).push(issue.message);
  }
  return { status: 'invalid', fieldErrors };
}

const updateRuleFormFieldNames = new Set([
  'name',
  'amount',
  'isActive',
  'categoryId',
  'productId',
  'kind',
  'calculationType',
  'unitsPerSheet',
  'minQty',
  'maxQty',
  'blocksAutomaticQuote',
  'includedUnits',
  'incrementUnits',
  'incrementAmount',
]);

function invalidUpdateFromDomain(
  error: CustomerPriceBookValidationError,
  ruleId: string,
): CustomerPriceBookMutationResult {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const segments = issue.path.split('.');
    const fieldName = segments[2];
    const isCurrentEditableRuleField =
      segments.length === 3 &&
      segments[0] === 'rules' &&
      segments[1] === ruleId &&
      fieldName !== undefined &&
      updateRuleFormFieldNames.has(fieldName);
    const path = isCurrentEditableRuleField ? fieldName : issue.path;
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return { status: 'invalid', fieldErrors };
}

function invalidGroupUpdateFromDomain(
  error: CustomerPriceBookValidationError,
  rows: Array<{ ruleId: string }>,
): CustomerPriceBookMutationResult {
  const fieldErrors: Record<string, string[]> = {};
  const rowIndexById = new Map(
    rows.map((row, index) => [row.ruleId, index]),
  );
  for (const issue of error.issues) {
    const segments = issue.path.split('.');
    const rowIndex = segments[1]
      ? rowIndexById.get(segments[1])
      : undefined;
    const fieldName = segments[2];
    const path =
      segments.length === 3 &&
      segments[0] === 'rules' &&
      rowIndex !== undefined &&
      (fieldName === 'amount' || fieldName === 'isActive')
        ? `rows.${rowIndex}.${fieldName}`
        : issue.path;
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return { status: 'invalid', fieldErrors };
}

function revalidatePriceBookPaths(): void {
  for (const path of [
    '/owner/prices',
    '/owner/prices/external-sales',
    '/owner/prices/external-sales/items',
    '/owner/prices/external-sales/versions',
    '/owner/prices/external-sales/logistics',
    '/sales/quote',
    '/sales/quote/logistics',
    '/orders/new',
  ]) {
    revalidatePath(path);
  }
}

export async function createCustomerPriceBookDraftAction(
  raw: CreateCustomerPriceBookDraftActionInput,
): Promise<CustomerPriceBookMutationResult> {
  const actor = await requirePermission('dict:price:manage');

  const parsed = createDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }
  try {
    const draft = await createCustomerPriceBookDraft(parsed.data, actor);
    revalidatePriceBookPaths();
    return {
      status: 'success',
      priceBookId: draft.id,
      version: draft.version,
    };
  } catch (error) {
    if (error instanceof CustomerPriceBookValidationError) return invalidFromDomain(error);
    if (error instanceof CustomerPriceBookAdminError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function updateCustomerPriceRuleDraftAction(
  raw: UpdateCustomerPriceRuleDraftActionInput,
): Promise<CustomerPriceBookMutationResult> {
  const actor = await requirePermission('dict:price:manage');

  const parsed = updateDraftRuleSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }
  try {
    const updated = await updateCustomerPriceRuleDraft(parsed.data, actor);
    revalidatePriceBookPaths();
    return {
      status: 'success',
      priceBookId: updated.priceBookId,
      ruleId: updated.id,
    };
  } catch (error) {
    if (error instanceof CustomerPriceBookValidationError) {
      return invalidUpdateFromDomain(error, parsed.data.ruleId);
    }
    if (error instanceof CustomerPriceBookAdminError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function updateCustomerPriceRuleDraftGroupAction(
  raw: UpdateCustomerPriceRuleDraftGroupActionInput,
): Promise<CustomerPriceBookMutationResult> {
  const actor = await requirePermission('dict:price:manage');

  const parsed = updateDraftRuleGroupSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: collectFieldErrorsDeep(parsed.error.issues),
    };
  }
  try {
    const updated = await updateCustomerPriceRuleDraftGroup(parsed.data, actor);
    revalidatePriceBookPaths();
    return {
      status: 'success',
      priceBookId: updated.priceBookId,
      ruleIds: updated.ruleIds,
    };
  } catch (error) {
    if (error instanceof CustomerPriceBookValidationError) {
      return invalidGroupUpdateFromDomain(error, parsed.data.rows);
    }
    if (error instanceof CustomerPriceBookAdminError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function publishCustomerPriceBookDraftAction(
  raw: PublishCustomerPriceBookDraftActionInput,
): Promise<CustomerPriceBookMutationResult> {
  const actor = await requirePermission('dict:price:manage');

  const parsed = publishDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }
  try {
    const published = await publishCustomerPriceBookDraft(parsed.data, actor);
    revalidatePriceBookPaths();
    return {
      status: 'success',
      priceBookId: published.id,
      version: published.version,
    };
  } catch (error) {
    if (error instanceof CustomerPriceBookValidationError) return invalidFromDomain(error);
    if (error instanceof CustomerPriceBookAdminError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

export async function discardCustomerPriceBookDraftAction(
  raw: DiscardCustomerPriceBookDraftActionInput,
): Promise<CustomerPriceBookMutationResult> {
  const actor = await requirePermission('dict:price:manage');

  const parsed = discardDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(parsed.error.issues) };
  }
  try {
    const discarded = await discardCustomerPriceBookDraft(parsed.data, actor);
    revalidatePriceBookPaths();
    return { status: 'success', priceBookId: discarded.id };
  } catch (error) {
    if (error instanceof CustomerPriceBookAdminError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}
