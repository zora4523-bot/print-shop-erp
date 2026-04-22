import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { Role } from '../../generated/prisma/client';
import { UnauthorizedError } from '../../lib/auth/errors';

// vi.mock factories are hoisted above top-level declarations, so refs to
// `dbMock`/`sessionMock` must also be hoisted to dodge the TDZ. vi.hoisted
// gives us a single place to define them and return them for both the mocks
// and the per-test assertions.
const { dbMock, sessionMock } = vi.hoisted(() => ({
  dbMock: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  sessionMock: { requireSession: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
  requireSession: () => sessionMock.requireSession(),
}));
// signOut is only used by signOutAction; stub it so importing this file
// doesn't blow up trying to wire Auth.js.
vi.mock('@/lib/auth/config', () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
  signIn: vi.fn(),
  auth: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

import { changeMyPassword } from '../account';

const formData = (data: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
};

const session = {
  user: {
    id: 'user-1',
    username: 'alice',
    displayName: 'Alice',
    role: Role.SALES,
    workerType: null,
    machineType: null,
  },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
};

describe('changeMyPassword', () => {
  const currentPlain = 'old-one-123';
  let storedHash: string;

  beforeEach(async () => {
    dbMock.user.findUnique.mockReset();
    dbMock.user.update.mockReset();
    sessionMock.requireSession.mockReset();
    storedHash = await bcrypt.hash(currentPlain, 4); // low rounds for test speed
  });

  it('requires a session (bubbles UnauthorizedError from requireSession)', async () => {
    sessionMock.requireSession.mockImplementation(() => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      changeMyPassword(null, formData({ currentPassword: 'x', newPassword: 'y'.repeat(10), confirmPassword: 'y'.repeat(10) })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns invalid when schema fails (short new password)', async () => {
    sessionMock.requireSession.mockResolvedValue(session);
    const result = await changeMyPassword(
      null,
      formData({ currentPassword: currentPlain, newPassword: 'short7_', confirmPassword: 'short7_' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.newPassword).toBeDefined();
    }
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it('returns invalid when confirm does not match', async () => {
    sessionMock.requireSession.mockResolvedValue(session);
    const result = await changeMyPassword(
      null,
      formData({ currentPassword: currentPlain, newPassword: 'brand-new-secret', confirmPassword: 'different-one' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.confirmPassword).toContain('两次输入的新密码不一致');
    }
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it('returns invalid when new == current (before hitting DB)', async () => {
    sessionMock.requireSession.mockResolvedValue(session);
    const result = await changeMyPassword(
      null,
      formData({ currentPassword: 'same-one-1234', newPassword: 'same-one-1234', confirmPassword: 'same-one-1234' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.newPassword).toContain('新密码不能与当前密码相同');
    }
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns error when the session user no longer exists in DB', async () => {
    sessionMock.requireSession.mockResolvedValue(session);
    dbMock.user.findUnique.mockResolvedValue(null);
    const result = await changeMyPassword(
      null,
      formData({ currentPassword: currentPlain, newPassword: 'brand-new-secret', confirmPassword: 'brand-new-secret' }),
    );
    expect(result.status).toBe('error');
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it('returns error when the user has been deactivated', async () => {
    sessionMock.requireSession.mockResolvedValue(session);
    dbMock.user.findUnique.mockResolvedValue({ id: 'user-1', password: storedHash, isActive: false });
    const result = await changeMyPassword(
      null,
      formData({ currentPassword: currentPlain, newPassword: 'brand-new-secret', confirmPassword: 'brand-new-secret' }),
    );
    expect(result.status).toBe('error');
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it('returns invalid.currentPassword when the current password does not match the stored hash', async () => {
    sessionMock.requireSession.mockResolvedValue(session);
    dbMock.user.findUnique.mockResolvedValue({ id: 'user-1', password: storedHash, isActive: true });
    const result = await changeMyPassword(
      null,
      formData({ currentPassword: 'wrong-one-1', newPassword: 'brand-new-secret', confirmPassword: 'brand-new-secret' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.currentPassword).toContain('当前密码不正确');
    }
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it('hashes the new password and updates the DB on success', async () => {
    sessionMock.requireSession.mockResolvedValue(session);
    dbMock.user.findUnique.mockResolvedValue({ id: 'user-1', password: storedHash, isActive: true });
    dbMock.user.update.mockResolvedValue({ id: 'user-1' });

    const result = await changeMyPassword(
      null,
      formData({
        currentPassword: currentPlain,
        newPassword: 'brand-new-secret',
        confirmPassword: 'brand-new-secret',
      }),
    );
    expect(result.status).toBe('success');
    expect(dbMock.user.update).toHaveBeenCalledOnce();
    const call = dbMock.user.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'user-1' });
    // The stored value must be a bcrypt hash of the new plaintext, not the
    // plaintext itself.
    expect(call.data.password).not.toBe('brand-new-secret');
    const storedNew = call.data.password as string;
    expect(await bcrypt.compare('brand-new-secret', storedNew)).toBe(true);
    // And the old plaintext must NOT verify against the new hash.
    expect(await bcrypt.compare(currentPlain, storedNew)).toBe(false);
  });
});
