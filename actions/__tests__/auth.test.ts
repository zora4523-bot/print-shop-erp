import { describe, expect, it, vi } from 'vitest';
import { CredentialsSignin } from '@auth/core/errors';

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));

vi.mock('@/lib/auth/config', () => ({ signIn: signInMock }));

import { loginAuthErrorResult } from '../../lib/auth/action-errors';

class RateLimited extends CredentialsSignin {
  code = 'rate_limited';
}

describe('loginAuthErrorResult', () => {
  it('returns a distinct non-enumerating rate-limit response', async () => {
    expect(loginAuthErrorResult(new RateLimited())).toEqual({
      status: 'error',
      message: '登录尝试过于频繁，请稍后再试',
    });
  });

  it('does not suppress unexpected authentication failures', async () => {
    const failure = new Error('unexpected auth failure');
    expect(loginAuthErrorResult(failure)).toBeNull();
  });
});


describe('signInWithCredentials username recovery', () => {
  it('returns submitted username after rejected credentials without returning the password', async () => {
    const { signInWithCredentials } = await import('../auth');
    signInMock.mockRejectedValueOnce(new CredentialsSignin());
    const data = new FormData();
    data.set('username', 'prehydration-user');
    data.set('password', 'wrong-password');
    expect(await signInWithCredentials(null, data)).toEqual({
      status: 'error', message: '用户名或密码错误', username: 'prehydration-user',
    });
  });

  it('returns submitted username on validation failure', async () => {
    const { signInWithCredentials } = await import('../auth');
    const data = new FormData();
    data.set('username', 'prehydration-user');
    data.set('password', '');
    const result = await signInWithCredentials(null, data);
    expect(result).toMatchObject({ status: 'invalid', username: 'prehydration-user' });
    expect(result).not.toHaveProperty('password');
  });
});
