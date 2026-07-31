import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MachineType, Role, WorkerType } from '@/generated/prisma/client';
import { UnauthorizedError } from '../errors';

const { authMock, findUniqueMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});
vi.mock('../config', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: findUniqueMock } },
}));

import {
  getVerifiedSession,
  getSession,
  requireSession,
  requireVerifiedSession,
} from '../session';

function jwtSession() {
  return {
    user: {
      id: 'user-1',
      username: 'stale-name',
      displayName: '旧名称',
      role: Role.ADMIN,
      workerType: null,
      machineType: null,
    },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

const activeUser = {
  id: 'user-1',
  username: 'current-name',
  displayName: '当前名称',
  role: Role.WORKER,
  workerType: WorkerType.MACHINE,
  machineType: MachineType.WINDMILL,
  isActive: true,
};

beforeEach(() => {
  authMock.mockReset();
  findUniqueMock.mockReset();
});

describe('verified session', () => {
  it('does not query the database without a JWT session', async () => {
    authMock.mockResolvedValue(null);

    await expect(getSession()).resolves.toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('rejects a JWT whose user was deleted', async () => {
    authMock.mockResolvedValue(jwtSession());
    findUniqueMock.mockResolvedValue(null);

    await expect(getSession()).resolves.toBeNull();
    await expect(requireSession()).rejects.toMatchObject({
      name: 'UnauthorizedError',
      message: '未登录或登录状态已失效，请重新登录',
    });
  });

  it('rejects a disabled account', async () => {
    authMock.mockResolvedValue(jwtSession());
    findUniqueMock.mockResolvedValue({ ...activeUser, isActive: false });

    await expect(getSession()).resolves.toBeNull();
  });

  it('uses current database identity and role instead of stale JWT claims', async () => {
    authMock.mockResolvedValue(jwtSession());
    findUniqueMock.mockResolvedValue(activeUser);

    const session = await requireSession();

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        workerType: true,
        machineType: true,
        isActive: true,
      },
    });
    expect(session.user).toMatchObject({
      id: activeUser.id,
      username: activeUser.username,
      displayName: activeUser.displayName,
      role: Role.WORKER,
      workerType: WorkerType.MACHINE,
      machineType: MachineType.WINDMILL,
    });
  });

  it('throws the shared authorization error when no verified session exists', async () => {
    authMock.mockResolvedValue(null);

    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('verifies Route Handler sessions supplied by the NextAuth wrapper', async () => {
    findUniqueMock.mockResolvedValue(activeUser);

    await expect(getVerifiedSession(jwtSession())).resolves.toMatchObject({
      user: { id: activeUser.id, role: activeUser.role },
    });
    await expect(requireVerifiedSession(jwtSession())).resolves.toMatchObject({
      user: { id: activeUser.id, role: activeUser.role },
    });
    expect(authMock).not.toHaveBeenCalled();
  });
});
