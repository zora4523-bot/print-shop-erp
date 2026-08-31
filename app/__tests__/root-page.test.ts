import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const { getSessionMock, redirectMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  getSession: getSessionMock,
}));
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import Home from '@/app/page';

beforeEach(() => {
  getSessionMock.mockReset();
  redirectMock.mockReset();
  redirectMock.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe('root role dispatcher', () => {
  it('redirects a missing or database-invalidated session to login', async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow('REDIRECT:/login');
    expect(getSessionMock).toHaveBeenCalledOnce();
    expect(redirectMock).toHaveBeenCalledOnce();
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it.each([
    [Role.ADMIN, '/owner'],
    [Role.SALES, '/orders'],
    [Role.CUSTOMER_SERVICE, '/orders'],
    [Role.WORKER, '/worker/tasks'],
  ])('redirects %s to %s', async (role, destination) => {
    getSessionMock.mockResolvedValue({ user: { role } });

    await expect(Home()).rejects.toThrow(`REDIRECT:${destination}`);
    expect(redirectMock).toHaveBeenCalledOnce();
    expect(redirectMock).toHaveBeenCalledWith(destination);
  });

  it('does not turn an unexpected session lookup failure into a login redirect', async () => {
    const error = new Error('database unavailable');
    getSessionMock.mockRejectedValue(error);

    await expect(Home()).rejects.toBe(error);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
