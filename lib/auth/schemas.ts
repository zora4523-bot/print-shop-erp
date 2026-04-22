import { z } from 'zod';

// bcrypt (and bcryptjs, which we use) only hashes the first 72 bytes of the
// input. Anything beyond that is silently truncated, so a 200-byte password
// is indistinguishable from a different 200-byte password that shares the
// same first 72 bytes. That means if we let users *set* passwords longer
// than 72 bytes, they can later log in with any suffix — a real security
// weakening. Cap any newly-set password at exactly the bcrypt boundary.
//
// Two-gate guard:
//   1. .max(72) fails fast on .length, which is UTF-16 units — cheap and
//      ensures we never call TextEncoder.encode on a pathologically large
//      payload (Codex round 11). Since every UTF-8 byte maps to ≥ 1 UTF-16
//      code unit at the source side, any input whose .length > 72 is
//      guaranteed to exceed 72 UTF-8 bytes too, so no legitimate input is
//      lost by tripping this gate first.
//   2. The refine() then does the exact byte count for the ≤72-char inputs
//      where multibyte chars may still push bytes over the limit (e.g. 25
//      Chinese chars = 75 bytes).
const BCRYPT_MAX_BYTES = 72;
const UTF8 = new TextEncoder();
const bcryptSafeByteLimit = {
  check: (v: string) => UTF8.encode(v).length <= BCRYPT_MAX_BYTES,
  message:
    '密码过长（按 UTF-8 字节计，最多 72 字节。纯英文约 72 字符，含中文约 24 字符）',
};

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
      .max(72, '新密码过长（最多 72 字符）')
      .refine(bcryptSafeByteLimit.check, { message: bcryptSafeByteLimit.message }),
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
