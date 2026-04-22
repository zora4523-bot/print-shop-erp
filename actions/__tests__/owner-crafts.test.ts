import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MachineType, Prisma } from '../../generated/prisma/client';
import { UnauthorizedError } from '../../lib/auth/errors';

const { permissionsMock, craftMock, revalidatePathMock, MockCraftInvariantError } =
  vi.hoisted(() => ({
    permissionsMock: { requirePermission: vi.fn() },
    craftMock: {
      createCraft: vi.fn(),
      updateCraft: vi.fn(),
      setCraftActive: vi.fn(),
    },
    revalidatePathMock: vi.fn(),
    MockCraftInvariantError: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CraftInvariantError';
      }
    },
  }));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/craft', () => ({
  createCraft: craftMock.createCraft,
  updateCraft: craftMock.updateCraft,
  setCraftActive: craftMock.setCraftActive,
  CraftInvariantError: MockCraftInvariantError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  createCraftAction,
  updateCraftAction,
  setCraftActiveAction,
} from '../owner-crafts';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '老板',
  role: 'OWNER',
  workerType: null,
  machineType: null,
};

const validCreateFields = {
  name: '专版单色平烫',
  code: 'FLAT_FOIL_SINGLE',
  isOutsource: 'false',
  defaultMachineType: MachineType.WINDMILL,
  sortOrder: '20',
};

const fd = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  craftMock.createCraft.mockReset();
  craftMock.updateCraft.mockReset();
  craftMock.setCraftActive.mockReset();
  revalidatePathMock.mockReset();
});

describe('createCraftAction', () => {
  it("first-line requirePermission('dict:craft:manage'); unauth bubbles", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(createCraftAction(null, fd(validCreateFields))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('dict:craft:manage');
    expect(craftMock.createCraft).not.toHaveBeenCalled();
  });

  it('short-circuits on schema failure (lowercase code)', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createCraftAction(
      null,
      fd({ ...validCreateFields, code: 'lowercase' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.fieldErrors.code).toBeDefined();
    expect(craftMock.createCraft).not.toHaveBeenCalled();
  });

  it('maps Prisma P2002 on code to invalid.code field error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['code'] },
      }),
    );
    const result = await createCraftAction(null, fd(validCreateFields));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.code).toContain('该代码已被占用');
    }
  });

  it('maps P2002 on name to invalid.name field error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['name'] },
      }),
    );
    const result = await createCraftAction(null, fd(validCreateFields));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.name).toContain('该工艺名已被占用');
    }
  });

  it('revalidates /owner/crafts on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });
    const result = await createCraftAction(null, fd(validCreateFields));
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/crafts');
  });

  it('coerces sortOrder string into int at the schema layer', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });
    await createCraftAction(null, fd({ ...validCreateFields, sortOrder: '42' }));
    expect(craftMock.createCraft).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 42 }),
    );
  });

  it('browser-default checkbox isOutsource=on parses as true', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });
    await createCraftAction(null, fd({ ...validCreateFields, isOutsource: 'on' }));
    expect(craftMock.createCraft).toHaveBeenCalledWith(
      expect.objectContaining({ isOutsource: true }),
    );
  });

  it('missing isOutsource (unchecked checkbox) parses as false', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });
    const f = new FormData();
    f.set('name', '粘封');
    f.set('code', 'GLUING');
    f.set('defaultMachineType', MachineType.GLUE);
    f.set('sortOrder', '40');
    // isOutsource deliberately absent
    await createCraftAction(null, f);
    expect(craftMock.createCraft).toHaveBeenCalledWith(
      expect.objectContaining({ isOutsource: false }),
    );
  });
});

describe('updateCraftAction', () => {
  const baseUpdate = { ...validCreateFields, isActive: 'true' };

  it('requires dict:craft:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(updateCraftAction('c', null, fd(baseUpdate))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('maps CraftInvariantError to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.updateCraft.mockRejectedValueOnce(new MockCraftInvariantError('目标工艺不存在'));
    const result = await updateCraftAction('c', null, fd(baseUpdate));
    expect(result.status).toBe('error');
  });

  it('revalidates both the list and the item route on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.updateCraft.mockResolvedValue({ id: 'c' });
    await updateCraftAction('c', null, fd(baseUpdate));
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/crafts');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/crafts/c');
  });
});

describe('setCraftActiveAction', () => {
  it('requires dict:craft:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(setCraftActiveAction('c', false)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('maps invariant error to error status', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.setCraftActive.mockRejectedValueOnce(
      new MockCraftInvariantError('目标工艺不存在'),
    );
    const result = await setCraftActiveAction('c', false);
    expect(result.status).toBe('error');
  });

  it('revalidates on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.setCraftActive.mockResolvedValue({ id: 'c' });
    const result = await setCraftActiveAction('c', false);
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/crafts');
  });
});
