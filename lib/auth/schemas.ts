import { z } from 'zod';
import {
  Role,
  WorkerType,
  MachineType,
  ProductCategory,
} from '../../generated/prisma/client';

// bcrypt (and bcryptjs, which we use) only hashes the first 72 bytes of the
// input. Anything beyond that is silently truncated, so a 200-byte password
// is indistinguishable from a different 200-byte password sharing the same
// first 72 bytes. If we let users *set* passwords longer than 72 bytes,
// they can later log in with any suffix — a real security weakening.
//
// Short-circuited guard, both checks in one superRefine (Codex round 12):
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
// whether the form is stock HTML or a JS-driven component (Codex round 13
// / P2).
const formBoolean = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === 'on';
  return false;
}, z.boolean());

export const updateUserSchema = z
  .object({
    displayName: displayNameField,
    phone: phoneField,
    role: roleField,
    workerType: workerTypeField,
    machineType: machineTypeField,
    isActive: formBoolean,
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
// the new craft ahead of every existing one (Codex round 18 / P2).
const sortOrderField = z.coerce
  .number({ message: '排序必须是数字' })
  .int('排序必须是整数')
  .min(1, '排序必须 ≥ 1（建议从 10 起，每 10 留一档）')
  .max(9999, '排序过大');

export const createCraftSchema = z.object({
  name: craftNameField,
  code: craftCodeField,
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
  isActive: formBoolean,
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
const moneyOptionalField = z
  .string()
  .trim()
  .refine(
    (v) => v === '' || /^\d{1,6}(\.\d{1,4})?$/.test(v),
    { message: '金额格式错误（整数部分最多 6 位、小数最多 4 位、非负数）' },
  )
  .transform((v) => (v === '' ? null : v));

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

const productCategoryField = z.nativeEnum(ProductCategory);

export const createProductSchema = z.object({
  category: productCategoryField,
  name: productNameField,
  specification: productTextFieldOptional('规格', 64),
  paperType: productTextFieldOptional('纸张', 32),
  baseUnitPrice: moneyOptionalField,
  minOrderQty: minOrderQtyField,
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  category: productCategoryField,
  name: productNameField,
  specification: productTextFieldOptional('规格', 64),
  paperType: productTextFieldOptional('纸张', 32),
  baseUnitPrice: moneyOptionalField,
  minOrderQty: minOrderQtyField,
  isActive: formBoolean,
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;
