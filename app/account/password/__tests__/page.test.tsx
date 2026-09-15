import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const { getSession, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT'); }),
}));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/components/business/auth/ChangePasswordForm', () => ({ ChangePasswordForm: () => <form data-testid="password-form" /> }));
import Page from '../page';
beforeEach(() => vi.clearAllMocks());
it('redirects an absent or disabled account session back to login with from', async () => {
  getSession.mockResolvedValue(null);
  await expect(Page()).rejects.toThrow('NEXT_REDIRECT');
  expect(redirect).toHaveBeenCalledWith('/login?from=/account/password');
});
it('renders the password form for a valid session', async () => {
  getSession.mockResolvedValue({ user: { id: 'worker' } });
  expect(renderToStaticMarkup(await Page())).toContain('password-form');
  expect(redirect).not.toHaveBeenCalled();
});
it('does not turn database failures into login redirects', async () => {
  getSession.mockRejectedValue(new Error('database unavailable'));
  await expect(Page()).rejects.toThrow('database unavailable');
  expect(redirect).not.toHaveBeenCalled();
});
