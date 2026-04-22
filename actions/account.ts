'use server';

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { signOut } from '@/lib/auth/config';
import { changePasswordSchema } from '@/lib/auth/schemas';

export type ChangePasswordResult =
  | { status: 'success' }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export async function changeMyPassword(
  _prev: ChangePasswordResult | null,
  formData: FormData,
): Promise<ChangePasswordResult> {
  const session = await requireSession();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = (issue.path[0] as string | undefined) ?? '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { status: 'invalid', fieldErrors };
  }

  const me = await db.user.findUnique({ where: { id: session.user.id } });
  // Session refers to a user that no longer exists — e.g. account deleted in
  // another tab. Surface it as an error and let the page nudge re-login.
  if (!me || !me.isActive) {
    return { status: 'error', message: '当前账号已不可用，请重新登录' };
  }

  const currentOk = await bcrypt.compare(parsed.data.currentPassword, me.password);
  if (!currentOk) {
    return { status: 'invalid', fieldErrors: { currentPassword: ['当前密码不正确'] } };
  }

  const hashed = await bcrypt.hash(parsed.data.newPassword, 10);
  await db.user.update({
    where: { id: me.id },
    data: { password: hashed },
  });

  return { status: 'success' };
}

export async function signOutAction() {
  await signOut({ redirectTo: '/login' });
}
