'use server';

import { AuthError } from 'next-auth';
import { signIn } from '@/lib/auth/config';
import { loginSchema } from '@/lib/auth/schemas';
import { safeInternalPath } from '@/lib/auth/redirect';

// Shape the LoginForm reads to render error text / decide redirect.
// `redirectTo` on success is the path we want the client to navigate to; we
// don't call redirect() here because Auth.js's Credentials signIn already
// throws NEXT_REDIRECT internally when given a valid redirectTo.
export type LoginActionResult =
  | { status: 'error'; message: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> };

export async function signInWithCredentials(
  _prev: LoginActionResult | null,
  formData: FormData,
): Promise<LoginActionResult> {
  const raw = {
    username: formData.get('username'),
    password: formData.get('password'),
  };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { status: 'invalid', fieldErrors };
  }

  // Sanitize the post-login target so `/login?from=//evil.example` can't turn
  // the auth flow into an open redirect .
  const from = safeInternalPath(formData.get('from'));

  try {
    // On success Auth.js throws NEXT_REDIRECT; this function never "returns"
    // a success value — the thrown redirect is propagated to the client.
    await signIn('credentials', {
      username: parsed.data.username,
      password: parsed.data.password,
      redirectTo: from,
    });
    // Unreachable in practice.
    return { status: 'error', message: '登录流程未触发跳转' };
  } catch (err) {
    // Auth.js re-throws NEXT_REDIRECT as a special Error; let it bubble.
    if ((err as Error)?.message === 'NEXT_REDIRECT') {
      throw err;
    }
    if (err instanceof AuthError) {
      // CredentialsSignin covers both "bad username" and "bad password".
      // We intentionally do NOT distinguish, to avoid username-enumeration.
      if (err.type === 'CredentialsSignin') {
        return { status: 'error', message: '用户名或密码错误' };
      }
      return { status: 'error', message: '登录失败，请稍后重试' };
    }
    throw err;
  }
}
