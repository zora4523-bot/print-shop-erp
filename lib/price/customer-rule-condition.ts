import { z } from 'zod';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderPackagingMode,
  OrderProductStructure,
} from '@/generated/prisma/enums';

const nonEmptyStringList = z
  .array(z.string().trim().min(1))
  .min(1)
  .transform((values) => [...new Set(values)]);

const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const positiveMeasurement = z.number().finite().positive();

/**
 * Versioned, closed matching contract for customer processing rules.
 *
 * Persisted JSON is still used as the storage envelope so published versions
 * remain immutable, but arbitrary keys and ill-typed values are rejected at
 * both publication and calculation boundaries. Missing schemaVersion is the
 * only legacy compatibility accepted and is normalized to version 1.
 */
export const customerRuleConditionV1Schema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    target: z.enum(['ITEM', 'PACKAGING_GROUP']).default('ITEM'),
    productCodes: nonEmptyStringList.optional(),
    craftCodes: nonEmptyStringList.optional(),
    noneOfCraftCodes: nonEmptyStringList.optional(),
    anyCraftCodeOutside: nonEmptyStringList.optional(),
    craftMode: z.enum(['ANY', 'ALL']).optional(),
    pricingRoutes: z.array(z.enum(OrderItemPricingRoute)).min(1).optional(),
    productStructures: z
      .array(z.enum(OrderProductStructure))
      .min(1)
      .optional(),
    foilTechniques: z.array(z.enum(OrderFoilTechnique)).min(1).optional(),
    specifications: nonEmptyStringList.optional(),
    paperTypes: nonEmptyStringList.optional(),
    foilColors: nonEmptyStringList.optional(),
    printColors: nonEmptyStringList.optional(),
    isDoubleSided: z.boolean().optional(),
    isDoubleColor: z.boolean().optional(),
    hasLocalFoil: z.boolean().optional(),
    foilColorCount: nonNegativeInteger.optional(),
    minFoilColorCount: nonNegativeInteger.optional(),
    maxFoilColorCount: nonNegativeInteger.optional(),
    foilPassCount: nonNegativeInteger.optional(),
    minFoilPassCount: nonNegativeInteger.optional(),
    maxFoilPassCount: nonNegativeInteger.optional(),
    printColorCount: nonNegativeInteger.optional(),
    minPrintColorCount: nonNegativeInteger.optional(),
    maxPrintColorCount: nonNegativeInteger.optional(),
    minWidthMm: positiveMeasurement.optional(),
    maxWidthMm: positiveMeasurement.optional(),
    minHeightMm: positiveMeasurement.optional(),
    maxHeightMm: positiveMeasurement.optional(),
    minPaperWeightGsm: positiveInteger.optional(),
    maxPaperWeightGsm: positiveInteger.optional(),
    minItemCount: positiveInteger.optional(),
    maxItemCount: positiveInteger.optional(),
    unitsPerSheet: positiveInteger.optional(),
    perFoilColor: z.boolean().optional(),
    perFoilPass: z.boolean().optional(),
    perPrintColor: z.boolean().optional(),
    packagingModes: z.array(z.enum(OrderPackagingMode)).min(1).optional(),
  })
  .strict()
  .superRefine((condition, ctx) => {
    for (const [minimumKey, maximumKey, label] of [
      ['minFoilColorCount', 'maxFoilColorCount', '烫金颜色数'],
      ['minFoilPassCount', 'maxFoilPassCount', '烫金道数'],
      ['minPrintColorCount', 'maxPrintColorCount', '彩印颜色数'],
      ['minWidthMm', 'maxWidthMm', '宽度'],
      ['minHeightMm', 'maxHeightMm', '高度'],
      ['minPaperWeightGsm', 'maxPaperWeightGsm', '纸张克重'],
      ['minItemCount', 'maxItemCount', '款式数'],
    ] as const) {
      const minimum = condition[minimumKey];
      const maximum = condition[maximumKey];
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        ctx.addIssue({
          code: 'custom',
          path: [maximumKey],
          message: `${label}上限不能小于下限`,
        });
      }
    }
    const itemOnlyKeys = [
      'productCodes',
      'craftCodes',
      'noneOfCraftCodes',
      'anyCraftCodeOutside',
      'craftMode',
      'pricingRoutes',
      'productStructures',
      'foilTechniques',
      'specifications',
      'paperTypes',
      'foilColors',
      'printColors',
      'isDoubleSided',
      'isDoubleColor',
      'hasLocalFoil',
      'foilColorCount',
      'minFoilColorCount',
      'maxFoilColorCount',
      'foilPassCount',
      'minFoilPassCount',
      'maxFoilPassCount',
      'printColorCount',
      'minPrintColorCount',
      'maxPrintColorCount',
      'minWidthMm',
      'maxWidthMm',
      'minHeightMm',
      'maxHeightMm',
      'minPaperWeightGsm',
      'maxPaperWeightGsm',
      'minItemCount',
      'maxItemCount',
      'unitsPerSheet',
      'perFoilColor',
      'perFoilPass',
      'perPrintColor',
    ] as const;
    if (condition.target === 'ITEM') {
      if (condition.packagingModes !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingModes'],
          message: '款式规则不能配置包装模式',
        });
      }
      if (condition.perFoilColor && condition.perFoilPass) {
        ctx.addIssue({
          code: 'custom',
          path: ['perFoilPass'],
          message: '烫金颜色倍数与烫金道数倍数只能选择一种',
        });
      }
      if (
        condition.foilPassCount !== undefined &&
        (condition.minFoilPassCount !== undefined ||
          condition.maxFoilPassCount !== undefined)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['foilPassCount'],
          message: '烫金道数精确值和范围只能选择一种',
        });
      }
      return;
    }
    if (!condition.packagingModes?.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['packagingModes'],
        message: '包装组规则必须选择至少一种包装模式',
      });
    }
    for (const key of itemOnlyKeys) {
      if (condition[key] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: '包装组规则不能混用款式匹配条件',
        });
      }
    }
  });

export type CustomerRuleConditionV1 = z.infer<
  typeof customerRuleConditionV1Schema
>;

const CONDITION_FIELD_LABELS: Readonly<Record<string, string>> = {
  schemaVersion: '规则版本',
  target: '计价对象',
  productCodes: '适用产品',
  craftCodes: '必须包含的工艺',
  noneOfCraftCodes: '不能包含的工艺',
  anyCraftCodeOutside: '其他工艺范围',
  craftMode: '工艺匹配方式',
  pricingRoutes: '适用计价路线',
  productStructures: '产品结构',
  foilTechniques: '烫金方式',
  specifications: '尺寸规格',
  paperTypes: '纸张',
  foilColors: '烫金颜色',
  printColors: '彩印颜色',
  isDoubleSided: '单双面',
  isDoubleColor: '单双色',
  hasLocalFoil: '局部烫金',
  foilColorCount: '烫金颜色精确数',
  minFoilColorCount: '烫金颜色最小数',
  maxFoilColorCount: '烫金颜色最大数',
  foilPassCount: '烫金精确道数',
  minFoilPassCount: '烫金最少道数',
  maxFoilPassCount: '烫金最多道数',
  printColorCount: '彩印颜色精确数',
  minPrintColorCount: '彩印颜色最小数',
  maxPrintColorCount: '彩印颜色最大数',
  minWidthMm: '最小宽度',
  maxWidthMm: '最大宽度',
  minHeightMm: '最小高度',
  maxHeightMm: '最大高度',
  minPaperWeightGsm: '最小纸张克重',
  maxPaperWeightGsm: '最大纸张克重',
  minItemCount: '订单最少款式数',
  maxItemCount: '订单最多款式数',
  unitsPerSheet: '每张成品数',
  perFoilColor: '按烫金颜色数乘算',
  perFoilPass: '按烫金道数乘算',
  perPrintColor: '按彩印颜色数乘算',
  packagingModes: '包装方式',
};

function conditionIssueMessage(issue: {
  code: string;
  path: readonly PropertyKey[];
  message: string;
}): string {
  const field = CONDITION_FIELD_LABELS[String(issue.path[0] ?? '')] ?? '适用条件';
  const message =
    issue.code === 'custom'
      ? issue.message
      : '设置无效，请重新选择或填写';
  return `${field}：${message}`;
}

/**
 * Editable projection of the persisted condition contract.
 *
 * Arrays are always present and nullable scalar values mean “不限”。This keeps
 * the client form explicit without leaking arbitrary JSON into the browser.
 */
export type CustomerRuleConditionEditorInput = {
  target: 'ITEM' | 'PACKAGING_GROUP';
  packagingModes: OrderPackagingMode[];
  pricingRoutes: OrderItemPricingRoute[];
  productStructures: OrderProductStructure[];
  foilTechniques: OrderFoilTechnique[];
  specifications: string[];
  paperTypes: string[];
  craftCodes: string[];
  noneOfCraftCodes: string[];
  anyCraftCodeOutside: string[];
  craftMode: 'ANY' | 'ALL' | null;
  foilColors: string[];
  printColors: string[];
  isDoubleSided: boolean | null;
  isDoubleColor: boolean | null;
  hasLocalFoil: boolean | null;
  foilColorCount: number | null;
  minFoilColorCount: number | null;
  maxFoilColorCount: number | null;
  foilPassCount: number | null;
  minFoilPassCount: number | null;
  maxFoilPassCount: number | null;
  printColorCount: number | null;
  minPrintColorCount: number | null;
  maxPrintColorCount: number | null;
  minWidthMm: number | null;
  maxWidthMm: number | null;
  minHeightMm: number | null;
  maxHeightMm: number | null;
  minPaperWeightGsm: number | null;
  maxPaperWeightGsm: number | null;
  minItemCount: number | null;
  maxItemCount: number | null;
  perFoilColor: boolean;
  perFoilPass: boolean;
  perPrintColor: boolean;
};

export const EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT: CustomerRuleConditionEditorInput = {
  target: 'ITEM',
  packagingModes: [],
  pricingRoutes: [],
  productStructures: [],
  foilTechniques: [],
  specifications: [],
  paperTypes: [],
  craftCodes: [],
  noneOfCraftCodes: [],
  anyCraftCodeOutside: [],
  craftMode: null,
  foilColors: [],
  printColors: [],
  isDoubleSided: null,
  isDoubleColor: null,
  hasLocalFoil: null,
  foilColorCount: null,
  minFoilColorCount: null,
  maxFoilColorCount: null,
  foilPassCount: null,
  minFoilPassCount: null,
  maxFoilPassCount: null,
  printColorCount: null,
  minPrintColorCount: null,
  maxPrintColorCount: null,
  minWidthMm: null,
  maxWidthMm: null,
  minHeightMm: null,
  maxHeightMm: null,
  minPaperWeightGsm: null,
  maxPaperWeightGsm: null,
  minItemCount: null,
  maxItemCount: null,
  perFoilColor: false,
  perFoilPass: false,
  perPrintColor: false,
};

export function parseCustomerRuleCondition(
  raw: unknown,
): { condition: CustomerRuleConditionV1 | null; errors: string[] } {
  const candidate =
    raw === null || raw === undefined
      ? {}
      : typeof raw === 'object' && !Array.isArray(raw)
        ? raw
        : raw;
  const parsed = customerRuleConditionV1Schema.safeParse(candidate);
  if (parsed.success) return { condition: parsed.data, errors: [] };
  return {
    condition: null,
    errors: [...new Set(parsed.error.issues.map(conditionIssueMessage))],
  };
}

export function customerRuleConditionEditorInput(
  raw: unknown,
): { value: CustomerRuleConditionEditorInput; errors: string[] } {
  const parsed = parseCustomerRuleCondition(raw);
  if (!parsed.condition) {
    return {
      value: { ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT },
      errors: parsed.errors,
    };
  }
  const condition = parsed.condition;
  return {
    value: {
      target: condition.target,
      packagingModes: condition.packagingModes ?? [],
      pricingRoutes: condition.pricingRoutes ?? [],
      productStructures: condition.productStructures ?? [],
      foilTechniques: condition.foilTechniques ?? [],
      specifications: condition.specifications ?? [],
      paperTypes: condition.paperTypes ?? [],
      craftCodes: condition.craftCodes ?? [],
      noneOfCraftCodes: condition.noneOfCraftCodes ?? [],
      anyCraftCodeOutside: condition.anyCraftCodeOutside ?? [],
      craftMode: condition.craftMode ?? null,
      foilColors: condition.foilColors ?? [],
      printColors: condition.printColors ?? [],
      isDoubleSided: condition.isDoubleSided ?? null,
      isDoubleColor: condition.isDoubleColor ?? null,
      hasLocalFoil: condition.hasLocalFoil ?? null,
      foilColorCount: condition.foilColorCount ?? null,
      minFoilColorCount: condition.minFoilColorCount ?? null,
      maxFoilColorCount: condition.maxFoilColorCount ?? null,
      foilPassCount: condition.foilPassCount ?? null,
      minFoilPassCount: condition.minFoilPassCount ?? null,
      maxFoilPassCount: condition.maxFoilPassCount ?? null,
      printColorCount: condition.printColorCount ?? null,
      minPrintColorCount: condition.minPrintColorCount ?? null,
      maxPrintColorCount: condition.maxPrintColorCount ?? null,
      minWidthMm: condition.minWidthMm ?? null,
      maxWidthMm: condition.maxWidthMm ?? null,
      minHeightMm: condition.minHeightMm ?? null,
      maxHeightMm: condition.maxHeightMm ?? null,
      minPaperWeightGsm: condition.minPaperWeightGsm ?? null,
      maxPaperWeightGsm: condition.maxPaperWeightGsm ?? null,
      minItemCount: condition.minItemCount ?? null,
      maxItemCount: condition.maxItemCount ?? null,
      perFoilColor: condition.perFoilColor ?? false,
      perFoilPass: condition.perFoilPass ?? false,
      perPrintColor: condition.perPrintColor ?? false,
    },
    errors: [],
  };
}

function nonEmpty<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined;
}

function defined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

/** Builds the only JSON shape the processing-rule editor is allowed to save. */
export function buildCustomerRuleCondition(
  editor: CustomerRuleConditionEditorInput,
  derived: { productCodes: string[]; unitsPerSheet: number | null },
): CustomerRuleConditionV1 {
  if (editor.target === 'PACKAGING_GROUP') {
    return customerRuleConditionV1Schema.parse({
      schemaVersion: 1,
      target: 'PACKAGING_GROUP',
      packagingModes: nonEmpty(editor.packagingModes),
    });
  }
  const candidate = {
    schemaVersion: 1,
    target: 'ITEM' as const,
    productCodes: nonEmpty(derived.productCodes),
    pricingRoutes: nonEmpty(editor.pricingRoutes),
    productStructures: nonEmpty(editor.productStructures),
    foilTechniques: nonEmpty(editor.foilTechniques),
    specifications: nonEmpty(editor.specifications),
    paperTypes: nonEmpty(editor.paperTypes),
    craftCodes: nonEmpty(editor.craftCodes),
    noneOfCraftCodes: nonEmpty(editor.noneOfCraftCodes),
    anyCraftCodeOutside: nonEmpty(editor.anyCraftCodeOutside),
    craftMode: defined(editor.craftMode),
    foilColors: nonEmpty(editor.foilColors),
    printColors: nonEmpty(editor.printColors),
    isDoubleSided: defined(editor.isDoubleSided),
    isDoubleColor: defined(editor.isDoubleColor),
    hasLocalFoil: defined(editor.hasLocalFoil),
    foilColorCount: defined(editor.foilColorCount),
    minFoilColorCount: defined(editor.minFoilColorCount),
    maxFoilColorCount: defined(editor.maxFoilColorCount),
    foilPassCount: defined(editor.foilPassCount),
    minFoilPassCount: defined(editor.minFoilPassCount),
    maxFoilPassCount: defined(editor.maxFoilPassCount),
    printColorCount: defined(editor.printColorCount),
    minPrintColorCount: defined(editor.minPrintColorCount),
    maxPrintColorCount: defined(editor.maxPrintColorCount),
    minWidthMm: defined(editor.minWidthMm),
    maxWidthMm: defined(editor.maxWidthMm),
    minHeightMm: defined(editor.minHeightMm),
    maxHeightMm: defined(editor.maxHeightMm),
    minPaperWeightGsm: defined(editor.minPaperWeightGsm),
    maxPaperWeightGsm: defined(editor.maxPaperWeightGsm),
    minItemCount: defined(editor.minItemCount),
    maxItemCount: defined(editor.maxItemCount),
    unitsPerSheet: defined(derived.unitsPerSheet),
    perFoilColor: editor.perFoilColor || undefined,
    perFoilPass: editor.perFoilPass || undefined,
    perPrintColor: editor.perPrintColor || undefined,
  };
  return customerRuleConditionV1Schema.parse(
    Object.fromEntries(
      Object.entries(candidate).filter(([, value]) => value !== undefined),
    ),
  );
}
