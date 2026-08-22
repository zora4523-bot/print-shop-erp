import { describe, expect, it } from 'vitest';
import { Role } from '../../../generated/prisma/enums';
import {
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

  it.each([Role.ADMIN, Role.SALES, Role.CUSTOMER_SERVICE, Role.WORKER])(
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
