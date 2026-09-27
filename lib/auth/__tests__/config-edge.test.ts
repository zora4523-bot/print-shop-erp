import { describe, expect, it } from 'vitest';
import { Role } from '../../../generated/prisma/enums';
import {
  authConfigEdge,
  normalizeSessionDisplayName,
  normalizeSessionRole,
} from '../config.edge';

describe('normalizeSessionRole', () => {
  it.each(['OWNER', 'FOREMAN'] as const)(
    'upgrades a legacy %s JWT claim to ADMIN',
    (legacyRole) => {
      expect(normalizeSessionRole(legacyRole)).toBe(Role.ADMIN);
    },
  );

  it.each([Role.ADMIN, Role.SALES, Role.WORKER])(
    'keeps the current %s role unchanged',
    (role) => {
      expect(normalizeSessionRole(role)).toBe(role);
    },
  );
});

describe('normalizeSessionDisplayName', () => {
  it.each(['老板', '车间主管'])('replaces the exact legacy admin label %s', (name) => {
    expect(normalizeSessionDisplayName(Role.ADMIN, name)).toBe('管理员');
  });

  it('does not rewrite a real name or nickname containing 老板', () => {
    expect(normalizeSessionDisplayName(Role.ADMIN, '王老板')).toBe('王老板');
  });

  it('does not rewrite a non-admin display name', () => {
    expect(normalizeSessionDisplayName(Role.SALES, '老板')).toBe('老板');
  });
});


describe('draft session scope', () => {
  const user = { id: 'admin', username: 'admin', displayName: '管理员', role: Role.ADMIN, workerType: null, machineType: null };
  it('rotates only on a successful new login, including the same account', async () => {
    const first = await authConfigEdge.callbacks.jwt({ token: { sub: user.id }, user } as never);
    const second = await authConfigEdge.callbacks.jwt({ token: { ...first }, user } as never);
    expect(first.draftSessionScope).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.draftSessionScope).not.toBe(first.draftSessionScope);
    const refreshed = await authConfigEdge.callbacks.jwt({ token: { ...first } } as never);
    expect(refreshed.draftSessionScope).toBe(first.draftSessionScope);
  });
  it('does not invent a scope for old tokens; propagates the current scope to verified session context', async () => {
    const old = await authConfigEdge.callbacks.jwt({ token: { sub: user.id, ...user } } as never);
    expect(old.draftSessionScope).toBeUndefined();
    const token = await authConfigEdge.callbacks.jwt({ token: { sub: user.id }, user } as never);
    const session = await authConfigEdge.callbacks.session({ session: { user: { ...user }, expires: '2030-01-01' }, token } as never);
    expect(session.user.draftSessionScope).toBe(token.draftSessionScope);
    expect(session.user.id).toBe(user.id);
  });
});
