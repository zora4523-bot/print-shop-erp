import { AuthError } from '@auth/core/errors';

export type LoginActionResult =
  | { status: 'error'; message: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> };

export function loginAuthErrorResult(error: unknown): LoginActionResult | null {
  // Auth.js can surface provider errors through either its re-export or the
  // @auth/core class directly. The stable public discriminator is `type`;
  // relying only on instanceof can fail when a bundle contains two module
  // instances of the same Auth.js package.
  const type =
    error && typeof error === 'object' && 'type' in error
      ? (error as { type?: unknown }).type
      : undefined;
  if (type === 'CredentialsSignin') {
    const code =
      'code' in (error as object)
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 'rate_limited') {
      return { status: 'error', message: '登录尝试过于频繁，请稍后再试' };
    }
    return { status: 'error', message: '用户名或密码错误' };
  }
  if (error instanceof AuthError) {
    return { status: 'error', message: '登录失败，请稍后重试' };
  }
  return null;
}
