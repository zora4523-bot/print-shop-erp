import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../../generated/prisma/enums';

const { consumeMock, findUserMock, compareMock, hashMock } = vi.hoisted(() => ({
  consumeMock: vi.fn(),
  findUserMock: vi.fn(),
  compareMock: vi.fn(),
  hashMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/login-rate-limit', () => ({
  consumeLoginRateLimit: consumeMock,
}));
vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: findUserMock } },
}));
vi.mock('bcryptjs', () => ({
  default: { compare: compareMock, hash: hashMock },
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

// Login must not reveal whether a username exists (or is usable) through
// response time: every lookup that reaches the database pays one bcrypt
// compare, and every unusable account still resolves to the same null.
describe('authorizeCredentials username-enumeration timing', () => {
  const DUMMY_HASH = '$2b$10$dummy.hash.for.timing.equalisation.only.xxxxxxxxxx';
  const credentials = { username: 'ghost', password: 'correct-horse-battery-staple' };

  let authorize: typeof authorizeCredentials;

  beforeEach(async () => {
    consumeMock.mockReset().mockResolvedValue(true);
    findUserMock.mockReset();
    compareMock.mockReset().mockResolvedValue(false);
    hashMock.mockReset().mockResolvedValue(DUMMY_HASH);
    // Fresh module per test so the lazily created dummy hash starts empty.
    vi.resetModules();
    ({ authorizeCredentials: authorize } = await import('../credentials'));
  });

  it('runs one bcrypt compare against a cost-10 dummy hash when the user is missing', async () => {
    findUserMock.mockResolvedValue(null);

    await expect(authorize(credentials, request)).resolves.toBeNull();

    expect(hashMock).toHaveBeenCalledTimes(1);
    expect(hashMock).toHaveBeenCalledWith(expect.any(String), 10);
    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(compareMock).toHaveBeenCalledWith(credentials.password, DUMMY_HASH);
  });

  it('creates the dummy hash once and reuses it for later misses', async () => {
    findUserMock.mockResolvedValue(null);

    await authorize(credentials, request);
    await authorize({ ...credentials, username: 'ghost-2' }, request);

    expect(hashMock).toHaveBeenCalledTimes(1);
    expect(compareMock).toHaveBeenCalledTimes(2);
    expect(compareMock).toHaveBeenNthCalledWith(2, credentials.password, DUMMY_HASH);
  });

  it('still compares and returns null for an inactive user, even with the right password', async () => {
    findUserMock.mockResolvedValue({
      id: 'user-2',
      username: 'ghost',
      password: 'stored-bcrypt-hash',
      displayName: 'Ghost',
      role: Role.SALES,
      workerType: null,
      machineType: null,
      isActive: false,
    });
    compareMock.mockResolvedValue(true);

    await expect(authorize(credentials, request)).resolves.toBeNull();

    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(compareMock).toHaveBeenCalledWith(credentials.password, 'stored-bcrypt-hash');
  });
});
