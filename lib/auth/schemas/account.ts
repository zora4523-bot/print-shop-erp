// 登录、改密与管理员侧账号管理（SPEC §2 + §9.1）
// 由 lib/auth/schemas.ts 按域拆出（2026-09-14）；对外仍通过 lib/auth/schemas.ts 统一导出。
import { z } from 'zod';
import { Role, WorkerType, MachineType, EmploymentType } from '../../../generated/prisma/enums';
import { parseStrictYmd } from './shared';

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

// isActive is intentionally NOT part of the update schema. Activation is
// controlled by a dedicated setXxxActive action (surfaced in the UI as a
// separate "停用/启用" button), so the basic-info form can't silently flip
// activation mid-edit. Same pattern applies to updateCraftSchema and
// updateProductSchema in ./catalog.ts.
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
