import { z } from 'zod';

// Password policy: ≥8 chars (decision A). Cap length defensively so bcrypt
// doesn't burn CPU on pathological inputs. Username trims so trailing spaces
// on a phone keyboard don't lock the user out.
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
