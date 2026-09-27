import { OrderPackagingMode } from '@/generated/prisma/enums';
import { MAX_CREATE_ORDER_UNITS_PER_BAG } from '@/lib/order/create-order-packaging';
import { z } from 'zod';

export const externalOrderCraftValues = [
  'PARTIAL',
  'FULL',
  'PRINT',
] as const;

export const externalPrintFoilModeValues = [
  'NONE',
  'PARTIAL',
  'FULL',
] as const;

const trimmedRequired = (label: string, maximum: number) =>
  z.string().trim().min(1, `请填写${label}`).max(maximum, `${label}过长`);

const optionalTrimmed = (maximum: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? null : value,
    z.string().trim().max(maximum).nullable().optional().default(null),
  );

const positiveNullableInteger = (label: string, maximum: number) =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z
      .number({ message: `${label}必须是数字` })
      .int(`${label}必须是整数`)
      .min(1, `${label}必须大于 0`)
      .max(maximum, `${label}过大`)
      .nullable(),
  );

const colorArray = z
  .array(trimmedRequired('烫金颜色', 32))
  .max(3, '每面最多选择 3 种烫金颜色')
  .superRefine((colors, ctx) => {
    if (new Set(colors).size !== colors.length) {
      ctx.addIssue({ code: 'custom', message: '同一面的颜色不能重复' });
    }
  });

export const externalCreateOrderStyleSchema = z
  .object({
    fig: z.number().int().min(1).max(999_999),
    craft: z.enum(externalOrderCraftValues),
    productId: optionalTrimmed(64),
    paperType: trimmedRequired('纸张', 64),
    weight: positiveNullableInteger('纸张克重', 2_000),
    specification: trimmedRequired('规格', 64),
    widthMm: positiveNullableInteger('实际宽度', 999_999),
    heightMm: positiveNullableInteger('实际高度', 999_999),
    quantity: z.number().int().min(1).max(9_999_999),
    frontColors: colorArray.default([]),
    backColors: colorArray.default([]),
    printFoilMode: z.enum(externalPrintFoilModeValues).default('NONE'),
    foilTechnique: z
      .enum(['NONE', 'FLAT', 'RELIEF', 'RAISED'])
      .default('NONE'),
    lamination: z
      .enum(['NONE', 'MATTE', 'SOFT_TOUCH', 'NEW_GLOSS', 'LASER'])
      .default('NONE'),
    packagingMode: z.enum(OrderPackagingMode).optional(),
    pack: positiveNullableInteger('每包数量', MAX_CREATE_ORDER_UNITS_PER_BAG),
    remark: optionalTrimmed(1_000),
  })
  .strict()
  .superRefine((style, ctx) => {
    if ((style.widthMm === null) !== (style.heightMm === null)) {
      ctx.addIssue({
        code: 'custom',
        path: style.widthMm === null ? ['widthMm'] : ['heightMm'],
        message: '实际宽度和高度必须同时填写',
      });
    }

    if (style.craft === 'FULL' && style.backColors.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['backColors'],
        message: '专版烫金只允许正面',
      });
    }

    // 彩印反面烫金（叠加局部或专版烫金）是合法事实，由计价引擎转人工核价
    // （DECISIONS 2026-08-27），schema 不提前拒绝。

    if (
      style.craft !== 'PRINT' &&
      style.printFoilMode !== 'NONE'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['printFoilMode'],
        message: '只有彩印款式可以选择叠加烫金',
      });
    }
  });

const externalCreateOrderFactsObject = z
  .object({
    clientSubmissionId: z.string().uuid('提交标识无效'),
    customName: trimmedRequired('工单名称', 100),
    // 客户名称/简称与关联客户已退役（业主 2026-09-27）。严格 schema 仍接受这两个
    // key，免得旧客户端被 strict 拒绝；toCanonicalFacts 不再传入，值不校验、不产生效果。
    customerPartyId: z.string().nullable().optional(),
    customerRef: z.string().nullable().optional(),
    receiverName: trimmedRequired('收件人', 64),
    receiverPhone: trimmedRequired('联系电话', 32),
    receiverAddress: trimmedRequired('收件地址', 256),
    destinationProvince: optionalTrimmed(32),
    isSfCollect: z.boolean().default(false),
    packRaw: optionalTrimmed(500),
    remark: optionalTrimmed(1_000),
    styles: z.array(externalCreateOrderStyleSchema).min(1).max(20),
  })
  .strict();

function addOrderFactsIssues(
  facts: z.infer<typeof externalCreateOrderFactsObject>,
  ctx: z.RefinementCtx,
  requirePack: boolean,
) {
  const seen = new Set<number>();
  for (const [index, style] of facts.styles.entries()) {
    if (seen.has(style.fig)) {
      ctx.addIssue({
        code: 'custom',
        path: ['styles', index, 'fig'],
        message: `款式编号 ${style.fig} 重复`,
      });
    }
    seen.add(style.fig);
    if (requirePack && style.packagingMode !== OrderPackagingMode.UNPACKED && style.pack === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['styles', index, 'pack'],
        message: `第 ${style.fig} 款请填写每包数量`,
      });
    }
  }
}

export const externalCreateOrderDraftSchema = externalCreateOrderFactsObject
  .superRefine((facts, ctx) => addOrderFactsIssues(facts, ctx, false));

export const externalCreateOrderSubmitSchema = externalCreateOrderFactsObject
  .superRefine((facts, ctx) => addOrderFactsIssues(facts, ctx, true));

export type ExternalCreateOrderDraftInput = z.infer<
  typeof externalCreateOrderDraftSchema
>;
export type ExternalCreateOrderSubmitInput = z.infer<
  typeof externalCreateOrderSubmitSchema
>;

export type ExternalCreateOrderIssue = {
  path: readonly PropertyKey[];
  fig: number | null;
  code: string;
  message: string;
};

export function externalCreateOrderIssues(
  error: z.ZodError,
  input: unknown,
): ExternalCreateOrderIssue[] {
  const styles =
    input && typeof input === 'object' && Array.isArray((input as { styles?: unknown }).styles)
      ? (input as { styles: unknown[] }).styles
      : [];
  return error.issues.map((issue) => {
    const styleIndex =
      issue.path[0] === 'styles' && typeof issue.path[1] === 'number'
        ? issue.path[1]
        : null;
    const candidate = styleIndex === null ? null : styles[styleIndex];
    const fig =
      candidate &&
      typeof candidate === 'object' &&
      Number.isSafeInteger((candidate as { fig?: unknown }).fig)
        ? Number((candidate as { fig: number }).fig)
        : null;
    return {
      path: issue.path,
      fig,
      code: issue.code,
      message: issue.message,
    };
  });
}
