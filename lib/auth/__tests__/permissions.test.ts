import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '../../../generated/prisma/client';

vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
}));

import {
  PERMISSIONS,
  requirePermission,
  requireOwnership,
  getOrderScopeFilter,
  type Permission,
} from '../permissions';
import { getSession } from '@/lib/auth/session';
import { UnauthorizedError } from '../errors';

const mockedGetSession = vi.mocked(getSession);

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
      'order:schedule',
      'order:ship',
      'order:mark-urgent',
      'order:cancel',
      'task:assign',
      'task:report',
      'outsource:manage',
      'design:upload',
      'design:bundle:create',
      'material:manage',
      'material:issue',
      'purchase:manage',
      'warehouse:manage',
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

  it('OWNER-exclusive permissions are exactly [OWNER]', () => {
    const ownerOnly: Permission[] = [
      'order:cancel',
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
      'ops:pigsty:view',
      'ops:jobs:manage',
      'account:manage',
      'report:all',
    ];
    for (const perm of ownerOnly) {
      expect(PERMISSIONS[perm], perm).toEqual([Role.OWNER]);
    }
  });

  it('worker-only permission task:report is [WORKER]', () => {
    expect(PERMISSIONS['task:report']).toEqual([Role.WORKER]);
  });
});

describe('requirePermission', () => {
  beforeEach(() => {
    mockedGetSession.mockReset();
  });

  it('throws UnauthorizedError when no session', async () => {
    mockedGetSession.mockResolvedValue(null);
    await expect(requirePermission('order:create')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.each([
    [Role.SALES, 'order:create'],
    [Role.CUSTOMER_SERVICE, 'order:create'],
    [Role.OWNER, 'order:create'],
    [Role.FOREMAN, 'order:create'],
    [Role.OWNER, 'account:manage'],
    [Role.WORKER, 'task:report'],
    [Role.OWNER, 'salary:rule:manage'],
    [Role.FOREMAN, 'report:production'],
  ] as const)('role %s is allowed for %s', async (role, perm) => {
    mockedGetSession.mockResolvedValue(session(role));
    const user = await requirePermission(perm);
    expect(user.role).toBe(role);
  });

  it.each([
    [Role.WORKER, 'order:create'],
    [Role.SALES, 'account:manage'],
    [Role.FOREMAN, 'account:manage'],
    [Role.CUSTOMER_SERVICE, 'salary:rule:manage'],
    [Role.WORKER, 'order:view:all'],
    [Role.SALES, 'task:report'],
  ] as const)('role %s is denied for %s', async (role, perm) => {
    mockedGetSession.mockResolvedValue(session(role));
    await expect(requirePermission(perm)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws a plain Error (not Unauthorized) when permission key is unknown', async () => {
    mockedGetSession.mockResolvedValue(session(Role.OWNER));
    // Bypass the compile-time guard to simulate a runtime bug.
    const badKey = 'does:not:exist' as Permission;
    await expect(requirePermission(badKey)).rejects.toThrow(/未定义的权限/);
  });

  it('returned user has id, role, username, displayName', async () => {
    mockedGetSession.mockResolvedValue(session(Role.OWNER, 'owner-42'));
    const user = await requirePermission('account:manage');
    expect(user.id).toBe('owner-42');
    expect(user.username).toBe('test');
    expect(user.displayName).toBe('测试');
    expect(user.role).toBe(Role.OWNER);
  });
});

describe('requireOwnership', () => {
  const selfUser: SessionUser = { id: 'u-self', role: Role.SALES };
  const ownerUser: SessionUser = { id: 'u-owner', role: Role.OWNER };
  const foremanUser: SessionUser = { id: 'u-foreman', role: Role.FOREMAN };

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
      requireOwnership(order, ownerUser, 'submitterId', 'order:view:all'),
    ).resolves.toBeUndefined();
    await expect(
      requireOwnership(order, foremanUser, 'submitterId', 'order:view:all'),
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
  it('OWNER sees all orders (empty filter)', () => {
    expect(getOrderScopeFilter({ id: 'x', role: Role.OWNER })).toEqual({});
  });

  it('FOREMAN sees all orders (empty filter)', () => {
    expect(getOrderScopeFilter({ id: 'x', role: Role.FOREMAN })).toEqual({});
  });

  it('SALES sees only their own orders', () => {
    expect(getOrderScopeFilter({ id: 's1', role: Role.SALES })).toEqual({ submitterId: 's1' });
  });

  it('CUSTOMER_SERVICE sees only their own orders', () => {
    expect(getOrderScopeFilter({ id: 'c1', role: Role.CUSTOMER_SERVICE })).toEqual({
      submitterId: 'c1',
    });
  });

  it('WORKER sees orders whose items have a task assigned to them', () => {
    expect(getOrderScopeFilter({ id: 'w1', role: Role.WORKER })).toEqual({
      items: { some: { tasks: { some: { workerId: 'w1' } } } },
    });
  });

  it('unknown role returns a never-match sentinel', () => {
    // Cast a bogus role — simulates a future enum value not yet handled.
    const filter = getOrderScopeFilter({ id: 'x', role: 'UNKNOWN' as Role });
    expect(filter).toEqual({ id: 'never-match' });
  });
});
