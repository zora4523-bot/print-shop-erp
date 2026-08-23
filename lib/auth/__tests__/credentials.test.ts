import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../../generated/prisma/enums';

const { consumeMock, findUserMock, compareMock } = vi.hoisted(() => ({
  consumeMock: vi.fn(),
  findUserMock: vi.fn(),
  compareMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/login-rate-limit', () => ({
  consumeLoginRateLimit: consumeMock,
}));
vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: findUserMock } },
}));
vi.mock('bcryptjs', () => ({
  default: { compare: compareMock },
}));

import {
  authorizeCredentials,
  LoginRateLimitedError,
  LoginRateLimitUnavailableError,
} from '../credentials';

const request = new Request('https://erp.example.com/api/auth/callback/credentials', {
  method: 'POST',
  headers: { 'x-real-ip': '203.0.113.8' },
});

describe('authorizeCredentials rate-limit boundary', () => {
  beforeEach(() => {
    consumeMock.mockReset().mockResolvedValue(true);
    findUserMock.mockReset();
    compareMock.mockReset();
  });

  it('counts malformed credential bodies before validation', async () => {
    await expect(authorizeCredentials({}, request)).resolves.toBeNull();
    expect(consumeMock).toHaveBeenCalledWith(request.headers);
    expect(findUserMock).not.toHaveBeenCalled();
  });

  it('rejects an exhausted bucket before any user lookup or bcrypt work', async () => {
    consumeMock.mockResolvedValue(false);
    await expect(
      authorizeCredentials(
        { username: 'alice', password: 'correct-horse-battery-staple' },
        request,
      ),
    ).rejects.toBeInstanceOf(LoginRateLimitedError);
    expect(findUserMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it('wraps limiter infrastructure errors without treating them as bad credentials', async () => {
    consumeMock.mockRejectedValue(new Error('postgres offline'));
    await expect(
      authorizeCredentials(
        { username: 'alice', password: 'correct-horse-battery-staple' },
        request,
      ),
    ).rejects.toBeInstanceOf(LoginRateLimitUnavailableError);
    expect(findUserMock).not.toHaveBeenCalled();
  });

  it('continues to authenticate valid active users after consuming a token', async () => {
    findUserMock.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      password: 'bcrypt-hash',
      displayName: 'Alice',
      role: Role.SALES,
      workerType: null,
      machineType: null,
      isActive: true,
    });
    compareMock.mockResolvedValue(true);

    await expect(
      authorizeCredentials(
        { username: 'alice', password: 'correct-horse-battery-staple' },
        request,
      ),
    ).resolves.toEqual({
      id: 'user-1',
      username: 'alice',
      displayName: 'Alice',
      role: Role.SALES,
      workerType: null,
      machineType: null,
    });
  });
});
