// 应收账单生成 / 收款与工单成本录入
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { OrderCostCategory } from '../../../generated/prisma/enums';
import { decimalStringToScaledInteger, optionalTrimmedText, shanghaiDateTimeField, ymField } from './shared';

export const generateBillsSchema = z.object({
  period: ymField('月份'),
});

export type GenerateBillsInput = z.infer<typeof generateBillsSchema>;

// Money input: accepts number or string; required > 0 for payments.
const billPaymentField = z.preprocess(
  (v) => {
    if (v === null || v === undefined || v === '') return Number.NaN;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '') return Number.NaN;
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(t)) return Number.NaN;
      return t;
    }
    return Number.NaN;
  },
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.parseFloat(v) > 0, '付款金额必须大于 0'),
);

export const recordBillPaymentSchema = z.object({
  idempotencyKey: z.string().uuid('付款请求标识格式非法'),
  amount: billPaymentField,
  paidAt: shanghaiDateTimeField('收款时间'),
  paymentMethod: optionalTrimmedText('收款方式', 32),
  referenceNo: optionalTrimmedText('流水号', 64),
  remark: optionalTrimmedText('付款备注', 200),
});

export type RecordBillPaymentInput = z.infer<typeof recordBillPaymentSchema>;

const optionalCostNumber = (
  label: string,
  integerDigits: number,
  decimals: number,
) =>
  z.preprocess(
    (value) =>
      value === null || value === undefined || value === ''
        ? null
        : typeof value === 'string'
          ? value.trim() || null
          : value,
    z
      .union([
        z.null(),
        z
          .string()
          .regex(
            new RegExp(
              `^\\d{1,${integerDigits}}(?:\\.\\d{1,${decimals}})?$`,
            ),
            `${label}格式不合法（整数部分最多 ${integerDigits} 位、小数最多 ${decimals} 位）`,
          ),
      ]),
  );

const AUTOMATIC_ORDER_COST_CATEGORIES = new Set<OrderCostCategory>([
  OrderCostCategory.PIECEWORK,
  OrderCostCategory.OUTSOURCE,
]);
const COST_PRODUCT_SCALE_TO_CENTS = BigInt(100_000);

export const createOrderCostEntrySchema = z
  .object({
    idempotencyKey: z.string().uuid('成本请求标识格式非法'),
    orderId: z.string().trim().regex(/^[A-Za-z0-9_-]+$/, '工单 id 格式非法'),
    category: z.nativeEnum(OrderCostCategory),
    description: z.string().trim().min(1, '请填写成本名称').max(100),
    // Decimal(12,3) has nine integer digits; Decimal(12,4) has eight.
    quantity: optionalCostNumber('数量', 9, 3),
    unit: optionalTrimmedText('单位', 20),
    unitPrice: optionalCostNumber('单价', 8, 4),
    amount: z
      .string()
      .trim()
      .regex(/^-?\d{1,10}(?:\.\d{1,2})?$/, '金额格式不合法')
      .refine((value) => Number(value) !== 0, '金额不能为 0'),
    remark: optionalTrimmedText('成本备注', 200),
  })
  .superRefine((input, ctx) => {
    if (AUTOMATIC_ORDER_COST_CATEGORIES.has(input.category)) {
      ctx.addIssue({
        code: 'custom',
        path: ['category'],
        message: '计件和外协成本由生产、外协流水自动计入，不能手工重复录入',
      });
    }

    if (
      input.category !== OrderCostCategory.ADJUSTMENT &&
      input.amount.startsWith('-')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: '普通成本金额必须大于 0；负数请使用“成本调整”',
      });
    }

    if (input.quantity !== null && input.unitPrice !== null) {
      const quantityThousandths = decimalStringToScaledInteger(
        input.quantity,
        3,
      );
      const unitPriceTenThousandths = decimalStringToScaledInteger(
        input.unitPrice,
        4,
      );
      const product = quantityThousandths * unitPriceTenThousandths;
      const expectedCents =
        (product + COST_PRODUCT_SCALE_TO_CENTS / BigInt(2)) /
        COST_PRODUCT_SCALE_TO_CENTS;
      const amountCents = decimalStringToScaledInteger(input.amount, 2);
      if (amountCents !== expectedCents) {
        ctx.addIssue({
          code: 'custom',
          path: ['amount'],
          message: '金额必须等于数量 × 单价（按两位小数四舍五入）',
        });
      }
    }
  });

export type CreateOrderCostEntryInput = z.infer<
  typeof createOrderCostEntrySchema
>;
