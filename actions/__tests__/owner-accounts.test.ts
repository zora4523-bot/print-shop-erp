import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role, WorkerType, MachineType, Prisma } from '../../generated/prisma/client';
import { UnauthorizedError } from '../../lib/auth/errors';

// ─────────────────────────────────────────────────────────────────────
// Hoisted mocks — every dependency of actions/owner-accounts.ts must
// be replaced so the unit test never hits the real DB, real session,
// or the real next/cache revalidatePath.
// ─────────────────────────────────────────────────────────────────────
// Fully replace dependencies — no importActual. The real modules transitively
// pull in next-auth and the Prisma singleton, neither of which is wanted in
// a unit test environment. Everything vi.mock uses must be declared via
// vi.hoisted so it's initialized before the hoisted mock factories run.
const {
  permissionsMock,
  accountMock,
  revalidatePathMock,
  redirectMock,
  MockAccountInvariantError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  accountMock: {
    createUser: vi.fn(),
    updateUser: vi.fn(),
    setUserActive: vi.fn(),
    resetUserPassword: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  // redirect() in prod throws NEXT_REDIRECT; mock mirrors that so we can
  // distinguish "create succeeded + redirected" from "create still running".
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  MockAccountInvariantError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AccountInvariantError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/account', () => ({
  createUser: accountMock.createUser,
  updateUser: accountMock.updateUser,
  setUserActive: accountMock.setUserActive,
  resetUserPassword: accountMock.resetUserPassword,
  AccountInvariantError: MockAccountInvariantError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createUserAction,
  updateUserAction,
  setUserActiveAction,
  resetUserPasswordAction,
} from '../owner-accounts';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '老板',
  role: Role.OWNER,
  workerType: null,
  machineType: null,
};

const fd = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  accountMock.createUser.mockReset();
  accountMock.updateUser.mockReset();
  accountMock.setUserActive.mockReset();
  accountMock.resetUserPassword.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createUserAction', () => {
  it('calls requirePermission("account:manage") first — auth failure bubbles', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      createUserAction(
        null,
        fd({ username: 'u', displayName: 'U', role: Role.SALES, password: 'a'.repeat(10) }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('account:manage');
    expect(accountMock.createUser).not.toHaveBeenCalled();
  });

  it('returns invalid result on schema failure (no DB call)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createUserAction(
      null,
      fd({ username: 'x', displayName: '', role: Role.SALES, password: 'short' }),
    );
    expect(result.status).toBe('invalid');
    expect(accountMock.createUser).not.toHaveBeenCalled();
  });

  it('maps Prisma P2002 unique-violation to field error on username', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['username'] },
    });
    accountMock.createUser.mockRejectedValueOnce(err);
    const result = await createUserAction(
      null,
      fd({
        username: 'alice',
        displayName: 'Alice',
        role: Role.SALES,
        password: 'plain-pass-1',
        phone: '',
      }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.username).toContain('该用户名已被占用');
    }
  });

  it('handles P2002 where meta.target is the column as a single string', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    accountMock.createUser.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'username' },
      }),
    );
    const result = await createUserAction(
      null,
      fd({
        username: 'alice',
        displayName: 'Alice',
        role: Role.SALES,
        password: 'plain-pass-1',
        phone: '',
      }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.username).toContain('该用户名已被占用');
    }
  });

  it('handles P2002 where meta.target is the Prisma default constraint name (Codex round 17 / P2)', async () => {
    // Some connectors return `User_username_key` (the default Prisma
    // unique-index name) instead of the column. Must still map.
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    accountMock.createUser.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'User_username_key' },
      }),
    );
    const result = await createUserAction(
      null,
      fd({
        username: 'alice',
        displayName: 'Alice',
        role: Role.SALES,
        password: 'plain-pass-1',
        phone: '',
      }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.username).toContain('该用户名已被占用');
    }
  });

  it('revalidates + redirects to the new account edit page on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    accountMock.createUser.mockResolvedValue({ id: 'u1' });

    await expect(
      createUserAction(
        null,
        fd({
          username: 'alice',
          displayName: 'Alice',
          role: Role.WORKER,
          workerType: WorkerType.MACHINE,
          machineType: MachineType.WINDMILL,
          password: 'plain-pass-1',
          phone: '',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/accounts');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/salary/cs/new');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/foreman/scheduling/[id]',
      'page',
    );
    expect(redirectMock).toHaveBeenCalledWith('/owner/accounts/u1');
  });
});

describe('updateUserAction', () => {
  const baseUpdate = {
    displayName: 'Alice',
    phone: '',
    role: Role.SALES,
    workerType: '',
    machineType: '',
  };

  it('requires account:manage; unauth bubbles', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(updateUserAction('user-1', null, fd(baseUpdate))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('passes the validated data AND the actor through to lib.updateUser', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    accountMock.updateUser.mockResolvedValue({ id: 'user-1' });

    await updateUserAction('user-1', null, fd(baseUpdate));

    expect(accountMock.updateUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        displayName: 'Alice',
        role: Role.SALES,
      }),
      expect.objectContaining({ id: 'actor-owner', role: Role.OWNER }),
    );
    // isActive is OWNED BY setUserActive, not this path — must not reach lib.
    const args = accountMock.updateUser.mock.calls[0][1] as Record<string, unknown>;
    expect('isActive' in args).toBe(false);
  });

  it('maps AccountInvariantError to error result, not a throw', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    accountMock.updateUser.mockRejectedValueOnce(new MockAccountInvariantError('最后一位 OWNER'));

    const result = await updateUserAction('user-1', null, fd(baseUpdate));
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toBe('最后一位 OWNER');
    }
  });

  it('returns invalid on cascade mismatch (role=WORKER without workerType)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await updateUserAction(
      'user-1',
      null,
      fd({ ...baseUpdate, role: Role.WORKER, workerType: '', machineType: '' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.workerType).toBeDefined();
    }
    expect(accountMock.updateUser).not.toHaveBeenCalled();
  });
});

describe('setUserActiveAction', () => {
  it('requires account:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(setUserActiveAction('u', false)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('passes the actor through so self-deactivation guard can fire', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    accountMock.setUserActive.mockResolvedValue({ id: 'other-owner' });

    await setUserActiveAction('other-owner', false);
    expect(accountMock.setUserActive).toHaveBeenCalledWith(
      'other-owner',
      false,
      expect.objectContaining({ id: 'actor-owner', role: Role.OWNER }),
    );
  });

  it('maps invariant error to error result', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    accountMock.setUserActive.mockRejectedValueOnce(
      new MockAccountInvariantError('不能停用自己的账号'),
    );
    const result = await setUserActiveAction('actor-owner', false);
    expect(result.status).toBe('error');
  });
});

describe('resetUserPasswordAction', () => {
  it('requires account:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(
      resetUserPasswordAction('u', null, fd({ newPassword: 'new-one-1234' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns invalid on short password (no DB call)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await resetUserPasswordAction('u', null, fd({ newPassword: 'short7_' }));
    expect(result.status).toBe('invalid');
    expect(accountMock.resetUserPassword).not.toHaveBeenCalled();
  });

  it('delegates to lib.resetUserPassword and revalidates the edit page', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    accountMock.resetUserPassword.mockResolvedValue(undefined);

    const result = await resetUserPasswordAction(
      'user-1',
      null,
      fd({ newPassword: 'brand-new-1' }),
    );
    expect(result.status).toBe('success');
    expect(accountMock.resetUserPassword).toHaveBeenCalledWith('user-1', 'brand-new-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/accounts/user-1');
  });
});
