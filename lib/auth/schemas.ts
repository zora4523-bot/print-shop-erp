import { z } from 'zod';

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
