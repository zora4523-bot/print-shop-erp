// 外协单（SPEC §3.2）
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { decimalStringToScaledInteger, optionalDateField, optionalTrimmedText, parseStrictShanghaiDateTimeLocal, safeId } from './shared';

const moneyField = z.preprocess(
  (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '') return null;
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(t)) return Number.NaN;
      return t;
    }
    return Number.NaN;
  },
  z
    .union([z.string(), z.number()])
    .nullable()
    .transform((v) => (v === null || v === '' ? null : String(v))),
);

const optionalIntField = (label: string, max: number) =>
  z.preprocess(
    (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t === '') return null;
        if (!/^\d+$/.test(t)) return Number.NaN;
        return Number.parseInt(t, 10);
      }
      return Number.NaN;
    },
    z
      .number()
      .int(`${label}必须是整数`)
      .min(0, `${label}不能为负`)
      .max(max, `${label}超出合理范围`)
      .nullable(),
  );

export const createOutsourceSchema = z.object({
  idempotencyKey: z.string().uuid('外协创建请求标识格式非法'),
  orderId: safeId('工单 id'),
  orderItemIds: z
    .array(safeId('款式 id'))
    .min(1, '至少选择一个款式')
    .max(50, '单次外协不超过 50 个款式')
    .refine((ids) => new Set(ids).size === ids.length, {
      message: '不能重复选择同一款式',
    }),
  supplierName: z
    .string()
    .trim()
    .min(1, '请填写外协厂名')
    .max(64, '外协厂名过长（最多 64 个字符）'),
  supplierContact: optionalTrimmedText('联系方式', 64),
  craftDescription: optionalTrimmedText('工艺说明', 500),
  specialRequirement: optionalTrimmedText('特殊要求', 500),
  // Up to 50 selected styles, each capped at 9,999,999 by the order schema.
  // This is a stale-page/tamper guard only; lib/outsource.ts derives the real
  // total from locked OrderItem rows.
  totalQty: optionalIntField('总数量', 499_999_950),
  expectedDate: optionalDateField,
  amount: moneyField,
  remark: optionalTrimmedText('备注', 500),
});

export type CreateOutsourceInput = z.infer<typeof createOutsourceSchema>;

const confirmedOutsourceAmountField = z.preprocess(
  (value) => {
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value.trim();
    return value;
  },
  z
    .string()
    .regex(
      /^\d{1,10}(?:\.\d{1,2})?$/,
      '外协金额格式不合法（最多 10 位整数、2 位小数）',
    ),
);

export const confirmOutsourceAmountSchema = z.object({
  idempotencyKey: z.string().uuid('外协金额请求标识格式非法'),
  amount: confirmedOutsourceAmountField,
  reason: z
    .string()
    .trim()
    .min(1, '请填写金额确认/更正原因')
    .max(200, '金额确认/更正原因过长（最多 200 个字符）'),
});

export type ConfirmOutsourceAmountInput = z.infer<
  typeof confirmOutsourceAmountSchema
>;

const outsourcePaymentAmountField = z.preprocess(
  (value) => (typeof value === 'number' ? String(value) : value),
  z
    .string()
    .trim()
    .regex(
      /^\d{1,10}(?:\.\d{1,2})?$/,
      '付款金额格式不合法（最多 10 位整数、2 位小数）',
    )
    .refine(
      (value) =>
        !/^\d{1,10}(?:\.\d{1,2})?$/.test(value) ||
        decimalStringToScaledInteger(value, 2) > BigInt(0),
      '付款金额必须大于 0',
    ),
);

const outsourcePaymentDateTimeField = z.union([
  z.date().refine((value) => !Number.isNaN(value.getTime()), '付款时间不合法'),
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      const parsed = parseStrictShanghaiDateTimeLocal(value);
      if (!parsed) {
        ctx.addIssue({ code: 'custom', message: '请选择合法的完整付款时间' });
        return z.NEVER;
      }
      return parsed;
    }),
]);

export const recordOutsourcePaymentSchema = z.object({
  idempotencyKey: z.string().uuid('外协付款请求标识格式非法'),
  amount: outsourcePaymentAmountField,
  paidAt: outsourcePaymentDateTimeField,
  method: optionalTrimmedText('付款方式', 32),
  reference: optionalTrimmedText('付款流水号', 64),
  remark: optionalTrimmedText('付款备注', 200),
});

export type RecordOutsourcePaymentInput = z.infer<
  typeof recordOutsourcePaymentSchema
>;

export const markOutsourceReceivedSchema = z.object({
  actualDate: optionalDateField,
});

export type MarkOutsourceReceivedInput = z.infer<typeof markOutsourceReceivedSchema>;
