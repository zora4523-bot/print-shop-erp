import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirectMock, requirePermissionMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  requirePermissionMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));

import RuleCenterPage from '@/app/(admin)/owner/rules/page';
import { RULE_CENTER_DEFAULT_HREF } from '@/lib/navigation/rule-center';

beforeEach(() => {
  redirectMock.mockClear();
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'admin-1' });
});

describe('rule center entry', () => {
  it('checks price-management permission before redirecting', async () => {
    await expect(RuleCenterPage()).rejects.toThrow(
      `NEXT_REDIRECT:${RULE_CENTER_DEFAULT_HREF}`,
    );

    expect(requirePermissionMock).toHaveBeenCalledOnce();
    expect(requirePermissionMock).toHaveBeenCalledWith('dict:price:manage');
    expect(redirectMock).toHaveBeenCalledOnce();
    expect(requirePermissionMock.mock.invocationCallOrder[0]).toBeLessThan(
      redirectMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('opens the first concrete editor instead of the obsolete overview', async () => {
    await expect(RuleCenterPage()).rejects.toThrow('NEXT_REDIRECT:');

    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/rules/customer-pricing?section=blank',
    );
  });
});
