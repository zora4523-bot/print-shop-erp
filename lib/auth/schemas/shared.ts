// 跨域共用的字段 helper 与严格日期解析（原 schemas.ts 各段落散落的私有 helper 收拢于此）
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { MAX_ORDER_ITEM_FOIL_COLORS, NO_FOIL_COLOR } from '../../order/foil-colors';
import { MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE } from '../../order/pricing-route';

// HTML checkboxes submit value="on" when checked and omit the field when
// unchecked — unless the form sets an explicit value. Accept both the
// browser-default 'on' and explicit 'true' / boolean so the schema works
// whether the form is stock HTML or a JS-driven component.
export const formBoolean = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === 'on';
  return false;
}, z.boolean());

// Omitted legacy facts stay unknown instead of being silently converted to
// an explicit "no". New browser forms submit a real boolean for this field.
export const nullableFormBoolean = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === 'on';
  return v;
}, z.boolean().nullable());

export const requiredFormBoolean = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'on') return true;
  if (v === 'false') return false;
  return v;
}, z.boolean({ message: '请明确选择是或否' }));

// Partial-update variant: undefined stays undefined (meaning "don't
// change") instead of collapsing to false. Used on edit schemas where
// not every checkbox is present in every submission (e.g. the
// SHIPPING_ONLY edit form omits isUrgent entirely).
export const optionalFormBoolean = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === 'on';
  return undefined;
}, z.boolean().optional());

export const productTextFieldOptional = (label: string, max = 64) =>
  z
    .string()
    .trim()
    .max(max, `${label}过长（最多 ${max} 个字符）`)
    .transform((v) => (v === '' ? null : v))
    .nullable();

// Prices go into a Decimal(10,4) column → 10 total digits with 4 after the
// decimal point, i.e. integer part capped at 6 digits, max value ≈
// 999999.9999. We keep the value as a string all the way to Prisma so JS
// floats don't silently round small decimals (e.g. 0.0007 → 0.0006999…).
// Both bounds live in the regex so an oversized price is rejected as
// `invalid` at the schema boundary instead of surfacing as a DB overflow.
// Preprocess normalizes null / undefined to '' so programmatic callers
// (lib.createOrder receives pre-parsed objects with null fields) don't
// trip "Expected string, got null".
export const moneyOptionalField = z.preprocess(
  (v) => (v === null || v === undefined ? '' : v),
  z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d{1,6}(\.\d{1,4})?$/.test(v),
      { message: '金额格式错误（整数部分最多 6 位、小数最多 4 位、非负数）' },
    )
    .transform((v) => (v === '' ? null : v)),
);

// OrderItem.fixedFee / suggestedSubtotal are Decimal(12,2), unlike unitPrice
// (Decimal(10,4)). Reject extra fractional digits at the application boundary
// instead of letting PostgreSQL round the stored fixed fee independently from
// the already-computed subtotal.
export const orderItemMoneyOptionalField = z.preprocess(
  (v) => (v === null || v === undefined ? '' : v),
  z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d{1,10}(\.\d{1,2})?$/.test(v),
      {
        message:
          '金额格式错误（整数部分最多 10 位、小数最多 2 位、非负数）',
      },
    )
    .transform((v) => (v === '' ? null : v)),
);

export const optionalTrimmedText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label}过长（最多 ${max} 个字符）`)
    .transform((v) => (v === '' ? null : v))
    .nullable();

export const requiredTrimmedText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `请填写${label}`)
    .max(max, `${label}过长（最多 ${max} 个字符）`);

// Per-item quantity: integer ≥ 1, capped at 9,999,999. Reject JS-ish numeric
// forms on the string path rather than accepting z.coerce.number() semantics.
export const orderItemQuantityField = z.preprocess(
  (v) => {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (trimmed === '') return undefined;
    if (!/^\d+$/.test(trimmed)) return null;
    return Number.parseInt(trimmed, 10);
  },
  z
    .number({ message: '数量必须是正整数' })
    .finite('数量必须是有限数')
    .int('数量必须是整数')
    .min(1, '数量必须 ≥ 1')
    .max(9_999_999, '数量过大'),
);

export const craftIdSchema = z
  .string()
  .trim()
  .min(1, '工艺 id 不能为空')
  .max(32, '工艺 id 过长');

export const orderItemFoilColorsArray = (maximum: number, message: string) => z
  .array(
    z
      .string()
      .trim()
      .min(1, '烫金颜色不能为空')
      .max(32, '烫金颜色过长（最多 32 个字符）'),
  )
  .max(maximum, message)
  .superRefine((colors, ctx) => {
    if (new Set(colors).size !== colors.length) {
      ctx.addIssue({ code: 'custom', message: '烫金颜色不能重复' });
    }
    if (colors.includes(NO_FOIL_COLOR) && colors.length > 1) {
      ctx.addIssue({
        code: 'custom',
        message: `“${NO_FOIL_COLOR}”不能与其他颜色同时选择`,
      });
    }
  });

export const orderItemFoilColorsField = orderItemFoilColorsArray(
  MAX_ORDER_ITEM_FOIL_COLORS,
  `单款式烫金颜色不超过 ${MAX_ORDER_ITEM_FOIL_COLORS} 种`,
);

export const orderItemFoilSideColorsField = z
  .array(
    z
      .string()
      .trim()
      .min(1, '烫金颜色不能为空')
      .max(32, '烫金颜色过长（最多 32 个字符）'),
  )
  .max(
    MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE,
    `每面烫金颜色不超过 ${MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE} 种`,
  )
  .superRefine((colors, ctx) => {
    if (new Set(colors).size !== colors.length) {
      ctx.addIssue({ code: 'custom', message: '同一面的烫金颜色不能重复' });
    }
    if (colors.includes(NO_FOIL_COLOR)) {
      ctx.addIssue({
        code: 'custom',
        message: `正反面颜色明细不能填写“${NO_FOIL_COLOR}”`,
      });
    }
  });

export function decimalStringToScaledInteger(value: string, scale: number): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart = '0', decimalPart = ''] = unsigned.split('.');
  const scaled = BigInt(
    `${integerPart}${decimalPart.padEnd(scale, '0').slice(0, scale)}`,
  );
  return negative ? -scaled : scaled;
}

export const shipmentBillableWeightField = z.preprocess(
  (value) =>
    value === null || value === undefined || value === ''
      ? null
      : typeof value === 'string'
        ? value.trim()
        : value,
  z.union([
    z.null(),
    z
      .string()
      .regex(/^\d{1,6}(?:\.\d{1,3})?$/, '计费重量格式不合法')
      .refine((value) => Number(value) > 0, '计费重量必须大于 0'),
  ]),
);

export const shipmentChargeMoneyField = z.preprocess(
  (value) =>
    value === null || value === undefined || value === ''
      ? null
      : typeof value === 'string'
        ? value.trim()
        : value,
  z.union([
    z.null(),
    z
      .string()
      .regex(
        /^\d{1,10}(?:\.\d{1,2})?$/,
        '收费金额格式错误（整数部分最多 10 位、小数最多 2 位）',
      ),
  ]),
);

// These fields were added after the original order command shipped. Treat a
// missing key exactly like an empty form field so legacy API/domain callers
// still normalize to null. This schema validates shape, not trust: role-aware
// server commands decide whether a submitted weight may be used or must be
// ignored (external-sales create/preview always ignore it).
export const optionalShipmentText = (label: string, max: number) =>
  z.preprocess(
    (value) => (value === undefined ? null : value),
    optionalTrimmedText(label, max),
  );

// 严格 YYYY-MM-DD → Date（parseStrictYmd 拒绝 2024-02-31 这类滚动日期；
// 函数声明有提升，此处提前引用安全）。空串/缺失 → null。
export const optionalDateField = z.preprocess((v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const parsed = parseStrictYmd(t);
    return parsed ?? 'invalid-date';
  }
  return 'invalid-date';
}, z.date().nullable());

// partial-update 版：undefined = 缺 key 不改；空串 = 清空为 null。
export const optionalDateFieldPartial = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const parsed = parseStrictYmd(t);
    return parsed ?? 'invalid-date';
  }
  return 'invalid-date';
}, z.date().nullable().optional());

// ID allowlist kept in sync with lib/oss/sign.ts — cuid / cuid2 only,
// no path-sensitive characters. A caller sending garbage here is a bug
// or attack, not a user typo.
export const scheduleIdRe = /^[A-Za-z0-9_-]+$/;
export const safeId = (label: string) =>
  z.string().trim().regex(scheduleIdRe, `${label}格式非法`);

// Strict YYYY-MM-DD parser — matches the format HTML `<input type="date">`
// emits. JS's `new Date(string)` would accept `2024-02-31` and silently
// roll it forward to March, which is exactly the class of calendar bug
// we don't want leaking into expected/actual delivery dates.
export const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function parseStrictYmd(s: string): Date | null {
  const m = YMD_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  // Use UTC so timezone offset doesn't shift the day. Verify the parsed
  // date's components match the input to reject invalid calendar dates
  // like 2024-02-31 (Date() would silently normalize to 2024-03-02).
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

// Strict parser for HTML `<input type="datetime-local">` values. Appending a
// timezone suffix and calling `new Date()` is not enough: JavaScript silently
// normalizes impossible dates such as 2026-02-31 into March. Validate the
// calendar portion first, then convert the valid Shanghai wall time to UTC.
export function parseStrictShanghaiDateTimeLocal(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const date = parseStrictYmd(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!date || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return new Date(
    date.getTime() + hour * 60 * 60 * 1000 + minute * 60 * 1000 -
      SHANGHAI_OFFSET_MS,
  );
}

export const shanghaiDateTimeField = (label: string) =>
  z.preprocess(
    (value) =>
      value === null || value === undefined || value === ''
        ? new Date()
        : value,
    z.union([
      z.date(),
      z
        .string()
        .trim()
        .transform((value, ctx) => {
          const parsed = parseStrictShanghaiDateTimeLocal(value);
          if (!parsed) {
            ctx.addIssue({
              code: 'custom',
              message: `请选择合法的完整${label}`,
            });
            return z.NEVER;
          }
          return parsed;
        }),
    ]),
  ).refine((value) => !Number.isNaN(value.getTime()), `${label}不合法`);

// YYYY-MM — same strict-regex-with-calendar-check pattern as ymdField.
export const ymField = (label: string) =>
  z
    .string()
    .trim()
    .superRefine((val, ctx) => {
      if (!/^(\d{4})-(\d{2})$/.test(val)) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}格式非法（应为 YYYY-MM）`,
        });
        return;
      }
      const [, , mo] = /^(\d{4})-(\d{2})$/.exec(val)!;
      const month = Number(mo);
      if (month < 1 || month > 12) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}月份超出 1-12`,
        });
      }
    });
