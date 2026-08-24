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

import { AccountForm } from '../AccountForm';

function render() {
  return renderToStaticMarkup(
    <AccountForm
      mode="create"
      action={vi.fn()}
      capabilityCrafts={[]}
    />,
  );
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('AccountForm structured feedback contract', () => {
  it('links the error summary and each invalid input to a stable message id', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        username: ['用户名格式非法'],
        displayName: ['请填写姓名'],
      },
    };

    const html = render();

    expect(html).toContain('data-slot="form-error-summary"');
    expect(html).toContain('href="#username"');
    expect(html).toContain('href="#displayName"');
    expect(html).toMatch(
      /id="username"[^>]*aria-errormessage="username-message"/,
    );
    expect(html).toContain('id="username-message"');
    expect(html).toContain('用户名格式非法');
  });

  it('clears stale feedback while pending and exposes the form busy state', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: { username: ['用户名格式非法'] },
    };
    actionState.pending = true;

    const html = render();

    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('正在保存账号…');
    expect(html).not.toContain('用户名格式非法');
    expect(html).not.toContain('data-slot="form-error-summary"');
  });

  it('renders mutually exclusive structured success and failure receipts', () => {
    actionState.current = { status: 'success' };
    const successHtml = render();
    expect(successHtml).toContain('data-slot="action-notice"');
    expect(successHtml).toContain('data-tone="success"');
    expect(successHtml).toContain('账号已保存');

    actionState.current = { status: 'error', message: '当前账号无权保存' };
    const errorHtml = render();
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('当前账号无权保存');
    expect(errorHtml).not.toContain('账号已保存');
  });
});
