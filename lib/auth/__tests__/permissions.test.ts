import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, Role } from '../../../generated/prisma/enums';

vi.mock('@/lib/auth/session', () => ({
  requireSession: vi.fn(),
}));

import {
  PERMISSIONS,
  requirePermission,
  requireOwnership,
  getOrderScopeFilter,
  type Permission,
} from '../permissions';
import { hasPermission } from '../permissions-dict';
import { requireSession } from '@/lib/auth/session';
import { UnauthorizedError } from '../errors';

const mockedRequireSession = vi.mocked(requireSession);

type SessionUser = Parameters<typeof requireOwnership>[1];

function session(role: Role, id = 'user-test') {
  return {
    user: {
      id,
      username: 'test',
      displayName: '测试',
      role,
      workerType: null,
      machineType: null,
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

describe('PERMISSIONS map', () => {
  it('defines all the SPEC §2.2 permission keys', () => {
    const expectedKeys: Permission[] = [
      'order:create',
      'order:update:pre-schedule',
      'order:update:post-schedule',
      'order:view:all',
      'order:view:self',
      'order:export:all',
      'order:ship',
      'order:mark-urgent',
      'order:cancel',
      'order:change:request',
      'order:change:review',
      'order:production-facts:repair',
      'order:price:confirm',
      'production:manage',
      'task:report',
      'task:dispute:create',
      'task:dispute:review',
      'attendance:manage',
      'outsource:manage',
      'design:upload',
      'design:bundle:create',
      'material:manage',
      'purchase:manage',
      'warehouse:manage',
      'bill:manage',
      'bill:view:all',
      'bill:view:self',
      'bill:mark-paid',
      'salary:view:all',
      'salary:view:self',
      'salary:view:team',
      'salary:rule:manage',
      'party:manage',
      'dict:product:manage',
      'dict:craft:manage',
      'dict:price:manage',
      'bom:manage',
      'notification:config',
      'setting:manage',
      'ops:pigsty:view',
      'ops:jobs:manage',
      'account:manage',
      'report:all',
      'report:production',
    ];
    for (const k of expectedKeys) {
      expect(PERMISSIONS[k], k).toBeDefined();
    }
    expect(Object.keys(PERMISSIONS).sort()).toEqual([...expectedKeys].sort());
  });

  it('every permission has at least one allowed role', () => {
    for (const [perm, roles] of Object.entries(PERMISSIONS)) {
      expect(roles.length, `${perm} has no roles`).toBeGreaterThan(0);
    }
  });

  it('administrator-only permissions are exactly [ADMIN]', () => {
    const adminOnly: Permission[] = [
      'order:change:review',
      'order:production-facts:repair',
      'order:price:confirm',
      'order:export:all',
      'task:dispute:review',
      'attendance:manage',
      'bill:manage',
      'bill:view:all',
      'bill:mark-paid',
      'salary:view:all',
      'salary:rule:manage',
      'party:manage',
      'purchase:manage',
      'warehouse:manage',
      'dict:product:manage',
      'dict:craft:manage',
      'dict:price:manage',
      'bom:manage',
      'notification:config',
      'setting:manage',
      'ops:pigsty:view',
      'ops:jobs:manage',
      'account:manage',
      'report:all',
    ];
    for (const perm of adminOnly) {
      expect(PERMISSIONS[perm], perm).toEqual([Role.ADMIN]);
    }
  });

  it('worker-only task permissions are [WORKER]', () => {
    expect(PERMISSIONS['task:report']).toEqual([Role.WORKER]);
    expect(PERMISSIONS['task:dispute:create']).toEqual([Role.WORKER]);
  });

  it('external-sales self billing is SALES-only', () => {
    expect(PERMISSIONS['bill:view:self']).toEqual([Role.SALES]);
  });
});

describe('requirePermission', () => {
  beforeEach(() => {
    mockedRequireSession.mockReset();
  });

  it('throws UnauthorizedError when no session', async () => {
    mockedRequireSession.mockRejectedValue(new UnauthorizedError('未登录'));
    await expect(requirePermission('order:create')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.each([
    [Role.SALES, 'order:create'],
    [Role.ADMIN, 'order:create'],
    [Role.ADMIN, 'account:manage'],
    [Role.ADMIN, 'bill:manage'],
    [Role.ADMIN, 'order:export:all'],
    [Role.SALES, 'bill:view:self'],
    [Role.WORKER, 'task:report'],
    [Role.WORKER, 'order:view:self'],
    [Role.WORKER, 'salary:view:self'],
    [Role.ADMIN, 'salary:rule:manage'],
    [Role.ADMIN, 'report:production'],
  ] as const)('role %s is allowed for %s', async (role, perm) => {
    mockedRequireSession.mockResolvedValue(session(role));
    const user = await requirePermission(perm);
    expect(user.role).toBe(role);
  });

  it.each([
    [Role.WORKER, 'order:create'],
    [Role.SALES, 'bill:manage'],
    [Role.WORKER, 'bill:manage'],
    [Role.SALES, 'account:manage'],
    [Role.WORKER, 'order:view:all'],
    [Role.SALES, 'order:export:all'],
    [Role.ADMIN, 'bill:view:self'],
    [Role.SALES, 'task:report'],
  ] as const)('role %s is denied for %s', async (role, perm) => {
    mockedRequireSession.mockResolvedValue(session(role));
    await expect(requirePermission(perm)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws a plain Error (not Unauthorized) when permission key is unknown', async () => {
    mockedRequireSession.mockResolvedValue(session(Role.ADMIN));
    // Bypass the compile-time guard to simulate a runtime bug.
    const badKey = 'does:not:exist' as Permission;
    await expect(requirePermission(badKey)).rejects.toThrow(/未定义的权限/);
  });

  it('returned user has id, role, username, displayName', async () => {
    mockedRequireSession.mockResolvedValue(session(Role.ADMIN, 'owner-42'));
    const user = await requirePermission('account:manage');
    expect(user.id).toBe('owner-42');
    expect(user.username).toBe('test');
    expect(user.displayName).toBe('测试');
    expect(user.role).toBe(Role.ADMIN);
  });
});

describe('hasPermission', () => {
  // 纯谓词版，只给「需要软判断、不能抛」的场景用 —— 目前是各详情页的
  // generateMetadata（流式 metadata 下抛异常未必还能干净落到 error.tsx）。
  // 它和 requirePermission 读的是同一张 PERMISSIONS 字典，所以标签页标题
  // 的可见性永远跟着权限规则走，不会各写一份。
  it('ADMIN 有 bill:view:all', () => {
    expect(hasPermission('bill:view:all', Role.ADMIN)).toBe(true);
  });

  it('SALES 没有 bill:view:all（直连 /owner/bills/<id> 时标题不能泄露账期+姓名）', () => {
    expect(hasPermission('bill:view:all', Role.SALES)).toBe(false);
  });

  it('SALES 有 bill:view:self', () => {
    expect(hasPermission('bill:view:self', Role.SALES)).toBe(true);
  });

  it('和 requirePermission 用的是同一张字典', () => {
    for (const [permission, roles] of Object.entries(PERMISSIONS)) {
      for (const role of Object.values(Role)) {
        expect(hasPermission(permission as Permission, role)).toBe(
          (roles as readonly Role[]).includes(role),
        );
      }
    }
  });
});

describe('requireOwnership', () => {
  const selfUser: SessionUser = { id: 'u-self', role: Role.SALES };
  const adminUser: SessionUser = { id: 'u-admin', role: Role.ADMIN };

  it('passes when the user is the owner (no global permission given)', async () => {
    const order = { submitterId: 'u-self' };
    await expect(requireOwnership(order, selfUser, 'submitterId')).resolves.toBeUndefined();
  });

  it('throws when the user is not the owner and no global permission given', async () => {
    const order = { submitterId: 'u-other' };
    await expect(requireOwnership(order, selfUser, 'submitterId')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('passes when globalPermission grants access regardless of ownership', async () => {
    const order = { submitterId: 'u-other' };
    await expect(
      requireOwnership(order, adminUser, 'submitterId', 'order:view:all'),
    ).resolves.toBeUndefined();
  });

  it('still requires ownership when globalPermission does not apply to the role', async () => {
    const order = { submitterId: 'u-other' };
    await expect(
      requireOwnership(order, selfUser, 'submitterId', 'order:view:all'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('getOrderScopeFilter', () => {
  it('ADMIN sees all orders (empty filter)', () => {
    expect(getOrderScopeFilter({ id: 'x', role: Role.ADMIN })).toEqual({});
  });

  it('SALES sees only their own orders', () => {
    expect(getOrderScopeFilter({ id: 's1', role: Role.SALES })).toEqual({ submitterId: 's1' });
  });

  it('WORKER legacy scope reads only their historical task-linked orders', () => {
    expect(getOrderScopeFilter({ id: 'w1', role: Role.WORKER })).toEqual({
      status: { not: OrderStatus.SUBMITTED },
      items: { some: { tasks: { some: { workerId: 'w1' } } } },
    });
  });

  it('unknown role returns a never-match sentinel', () => {
    // Cast a bogus role — simulates a future enum value not yet handled.
    const filter = getOrderScopeFilter({ id: 'x', role: 'UNKNOWN' as Role });
    expect(filter).toEqual({ id: 'never-match' });
  });
});
