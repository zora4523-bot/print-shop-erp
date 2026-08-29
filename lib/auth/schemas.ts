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
  ReworkCause,
  Role,
  WorkerType,
  MachineType,
  OrderCostCategory,
  EmploymentType,
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
} from '../../generated/prisma/enums';
import {
  MAX_ORDER_ITEM_FOIL_COLORS,
  NO_FOIL_COLOR,
} from '../order/foil-colors';
import { MAX_ORDER_ITEMS_PER_ORDER } from '../order/limits';
import { MAX_ORDER_ITEM_PRINT_COLORS } from '../order/print-colors';
import {
  MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE,
  isNewOrderPricingRoute,
  resolveOrderItemFoilSides,
} from '../order/pricing-route';
import { calculatePackagingBagCount } from '../order/packaging-bag-count';
import { validatePriceAdjustmentTriggerCondition } from '../price/adjustment-condition';

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
// Administrator-side account management (SPEC §2 + §9.1)
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
  data: {
    role: Role;
    workerType?: WorkerType | null;
    machineType?: MachineType | null;
  },
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

const employmentTypeField = z.preprocess(
  (value) =>
    value === null || value === undefined || value === ''
      ? null
      : value,
  z.nativeEnum(EmploymentType).nullable(),
);

const employmentDateField = (label: string) =>
  z.preprocess(
    (value) =>
      value === null || value === undefined || value === '' ? null : value,
    z
      .union([z.null(), z.string()])
      .refine(
        (value) => value === null || parseStrictYmd(value) !== null,
        `${label}不是合法日期`,
      )
      .transform((value) => (value === null ? null : parseStrictYmd(value))),
  );

function enforceEmployment(
  data: {
    role: Role;
    employmentType?: EmploymentType | null;
    employmentStartDate?: Date | null;
    employmentEndDate?: Date | null;
  },
  ctx: z.RefinementCtx,
) {
  const isInternalEmployee =
    data.role === Role.CUSTOMER_SERVICE || data.role === Role.WORKER;
  if (isInternalEmployee && !data.employmentType) {
    ctx.addIssue({
      code: 'custom',
      path: ['employmentType'],
      message: '请设置员工用工类型',
    });
  }
  if (
    !isInternalEmployee &&
    (data.employmentType ||
      data.employmentStartDate ||
      data.employmentEndDate)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['employmentType'],
      message: '外部销售和管理员不参与员工工资，不应设置用工信息',
    });
  }
  if (
    data.employmentStartDate &&
    data.employmentEndDate &&
    data.employmentEndDate < data.employmentStartDate
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['employmentEndDate'],
      message: '离职日期不能早于入职日期',
    });
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
    employmentType: employmentTypeField,
    employmentStartDate: employmentDateField('入职日期'),
    employmentEndDate: employmentDateField('离职日期'),
  })
  .superRefine(enforceWorkerCascade)
  .superRefine(enforceEmployment);

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

// Omitted legacy facts stay unknown instead of being silently converted to
// an explicit "no". New browser forms submit a real boolean for this field.
const nullableFormBoolean = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === 'on';
  return v;
}, z.boolean().nullable());

const requiredFormBoolean = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'on') return true;
  if (v === 'false') return false;
  return v;
}, z.boolean({ message: '请明确选择是或否' }));

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
    employmentType: employmentTypeField,
    employmentStartDate: employmentDateField('入职日期'),
    employmentEndDate: employmentDateField('离职日期'),
  })
  .superRefine(enforceWorkerCascade)
  .superRefine(enforceEmployment);

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
  sortOrder: sortOrderField,
});

export type CreateCraftInput = z.infer<typeof createCraftSchema>;

export const updateCraftSchema = z.object({
  name: craftNameField,
  isOutsource: formBoolean,
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

// OrderItem.fixedFee / suggestedSubtotal are Decimal(12,2), unlike unitPrice
// (Decimal(10,4)). Reject extra fractional digits at the application boundary
// instead of letting PostgreSQL round the stored fixed fee independently from
// the already-computed subtotal.
const orderItemMoneyOptionalField = z.preprocess(
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
  legacyCategory: z.nativeEnum(ProductCategory, {
    error: '请选择有效的产品分类',
  }),
  sortOrder: productCategorySortOrderField,
});

export type CreateProductCategoryNodeInput = z.infer<
  typeof createProductCategoryNodeSchema
>;

// 编辑不允许改层级——移动子树会让子分类/产品挂错位置（现实现不级联
// 子节点 path）；只能改名/旧分类快照/排序。
export const updateProductCategoryNodeSchema = z.object({
  name: productCategoryNameField,
  legacyCategory: z.nativeEnum(ProductCategory, {
    error: '请选择有效的产品分类',
  }),
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
      return (
        parseStrictShanghaiDateTimeLocal(`${trimmed}T00:00`) ?? 'invalid-date'
      );
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
      return (
        parseStrictShanghaiDateTimeLocal(`${trimmed}T00:00`) ?? 'invalid-date'
      );
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

export const createPriceAdjustmentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, '请填写加价规则名称')
      .max(64, '加价规则名称过长（最多 64 个字符）'),
    adjustmentType: z.nativeEnum(AdjustmentType, {
      error: '请选择有效的加价类型',
    }),
    amount: priceMoneyField('加价金额'),
    triggerCondition: triggerConditionJsonObjectField,
  })
  .superRefine((data, ctx) => {
    for (const message of validatePriceAdjustmentTriggerCondition(
      data.triggerCondition,
      data.adjustmentType,
    )) {
      ctx.addIssue({
        code: 'custom',
        path: ['triggerCondition'],
        message,
      });
    }
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
  category: z.nativeEnum(MaterialCategory, {
    error: '请选择有效的物料分类',
  }),
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

// 盘点回传的「账面回声」：录入这一格时页面上显示的账面数。
// 单独定义而不是复用 warehouseQuantityField，是为了给**缺字段**一条中文消息——
// getFormString 缺键返回 undefined、JSON 里少这个键也是 undefined，zod v4 会走
// invalid_type 分支，.regex() 的自定义消息根本不触发，默认文案是英文的
// "Invalid input: expected string, received undefined"。
// 库位余额恒非负（写入口有 lt(0) 兜底），所以正则和 warehouseQuantityField 同款。
const inventoryBookQuantityField = z
  .string({ error: '缺少账面数快照，请刷新页面后重新盘点' })
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, '账面数快照格式非法，请刷新页面后重新盘点');

const inventoryCountReasonField = z
  .string({ error: '请填写盘点过账原因' })
  .trim()
  .min(1, '请填写盘点过账原因')
  .max(500, '盘点过账原因过长（最多 500 个字符）');

export const postInventoryCountSchema = z.object({
  idempotencyKey: z.string().uuid('盘点请求标识格式非法'),
  // 盘点会直接改写库存余额；原因随盘点单持久化，作为 L3 操作审计说明。
  remark: inventoryCountReasonField,
  items: z
    .array(
      z.object({
        materialId: warehouseEntityIdField('物料'),
        locationId: warehouseEntityIdField('库位'),
        // 必填而不是可选：漏传必须当场失败，让操作员刷新页面重新盘点，而不是
        // 静默退回「提交那一刻才读账面数」的旧行为。部署窗口里还开着旧页面的
        // 浏览器会命中这一条——这是刻意的 fail closed。
        bookQuantity: inventoryBookQuantityField,
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
  reason: z
    .string()
    .trim()
    .min(1, '请填写取消原因')
    .max(500, '取消原因过长（最多 500 个字符）'),
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

const requiredTrimmedText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `请填写${label}`)
    .max(max, `${label}过长（最多 ${max} 个字符）`);

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

const orderItemFoilColorsArray = (maximum: number, message: string) => z
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

const orderItemFoilColorsField = orderItemFoilColorsArray(
  MAX_ORDER_ITEM_FOIL_COLORS,
  `单款式烫金颜色不超过 ${MAX_ORDER_ITEM_FOIL_COLORS} 种`,
);

// A new command can carry three explicit colors per side. The retired
// aggregate may therefore contain six distinct colors, but only when the side
// arrays prove that split; validateOrderItemPricingFacts keeps a legacy
// aggregate without side evidence at the historical five-color ceiling.
const orderItemFoilColorsWithExplicitSidesField = orderItemFoilColorsArray(
  MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE * 2,
  `正反面烫金颜色合计不超过 ${MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE * 2} 种`,
);

const orderItemFoilSideColorsField = z
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

const orderItemBaseSchema = z.object({
  fig: z
    .number({ message: '款式编号必须是正整数' })
    .int('款式编号必须是整数')
    .min(1, '款式编号必须大于 0')
    .max(999_999, '款式编号过大')
    .optional(),
  name: z.string().trim().min(1, '请填写款式名').max(64, '款式名过长（最多 64 个字符）'),
  productId: optionalTrimmedText('产品 id', 32),
  pricingRoute: z.enum(OrderItemPricingRoute),
  productStructure: z
    .enum(OrderProductStructure)
    .default(OrderProductStructure.UNSPECIFIED),
  artworkVersion: optionalTrimmedText('稿件版本', 64).default(null),
  plateGroupId: optionalTrimmedText('版组/模具组', 64).default(null),
  pricingGroup: optionalTrimmedText('专版计价组', 64).default(null),
  manualQuoteReason: optionalTrimmedText('人工报价原因', 500).default(null),
  specification: optionalTrimmedText('规格', 64),
  actualWidthMm: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z
      .number({ message: '实际宽度必须是数字' })
      .finite('实际宽度必须是有限数')
      .positive('实际宽度必须大于 0')
      .max(999_999.99, '实际宽度过大')
      .nullable(),
  ),
  actualHeightMm: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z
      .number({ message: '实际高度必须是数字' })
      .finite('实际高度必须是有限数')
      .positive('实际高度必须大于 0')
      .max(999_999.99, '实际高度过大')
      .nullable(),
  ),
  paperType: optionalTrimmedText('纸张', 32),
  paperWeightGsm: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z
      .number({ message: '纸张克重必须是数字' })
      .int('纸张克重必须是整数')
      .min(1, '纸张克重必须大于 0')
      .max(2_000, '纸张克重不能超过 2000g')
      .nullable(),
  ),
  quantity: orderItemQuantityField,
  pack: z.preprocess(
    (value) => (value === '' || value === undefined ? null : value),
    z
      .number({ message: '每包数量必须是数字' })
      .int('每包数量必须是整数')
      .min(1, '每包数量必须大于 0')
      .max(9_999_999, '每包数量过大')
      .nullable(),
  ).optional(),
  crafts: z
    .array(craftIdSchema)
    .max(10, '单款式工艺不超过 10 项'),
  frontFoilColors: orderItemFoilSideColorsField.default([]),
  backFoilColors: orderItemFoilSideColorsField.default([]),
  // Retired aggregate facts remain accepted for old clients. The domain
  // write path always derives them from the two side arrays for new rows.
  foilColors: orderItemFoilColorsWithExplicitSidesField.default([]),
  foilTechnique: z
    .enum(OrderFoilTechnique)
    .default(OrderFoilTechnique.UNSPECIFIED),
  hasLocalFoil: nullableFormBoolean,
  lamination: z.enum(OrderLamination).default(OrderLamination.NONE),
  printColors: z
    .array(
      z
        .string()
        .trim()
        .min(1, '彩印颜色不能为空')
        .max(32, '彩印颜色过长（最多 32 个字符）'),
    )
    .max(
      MAX_ORDER_ITEM_PRINT_COLORS,
      `单款式彩印颜色不超过 ${MAX_ORDER_ITEM_PRINT_COLORS} 种`,
    )
    .default([])
    .superRefine((colors, ctx) => {
      if (new Set(colors).size !== colors.length) {
        ctx.addIssue({ code: 'custom', message: '彩印颜色不能重复' });
      }
    }),
  isDoubleSided: formBoolean,
  isDoubleColor: formBoolean,
  unitPrice: moneyOptionalField,
  fixedFee: orderItemMoneyOptionalField.optional(),
  suggestedSubtotal: orderItemMoneyOptionalField,
  priceOverrideReason: optionalTrimmedText('人工改价说明', 200).optional(),
  remark: optionalTrimmedText('款式备注', 1000),
});

type OrderItemPricingFactsForValidation = Pick<
  z.infer<typeof orderItemBaseSchema>,
  | 'productId'
  | 'pricingRoute'
  | 'paperType'
  | 'crafts'
  | 'actualWidthMm'
  | 'actualHeightMm'
  | 'frontFoilColors'
  | 'backFoilColors'
  | 'foilColors'
  | 'foilTechnique'
  | 'hasLocalFoil'
  | 'lamination'
  | 'printColors'
  | 'isDoubleSided'
> & {
  manualQuoteReason?: string | null;
};

function validateOrderItemPricingFacts(
  item: OrderItemPricingFactsForValidation,
  ctx: z.RefinementCtx,
): void {
  if (!isNewOrderPricingRoute(item.pricingRoute)) {
    ctx.addIssue({
      code: 'custom',
      path: ['pricingRoute'],
      message: '新建工单必须从三条计价路线中选择一条',
    });
    return;
  }

  if ((item.actualWidthMm === null) !== (item.actualHeightMm === null)) {
    ctx.addIssue({
      code: 'custom',
      path: item.actualWidthMm === null ? ['actualWidthMm'] : ['actualHeightMm'],
      message: '实际宽度和高度必须同时填写',
    });
  }

  const manualPricingRequested = Boolean(item.manualQuoteReason?.trim());
  if (!item.productId && !manualPricingRequested) {
    ctx.addIssue({
      code: 'custom',
      path: ['productId'],
      message: '自动计价路线必须选择精确的建单产品',
    });
  }
  if (!item.paperType && !manualPricingRequested) {
    ctx.addIssue({
      code: 'custom',
      path: ['paperType'],
      message: '请选择标准纸张或填写自定义纸张',
    });
  }
  if (item.crafts.length === 0 && !manualPricingRequested) {
    ctx.addIssue({
      code: 'custom',
      path: ['crafts'],
      message: '至少选择一项工艺',
    });
  }

  if (
    item.foilColors.length > MAX_ORDER_ITEM_FOIL_COLORS &&
    item.frontFoilColors.length === 0 &&
    item.backFoilColors.length === 0
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['foilColors'],
      message: `未按正反面填写时，烫金颜色不超过 ${MAX_ORDER_ITEM_FOIL_COLORS} 种`,
    });
  }

  const { frontFoilColors, backFoilColors } = resolveOrderItemFoilSides(item);
  const actualFoilColors = [...frontFoilColors, ...backFoilColors];
  if (
    item.pricingRoute !== OrderItemPricingRoute.COLOR_PRINT &&
    item.lamination !== OrderLamination.NONE
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['lamination'],
      message: '非彩印款式的覆膜方式必须为“无覆膜”',
    });
  }
  if (
    frontFoilColors.length > MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE ||
    backFoilColors.length > MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE
  ) {
    ctx.addIssue({
      code: 'custom',
      path:
        frontFoilColors.length > MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE
          ? ['frontFoilColors']
          : ['backFoilColors'],
      message: `正反面各最多 ${MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE} 种烫金颜色`,
    });
  }

  if (item.pricingRoute === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL) {
    if (
      item.foilTechnique === OrderFoilTechnique.NONE ||
      item.foilTechnique === OrderFoilTechnique.UNSPECIFIED
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['foilTechnique'],
        message: '专版烫金必须选择烫金方式',
      });
    }
    if (actualFoilColors.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['foilColors'],
        message: '专版烫金必须选择至少 1 种烫金颜色',
      });
    }
  }

  if (item.pricingRoute === OrderItemPricingRoute.STOCK_BLANK) {
    if (item.hasLocalFoil !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['hasLocalFoil'],
        message: '通版现货路线必须使用局部烫金',
      });
    }
    if (
      item.foilTechnique === OrderFoilTechnique.NONE ||
      item.foilTechnique === OrderFoilTechnique.UNSPECIFIED
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['foilTechnique'],
        message: '局部烫金必须选择烫金方式',
      });
    }
    if (actualFoilColors.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['foilColors'],
        message: '局部烫金必须选择至少 1 种烫金颜色',
      });
    }
  }

  if (item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT) {
    if (item.printColors.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['printColors'],
        message: '彩印自动计价必须填写彩印颜色',
      });
    }
    if (actualFoilColors.length === 0) {
      if (item.foilTechnique !== OrderFoilTechnique.NONE) {
        ctx.addIssue({
          code: 'custom',
          path: ['foilTechnique'],
          message: '纯彩印未选烫金颜色时，烫金方式必须为“无烫金”',
        });
      }
      if (item.hasLocalFoil !== false) {
        ctx.addIssue({
          code: 'custom',
          path: ['hasLocalFoil'],
          message: '纯彩印未选烫金颜色时，不能标记局部烫金',
        });
      }
    } else {
      if (
        item.foilTechnique === OrderFoilTechnique.NONE ||
        item.foilTechnique === OrderFoilTechnique.UNSPECIFIED
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['foilTechnique'],
          message: '彩印加烫金时必须选择烫金方式',
        });
      }
      if (item.hasLocalFoil === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['hasLocalFoil'],
          message: '彩印加烫金时必须明确是否局部烫金',
        });
      }
    }
  }
}

/**
 * Shared command-boundary validation for a fully merged set of pricing
 * facts. Change requests use this schema after combining a proposal with the
 * persisted item, so they cannot bypass the same route invariants enforced
 * when an order is first created.
 */
export const orderItemPricingFactsSchema = orderItemBaseSchema
  .pick({
    productId: true,
    pricingRoute: true,
    paperType: true,
    crafts: true,
    actualWidthMm: true,
    actualHeightMm: true,
    frontFoilColors: true,
    backFoilColors: true,
    foilColors: true,
    foilTechnique: true,
    hasLocalFoil: true,
    lamination: true,
    printColors: true,
    isDoubleSided: true,
  })
  .superRefine(validateOrderItemPricingFacts);

const orderItemSchema = orderItemBaseSchema.superRefine(
  validateOrderItemPricingFacts,
);

export type OrderItemInput = z.infer<typeof orderItemSchema>;

// 建议价由服务端根据当前生效规则计算。客户端只传业务事实，
// 不传价格或规则快照，避免直接 POST 伪造报价结果。
export const createOrderQuoteItemsSchema = z.object({
  items: z
    .array(
      orderItemBaseSchema
        .pick({
          productId: true,
          specification: true,
          paperType: true,
          pricingRoute: true,
          manualQuoteReason: true,
          productStructure: true,
          artworkVersion: true,
          plateGroupId: true,
          pricingGroup: true,
          actualWidthMm: true,
          actualHeightMm: true,
          paperWeightGsm: true,
          quantity: true,
          crafts: true,
          frontFoilColors: true,
          backFoilColors: true,
          foilColors: true,
          foilTechnique: true,
          hasLocalFoil: true,
          lamination: true,
          printColors: true,
          isDoubleSided: true,
          isDoubleColor: true,
        })
        .superRefine(validateOrderItemPricingFacts),
    )
    .min(1, '至少需要一个款式')
    .max(20, '单次最多计算 20 个款式'),
  // The form may preview one completed line while other lines are still being
  // edited.  Preserve the real order-level item count for packing/mixed-item
  // rules without asking the quote endpoint to accept invalid placeholder
  // lines.  Order creation always derives this count from persisted inputs.
  orderItemCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_ORDER_ITEMS_PER_ORDER)
    .optional(),
});

export type CreateOrderQuoteItemsInput = z.infer<
  typeof createOrderQuoteItemsSchema
>;

// OrderItem.subtotal and Order.totalAmount are Decimal(12,2): at most
// 9,999,999,999.99 yuan. lib/order.ts persists each line as
// Decimal(quantity * unitPrice).toFixed(2), whose default rounding mode is
// ROUND_HALF_UP. Keep the boundary check exact without passing through an
// IEEE-754 number: unit prices have four decimal places, so converting them
// to ten-thousandths and dividing the product by 100 yields cents.
const DECIMAL_12_2_MAX_CENTS = BigInt('999999999999');
const TEN_THOUSANDTHS_PER_CENT = BigInt(100);

function decimalStringToScaledInteger(value: string, scale: number): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart = '0', decimalPart = ''] = unsigned.split('.');
  const scaled = BigInt(
    `${integerPart}${decimalPart.padEnd(scale, '0').slice(0, scale)}`,
  );
  return negative ? -scaled : scaled;
}

function orderItemSubtotalCents(
  quantity: number,
  unitPrice: string | null,
  fixedFee: string | null | undefined,
): bigint {
  const priceTenThousandths = decimalStringToScaledInteger(
    unitPrice ?? '0',
    4,
  );
  const unrounded = priceTenThousandths * BigInt(quantity);
  const variableCents = (
    unrounded + TEN_THOUSANDTHS_PER_CENT / BigInt(2)
  ) / TEN_THOUSANDTHS_PER_CENT;
  const fixedFeeCents = decimalStringToScaledInteger(
    fixedFee ?? '0',
    2,
  );
  return variableCents + fixedFeeCents;
}

const shipmentSplitQuantityField = z.preprocess(
  (value) => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed === '') return 0;
    if (!/^\d+$/.test(trimmed)) return Number.NaN;
    return Number.parseInt(trimmed, 10);
  },
  z
    .number({ message: '分配数量必须是非负整数' })
    .finite('分配数量必须是有限数')
    .int('分配数量必须是整数')
    .min(0, '分配数量不能小于 0')
    .max(9_999_999, '分配数量过大'),
);

const shipmentBillableWeightField = z.preprocess(
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

const shipmentChargeMoneyField = z.preprocess(
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
const optionalShipmentText = (label: string, max: number) =>
  z.preprocess(
    (value) => (value === undefined ? null : value),
    optionalTrimmedText(label, max),
  );

const shipmentChargeFields = {
  destinationProvince: optionalShipmentText('计费省份', 32),
  quotedWeightKg: shipmentBillableWeightField,
  shippingFee: shipmentChargeMoneyField,
  packingMaterialFee: shipmentChargeMoneyField,
  customerChargeOverrideReason: optionalShipmentText('收费调整说明', 500),
} as const;

const externalOrderChargeQuoteShipmentSchema = z.object({
  shipmentKey: z
    .string()
    .trim()
    .min(1, '发货记录标识不能为空')
    .max(32, '发货记录标识过长'),
  province: optionalShipmentText('计费省份', 32),
  billableWeightKg: shipmentBillableWeightField,
  itemQuantity: z
    .number()
    .int('单票分配数量必须是整数')
    .min(1, '单票分配数量必须大于 0')
    .max(
      MAX_ORDER_ITEMS_PER_ORDER * 9_999_999,
      '单票分配数量过大',
    ),
  itemQuantities: z
    .array(
      z
        .number()
        .int('分配数量必须是整数')
        .min(0, '分配数量不能小于 0')
        .max(9_999_999, '分配数量过大'),
    )
    .max(MAX_ORDER_ITEMS_PER_ORDER, '单票分配款式过多')
    .optional(),
});

const externalOrderChargeQuoteItemSchema = z.object({
  itemKey: z.string().trim().min(1).max(64).optional(),
  quantity: z
    .number()
    .int('款式数量必须是整数')
    .min(1, '款式数量必须大于 0')
    .max(9_999_999, '款式数量过大'),
  paperWeightGsm: z
    .number()
    .int('纸张克重必须是整数')
    .min(1)
    .max(2_000)
    .nullable(),
  paperType: optionalTrimmedText('纸张', 64).optional(),
  productStructure: z.enum(OrderProductStructure),
});

// 创建页物流报价只接收业务事实，不接收价格、规则或价目簿编号。
// 服务端每次按当前生效 LOGISTICS 价目簿重新报价。
export const quoteExternalOrderChargesSchema = z
  .object({
    isSfCollect: z.boolean(),
    items: z
      .array(externalOrderChargeQuoteItemSchema)
      .min(1, '至少需要一个款式')
      .max(MAX_ORDER_ITEMS_PER_ORDER, '款式数量过多')
      .optional(),
    shipments: z
      .array(externalOrderChargeQuoteShipmentSchema)
      .min(1, '至少需要一个发货地址')
      .max(10, '单工单发货地址不超过 10 个'),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const [index, shipment] of input.shipments.entries()) {
      if (seen.has(shipment.shipmentKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', index, 'shipmentKey'],
          message: '发货记录标识不能重复',
        });
      }
      seen.add(shipment.shipmentKey);
    }

    if (!input.items) return;
    const allocatedByItem = input.items.map(() => 0);
    for (const [shipmentIndex, shipment] of input.shipments.entries()) {
      if (!shipment.itemQuantities) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', shipmentIndex, 'itemQuantities'],
          message: '自动物流报价必须提供各款分配数量',
        });
        continue;
      }
      if (shipment.itemQuantities.length !== input.items.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', shipmentIndex, 'itemQuantities'],
          message: '各地址的款式分配必须与工单款式一一对应',
        });
        continue;
      }
      shipment.itemQuantities.forEach((quantity, itemIndex) => {
        allocatedByItem[itemIndex] =
          (allocatedByItem[itemIndex] ?? 0) + quantity;
      });
      if (!shipment.itemQuantities.some((quantity) => quantity > 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', shipmentIndex, 'itemQuantities'],
          message: '每个地址至少要分配一个款式',
        });
      }
      const allocatedQuantity = shipment.itemQuantities.reduce(
        (sum, quantity) => sum + quantity,
        0,
      );
      if (shipment.itemQuantity !== allocatedQuantity) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', shipmentIndex, 'itemQuantity'],
          message: '地址总数量必须等于各款分配数量之和',
        });
      }
    }
    input.items.forEach((item, itemIndex) => {
      if (allocatedByItem[itemIndex] !== item.quantity) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', itemIndex, 'quantity'],
          message: `款式 #${itemIndex + 1} 的地址分配数量必须等于本款数量`,
        });
      }
    });
  });

export type QuoteExternalOrderChargesInput = z.infer<
  typeof quoteExternalOrderChargesSchema
>;

// 创建页包装组预报价只接收可验证的业务事实。袋数由浏览器根据
// 每袋组成实时计算，服务端仍严格校验类型和范围，并按当前生效价目重算金额。
const quotePackagingUnitsPerBagField = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return 0;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
    return value;
  },
  z
    .number({ message: '每袋数量必须是非负整数' })
    .int('每袋数量必须是整数')
    .min(0, '每袋数量不能小于 0')
    .max(9_999_999, '每袋数量过大'),
);

const orderPackagingQuoteGroupSchema = z.object({
  groupKey: z
    .string({ error: '包装组标识不能为空' })
    .trim()
    .min(1, '包装组标识不能为空')
    .max(64, '包装组标识过长'),
  mode: z.enum(OrderPackagingMode, { error: '包装方式非法' }),
  actualBagCount: z
    .number({ error: '袋数必须是数字' })
    .finite('袋数必须是有限数')
    .int('袋数必须是整数')
    .min(1, '袋数必须大于 0')
    .max(9_999_999, '袋数过大'),
});

// 统一建单报价还需要每袋的款式组成，用来验证混装与计算袋数。
const createOrderPackagingQuoteGroupSchema =
  orderPackagingQuoteGroupSchema.extend({
    itemUnitsPerBag: z
      .array(quotePackagingUnitsPerBagField, {
        error: '包装组款式组成格式非法',
      })
      .min(1, '包装组至少需要一个款式组成')
      .max(MAX_ORDER_ITEMS_PER_ORDER, '包装组款式组成过多'),
  });

export const quoteCreateOrderPackagingGroupsSchema = z
  .object({
    groups: z
      .array(createOrderPackagingQuoteGroupSchema, {
        error: '包装组数据格式非法',
      })
      .min(1, '至少需要一个包装组')
      .max(20, '单工单包装组不超过 20 组'),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.groups.forEach((group, index) => {
      if (seen.has(group.groupKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', index, 'groupKey'],
          message: '包装组标识不能重复',
        });
      }
      seen.add(group.groupKey);
    });
  });

export type QuoteCreateOrderPackagingGroupsInput = z.infer<
  typeof quoteCreateOrderPackagingGroupsSchema
>;

const additionalShipmentSchema = z.object({
  receiverName: optionalTrimmedText('收货人', 64),
  receiverPhone: optionalTrimmedText('收货电话', 32),
  receiverAddress: requiredTrimmedText('收货地址', 256),
  expressCode: optionalTrimmedText('快递代码', 32),
  ...shipmentChargeFields,
  itemQuantities: z
    .array(shipmentSplitQuantityField)
    .max(50, '单个地址的款式分配不超过 50 项'),
});

const packagingUnitsPerBagField = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return 0;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
    return value;
  },
  z
    .number({ message: '每袋数量必须是非负整数' })
    .int('每袋数量必须是整数')
    .min(0, '每袋数量不能小于 0')
    .max(9_999_999, '每袋数量过大'),
);

const packagingGroupSchema = z.object({
  name: optionalTrimmedText('包装组名称', 64),
  mode: z.enum(OrderPackagingMode),
  actualBagCount: z.preprocess(
    (value) => {
      if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        return Number.parseInt(value.trim(), 10);
      }
      return value;
    },
    z
      .number({ message: '实际袋数必须是数字' })
      .int('实际袋数必须是整数')
      .min(1, '实际袋数必须大于 0')
      .max(9_999_999, '实际袋数过大'),
  ),
  itemUnitsPerBag: z
    .array(packagingUnitsPerBagField)
    .max(MAX_ORDER_ITEMS_PER_ORDER, '包装组款式组成过多'),
});

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

export const createOrderSchema = z
  .object({
    clientSubmissionId: z.string().uuid('提交标识无效').optional(),
    nextItemFig: z
      .number()
      .int('下一款式编号必须是整数')
      .min(1, '下一款式编号必须大于 0')
      .optional(),
    customName: optionalTrimmedText('工单名称', 100).optional(),
    customerPartyId: optionalTrimmedText('客户主数据', 64).optional(),
    customerRef: optionalTrimmedText('客户名称/简称', 64),
    receiverName: optionalTrimmedText('收货人', 64),
    receiverPhone: optionalTrimmedText('收货电话', 32),
    receiverAddress: optionalTrimmedText('收货地址', 256)
      .optional()
      .refine((value) => Boolean(value), {
        message: '请填写收货地址',
      })
      .transform((value) => value ?? null),
    expressCode: optionalTrimmedText('快递代码', 32),
    ...shipmentChargeFields,
    packageRequirement: optionalTrimmedText('包装要求', 500),
    remark: optionalTrimmedText('工单备注', 1000),
    promisedDate: optionalDateField,
    isUrgent: formBoolean,
    isSfCollect: formBoolean,
    additionalShipments: z
      .array(additionalShipmentSchema)
      .max(9, '额外地址不超过 9 个')
      .default([]),
    packagingGroups: z
      .array(packagingGroupSchema)
      .max(20, '单工单包装组不超过 20 组')
      .default([]),
    items: z
      .array(orderItemSchema)
      .min(1, '至少一个款式')
      .max(
        MAX_ORDER_ITEMS_PER_ORDER,
        `单工单款式不超过 ${MAX_ORDER_ITEMS_PER_ORDER} 项`,
      ),
  })
  .superRefine((input, ctx) => {
    const seenFigs = new Set<number>();
    let maximumFig = 0;
    input.items.forEach((item, itemIndex) => {
      const fig = item.fig ?? itemIndex + 1;
      maximumFig = Math.max(maximumFig, fig);
      if (seenFigs.has(fig)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', itemIndex, 'fig'],
          message: `款式编号 ${fig} 重复`,
        });
      }
      seenFigs.add(fig);
    });
    if (
      input.nextItemFig !== undefined &&
      input.nextItemFig <= maximumFig
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['nextItemFig'],
        message: '下一款式编号必须大于已有款式编号',
      });
    }
    let orderTotalCents = BigInt(0);
    for (const [itemIndex, item] of input.items.entries()) {
      const subtotalCents = orderItemSubtotalCents(
        item.quantity,
        item.unitPrice,
        item.fixedFee,
      );
      orderTotalCents += subtotalCents;
      if (subtotalCents > DECIMAL_12_2_MAX_CENTS) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', itemIndex, 'unitPrice'],
          message:
            '款式小计过大（数量 × 单价 + 一次性费用不能超过 9,999,999,999.99 元）',
        });
      }
    }
    if (orderTotalCents > DECIMAL_12_2_MAX_CENTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: '工单总金额过大（不能超过 9,999,999,999.99 元）',
      });
    }

    const customerChargeValues = [
      input.shippingFee,
      input.packingMaterialFee,
      ...input.additionalShipments.flatMap((shipment) => [
        shipment.shippingFee,
        shipment.packingMaterialFee,
      ]),
    ];
    const customerChargeCents = customerChargeValues.reduce(
      (sum, value) =>
        sum + decimalStringToScaledInteger(value ?? '0', 2),
      BigInt(0),
    );
    if (orderTotalCents + customerChargeCents > DECIMAL_12_2_MAX_CENTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['shippingFee'],
        message: '加工费加快递/耗材费后的工单总额超过系统上限',
      });
    }

    if (input.isSfCollect) {
      const shippingFees = [
        input.shippingFee,
        ...input.additionalShipments.map((shipment) => shipment.shippingFee),
      ];
      for (const [shipmentIndex, fee] of shippingFees.entries()) {
        if (fee !== null && decimalStringToScaledInteger(fee, 2) !== BigInt(0)) {
          ctx.addIssue({
            code: 'custom',
            path:
              shipmentIndex === 0
                ? ['shippingFee']
                : ['additionalShipments', shipmentIndex - 1, 'shippingFee'],
            message: '顺丰到付由客户自行预约，快递费必须为 0',
          });
        }
      }
    }

    for (const [shipmentIndex, shipment] of input.additionalShipments.entries()) {
      if (shipment.itemQuantities.length !== input.items.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['additionalShipments', shipmentIndex, 'itemQuantities'],
          message: '每个额外地址必须为全部款式提供分配数量',
        });
      }
      const quantities = input.items.map(
        (_, itemIndex) => shipment.itemQuantities[itemIndex] ?? 0,
      );
      if (!quantities.some((quantity) => quantity > 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['additionalShipments', shipmentIndex, 'itemQuantities'],
          message: '额外地址至少要分配一个款式的数量',
        });
      }
    }

    let primaryHasQuantity = false;
    for (const [itemIndex, item] of input.items.entries()) {
      const extraQuantity = input.additionalShipments.reduce(
        (sum, shipment) => sum + (shipment.itemQuantities[itemIndex] ?? 0),
        0,
      );
      if (extraQuantity > item.quantity) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', itemIndex, 'quantity'],
          message: `分配到额外地址的数量 ${extraQuantity} 超过款式总数 ${item.quantity}`,
        });
      }
      if (extraQuantity < item.quantity) primaryHasQuantity = true;
    }
    if (input.additionalShipments.length > 0 && !primaryHasQuantity) {
      ctx.addIssue({
        code: 'custom',
        path: ['additionalShipments'],
        message: '主地址至少要保留一个款式的发货数量',
      });
    }

    const packagingGroupCountByItem = input.items.map(() => 0);
    for (const [groupIndex, group] of input.packagingGroups.entries()) {
      if (group.itemUnitsPerBag.length !== input.items.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups', groupIndex, 'itemUnitsPerBag'],
          message: '每个包装组必须为全部款式表达每袋组成',
        });
        continue;
      }
      const selectedItemCount = group.itemUnitsPerBag.filter(
        (quantity) => quantity > 0,
      ).length;
      if (
        group.mode === OrderPackagingMode.SINGLE_STYLE &&
        selectedItemCount !== 1
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups', groupIndex, 'itemUnitsPerBag'],
          message: '单款装包装组必须且只能包含 1 个款式',
        });
      }
      if (
        group.mode === OrderPackagingMode.MIXED_STYLE &&
        selectedItemCount < 2
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups', groupIndex, 'itemUnitsPerBag'],
          message: '混装包装组至少要包含 2 个款式',
        });
      }
      const derived = calculatePackagingBagCount({
        mode: group.mode,
        itemQuantities: input.items.map((item) => item.quantity),
        itemUnitsPerBag: group.itemUnitsPerBag,
      });
      if (!derived.complete) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups', groupIndex, 'itemUnitsPerBag'],
          message: derived.errors.join('；'),
        });
      }
      group.itemUnitsPerBag.forEach((unitsPerBag, itemIndex) => {
        if (unitsPerBag <= 0) return;
        packagingGroupCountByItem[itemIndex] =
          (packagingGroupCountByItem[itemIndex] ?? 0) + 1;
      });
    }
    packagingGroupCountByItem.forEach((groupCount, itemIndex) => {
      if (groupCount > 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups'],
          message: `款式 #${itemIndex + 1} 只能归入一个包装组`,
        });
      }
    });
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const cancelOrderSchema = z.object({
  reason: requiredTrimmedText('取消原因', 500),
});

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// 标记发货：trackingNo 选填（运单号）。Order.trackingNo 是 nullable
// text，用同一 optional-trimmed 收尾的 helper。
export const shipOrderSchema = z.object({
  trackingNo: optionalTrimmedText('运单号', 64),
  shipments: z
    .array(
      z.object({
        shipmentId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]+$/, '发货记录 id 格式非法'),
        trackingNo: optionalTrimmedText('运单号', 64),
        weightKg: z.preprocess(
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
              .regex(/^\d{1,6}(?:\.\d{1,3})?$/, '快递重量格式不合法')
              .refine((value) => Number(value) > 0, '快递重量必须大于 0'),
          ]),
        ).optional(),
        destinationProvince: optionalShipmentText('计费省份', 32),
        shippingFee: shipmentChargeMoneyField,
        packingMaterialFee: shipmentChargeMoneyField,
        customerChargeOverrideReason: optionalShipmentText('收费调整说明', 500),
      }),
    )
    .max(10, '单工单发货地址不超过 10 个')
    .default([]),
});

export type ShipOrderInput = z.infer<typeof shipOrderSchema>;

const reworkEntityId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]+$/, '记录 id 格式非法');

const optionalReworkUnitsPerBagField = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
    return value;
  },
  z
    .number({ message: '每袋数量必须是数字' })
    .int('每袋数量必须是整数')
    .min(1, '每袋数量必须大于 0')
    .max(9_999_999, '每袋数量过大')
    .optional(),
);

export const createReworkOrderSchema = z.object({
  sourceOrderId: reworkEntityId,
  cause: z.enum(ReworkCause),
  reason: z.string().trim().min(1, '请填写重做原因').max(500, '重做原因过长'),
  items: z
    .array(
      z.object({
        sourceOrderItemId: reworkEntityId,
        quantity: orderItemQuantityField,
        // 只有历史原单无结构化包装组且该款 pack 也缺失时，
        // 域层才会采用管理员显式补录的每袋数；不得覆盖 canonical 包装组。
        unitsPerBag: optionalReworkUnitsPerBagField,
        craftIds: z
          .array(craftIdSchema)
          .max(10)
          .refine(
            (craftIds) => new Set(craftIds).size === craftIds.length,
            '重做工艺不能重复',
          ),
      }),
    )
    .min(1, '至少选择一个需要重做的款式')
    .max(50, '单次重做款式不超过 50 项'),
});

export type CreateReworkOrderInput = z.infer<typeof createReworkOrderSchema>;

const orderChangeId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]+$/, '记录 id 格式非法');

const updateOrderItemChangeSchema = z
  .object({
    operation: z.literal('UPDATE'),
    itemId: orderChangeId,
    name: z.string().trim().min(1).max(64).optional(),
    quantity: orderItemQuantityField.optional(),
    specification: optionalTrimmedText('规格', 64).optional(),
    frontFoilColors: orderItemFoilSideColorsField.optional(),
    backFoilColors: orderItemFoilSideColorsField.optional(),
    // Historical clients only submitted one aggregate array. It remains
    // readable at the command boundary, but the domain layer immediately
    // projects it into explicit front/back facts before persisting.
    foilColors: orderItemFoilColorsField.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.quantity !== undefined ||
      value.specification !== undefined ||
      value.frontFoilColors !== undefined ||
      value.backFoilColors !== undefined ||
      value.foilColors !== undefined,
    '至少修改一个款式字段',
  );

const addOrderItemChangeSchema = z.object({
  operation: z.literal('ADD'),
  templateItemId: orderChangeId,
  name: z.string().trim().min(1, '请填写新增款式名').max(64),
  quantity: orderItemQuantityField,
  specification: optionalTrimmedText('规格', 64).optional(),
  frontFoilColors: orderItemFoilSideColorsField.optional(),
  backFoilColors: orderItemFoilSideColorsField.optional(),
  foilColors: orderItemFoilColorsField.optional(),
});

export const orderChangeRequestItemsSchema = z
  .array(
    z.discriminatedUnion('operation', [
      updateOrderItemChangeSchema,
      addOrderItemChangeSchema,
    ]),
  )
  .min(1, '至少填写一项修改')
  .max(50, '单次修改不超过 50 项')
  .superRefine((value, ctx) => {
    const updatedItemIds = new Set<string>();
    value.forEach((item, index) => {
      if (item.operation !== 'UPDATE') return;
      if (updatedItemIds.has(item.itemId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'itemId'],
          message: '同一款式不能重复提交修改',
        });
      }
      updatedItemIds.add(item.itemId);
    });
  });

export const createOrderChangeRequestSchema = z.object({
  orderId: orderChangeId,
  reason: z
    .string()
    .trim()
    .min(1, '请填写修改原因')
    .max(500, '修改原因过长'),
  items: orderChangeRequestItemsSchema,
});

export type CreateOrderChangeRequestInput = z.infer<
  typeof createOrderChangeRequestSchema
>;

export const reviewOrderChangeRequestSchema = z.object({
  requestId: orderChangeId,
  decision: z.enum(['APPROVE', 'REJECT']),
  reviewRemark: optionalTrimmedText('审核备注', 500),
});

export type ReviewOrderChangeRequestInput = z.infer<
  typeof reviewOrderChangeRequestSchema
>;

export const previewOrderChangeRequestPricingSchema =
  reviewOrderChangeRequestSchema.pick({ requestId: true });

export type PreviewOrderChangeRequestPricingInput = z.infer<
  typeof previewOrderChangeRequestPricingSchema
>;

// 工厂终价只接收管理员对待定行的确认值；价目簿 id、自动价和小计
// 一律读取工单已经锁定的快照，不信任浏览器金额或当前价表。
const orderPricingRevisionField = z.preprocess(
  (value) => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN;
  },
  z.number().int('价格版本必须是整数').min(1, '价格版本非法'),
);

const confirmedShipmentChargeMoneyField = shipmentChargeMoneyField.refine(
  (value): value is string => value !== null,
  '请填写确认收费',
);

export const previewOrderPricingReviewSchema = z.object({
  orderId: orderChangeId,
});

export type PreviewOrderPricingReviewInput = z.infer<
  typeof previewOrderPricingReviewSchema
>;

export const finalizeOrderPricingSchema = z
  .object({
    orderId: orderChangeId,
    expectedOrderRevision: orderPricingRevisionField,
    expectedPriceRevision: orderPricingRevisionField,
    items: z
      .array(
        z.object({
          itemId: orderChangeId,
          unitPrice: moneyOptionalField,
          fixedFee: orderItemMoneyOptionalField,
          reason: optionalTrimmedText('管理员定价依据', 500),
        }),
      )
      .max(
        MAX_ORDER_ITEMS_PER_ORDER,
        `单工单款式不超过 ${MAX_ORDER_ITEMS_PER_ORDER} 项`,
      )
      .default([]),
    packagingGroups: z
      .array(
        z.object({
          packagingGroupId: orderChangeId,
          expectedMode: z.enum(OrderPackagingMode),
          expectedActualBagCount: z.preprocess(
            (value) => {
              if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
                return Number.parseInt(value.trim(), 10);
              }
              return value;
            },
            z
              .number({ message: '实际袋数必须是数字' })
              .int('实际袋数必须是整数')
              .min(1, '实际袋数必须大于 0')
              .max(9_999_999, '实际袋数过大'),
          ),
          unitPrice: moneyOptionalField,
          reason: optionalTrimmedText('包装组定价依据', 500),
        }),
      )
      .max(20, '单工单包装组不超过 20 组')
      .default([]),
    orderCharges: z
      .array(
        z.object({
          chargeId: orderChangeId,
          expectedBusinessKey: z
            .string()
            .trim()
            .min(1, '订单级收费业务键不能为空')
            .max(128, '订单级收费业务键过长'),
          amount: confirmedShipmentChargeMoneyField,
          reason: optionalTrimmedText('订单级收费定价依据', 500),
        }),
      )
      .max(50, '单工单订单级待核价费用不超过 50 项')
      .default([]),
    shipments: z
      .array(
        z.object({
          shipmentId: orderChangeId,
          expectedDestinationProvince: optionalShipmentText('预览计费省份', 32),
          expectedBillableWeightKg: shipmentBillableWeightField,
          shippingFee: confirmedShipmentChargeMoneyField,
          packingMaterialFee: confirmedShipmentChargeMoneyField,
          reason: optionalShipmentText('收费确认说明', 500),
        }),
      )
      .max(10, '单工单发货地址不超过 10 个'),
    remark: optionalTrimmedText('终价备注', 500),
  })
  .superRefine((input, ctx) => {
    const itemIds = new Set<string>();
    input.items.forEach((item, index) => {
      if (itemIds.has(item.itemId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'itemId'],
          message: '同一款式不能重复提交终价',
        });
      }
      itemIds.add(item.itemId);
    });

    const shipmentIds = new Set<string>();
    input.shipments.forEach((shipment, index) => {
      if (shipmentIds.has(shipment.shipmentId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', index, 'shipmentId'],
          message: '同一发货地址不能重复提交收费',
        });
      }
      shipmentIds.add(shipment.shipmentId);
    });

    const orderChargeIds = new Set<string>();
    input.orderCharges.forEach((charge, index) => {
      if (orderChargeIds.has(charge.chargeId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['orderCharges', index, 'chargeId'],
          message: '同一订单级待核价费用不能重复提交',
        });
      }
      orderChargeIds.add(charge.chargeId);
    });

    const packagingGroupIds = new Set<string>();
    input.packagingGroups.forEach((group, index) => {
      if (packagingGroupIds.has(group.packagingGroupId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['packagingGroups', index, 'packagingGroupId'],
          message: '同一包装组不能重复提交终价',
        });
      }
      packagingGroupIds.add(group.packagingGroupId);
    });
  });

export type FinalizeOrderPricingInput = z.infer<
  typeof finalizeOrderPricingSchema
>;

// ─────────────────────────────────────────────────────────────────────
// Structured customer extras / per-style plate details
// ─────────────────────────────────────────────────────────────────────

const orderCommercialMoneyField = orderItemMoneyOptionalField.refine(
  (value): value is string => value !== null,
  '请填写金额',
);

const signedOrderAdjustmentMoneyField = z.preprocess(
  (value) => (value === null || value === undefined ? '' : value),
  z
    .string()
    .trim()
    .refine(
      (value) =>
        /^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value),
      '调整金额格式错误（整数部分最多 10 位、小数最多 2 位）',
    ),
);

export const saveOrderManualChargeSchema = z
  .object({
    orderId: orderChangeId,
    chargeId: orderChangeId.nullable().default(null),
    expectedPriceRevision: orderPricingRevisionField,
    categoryCode: z.enum([
      'SAMPLE_FEE',
      'OTHER_PACKAGING_FEE',
      'APPROVED_ADJUSTMENT',
    ]),
    description: requiredTrimmedText('收费说明', 120),
    amount: z.union([
      orderCommercialMoneyField,
      signedOrderAdjustmentMoneyField,
    ]),
    reason: requiredTrimmedText('收费原因', 500),
    approvalReference: optionalTrimmedText('审批信息', 500).default(null),
  })
  .superRefine((input, ctx) => {
    const signedAmount = Number(input.amount);
    if (
      input.categoryCode !== 'APPROVED_ADJUSTMENT' &&
      signedAmount < 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: '只有经审批调整金额可以为负数',
      });
    }
    if (
      input.categoryCode === 'APPROVED_ADJUSTMENT' &&
      !input.approvalReference
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['approvalReference'],
        message: '经审批调整必须填写审批信息',
      });
    }
  });

export const deleteOrderManualChargeSchema = z.object({
  orderId: orderChangeId,
  chargeId: orderChangeId,
  expectedPriceRevision: orderPricingRevisionField,
  reason: requiredTrimmedText('移除原因', 500),
});

export const saveOrderPlateDetailSchema = z.object({
  orderId: orderChangeId,
  orderItemId: orderChangeId,
  plateDetailId: orderChangeId.nullable().default(null),
  expectedPriceRevision: orderPricingRevisionField,
  name: requiredTrimmedText('制版名称', 120),
  plateGroupId: optionalTrimmedText('版组 ID', 64).default(null),
  specification: optionalTrimmedText('制版规格', 120).default(null),
  quantity: orderItemQuantityField,
  unitPrice: orderCommercialMoneyField,
  remark: optionalTrimmedText('制版备注', 500).default(null),
});

export const deleteOrderPlateDetailSchema = z.object({
  orderId: orderChangeId,
  orderItemId: orderChangeId,
  plateDetailId: orderChangeId,
  expectedPriceRevision: orderPricingRevisionField,
  reason: requiredTrimmedText('移除原因', 500),
});

export type SaveOrderManualChargeInput = z.infer<
  typeof saveOrderManualChargeSchema
>;
export type DeleteOrderManualChargeInput = z.infer<
  typeof deleteOrderManualChargeSchema
>;
export type SaveOrderPlateDetailInput = z.infer<
  typeof saveOrderPlateDetailSchema
>;
export type DeleteOrderPlateDetailInput = z.infer<
  typeof deleteOrderPlateDetailSchema
>;

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
// → don't change; optional text may be cleared to null. receiverAddress
// is the deliberate exception: once supplied it must stay non-blank.
// optionalFormBoolean handles the undefined case for the urgent checkbox.
export const updateEditableOrderSchema = z.object({
  customName: optionalTrimmedText('工单名称', 100).optional(),
  customerRef: optionalTrimmedText('客户名称/简称', 64).optional(),
  receiverName: optionalTrimmedText('收货人', 64).optional(),
  receiverPhone: optionalTrimmedText('收货电话', 32).optional(),
  // 普通编辑允许不传该 key（partial update），但只要传了就不能清空。
  receiverAddress: requiredTrimmedText('收货地址', 256).optional(),
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
  receiverAddress: requiredTrimmedText('收货地址', 256),
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

// 顺丰到付是独立的发货属性：工单进入生产后仍可更正，避免为了改
// 一个到付标识而重新开放已冻结的金额 / 款式字段。
export const setOrderSfCollectSchema = z
  .object({
    isSfCollect: requiredFormBoolean,
    shipments: z
      .array(
        z.object({
          shipmentId: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9_-]+$/, '发货记录 id 格式非法'),
          destinationProvince: optionalShipmentText('计费省份', 32),
          weightKg: shipmentBillableWeightField,
          shippingFee: shipmentChargeMoneyField,
          customerChargeOverrideReason: optionalShipmentText(
            '收费调整说明',
            500,
          ),
        }),
      )
      .max(10, '单工单发货地址不超过 10 个')
      .default([]),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const [index, shipment] of input.shipments.entries()) {
      if (seen.has(shipment.shipmentId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['shipments', index, 'shipmentId'],
          message: '发货记录不能重复',
        });
      }
      seen.add(shipment.shipmentId);
    }
  });

export type SetOrderSfCollectInput = z.infer<typeof setOrderSfCollectSchema>;

// ─────────────────────────────────────────────────────────────────────
// Historical production-task disputes
// ─────────────────────────────────────────────────────────────────────

// ID allowlist kept in sync with lib/oss/sign.ts — cuid / cuid2 only,
// no path-sensitive characters. A caller sending garbage here is a bug
// or attack, not a user typo.
const scheduleIdRe = /^[A-Za-z0-9_-]+$/;
const safeId = (label: string) =>
  z.string().trim().regex(scheduleIdRe, `${label}格式非法`);
export const createProductionTaskDisputeSchema = z.object({
  taskId: safeId('生产任务 id'),
  reason: z
    .string()
    .trim()
    .min(5, '异议原因至少 5 个字')
    .max(1000, '异议原因最多 1000 个字符'),
});

export type CreateProductionTaskDisputeInput = z.infer<
  typeof createProductionTaskDisputeSchema
>;

export const reviewProductionTaskDisputeSchema = z.object({
  disputeId: safeId('异议 id'),
  decision: z.enum(['RESOLVED', 'REJECTED'], {
    error: '请选择同意调整或驳回异议',
  }),
  resolution: z
    .string()
    .trim()
    .min(2, '处理回复至少 2 个字')
    .max(1000, '处理回复最多 1000 个字符'),
});

export type ReviewProductionTaskDisputeInput = z.infer<
  typeof reviewProductionTaskDisputeSchema
>;

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

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

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

// ─────────────────────────────────────────────────────────────────────
// Salary actions (SPEC §5)
// ─────────────────────────────────────────────────────────────────────

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

const shanghaiDateTimeField = (label: string) =>
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
    spareHours: hoursField('空闲打包工时'),
    workUnits: attendanceUnitField('实际上班', 1),
    leaveUnits: attendanceUnitField('请假', 0),
    leaveType: optionalTrimmedText('请假类型', 50).optional(),
    remark: optionalTrimmedText('备注', 200).optional(),
  })
  .refine((value) => value.workUnits + value.leaveUnits <= 1, {
    path: ['leaveUnits'],
    message: '上班天数与请假天数合计不能超过 1 天',
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
// 严格 origin 检查：避免管理员把任意 URL 粘进来踩 SSRF / 误投递。
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
