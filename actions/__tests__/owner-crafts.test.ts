import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  craftMock,
  revalidatePathMock,
  redirectMock,
  MockCraftInvariantError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  craftMock: {
    createCraft: vi.fn(),
    updateCraft: vi.fn(),
    setCraftActive: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
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
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createRuleCenterCraftAction,
  updateCraftAction,
  setCraftActiveAction,
} from '../owner-crafts';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  workerType: null,
  machineType: null,
};

const validCreateFields = {
  name: '专版单色平烫',
  isOutsource: 'false',
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
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createRuleCenterCraftAction', () => {
  it('新建工艺始终由服务端生成稳定编号', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });

    await expect(
      createRuleCenterCraftAction(
        null,
        fd({ ...validCreateFields, code: 'FORGED_CRAFT_CODE' }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(craftMock.createCraft).toHaveBeenCalledWith(
      expect.objectContaining({ code: null }),
    );
  });

  it("first-line requirePermission('dict:craft:manage'); unauth bubbles", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(createRuleCenterCraftAction(null, fd(validCreateFields))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('dict:craft:manage');
    expect(craftMock.createCraft).not.toHaveBeenCalled();
  });

  it('自动编号冲突返回可见的业务错误', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['code'] },
      }),
    );
    const result = await createRuleCenterCraftAction(null, fd(validCreateFields));
    expect(result).toEqual({
      status: 'error',
      message: '系统未能生成工艺编号，请重新提交。',
    });
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
    const result = await createRuleCenterCraftAction(null, fd(validCreateFields));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.name).toContain('该工艺名已被占用');
    }
  });

  it('handles P2002 where meta.target is a single column string', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'code' },
      }),
    );
    const result = await createRuleCenterCraftAction(null, fd(validCreateFields));
    expect(result.status).toBe('error');
  });

  it('handles P2002 where meta.target is the Prisma default constraint name (Codex round 17 / P2)', async () => {
    // Some connectors return the `<Model>_<column>_key` form. The
    // synonym allowlist must accept it so real duplicate-code errors
    // still map to a field-level message.
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'Craft_code_key' },
      }),
    );
    const result = await createRuleCenterCraftAction(null, fd(validCreateFields));
    expect(result.status).toBe('error');
  });

  it("doesn't false-positive on an unrelated index name that contains 'name' as substring", async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'Craft_something_name_idx' },
      }),
    );
    // Not in our synonym allowlist → bubbles up, not mapped.
    await expect(createRuleCenterCraftAction(null, fd(validCreateFields))).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('revalidates + redirects to the new craft edit page on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });
    await expect(createRuleCenterCraftAction(null, fd(validCreateFields))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/crafts');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/crafts/craft-new',
    );
    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/rules/crafts/craft-new?created=1',
    );
  });

  it('keeps rule-center craft creation inside the rule center', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });

    await expect(
      createRuleCenterCraftAction(
        null,
        fd({
          ...validCreateFields,
          routeBase: '/owner/rules/crafts',
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/rules/crafts/craft-new?created=1',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/crafts');
  });

  it('规则中心专用 action 不信任伪造的返回路径', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });

    await expect(
      createRuleCenterCraftAction(
        null,
        fd({ ...validCreateFields, routeBase: '/owner/crafts' }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/rules/crafts/craft-new?created=1',
    );
  });

  it('coerces sortOrder string into int at the schema layer', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });
    await expect(
      createRuleCenterCraftAction(null, fd({ ...validCreateFields, sortOrder: '42' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(craftMock.createCraft).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 42 }),
    );
  });

  it('browser-default checkbox isOutsource=on parses as true', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });
    await expect(
      createRuleCenterCraftAction(null, fd({ ...validCreateFields, isOutsource: 'on' })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(craftMock.createCraft).toHaveBeenCalledWith(
      expect.objectContaining({ isOutsource: true }),
    );
  });

  it('missing isOutsource (unchecked checkbox) parses as false', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.createCraft.mockResolvedValue({ id: 'craft-new' });
    const f = new FormData();
    f.set('name', '粘封');
    f.set('sortOrder', '40');
    // isOutsource deliberately absent
    await expect(createRuleCenterCraftAction(null, f)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(craftMock.createCraft).toHaveBeenCalledWith(
      expect.objectContaining({ isOutsource: false }),
    );
  });
});

describe('updateCraftAction', () => {
  const baseUpdate = { ...validCreateFields };

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
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/crafts');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/crafts/c');
  });

  it('编辑时忽略篡改的内部编号', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.updateCraft.mockResolvedValue({ id: 'c' });

    await updateCraftAction(
      'c',
      null,
      fd({ ...baseUpdate, code: 'FORGED_CRAFT_CODE' }),
    );

    expect(craftMock.updateCraft).toHaveBeenCalledWith(
      'c',
      expect.not.objectContaining({ code: expect.anything() }),
    );
  });
});

describe('setCraftActiveAction', () => {
  it('requires dict:craft:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(setCraftActiveAction('c', false)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('maps a retired-craft activation invariant without revalidating', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.setCraftActive.mockRejectedValueOnce(
      new MockCraftInvariantError('历史工艺已退役，不能重新启用'),
    );
    const result = await setCraftActiveAction('c', true);
    expect(result).toEqual({
      status: 'error',
      message: '历史工艺已退役，不能重新启用',
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('revalidates on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    craftMock.setCraftActive.mockResolvedValue({ id: 'c' });
    const result = await setCraftActiveAction('c', false);
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/crafts');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/rules/crafts/c');
  });
});
