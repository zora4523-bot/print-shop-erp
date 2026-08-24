import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountMutationResult } from '@/actions/owner-accounts.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as AccountMutationResult | null,
    pending: false,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), actionState.pending],
  };
});

vi.mock('@/actions/owner-accounts', () => ({
  resetUserPasswordAction: vi.fn(),
  setUserActiveAction: vi.fn(),
}));

import { ResetPasswordForm } from '../ResetPasswordForm';
import { ToggleActiveButton } from '../ToggleActiveButton';

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('account action forms structured feedback', () => {
  it('links password validation to a stable message and summary target', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: { newPassword: ['新密码至少 8 位'] },
    };

    const html = renderToStaticMarkup(<ResetPasswordForm userId="user-1" />);

    expect(html).toContain('href="#newPassword"');
    expect(html).toMatch(
      /id="newPassword"[^>]*aria-errormessage="newPassword-message"/,
    );
    expect(html).toContain('id="newPassword-message"');
    expect(html).toContain('新密码至少 8 位');
  });

  it('clears stale password errors while the reset is pending', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: { newPassword: ['新密码至少 8 位'] },
    };
    actionState.pending = true;

    const html = renderToStaticMarkup(<ResetPasswordForm userId="user-1" />);

    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('正在重置密码…');
    expect(html).not.toContain('新密码至少 8 位');
    expect(html).toContain('newPassword-message');
  });

  it('uses structured account toggle success, failure and pending states', () => {
    actionState.current = { status: 'success' };
    const successHtml = renderToStaticMarkup(
      <ToggleActiveButton userId="user-1" currentlyActive />,
    );
    expect(successHtml).toContain('data-slot="alert-dialog-trigger"');
    expect(successHtml).toContain('aria-haspopup="dialog"');
    expect(successHtml).toContain('data-tone="success"');
    expect(successHtml).toContain('账号已停用');

    actionState.current = { status: 'error', message: '系统至少需要 1 位活跃管理员' };
    const errorHtml = renderToStaticMarkup(
      <ToggleActiveButton userId="user-1" currentlyActive />,
    );
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('系统至少需要 1 位活跃管理员');

    actionState.pending = true;
    const pendingHtml = renderToStaticMarkup(
      <ToggleActiveButton userId="user-1" currentlyActive />,
    );
    expect(pendingHtml).toMatch(/<form[^>]*aria-busy="true"/);
    expect(pendingHtml).toContain('disabled');
    expect(pendingHtml).toContain('正在停用账号…');
    expect(pendingHtml).not.toContain('系统至少需要 1 位活跃管理员');
  });
});
