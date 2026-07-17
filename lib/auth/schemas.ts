import { z } from 'zod';
// Import enums from the runtime-free /enums entry so importing this
// module from client components (e.g. `zodResolver(createOrderSchema)`
// inside an RHF form) doesn't drag the Prisma runtime into the browser
// bundle. /enums exports plain `const` objects with the same values as
// /client but without the `@prisma/client` runtime (node:module etc.).
import {
  AdjustmentType,
  MaterialCategory,
  PartyType,
  ProductCategory,
  Role,
  WorkerType,
  MachineType,
} from '../../generated/prisma/enums';

// bcrypt (and bcryptjs, which we use) only hashes the first 72 bytes of the
// input. Anything beyond that is silently truncated, so a 200-byte password
// is indistinguishable from a different 200-byte password sharing the same
// first 72 bytes. If we let users *set* passwords longer than 72 bytes,
// they can later log in with any suffix — a real security weakening.
//
// Short-circuited guard, both checks in one superRefine :
// separate `.max(72)` and `.refine(byteCheck)` don't compose into
// short-circuiting — Zod runs every check in the chain even after an
// earlier one fails, so TextEncoder.encode would still allocate for a 10k
// string. A single superRefine with early `return` after the char-count
// issue guarantees the byte check is skipped on oversize inputs.
const BCRYPT_MAX_BYTES = 72;
const MAX_PASSWORD_CHARS = 72;
const UTF8 = new TextEncoder();

function checkBcryptSafeLength(v: string, ctx: import('zod').RefinementCtx) {
  // Gate 1: cheap UTF-16 .length cap. Every UTF-8 byte is ≥1 UTF-16 code
  // unit at the source side, so .length > 72 ⇒ bytes > 72 — no legitimate
  // input is lost here. Bails out before any allocation.
  if (v.length > MAX_PASSWORD_CHARS) {
    ctx.addIssue({ code: 'custom', message: '新密码过长（最多 72 字符）' });
    return;
  }
  // Gate 2: multibyte-aware byte count. Only reachable for ≤72-char inputs,
  // so the TextEncoder buffer is bounded (≤ 4 bytes/char ⇒ ≤ 288 bytes).
  if (UTF8.encode(v).length > BCRYPT_MAX_BYTES) {
    ctx.addIssue({
      code: 'custom',
      message:
        '新密码过长（按 UTF-8 字节计，最多 72 字节。纯英文约 72 字符，含中文约 24 字符）',
    });
  }
}

// Password policy: ≥8 chars (decision A). Username trims so trailing spaces
// on a phone keyboard don't lock the user out.
//
// Login password cap stays at 256 chars (not the bcrypt-byte limit) so
// pre-existing long passwords — if any were ever set out of band — still
// validate at the form. bcrypt.compare then does the (truncated) check.
export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, '请输入用户名')
    .max(64, '用户名过长（最多 64 个字符）'),
  password: z
    .string()
    .min(8, '密码至少 8 位')
    .max(256, '密码过长（最多 256 个字符）'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// For password *changes* we enforce the bcrypt-safe byte limit on newPassword
// so a freshly-set password can never exceed what bcrypt will actually hash.
// currentPassword stays lenient: we only need to match a potentially-legacy
// stored hash, and bcrypt.compare handles any length.
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, '请输入当前密码')
      .max(256, '密码过长（最多 256 个字符）'),
    newPassword: z
      .string()
      .min(8, '新密码至少 8 位')
      .superRefine(checkBcryptSafeLength),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: '两次输入的新密码不一致',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: '新密码不能与当前密码相同',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ============================================================
// Owner-side account management (SPEC §2 + §9.1)
// ============================================================

// Username is used both as a login handle and appears in logs / UI. Keep it
// narrow: ascii letters, digits, dash, underscore, 3–64 chars. Trim first
// so a phone keyboard's trailing space doesn't create a weirdly-named row.
const usernameField = z
  .string()
  .trim()
  .min(3, '用户名至少 3 个字符')
  .max(64, '用户名过长（最多 64 个字符）')
  .regex(/^[A-Za-z0-9_-]+$/, '用户名只能包含字母、数字、下划线或连字符');

const displayNameField = z
  .string()
  .trim()
  .min(1, '请填写姓名')
  .max(64, '姓名过长（最多 64 个字符）');

// Accept blank, then coerce to null/undefined at the action boundary. Keep
// the upper bound so log lines don't balloon.
const phoneField = z
  .string()
  .trim()
  .max(32, '电话过长（最多 32 个字符）')
  .optional();

const roleField = z.nativeEnum(Role);
const workerTypeField = z.nativeEnum(WorkerType).nullable().optional();
const machineTypeField = z.nativeEnum(MachineType).nullable().optional();

// Enforces the SPEC §2.1 cascade:
//   role === WORKER            ⇒ workerType is required
//   workerType === MACHINE     ⇒ machineType is required
//   role !== WORKER            ⇒ workerType / machineType must be absent
//   workerType !== MACHINE     ⇒ machineType must be absent
//
// Extracted as a standalone function so createUserSchema and updateUserSchema
// can both apply it without having to duplicate the cross-field logic.
function enforceWorkerCascade(
  data: { role: Role; workerType?: WorkerType | null; machineType?: MachineType | null },
  ctx: z.RefinementCtx,
) {
  if (data.role === Role.WORKER) {
    if (!data.workerType) {
      ctx.addIssue({ code: 'custom', path: ['workerType'], message: '请为师傅选择岗位类型' });
      return;
    }
    if (data.workerType === WorkerType.MACHINE && !data.machineType) {
      ctx.addIssue({ code: 'custom', path: ['machineType'], message: '请为开机师傅选择机器类型' });
    }
    if (data.workerType !== WorkerType.MACHINE && data.machineType) {
      ctx.addIssue({
        code: 'custom',
        path: ['machineType'],
        message: '只有开机师傅（MACHINE）才需要机器类型',
      });
    }
  } else {
    if (data.workerType) {
      ctx.addIssue({ code: 'custom', path: ['workerType'], message: '非师傅角色不应设置岗位类型' });
    }
    if (data.machineType) {
      ctx.addIssue({ code: 'custom', path: ['machineType'], message: '非开机师傅不应设置机器类型' });
    }
  }
}

// Reused for both createUserSchema.password and resetUserPasswordSchema.
// Same bcrypt 72-byte ceiling as changePasswordSchema.newPassword
// (rounds 10 / 11 / 12).
function passwordField(label = '密码') {
  return z
    .string()
    .min(8, `${label}至少 8 位`)
    .superRefine((v, ctx) => {
      if (v.length > MAX_PASSWORD_CHARS) {
        ctx.addIssue({ code: 'custom', message: `${label}过长（最多 72 字符）` });
        return;
      }
      if (UTF8.encode(v).length > BCRYPT_MAX_BYTES) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}过长（按 UTF-8 字节计，最多 72 字节。纯英文约 72 字符，含中文约 24 字符）`,
        });
      }
    });
}

export const createUserSchema = z
  .object({
    username: usernameField,
    displayName: displayNameField,
    phone: phoneField,
    role: roleField,
    workerType: workerTypeField,
    machineType: machineTypeField,
    password: passwordField('密码'),
  })
  .superRefine(enforceWorkerCascade);

export type CreateUserInput = z.infer<typeof createUserSchema>;

// HTML checkboxes submit value="on" when checked and omit the field when
// unchecked — unless the form sets an explicit value. Accept both the
// browser-default 'on' and explicit 'true' / boolean so the schema works
// whether the form is stock HTML or a JS-driven component.
const formBoolean = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === 'on';
  return false;
}, z.boolean());

// Partial-update variant: undefined stays undefined (meaning "don't
// change") instead of collapsing to false. Used on edit schemas where
// not every checkbox is present in every submission (e.g. the
// SHIPPING_ONLY edit form omits isUrgent entirely).
const optionalFormBoolean = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === 'on';
  return undefined;
}, z.boolean().optional());

// isActive is intentionally NOT part of the update schema. Activation is
// controlled by a dedicated setXxxActive action (surfaced in the UI as a
// separate "停用/启用" button), so the basic-info form can't silently flip
// activation mid-edit. Same pattern applies to updateCraftSchema and
// updateProductSchema below.
export const updateUserSchema = z
  .object({
    displayName: displayNameField,
    phone: phoneField,
    role: roleField,
    workerType: workerTypeField,
    machineType: machineTypeField,
  })
  .superRefine(enforceWorkerCascade);

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetUserPasswordSchema = z.object({
  newPassword: passwordField('新密码'),
});

export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;

// ============================================================
// Craft dictionary (SPEC §6.1 / appendix B)
// ============================================================

// Code is the stable machine-facing identifier — referenced by production
// tasks, notification templates, future API consumers. Keep it narrow so
// ad-hoc edits don't break existing joins.
const craftCodeField = z
  .string()
  .trim()
  .min(2, '代码至少 2 个字符')
  .max(32, '代码过长（最多 32 个字符）')
  .regex(/^[A-Z][A-Z0-9_]*$/, '代码只能包含大写字母、数字、下划线，且必须以字母开头');

const optionalCraftCodeField = z
  .preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.union([z.literal(''), craftCodeField]),
  )
  .transform((value) => (value === '' ? null : value));

const craftNameField = z
  .string()
  .trim()
  .min(1, '请填写工艺名')
  .max(32, '工艺名过长（最多 32 个字符）');

// Optional select that arrives from FormData as '' when the operator didn't
// pick anything. Normalize to null so Prisma's MachineType? column stores
// a proper "no default machine".
const optionalMachineTypeField = z
  .union([z.nativeEnum(MachineType), z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v === '' || v === undefined ? null : v));

// FormData always hands us strings; accept the string form too and coerce.
// Min is 1 (not 0) so an untouched create form — where the default-empty
// input coerces to 0 — fails validation rather than accidentally sorting
// the new craft ahead of every existing one .
const sortOrderField = z.coerce
  .number({ message: '排序必须是数字' })
  .int('排序必须是整数')
  .min(1, '排序必须 ≥ 1（建议从 10 起，每 10 留一档）')
  .max(9999, '排序过大');

export const createCraftSchema = z.object({
  name: craftNameField,
  code: optionalCraftCodeField,
  isOutsource: formBoolean,
  defaultMachineType: optionalMachineTypeField,
  sortOrder: sortOrderField,
});

export type CreateCraftInput = z.infer<typeof createCraftSchema>;

export const updateCraftSchema = z.object({
  name: craftNameField,
  code: craftCodeField,
  isOutsource: formBoolean,
  defaultMachineType: optionalMachineTypeField,
  sortOrder: sortOrderField,
});

export type UpdateCraftInput = z.infer<typeof updateCraftSchema>;

// ============================================================
// Product dictionary (SPEC §4.1 / appendix C)
// ============================================================

const productNameField = z
  .string()
  .trim()
  .min(1, '请填写产品名')
  .max(64, '产品名过长（最多 64 个字符）');

const productCodeField = z
  .string()
  .trim()
  .max(32, '产品编码过长（最多 32 个字符）')
  .refine((v) => v === '' || /^[A-Za-z0-9_-]+$/.test(v), {
    message: '产品编码只能包含英文字母、数字、下划线、短横线',
  })
  .transform((v) => (v === '' ? null : v));

const productTextFieldOptional = (label: string, max = 64) =>
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
const moneyOptionalField = z.preprocess(
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

// Quantity semantics:
//   • From FormData (strings): accept `^\d+$` (plus trim), reject JS-ish
//     numeric forms '1e3' / '0x10' / '+5' etc. that z.coerce.number() would
//     have silently accepted.
//   • From JS callers (seed scripts, internal helpers): accept plain
//     `number` values directly so the schema stays usable outside the
//     form-post path.
// Both paths funnel into a plain `z.number().int().min(1).max(…)`.
const minOrderQtyField = z.preprocess(
  (v) => {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (trimmed === '') return undefined;
    if (!/^\d+$/.test(trimmed)) return null; // invalid — number schema will reject
    return Number.parseInt(trimmed, 10);
  },
  z
    .number({ message: '最小起订量必须是正整数' })
    .finite('最小起订量必须是有限数')
    .int('最小起订量必须是整数')
    .min(1, '最小起订量必须 ≥ 1')
    .max(9_999_999, '最小起订量过大')
    .optional(),
);

const productCategoryNodeIdField = z
  .string()
  .trim()
  .min(1, '请选择产品分类');

// 上级分类：空串 = 顶级。内部 ltree path 由服务端从上级分类派生 +
// 自动生成段名——面向业主的 UI 不暴露路径细节。
const productCategoryParentField = z
  .string()
  .trim()
  .max(64, '上级分类无效')
  .transform((v) => (v === '' ? null : v));

const productCategoryNameField = z
  .string()
  .trim()
  .min(1, '请填写分类名')
  .max(64, '分类名过长（最多 64 个字符）');

const productCategorySortOrderField = z.coerce
  .number({ message: '排序必须是数字' })
  .int('排序必须是整数')
  .min(1, '排序必须 ≥ 1（建议从 10 起，每 10 留一档）')
  .max(9999, '排序过大');

export const createProductCategoryNodeSchema = z.object({
  parentId: productCategoryParentField,
  name: productCategoryNameField,
  legacyCategory: z.nativeEnum(ProductCategory),
  sortOrder: productCategorySortOrderField,
});

export type CreateProductCategoryNodeInput = z.infer<
  typeof createProductCategoryNodeSchema
>;

// 编辑不允许改层级——移动子树会让子分类/产品挂错位置（现实现不级联
// 子节点 path）；只能改名/旧分类快照/排序。
export const updateProductCategoryNodeSchema = z.object({
  name: productCategoryNameField,
  legacyCategory: z.nativeEnum(ProductCategory),
  sortOrder: productCategorySortOrderField,
});

export type UpdateProductCategoryNodeInput = z.infer<
  typeof updateProductCategoryNodeSchema
>;

export const createProductSchema = z.object({
  code: productCodeField,
  categoryNodeId: productCategoryNodeIdField,
  name: productNameField,
  specification: productTextFieldOptional('规格', 64),
  paperType: productTextFieldOptional('纸张', 32),
  baseUnitPrice: moneyOptionalField,
  minOrderQty: minOrderQtyField,
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  code: productCodeField,
  categoryNodeId: productCategoryNodeIdField,
  name: productNameField,
  specification: productTextFieldOptional('规格', 64),
  paperType: productTextFieldOptional('纸张', 32),
  baseUnitPrice: moneyOptionalField,
  minOrderQty: minOrderQtyField,
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ============================================================
// Party master data: customers / suppliers
// ============================================================

const partyCodeField = z
  .string()
  .trim()
  .min(1, '请填写客户/供应商编码')
  .max(32, '编码过长（最多 32 个字符）')
  .regex(/^[A-Za-z0-9_-]+$/, '编码只能包含英文字母、数字、下划线、短横线');

const optionalPartyCodeField = z
  .preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.union([z.literal(''), partyCodeField]),
  )
  .transform((value) => (value === '' ? null : value));

const partyNameField = z
  .string()
  .trim()
  .min(1, '请填写客户/供应商名称')
  .max(128, '名称过长（最多 128 个字符）');

const partySchemaFields = {
  type: z.nativeEnum(PartyType),
  name: partyNameField,
  shortName: productTextFieldOptional('简称', 64),
  primaryContactName: productTextFieldOptional('默认联系人', 64),
  primaryContactPhone: productTextFieldOptional('默认联系电话', 32),
  primaryContactWechat: productTextFieldOptional('默认微信', 64),
  defaultReceiverName: productTextFieldOptional('默认收货人', 64),
  defaultReceiverPhone: productTextFieldOptional('默认收货电话', 32),
  defaultProvince: productTextFieldOptional('省份', 32),
  defaultCity: productTextFieldOptional('城市', 32),
  defaultDistrict: productTextFieldOptional('区县', 32),
  defaultAddressDetail: productTextFieldOptional('详细地址', 256),
} as const;

export const createPartySchema = z.object({
  ...partySchemaFields,
  code: optionalPartyCodeField,
});

export type CreatePartyInput = z.infer<typeof createPartySchema>;

export const updatePartySchema = z.object({
  ...partySchemaFields,
  code: partyCodeField,
});

export type UpdatePartyInput = z.infer<typeof updatePartySchema>;

// ============================================================
// Price dictionary (P1)
// ============================================================

const priceDictionaryIdField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `请选择${label}`)
    .max(64, `${label}格式非法`)
    .regex(/^[A-Za-z0-9_-]+$/, `${label}格式非法`);

const pricePositiveIntField = (label: string) =>
  z.preprocess(
    (v) => {
      if (typeof v === 'number') return v;
      if (typeof v !== 'string') return v;
      const trimmed = v.trim();
      if (trimmed === '') return undefined;
      if (!/^\d+$/.test(trimmed)) return null;
      return Number.parseInt(trimmed, 10);
    },
    z
      .number({ message: `${label}必须是正整数` })
      .finite(`${label}必须是有限数`)
      .int(`${label}必须是整数`)
      .min(1, `${label}必须 ≥ 1`)
      .max(9_999_999, `${label}过大`),
  );

const priceMoneyField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `请填写${label}`)
    .regex(/^\d{1,6}(\.\d{1,4})?$/, {
      message: `${label}格式错误（整数部分最多 6 位、小数最多 4 位、非负数）`,
    });

const priceDateField = (label: string) =>
  z.preprocess((v) => {
    if (v instanceof Date) return v;
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed === '') return undefined;
      return parseStrictYmd(trimmed) ?? 'invalid-date';
    }
    return 'invalid-date';
  }, z.date({ message: `请选择合法${label}（YYYY-MM-DD）` }));

const priceOptionalDateField = (label: string) =>
  z.preprocess((v) => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed === '') return null;
      return parseStrictYmd(trimmed) ?? 'invalid-date';
    }
    return 'invalid-date';
  }, z.date({ message: `${label}格式非法（YYYY-MM-DD）` }).nullable());

const triggerConditionJsonObjectField = z
  .string()
  .trim()
  .max(2000, '触发条件过长（最多 2000 个字符）')
  .transform((value, ctx): Record<string, unknown> | null => {
    if (value === '') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: '触发条件必须是合法 JSON' });
      return z.NEVER;
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      ctx.addIssue({ code: 'custom', message: '触发条件必须是 JSON object' });
      return z.NEVER;
    }
    return parsed as Record<string, unknown>;
  });

export const createPriceTierSchema = z
  .object({
    productId: priceDictionaryIdField('产品'),
    minQty: pricePositiveIntField('起订量'),
    unitPrice: priceMoneyField('单价'),
    effectiveFrom: priceDateField('有效起始日期'),
    effectiveTo: priceOptionalDateField('有效截止日期'),
  })
  .superRefine((data, ctx) => {
    if (data.effectiveTo && data.effectiveTo <= data.effectiveFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveTo'],
        message: '有效截止日期必须晚于有效起始日期',
      });
    }
  });

export type CreatePriceTierInput = z.infer<typeof createPriceTierSchema>;

export const updatePriceTierSchema = createPriceTierSchema;

export type UpdatePriceTierInput = z.infer<typeof updatePriceTierSchema>;

export const createPriceAdjustmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '请填写加价规则名称')
    .max(64, '加价规则名称过长（最多 64 个字符）'),
  adjustmentType: z.nativeEnum(AdjustmentType),
  amount: priceMoneyField('加价金额'),
  triggerCondition: triggerConditionJsonObjectField,
});

export type CreatePriceAdjustmentInput = z.infer<
  typeof createPriceAdjustmentSchema
>;

export const updatePriceAdjustmentSchema = createPriceAdjustmentSchema;

export type UpdatePriceAdjustmentInput = z.infer<
  typeof updatePriceAdjustmentSchema
>;

// ============================================================
// Material dictionary and stock transactions (SPEC §5 / P1)
// ============================================================

const materialCodeField = z
  .string()
  .trim()
  .min(1, '请填写物料编码')
  .max(32, '物料编码过长（最多 32 个字符）')
  .regex(/^[A-Za-z0-9_-]+$/, '物料编码只能包含英文字母、数字、下划线、短横线');

const optionalMaterialCodeField = z
  .preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.union([z.literal(''), materialCodeField]),
  )
  .transform((value) => (value === '' ? null : value));

const materialNameField = z
  .string()
  .trim()
  .min(1, '请填写物料名称')
  .max(64, '物料名称过长（最多 64 个字符）');

const materialUnitField = z
  .string()
  .trim()
  .min(1, '请填写单位')
  .max(16, '单位过长（最多 16 个字符）');

const decimalOptionalField = ({
  label,
  integerDigits,
  fractionDigits,
}: {
  label: string;
  integerDigits: number;
  fractionDigits: number;
}) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? '' : v),
    z
      .string()
      .trim()
      .refine(
        (v) =>
          v === '' ||
          new RegExp(`^\\d{1,${integerDigits}}(\\.\\d{1,${fractionDigits}})?$`).test(v),
        {
          message: `${label}格式错误（整数部分最多 ${integerDigits} 位、小数最多 ${fractionDigits} 位、非负数）`,
        },
      )
      .transform((v) => (v === '' ? null : v)),
  );

const decimalRequiredField = ({
  label,
  integerDigits,
  fractionDigits,
}: {
  label: string;
  integerDigits: number;
  fractionDigits: number;
}) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? '' : v),
    z
      .string()
      .trim()
      .regex(
        new RegExp(`^\\d{1,${integerDigits}}(\\.\\d{1,${fractionDigits}})?$`),
        `${label}格式错误（整数部分最多 ${integerDigits} 位、小数最多 ${fractionDigits} 位、非负数）`,
      )
      .refine((v) => Number(v) > 0, `${label}必须大于 0`),
  );

const materialDecimal12Optional = decimalOptionalField({
  label: '数量',
  integerDigits: 10,
  fractionDigits: 2,
});
const materialDecimal12Required = decimalRequiredField({
  label: '数量',
  integerDigits: 10,
  fractionDigits: 2,
});
const materialDecimal10Optional = decimalOptionalField({
  label: '金额',
  integerDigits: 6,
  fractionDigits: 4,
});

const materialSchemaFields = {
  name: materialNameField,
  category: z.nativeEnum(MaterialCategory),
  specification: productTextFieldOptional('规格', 64),
  unit: materialUnitField,
  safetyStock: materialDecimal12Optional,
  averageCost: materialDecimal10Optional,
} as const;

export const createMaterialSchema = z.object({
  ...materialSchemaFields,
  code: optionalMaterialCodeField,
});

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;

export const updateMaterialSchema = z.object({
  ...materialSchemaFields,
  code: materialCodeField,
});

export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;

export const materialStockTransactionSchema = z
  .object({
    materialId: z.string().trim().min(1, '物料 id 不能为空'),
    locationId: z
      .string()
      .trim()
      .max(64, '库位格式非法')
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    direction: z.enum(['IN', 'OUT']),
    quantity: materialDecimal12Required,
    // 采购收货、盘点和调拨都有专用单据，禁止从手工入口伪造这些原因。
    reasonType: z.enum(['PRODUCTION_USE', 'RETURN', 'OTHER'], {
      message: '请选择允许的手工出入库原因',
    }),
    unitCost: materialDecimal10Optional,
    remark: productTextFieldOptional('备注', 500),
  })
  .superRefine((value, context) => {
    if (value.direction === 'IN' && value.reasonType === 'PRODUCTION_USE') {
      context.addIssue({
        code: 'custom',
        path: ['reasonType'],
        message: '生产领用只能出库',
      });
    }
    if (value.direction === 'OUT' && value.reasonType === 'RETURN') {
      context.addIssue({
        code: 'custom',
        path: ['reasonType'],
        message: '退回入库只能入库',
      });
    }
  });

export type MaterialStockTransactionInput = z.infer<
  typeof materialStockTransactionSchema
>;

// ============================================================
// Warehouse / location dictionary (A18)
// ============================================================

const warehouseCodeField = z
  .string()
  .trim()
  .min(1, '请填写仓库编码')
  .max(32, '仓库编码过长（最多 32 个字符）')
  .regex(/^[A-Za-z0-9_-]+$/, '仓库编码只能包含英文字母、数字、下划线、短横线');

const optionalWarehouseCodeField = z
  .preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.union([z.literal(''), warehouseCodeField]),
  )
  .transform((value) => (value === '' ? null : value));

const warehouseLocationCodeField = z
  .string()
  .trim()
  .min(1, '请填写库位编码')
  .max(32, '库位编码过长（最多 32 个字符）')
  .regex(/^[A-Za-z0-9_-]+$/, '库位编码只能包含英文字母、数字、下划线、短横线');

const optionalWarehouseLocationCodeField = z
  .preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.union([z.literal(''), warehouseLocationCodeField]),
  )
  .transform((value) => (value === '' ? null : value));

const warehouseNameField = z
  .string()
  .trim()
  .min(1, '请填写名称')
  .max(64, '名称过长（最多 64 个字符）');

export const createWarehouseSchema = z.object({
  code: optionalWarehouseCodeField,
  name: warehouseNameField,
});

export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const createWarehouseLocationSchema = z.object({
  warehouseId: z
    .string()
    .trim()
    .min(1, '请选择仓库')
    .max(64, '仓库格式非法')
    .regex(/^[A-Za-z0-9_-]+$/, '仓库格式非法'),
  code: optionalWarehouseLocationCodeField,
  name: warehouseNameField,
});

export type CreateWarehouseLocationInput = z.infer<
  typeof createWarehouseLocationSchema
>;

const warehouseQuantityField = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, '数量格式错误（非负数，最多 2 位小数）');

const warehouseEntityIdField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `请选择${label}`)
    .max(64, `${label}格式非法`)
    .regex(/^[A-Za-z0-9_-]+$/, `${label}格式非法`);

export const createStockTransferSchema = z.object({
  idempotencyKey: z.string().uuid('调拨请求标识格式非法'),
  materialId: warehouseEntityIdField('物料'),
  sourceLocationId: warehouseEntityIdField('来源库位'),
  destinationLocationId: warehouseEntityIdField('目标库位'),
  quantity: warehouseQuantityField.refine((value) => Number(value) > 0, {
    message: '调拨数量必须大于 0',
  }),
  remark: productTextFieldOptional('备注', 500),
});

export type CreateStockTransferInput = z.infer<
  typeof createStockTransferSchema
>;

export const postInventoryCountSchema = z.object({
  idempotencyKey: z.string().uuid('盘点请求标识格式非法'),
  remark: productTextFieldOptional('备注', 500),
  items: z
    .array(
      z.object({
        materialId: warehouseEntityIdField('物料'),
        locationId: warehouseEntityIdField('库位'),
        countedQuantity: warehouseQuantityField,
      }),
    )
    .min(1, '请至少录入一个实盘数')
    .max(100, '单次盘点最多提交 100 个库位物料'),
});

export type PostInventoryCountInput = z.infer<
  typeof postInventoryCountSchema
>;

// ============================================================
// BOM / material usage planning (A19)
// ============================================================

const bomIdField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `请选择${label}`)
    .max(64, `${label}格式非法`)
    .regex(/^[A-Za-z0-9_-]+$/, `${label}格式非法`);

const optionalBomIdField = (label: string) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? '' : v),
    z
      .string()
      .trim()
      .max(64, `${label}格式非法`)
      .refine((v) => v === '' || /^[A-Za-z0-9_-]+$/.test(v), {
        message: `${label}格式非法`,
      })
      .transform((v) => (v === '' ? null : v)),
  );

const bomPositiveIntField = (label: string) =>
  z.preprocess(
    (v) => {
      if (typeof v === 'number') return v;
      if (typeof v !== 'string') return v;
      const trimmed = v.trim();
      if (trimmed === '') return undefined;
      if (!/^\d+$/.test(trimmed)) return null;
      return Number.parseInt(trimmed, 10);
    },
    z
      .number({ message: `${label}必须是正整数` })
      .finite(`${label}必须是有限数`)
      .int(`${label}必须是整数`)
      .min(1, `${label}必须 ≥ 1`)
      .max(999_999, `${label}过大`),
  );

const bomMaterialQuantityField = decimalRequiredField({
  label: 'BOM 用量',
  integerDigits: 8,
  fractionDigits: 4,
});

export const createBomSchema = z
  .object({
    targetType: z.enum(['PRODUCT', 'CATEGORY']),
    productId: optionalBomIdField('产品'),
    categoryNodeId: optionalBomIdField('产品分类'),
    name: z
      .string()
      .trim()
      .min(1, '请填写 BOM 名称')
      .max(64, 'BOM 名称过长（最多 64 个字符）'),
    version: bomPositiveIntField('版本号'),
    baseQuantity: bomPositiveIntField('基准产量'),
    items: z
      .array(
        z.object({
          materialId: bomIdField('物料'),
          quantity: bomMaterialQuantityField,
          remark: productTextFieldOptional('备注', 200),
        }),
      )
      .min(1, '至少添加 1 行物料')
      .max(20, 'BOM 物料行最多 20 行'),
  })
  .superRefine((data, ctx) => {
    if (data.targetType === 'PRODUCT' && !data.productId) {
      ctx.addIssue({
        code: 'custom',
        path: ['productId'],
        message: '请选择产品',
      });
    }
    if (data.targetType === 'CATEGORY' && !data.categoryNodeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['categoryNodeId'],
        message: '请选择产品分类',
      });
    }
    const seen = new Set<string>();
    data.items.forEach((item, index) => {
      if (seen.has(item.materialId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'materialId'],
          message: '同一个 BOM 中物料不能重复',
        });
      }
      seen.add(item.materialId);
    });
  });

export type CreateBomInput = z.infer<typeof createBomSchema>;

// ============================================================
// Purchase orders / receipts (A17)
// ============================================================

const purchaseIdField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `请选择${label}`)
    .max(64, `${label}格式非法`)
    .regex(/^[A-Za-z0-9_-]+$/, `${label}格式非法`);

const optionalPurchaseIdField = (label: string) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? '' : v),
    z
      .string()
      .trim()
      .max(64, `${label}格式非法`)
      .refine((v) => v === '' || /^[A-Za-z0-9_-]+$/.test(v), {
        message: `${label}格式非法`,
      })
      .transform((v) => (v === '' ? null : v)),
  );

const purchaseDateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .or(z.literal('').transform(() => null));

export const createPurchaseOrderSchema = z.object({
  supplierPartyId: purchaseIdField('供应商'),
  materialId: purchaseIdField('物料'),
  quantity: materialDecimal12Required,
  unitCost: materialDecimal10Optional,
  expectedDate: purchaseDateField,
  remark: productTextFieldOptional('备注', 500),
});

export type CreatePurchaseOrderInput = z.infer<
  typeof createPurchaseOrderSchema
>;

export const createPurchaseReceiptSchema = z.object({
  idempotencyKey: z.string().uuid('入库请求标识格式非法'),
  purchaseOrderItemId: purchaseIdField('采购明细'),
  locationId: optionalPurchaseIdField('库位'),
  quantity: materialDecimal12Required,
  unitCost: materialDecimal10Optional,
  remark: productTextFieldOptional('备注', 500),
});

export type CreatePurchaseReceiptInput = z.infer<
  typeof createPurchaseReceiptSchema
>;

export const cancelPurchaseReceiptSchema = z.object({
  reason: productTextFieldOptional('取消原因', 500),
});

export type CancelPurchaseReceiptInput = z.infer<
  typeof cancelPurchaseReceiptSchema
>;

// ============================================================
// Order creation (SPEC §3.1 / §4.1)
// ============================================================

const optionalTrimmedText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label}过长（最多 ${max} 个字符）`)
    .transform((v) => (v === '' ? null : v))
    .nullable();

// Per-item quantity: integer ≥ 1, capped at the same 9,999,999 ceiling as
// minOrderQty. Reject JS-ish numeric forms on the string path (see
// minOrderQtyField for rationale).
const orderItemQuantityField = z.preprocess(
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

const craftIdSchema = z
  .string()
  .trim()
  .min(1, '工艺 id 不能为空')
  .max(32, '工艺 id 过长');

const orderItemSchema = z.object({
  name: z.string().trim().min(1, '请填写款式名').max(64, '款式名过长（最多 64 个字符）'),
  productId: optionalTrimmedText('产品 id', 32),
  specification: optionalTrimmedText('规格', 64),
  paperType: optionalTrimmedText('纸张', 32),
  quantity: orderItemQuantityField,
  crafts: z
    .array(craftIdSchema)
    .min(1, '至少选择一项工艺')
    .max(10, '单款式工艺不超过 10 项'),
  foilColor: optionalTrimmedText('烫金颜色', 32),
  isDoubleSided: formBoolean,
  isDoubleColor: formBoolean,
  unitPrice: moneyOptionalField,
  suggestedPrice: moneyOptionalField,
  remark: optionalTrimmedText('款式备注', 1000),
});

export type OrderItemInput = z.infer<typeof orderItemSchema>;

// 严格 YYYY-MM-DD → Date（parseStrictYmd 拒绝 2024-02-31 这类滚动日期；
// 函数声明有提升，此处提前引用安全）。空串/缺失 → null。
const optionalDateField = z.preprocess((v) => {
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
const optionalDateFieldPartial = z.preprocess((v) => {
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

export const createOrderSchema = z.object({
  customerPartyId: optionalTrimmedText('客户主数据', 64).optional(),
  customerRef: optionalTrimmedText('客户代号', 64),
  receiverName: optionalTrimmedText('收货人', 64),
  receiverPhone: optionalTrimmedText('收货电话', 32),
  receiverAddress: optionalTrimmedText('收货地址', 256),
  expressCode: optionalTrimmedText('快递代码', 32),
  packageRequirement: optionalTrimmedText('包装要求', 500),
  remark: optionalTrimmedText('工单备注', 1000),
  promisedDate: optionalDateField,
  isUrgent: formBoolean,
  items: z
    .array(orderItemSchema)
    .min(1, '至少一个款式')
    .max(50, '单工单款式不超过 50 项'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const cancelOrderSchema = z.object({
  reason: optionalTrimmedText('取消原因', 500),
});

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// 标记发货：trackingNo 选填（运单号）。Order.trackingNo 是 nullable
// text，用同一 optional-trimmed 收尾的 helper。
export const shipOrderSchema = z.object({
  trackingNo: optionalTrimmedText('运单号', 64),
});

export type ShipOrderInput = z.infer<typeof shipOrderSchema>;

// ─────────────────────────────────────────────────────────────────────
// Order edit (SPEC §3.6 — top-level fields only, E-lean scope)
// ─────────────────────────────────────────────────────────────────────
//
// E-full (item add/remove/edit) is deferred to P1. These schemas cover
// the top-level Order fields; the action layer picks the FULL or
// SHIPPING_ONLY shape based on the order's current status and rejects
// anything outside the allowed set before reaching the lib.

// Partial-update shape: every field is independently optional so the
// action can submit only what the form actually touched. Missing key
// → don't change; empty string → clear to null; present value → update.
// optionalFormBoolean already handles the undefined case for isUrgent.
export const updateEditableOrderSchema = z.object({
  customerRef: optionalTrimmedText('客户代号', 64).optional(),
  receiverName: optionalTrimmedText('收货人', 64).optional(),
  receiverPhone: optionalTrimmedText('收货电话', 32).optional(),
  receiverAddress: optionalTrimmedText('收货地址', 256).optional(),
  expressCode: optionalTrimmedText('快递代码', 32).optional(),
  packageRequirement: optionalTrimmedText('包装要求', 500).optional(),
  remark: optionalTrimmedText('工单备注', 1000).optional(),
  promisedDate: optionalDateFieldPartial,
  isUrgent: optionalFormBoolean,
});

export type UpdateEditableOrderInput = z.infer<typeof updateEditableOrderSchema>;

export const updateShippingOrderSchema = z.object({
  receiverName: optionalTrimmedText('收货人', 64),
  receiverPhone: optionalTrimmedText('收货电话', 32),
  receiverAddress: optionalTrimmedText('收货地址', 256),
  expressCode: optionalTrimmedText('快递代码', 32),
  packageRequirement: optionalTrimmedText('包装要求', 500),
  remark: optionalTrimmedText('工单备注', 1000),
});

export type UpdateShippingOrderInput = z.infer<typeof updateShippingOrderSchema>;

// Lightweight schema for the inline 急单 toggle — keeps that quick
// one-click UX separate from the main edit form so a failed form
// validation doesn't block a simple urgent-flag flip.
// Toggle is a one-click action — the value IS the intent, so require
// it explicitly instead of defaulting.
export const setOrderUrgentSchema = z.object({
  isUrgent: formBoolean,
});

export type SetOrderUrgentInput = z.infer<typeof setOrderUrgentSchema>;

// ─────────────────────────────────────────────────────────────────────
// Production scheduling (SPEC §3.2 / §4.3)
// ─────────────────────────────────────────────────────────────────────

// ID allowlist kept in sync with lib/oss/sign.ts — cuid / cuid2 only,
// no path-sensitive characters. A caller sending garbage here is a bug
// or attack, not a user typo.
const scheduleIdRe = /^[A-Za-z0-9_-]+$/;
const safeId = (label: string) =>
  z.string().trim().regex(scheduleIdRe, `${label}格式非法`);

const scheduleAssignmentSchema = z.object({
  orderItemId: safeId('款式 id'),
  craftId: safeId('工艺 id'),
  workerId: safeId('师傅 id'),
});

export const scheduleOrderSchema = z.object({
  orderId: safeId('工单 id'),
  assignments: z
    .array(scheduleAssignmentSchema)
    // An "all-outsource" order has zero expected assignments. Allow
    // the empty array so scheduleOrder can still transition Order to
    // SCHEDULING (lib enforces the real invariant: every expected
    // non-outsource pair must be covered).
    .max(200, '单次排产不超过 200 个任务'),
});

export type ScheduleOrderInput = z.infer<typeof scheduleOrderSchema>;

// ─────────────────────────────────────────────────────────────────────
// Worker task report (SPEC §3.3)
// ─────────────────────────────────────────────────────────────────────

// Shared coercion for the three count fields. Accepts either a number
// (programmatic caller) or the string that FormData hands us; null /
// empty / blank string → 0 so a worker who doesn't have any rework
// pieces can leave the field blank.
const taskCountField = (label: string) =>
  z.preprocess(
    (v) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed === '') return 0;
        // Reject decimals, signs, scientific notation — counts are
        // non-negative integers.
        if (!/^\d+$/.test(trimmed)) return Number.NaN;
        const n = Number.parseInt(trimmed, 10);
        return Number.isSafeInteger(n) ? n : Number.NaN;
      }
      if (v === null || v === undefined) return 0;
      return Number.NaN;
    },
    z
      .number()
      .int(`${label}必须是整数`)
      .min(0, `${label}不能为负`)
      .max(10_000_000, `${label}超出合理范围`),
  );

export const reportTaskSchema = z
  .object({
    completedQty: taskCountField('合格数'),
    defectQty: taskCountField('不良数'),
    reworkQty: taskCountField('返工数'),
  })
  .refine(
    (v) => v.completedQty + v.defectQty + v.reworkQty > 0,
    {
      message: '至少报一件（合格 / 不良 / 返工 三者之和 > 0）',
      path: ['completedQty'],
    },
  );

export type ReportTaskInput = z.infer<typeof reportTaskSchema>;

// ─────────────────────────────────────────────────────────────────────
// Outsource order (SPEC §3.2, 外协)
// ─────────────────────────────────────────────────────────────────────

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

export const createOutsourceSchema = z.object({
  orderId: safeId('工单 id'),
  orderItemIds: z
    .array(safeId('款式 id'))
    .min(1, '至少选择一个款式')
    .max(50, '单次外协不超过 50 个款式'),
  supplierName: z
    .string()
    .trim()
    .min(1, '请填写外协厂名')
    .max(64, '外协厂名过长（最多 64 个字符）'),
  supplierContact: optionalTrimmedText('联系方式', 64),
  craftDescription: optionalTrimmedText('工艺说明', 500),
  specialRequirement: optionalTrimmedText('特殊要求', 500),
  totalQty: optionalIntField('总数量', 10_000_000),
  expectedDate: optionalDateField,
  amount: moneyField,
  remark: optionalTrimmedText('备注', 500),
});

export type CreateOutsourceInput = z.infer<typeof createOutsourceSchema>;

export const markOutsourceReceivedSchema = z.object({
  actualDate: optionalDateField,
});

export type MarkOutsourceReceivedInput = z.infer<typeof markOutsourceReceivedSchema>;

// ─────────────────────────────────────────────────────────────────────
// Salary actions (SPEC §5)
// ─────────────────────────────────────────────────────────────────────

// The recompute-daily endpoint takes a date and optionally a single
// workerId (for "recompute just this row" from the UI). Strict calendar
// validation — refuses 2026-02-31 and the like .
export const recomputeDailySalarySchema = z.object({
  date: z
    .string()
    .trim()
    .superRefine((val, ctx) => {
      if (!YMD_RE.test(val)) {
        ctx.addIssue({
          code: 'custom',
          message: '日期格式非法（应为 YYYY-MM-DD）',
        });
        return;
      }
      if (!parseStrictYmd(val)) {
        ctx.addIssue({
          code: 'custom',
          message: '日期不是合法日历日期',
        });
      }
    }),
  workerId: safeId('师傅 id').optional(),
});

export type RecomputeDailySalaryInput = z.infer<typeof recomputeDailySalarySchema>;

export const markDailySalaryPaidSchema = z.object({
  isPaid: formBoolean,
});

export type MarkDailySalaryPaidInput = z.infer<typeof markDailySalaryPaidSchema>;

// Reusable strict-calendar YYYY-MM-DD field (covers rule-key resolution
// + calendar validity in one helper, like recomputeDailySalarySchema).
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

const nonNegativeDecimal = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '') return undefined;
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(t)) return Number.NaN;
      return t;
    }
    return Number.NaN;
  },
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) =>
      v === undefined || v === '' ? undefined : String(v),
    ),
);

export const startCsPeriodSchema = z.object({
  csUserId: safeId('客服 id'),
  periodStart: ymdField('周期起始日期'),
  durationMonths: z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === '') return undefined;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t === '') return undefined;
        if (!/^\d+$/.test(t)) return Number.NaN;
        return Number.parseInt(t, 10);
      }
      return Number.NaN;
    },
    z.number().int('周期月数必须是整数').min(1, '周期月数必须 ≥ 1').max(24, '周期月数超出合理范围').optional(),
  ),
  initialSales: nonNegativeDecimal,
  monthlyBase: nonNegativeDecimal,
});

export type StartCsPeriodInput = z.infer<typeof startCsPeriodSchema>;

export const markCsCommissionPaidSchema = z.object({
  isPaid: formBoolean,
});

export type MarkCsCommissionPaidInput = z.infer<typeof markCsCommissionPaidSchema>;

// ─────────────────────────────────────────────────────────────────────
// 时薪工考勤 + 月结 (P0 #5 Slice C)
// ─────────────────────────────────────────────────────────────────────

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

export const recordAttendanceSchema = z.object({
  workerId: safeId('工人 id'),
  date: ymdField('考勤日期'),
  normalHours: hoursField('正常工时'),
  otHours: hoursField('加班工时'),
  spareHours: hoursField('空闲打包工时'),
  remark: optionalTrimmedText('备注', 200).optional(),
});

export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;

export const removeAttendanceSchema = z.object({
  workerId: safeId('工人 id'),
  date: ymdField('考勤日期'),
});

export type RemoveAttendanceInput = z.infer<typeof removeAttendanceSchema>;

// YYYY-MM — same strict-regex-with-calendar-check pattern as ymdField.
const ymField = (label: string) =>
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

export const recomputeHourlyPayrollSchema = z.object({
  month: ymField('月份'),
  workerId: safeId('工人 id').optional(),
});

export type RecomputeHourlyPayrollInput = z.infer<typeof recomputeHourlyPayrollSchema>;

export const markHourlyPayrollPaidSchema = z.object({
  isPaid: formBoolean,
});

export type MarkHourlyPayrollPaidInput = z.infer<typeof markHourlyPayrollPaidSchema>;

// ─────────────────────────────────────────────────────────────────────
// 销售应收账单 (P0 #6 Slice A)
// ─────────────────────────────────────────────────────────────────────

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
  amount: billPaymentField,
});

export type RecordBillPaymentInput = z.infer<typeof recordBillPaymentSchema>;

// ============================================================
// 推送配置（SPEC §8 / P1 #2）
// ============================================================

const channelNameField = z
  .string()
  .trim()
  .min(1, '请填写群名（如 排产群）')
  .max(64, '群名过长（最多 64 个字符）');

// 企业微信 webhook URL 的官方格式：
//   https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<uuid>
// 严格 origin 检查：避免老板把任意 URL 粘进来踩 SSRF / 误投递。
// HTTPS 强制——HTTP 在 prod 会被 reject 但本地 mock URL 也走 https://...
// 所以不放宽。query 参数允许任意（key、可能的扩展字段）。
const channelWebhookUrlField = z
  .string()
  .trim()
  .min(1, '请填写企业微信 Webhook URL')
  .max(512, 'Webhook URL 过长')
  .refine(
    (v) => /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?/.test(v),
    'Webhook URL 必须形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...',
  );

export const createNotificationChannelSchema = z.object({
  channelKey: z
    .string()
    .trim()
    .min(1, '请填写 channelKey（英文小写 / 下划线，例：scheduling_group）')
    .max(64, 'channelKey 过长')
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'channelKey 必须以小写字母开头，仅允许小写字母 / 数字 / 下划线',
    ),
  channelName: channelNameField,
  webhookUrl: channelWebhookUrlField,
  isActive: formBoolean,
});

export type CreateNotificationChannelInput = z.infer<
  typeof createNotificationChannelSchema
>;

// 编辑场景下不让 owner 改 channelKey（key 是稳定标识，被 audit log
// 引用；改 key 等同于&ldquo;新建+删除&rdquo;）—— UI 把 key 渲染成只读。
export const updateNotificationChannelSchema = z.object({
  channelName: channelNameField,
  webhookUrl: channelWebhookUrlField,
  isActive: formBoolean,
});

export type UpdateNotificationChannelInput = z.infer<
  typeof updateNotificationChannelSchema
>;

// rule 编辑：eventType 由 URL path 提供且固定 enum，不在 schema 里；
// owner 只能改 messageTemplate / channelIds / isActive。
export const updateNotificationRuleSchema = z.object({
  messageTemplate: z
    .string()
    .trim()
    .min(1, '请填写消息模板')
    .max(4000, '模板过长（企业微信单条 markdown 上限 4096 字节，留余量）'),
  // FormData 里多选 checkbox 走 getAll('channelIds'); 这里接 string[]。
  // 允许空数组——但 isActive=true && empty 在 server action 里业务校验
  // 拒绝（schema 不能跨字段拒，留给 action 层）。
  channelIds: z.array(z.string().min(1)).default([]),
  isActive: formBoolean,
});

export type UpdateNotificationRuleInput = z.infer<
  typeof updateNotificationRuleSchema
>;
