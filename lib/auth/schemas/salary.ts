// 薪资：客服周期、提成发放、考勤（SPEC §5）
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { YMD_RE, decimalStringToScaledInteger, optionalTrimmedText, parseStrictYmd, safeId, shanghaiDateTimeField } from './shared';

// Reusable strict-calendar YYYY-MM-DD field for salary-period resolution.
const ymdField = (label: string) =>
  z
    .string()
    .trim()
    .superRefine((val, ctx) => {
      if (!YMD_RE.test(val)) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}格式非法（应为 YYYY-MM-DD）`,
        });
        return;
      }
      if (!parseStrictYmd(val)) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}不是合法日历日期`,
        });
      }
    });

const optionalNonNegativeDecimal = (
  label: string,
  integerDigits: number,
) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === '') {
        return undefined;
      }
      if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : value;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
      }
      return value;
    },
    z
      .string({ message: `${label}格式不合法` })
      .regex(
        new RegExp(`^\\d{1,${integerDigits}}(?:\\.\\d{1,2})?$`),
        `${label}必须为非负数（整数部分最多 ${integerDigits} 位、小数最多 2 位）`,
      )
      .optional(),
  );

const optionalWholeNumber = (label: string, min: number, max: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === '') return undefined;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return undefined;
        if (!/^\d+$/.test(trimmed)) return Number.NaN;
        return Number.parseInt(trimmed, 10);
      }
      return Number.NaN;
    },
    z
      .number()
      .int(`${label}必须是整数`)
      .min(min, `${label}必须 ≥ ${min}`)
      .max(max, `${label}超出合理范围`)
      .optional(),
  );

export const startCsPeriodSchema = z
  .object({
    csUserId: safeId('客服 id'),
    periodStart: ymdField('周期起始日期'),
    durationMonths: optionalWholeNumber('周期月数', 1, 24),
    baseMonthsAlreadyPaid: optionalWholeNumber('已发底薪月数', 0, 24),
    // SalaryPeriod.initialSales is Decimal(12,2), while monthlyBase is
    // Decimal(10,2). Their integer precision is therefore 10 and 8 digits.
    initialSales: optionalNonNegativeDecimal('期初业绩', 10),
    monthlyBase: optionalNonNegativeDecimal('月基本工资', 8),
  })
  .superRefine((input, ctx) => {
    if (
      input.durationMonths !== undefined &&
      input.baseMonthsAlreadyPaid !== undefined &&
      input.baseMonthsAlreadyPaid > input.durationMonths
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseMonthsAlreadyPaid'],
        message: '已发底薪月数不能超过周期月数',
      });
    }
    if (
      input.durationMonths !== undefined &&
      input.monthlyBase !== undefined &&
      decimalStringToScaledInteger(input.monthlyBase, 2) *
        BigInt(input.durationMonths) >
        BigInt('9999999999')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['monthlyBase'],
        message: '月底薪 × 周期月数超过可保存上限 99,999,999.99 元',
      });
    }
  });

export type StartCsPeriodInput = z.infer<typeof startCsPeriodSchema>;

const csPayrollAmountField = (label: string) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === '') return '0';
      if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : value;
      }
      return typeof value === 'string' ? value.trim() || '0' : value;
    },
    z
      .string({ message: `${label}格式不合法` })
      .regex(
        /^\d{1,10}(?:\.\d{1,2})?$/,
        `${label}必须为非负金额（整数最多 10 位、小数最多 2 位）`,
      ),
  );

export const recordCsPayrollPaymentSchema = z
  .object({
    idempotencyKey: z.string().uuid('工资发放请求标识格式非法'),
    baseAmount: csPayrollAmountField('底薪金额'),
    commissionAmount: csPayrollAmountField('提成金额'),
    paidAt: shanghaiDateTimeField('发放时间'),
    paymentMethod: optionalTrimmedText('发放方式', 32),
    referenceNo: optionalTrimmedText('流水号', 64),
    remark: optionalTrimmedText('发放备注', 200),
  })
  .superRefine((input, ctx) => {
    const baseCents = decimalStringToScaledInteger(input.baseAmount, 2);
    const commissionCents = decimalStringToScaledInteger(
      input.commissionAmount,
      2,
    );
    if (baseCents + commissionCents === BigInt(0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseAmount'],
        message: '本次发放的底薪或提成至少填写一项',
      });
    }
  });

export type RecordCsPayrollPaymentInput = z.infer<
  typeof recordCsPayrollPaymentSchema
>;

// Hours field: accepts number or numeric string; "" / null → 0
// (foreman may leave a field blank to mean "didn't work those hours").
// Rejects negative / non-numeric / > 24.
const hoursField = (label: string) =>
  z.preprocess(
    (v) => {
      if (v === null || v === undefined || v === '') return 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t === '') return 0;
        if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return Number.NaN;
        return Number.parseFloat(t);
      }
      return Number.NaN;
    },
    z
      .number()
      .min(0, `${label}不能为负`)
      .max(24, `${label}超出 24 小时`),
  );

const attendanceUnitField = (label: string, fallback: number) =>
  z.preprocess(
    (value) =>
      value === null || value === undefined || value === ''
        ? fallback
        : typeof value === 'string'
          ? Number(value)
          : value,
    z
      .number()
      .refine(
        (value) => value === 0 || value === 0.5 || value === 1,
        `${label}只支持 0、0.5、1 天`,
      ),
  );

export const recordAttendanceSchema = z
  .object({
    workerId: safeId('员工 id'),
    date: ymdField('考勤日期'),
    normalHours: hoursField('正常工时'),
    otHours: hoursField('加班工时'),
    workUnits: attendanceUnitField('实际上班', 1),
    leaveUnits: attendanceUnitField('请假', 0),
    leaveType: optionalTrimmedText('请假类型', 50).optional(),
    remark: optionalTrimmedText('备注', 200).optional(),
  })
  .refine((value) => value.workUnits + value.leaveUnits <= 1, {
    path: ['leaveUnits'],
    message: '上班天数与请假天数合计不能超过 1 天',
  })
  .refine((value) => value.normalHours + value.otHours <= 24, {
    path: ['otHours'],
    message: '正常工时与加班工时合计不能超过 24 小时',
  });

export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;

export const removeAttendanceSchema = z.object({
  workerId: safeId('工人 id'),
  date: ymdField('考勤日期'),
});

export type RemoveAttendanceInput = z.infer<typeof removeAttendanceSchema>;
