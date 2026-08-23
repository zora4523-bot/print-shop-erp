'use server';

import { signIn } from '@/lib/auth/config';
import { loginSchema } from '@/lib/auth/schemas';
import { safeInternalPath } from '@/lib/auth/redirect';
import { invalidFromIssuesDeep } from '@/lib/admin/action-helpers';
import {
  loginAuthErrorResult,
  type LoginActionResult,
} from '@/lib/auth/action-errors';

export type { LoginActionResult } from '@/lib/auth/action-errors';

// Shape the LoginForm reads to render error text / decide redirect.
// `redirectTo` on success is the path we want the client to navigate to; we
// don't call redirect() here because Auth.js's Credentials signIn already
// throws NEXT_REDIRECT internally when given a valid redirectTo.
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
    return invalidFromIssuesDeep(parsed.error.issues);
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
    const authErrorResult = loginAuthErrorResult(err);
    if (authErrorResult) return authErrorResult;
    throw err;
  }
}
