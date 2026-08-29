'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
  OrderFoilTechnique,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
} from '../generated/prisma/enums';
import { collectFieldErrorsDeep } from '@/lib/admin/action-helpers';
import { requirePermission } from '@/lib/auth/permissions';
import { parseStrictShanghaiDateTimeLocal } from '@/lib/auth/schemas';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { NEW_ORDER_PRICING_ROUTES } from '@/lib/order/pricing-route';
import {
  createCustomerPriceBookDraft,
  CustomerPriceBookAdminError,
  CustomerPriceBookValidationError,
  discardCustomerPriceBookDraft,
  publishCustomerPriceBookDraft,
  updateCustomerPriceRuleDraft,
  updateCustomerPriceRuleDraftGroup,
  updateCustomerPriceSectionDraft,
  updateCustomerPriceSectionsDraft,
  type UpdateCustomerPriceSectionDraftInput,
} from '@/lib/price/customer-price-book-admin';
import type {
  CreateCustomerPriceBookDraftActionInput,
  CustomerPriceBookMutationResult,
  DiscardCustomerPriceBookDraftActionInput,
  PublishCustomerPriceBookDraftActionInput,
  UpdateCustomerPriceRuleDraftActionInput,
  UpdateCustomerPriceRuleDraftGroupActionInput,
  UpdateCustomerPriceSectionDraftActionInput,
} from './customer-price-books.types';

const safeId = z
  .string()
  .trim()
  .min(1, '标识不能为空')
  .max(128, '标识过长')
  .regex(/^[A-Za-z0-9_-]+$/, '标识格式非法');

const VALIDATION_FIELD_LABELS: Readonly<Record<string, string>> = {
  purpose: '调价用途',
  kind: '收费类型',
  calculationType: '计价方式',
  target: '计价对象',
  packagingModes: '包装方式',
  pricingRoutes: '计价方式',
  productStructures: '产品结构',
  foilTechniques: '烫金方式',
  laminations: '覆膜方式',
  craftMode: '多工艺条件',
  isActive: '启用状态',
  blocksAutomaticQuote: '自动计价设置',
};

function customerPriceBookFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string[]> {
  return collectFieldErrorsDeep(
    issues.map((issue) => {
      const field = [...issue.path]
        .reverse()
        .find((segment): segment is string => typeof segment === 'string');
      const hasTechnicalMessage =
        /(?:invalid|unrecognized|expected|received|json)/i.test(issue.message) ||
        /\b[A-Z][A-Z0-9_]{2,}\b/.test(issue.message);
      if (!hasTechnicalMessage) return issue;
      return {
        path: issue.path,
        message:
          issue.path.length === 0
            ? '提交内容包含页面不支持的字段，请刷新后重试'
            : `${VALIDATION_FIELD_LABELS[field ?? ''] ?? '该项'}设置无效，请重新选择或填写`,
      };
    }),
  );
}

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

const matcherStringList = z
  .array(z.string().trim().min(1, '条件值不能为空').max(120, '单个条件最多 120 字'))
  .max(100, '单项条件最多 100 个值')
  .transform((values) => [...new Set(values)]);

const nullableMatchBoolean = z.boolean().nullable();
const nullableMatchCount = z.number().int().min(0).max(100).nullable();
const nullablePositiveInteger = z
  .number()
  .int()
  .min(1)
  .max(9_999_999)
  .nullable();
const nullableMeasurement = z.number().finite().gt(0).max(99_999).nullable();

const processingRuleMatchSchema = z
  .object({
    target: z.enum(['ITEM', 'PACKAGING_GROUP'], {
      error: '请选择有效的计价对象',
    }),
    packagingModes: z
      .array(
        z.enum(OrderPackagingMode, {
          error: '请选择有效的包装方式',
        }),
      )
      .max(20),
    pricingRoutes: z
      .array(
        z.enum(NEW_ORDER_PRICING_ROUTES, {
          error: '请选择有效的计价方式',
        }),
      )
      .max(NEW_ORDER_PRICING_ROUTES.length),
    productStructures: z
      .array(
        z.enum(OrderProductStructure, {
          error: '请选择有效的产品结构',
        }),
      )
      .max(20),
    foilTechniques: z
      .array(
        z.enum(OrderFoilTechnique, {
          error: '请选择有效的烫金方式',
        }),
      )
      .max(20),
    laminations: z
      .array(
        z.enum(OrderLamination, {
          error: '请选择有效的覆膜方式',
        }),
      )
      .max(20),
    specifications: matcherStringList,
    paperTypes: matcherStringList,
    craftCodes: matcherStringList,
    noneOfCraftCodes: matcherStringList,
    anyCraftCodeOutside: matcherStringList,
    craftMode: z
      .enum(['ANY', 'ALL'], {
        error: '请选择有效的多工艺条件',
      })
      .nullable(),
    foilColors: matcherStringList,
    printColors: matcherStringList,
    isDoubleSided: nullableMatchBoolean,
    isDoubleColor: nullableMatchBoolean,
    hasLocalFoil: nullableMatchBoolean,
    foilColorCount: nullableMatchCount,
    minFoilColorCount: nullableMatchCount,
    maxFoilColorCount: nullableMatchCount,
    foilPassCount: nullableMatchCount,
    minFoilPassCount: nullableMatchCount,
    maxFoilPassCount: nullableMatchCount,
    printColorCount: nullableMatchCount,
    minPrintColorCount: nullableMatchCount,
    maxPrintColorCount: nullableMatchCount,
    minWidthMm: nullableMeasurement,
    maxWidthMm: nullableMeasurement,
    minHeightMm: nullableMeasurement,
    maxHeightMm: nullableMeasurement,
    minPaperWeightGsm: nullablePositiveInteger,
    maxPaperWeightGsm: nullablePositiveInteger,
    minItemCount: nullablePositiveInteger,
    maxItemCount: nullablePositiveInteger,
    perFoilColor: z.boolean(),
    perFoilPass: z.boolean(),
    perPrintColor: z.boolean(),
  })
  .strict()
  .superRefine((match, ctx) => {
    if (match.target === 'ITEM') {
      if (match.pricingRoutes.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['pricingRoutes'],
          message: '款式规则至少选择一条计价路线',
        });
      }
      if (match.packagingModes.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingModes'],
          message: '款式规则不能配置包装模式',
        });
      }
    } else {
      if (match.packagingModes.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingModes'],
          message: '包装组规则至少选择一种包装模式',
        });
      }
      const mixedItemFields = [
        match.pricingRoutes,
        match.productStructures,
        match.foilTechniques,
        match.laminations,
        match.specifications,
        match.paperTypes,
        match.craftCodes,
        match.noneOfCraftCodes,
        match.anyCraftCodeOutside,
        match.foilColors,
        match.printColors,
      ];
      const hasMixedScalar = [
        match.craftMode,
        match.isDoubleSided,
        match.isDoubleColor,
        match.hasLocalFoil,
        match.foilColorCount,
        match.minFoilColorCount,
        match.maxFoilColorCount,
        match.foilPassCount,
        match.minFoilPassCount,
        match.maxFoilPassCount,
        match.printColorCount,
        match.minPrintColorCount,
        match.maxPrintColorCount,
        match.minWidthMm,
        match.maxWidthMm,
        match.minHeightMm,
        match.maxHeightMm,
        match.minPaperWeightGsm,
        match.maxPaperWeightGsm,
        match.minItemCount,
        match.maxItemCount,
      ].some((value) => value !== null);
      if (
        mixedItemFields.some((values) => values.length > 0) ||
        hasMixedScalar ||
        match.perFoilColor ||
        match.perFoilPass ||
        match.perPrintColor
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['target'],
          message: '包装组规则不能混用款式匹配条件',
        });
      }
    }
    for (const [minimumKey, maximumKey, label] of [
      ['minFoilColorCount', 'maxFoilColorCount', '烫金颜色数'],
      ['minFoilPassCount', 'maxFoilPassCount', '烫金道数'],
      ['minPrintColorCount', 'maxPrintColorCount', '彩印颜色数'],
      ['minWidthMm', 'maxWidthMm', '宽度'],
      ['minHeightMm', 'maxHeightMm', '高度'],
      ['minPaperWeightGsm', 'maxPaperWeightGsm', '纸张克重'],
      ['minItemCount', 'maxItemCount', '款式数'],
    ] as const) {
      const minimum = match[minimumKey];
      const maximum = match[maximumKey];
      if (minimum !== null && maximum !== null && minimum > maximum) {
        ctx.addIssue({
          code: 'custom',
          path: [maximumKey],
          message: `${label}上限不能小于下限`,
        });
      }
    }
    for (const [exactKey, minimumKey, maximumKey, label] of [
      ['foilColorCount', 'minFoilColorCount', 'maxFoilColorCount', '烫金颜色数'],
      ['foilPassCount', 'minFoilPassCount', 'maxFoilPassCount', '烫金道数'],
      ['printColorCount', 'minPrintColorCount', 'maxPrintColorCount', '彩印颜色数'],
    ] as const) {
      if (
        match[exactKey] !== null &&
        (match[minimumKey] !== null || match[maximumKey] !== null)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [exactKey],
          message: `${label}精确值和范围只能选择一种`,
        });
      }
    }
    if (match.perFoilColor && match.perFoilPass) {
      ctx.addIssue({
        code: 'custom',
        path: ['perFoilPass'],
        message: '烫金颜色倍数与烫金道数倍数只能选择一种',
      });
    }
  });

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
    match: processingRuleMatchSchema.optional(),
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
    if (input.categoryId !== undefined && input.match === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['match'],
        message: '加工费规则必须填写结构化适用条件',
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

const updatePriceSectionDraftSchema = z
  .object({
    priceBookId: safeId,
    section: z.enum(['blank', 'machine', 'tiers', 'adds', 'print', 'ship']),
    rows: z
      .array(
        z
          .object({
            ruleId: safeId,
            expectedUpdatedAt: strictIsoInstant,
            amount: nullableDecimal('金额', 10, 4),
            minQty: nullableQuantity,
            maxQty: nullableQuantity,
            includedUnits: nullableDecimal('首重', 7, 3),
            incrementUnits: nullableDecimal('续重单位', 7, 3),
            incrementAmount: nullableDecimal('续重金额', 10, 4),
          })
          .strict(),
      )
      .min(1, '当前业务板块没有可保存规则')
      .max(100, '一次最多保存 100 条规则'),
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
  });

const publishDraftSchema = z
  .object({
    priceBookId: safeId,
    expectedDraftUpdatedAt: strictIsoInstant,
    publishNote: z
      .string()
      .trim()
      .min(2, '请填写至少 2 个字符的发布说明')
      .max(500, '发布说明最多 500 字'),
    confirmedImpact: z.literal(true, {
      error: '请确认已了解发布影响范围',
    }),
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
  'match',
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
    const path =
      isCurrentEditableRuleField
        ? fieldName
        : segments.length === 3 &&
            segments[0] === 'rules' &&
            segments[1] === ruleId &&
            fieldName === 'triggerCondition'
          ? 'match'
          : issue.path;
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
      (fieldName === 'amount' ||
        fieldName === 'isActive' ||
        fieldName === 'minQty' ||
        fieldName === 'maxQty' ||
        fieldName === 'includedUnits' ||
        fieldName === 'incrementUnits' ||
        fieldName === 'incrementAmount')
        ? `rows.${rowIndex}.${fieldName}`
        : issue.path;
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return { status: 'invalid', fieldErrors };
}

function revalidatePriceBookPaths(): void {
  for (const path of [
    RULE_CENTER_HREFS.customerPricing,
    RULE_CENTER_HREFS.priceVersions,
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
    return {
      status: 'invalid',
      fieldErrors: customerPriceBookFieldErrors(parsed.error.issues),
    };
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
    return {
      status: 'invalid',
      fieldErrors: customerPriceBookFieldErrors(parsed.error.issues),
    };
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
      fieldErrors: customerPriceBookFieldErrors(parsed.error.issues),
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

export async function updateCustomerPriceSectionDraftAction(
  raw: UpdateCustomerPriceSectionDraftActionInput,
): Promise<CustomerPriceBookMutationResult> {
  const actor = await requirePermission('dict:price:manage');
  const parsed = updatePriceSectionDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: customerPriceBookFieldErrors(parsed.error.issues),
    };
  }
  try {
    const updated = await updateCustomerPriceSectionDraft(parsed.data, actor);
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

type CustomerPriceSectionFormField =
  | 'amount'
  | 'minQty'
  | 'maxQty'
  | 'includedUnits'
  | 'incrementUnits'
  | 'incrementAmount';

export type CustomerPriceSectionFormBinding = {
  inputName: string;
  targets: Array<{
    rowIndex: number;
    field: CustomerPriceSectionFormField;
    /** Used for inferred adjacent quantity boundaries. */
    integerOffset?: number;
  }>;
};

export type CustomerPriceSectionFormContext = {
  section: UpdateCustomerPriceSectionDraftActionInput['section'];
  rows: Array<
    UpdateCustomerPriceSectionDraftActionInput['rows'][number] & {
      priceBookId: string;
    }
  >;
  bindings: CustomerPriceSectionFormBinding[];
};

function formDecimal(value: FormDataEntryValue): string | null {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : null;
}

/**
 * Bound-form adapter for the design-native matrices. Rule identities and the
 * field-to-row propagation map are supplied by the authenticated server page;
 * the locked DAL still re-derives complete section membership before writing.
 */
export async function updateCustomerPriceSectionDraftFormAction(
  context: CustomerPriceSectionFormContext,
  _previousState: CustomerPriceBookMutationResult | null,
  formData: FormData,
): Promise<CustomerPriceBookMutationResult> {
  const actor = await requirePermission('dict:price:manage');
  const rows = context.rows.map((row) => ({ ...row }));
  for (const binding of context.bindings) {
    const value = formData.get(binding.inputName);
    if (value === null) continue;
    for (const target of binding.targets) {
      const row = rows[target.rowIndex];
      if (!row) {
        return {
          status: 'invalid',
          fieldErrors: {
            [binding.inputName]: ['页面价格定位已失效，请刷新后重试'],
          },
        };
      }
      if (target.field === 'minQty' || target.field === 'maxQty') {
        const text = typeof value === 'string' ? value.trim() : '';
        const parsed = Number(text);
        row[target.field] =
          text === ''
            ? null
            : parsed + (target.integerOffset ?? 0);
      } else {
        row[target.field] = formDecimal(value);
      }
    }
  }

  const byBook = new Map<string, typeof rows>();
  rows.forEach((row) => {
    const bookRows = byBook.get(row.priceBookId) ?? [];
    bookRows.push(row);
    byBook.set(row.priceBookId, bookRows);
  });

  const parsedInputs: UpdateCustomerPriceSectionDraftInput[] = [];
  for (const [priceBookId, bookRows] of byBook) {
    const parsed = updatePriceSectionDraftSchema.safeParse({
      priceBookId,
      section: context.section,
      rows: bookRows.map((row) => ({
        ruleId: row.ruleId,
        expectedUpdatedAt: row.expectedUpdatedAt,
        amount: row.amount,
        minQty: row.minQty,
        maxQty: row.maxQty,
        includedUnits: row.includedUnits,
        incrementUnits: row.incrementUnits,
        incrementAmount: row.incrementAmount,
      })),
    });
    if (!parsed.success) {
      return {
        status: 'invalid',
        fieldErrors: customerPriceBookFieldErrors(parsed.error.issues),
      };
    }
    parsedInputs.push(parsed.data);
  }
  if (parsedInputs.length === 0) {
    return {
      status: 'invalid',
      fieldErrors: { rows: ['当前业务板块没有可保存规则'] },
    };
  }

  try {
    const updated = await updateCustomerPriceSectionsDraft(
      parsedInputs,
      actor,
    );
    revalidatePriceBookPaths();
    return {
      status: 'success',
      priceBookId: updated.map((result) => result.priceBookId).join(','),
      ruleIds: updated.flatMap((result) => result.ruleIds),
    };
  } catch (error) {
    if (error instanceof CustomerPriceBookValidationError) {
      return invalidGroupUpdateFromDomain(
        error,
        parsedInputs.flatMap((input) => input.rows),
      );
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
    return {
      status: 'invalid',
      fieldErrors: customerPriceBookFieldErrors(parsed.error.issues),
    };
  }
  try {
    const published = await publishCustomerPriceBookDraft(
      {
        priceBookId: parsed.data.priceBookId,
        expectedDraftUpdatedAt: parsed.data.expectedDraftUpdatedAt,
        effectiveFrom: parsed.data.effectiveFrom,
        publishNote: parsed.data.publishNote,
      },
      actor,
    );
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
    return {
      status: 'invalid',
      fieldErrors: customerPriceBookFieldErrors(parsed.error.issues),
    };
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
