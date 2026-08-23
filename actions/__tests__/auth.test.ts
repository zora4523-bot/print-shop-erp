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
