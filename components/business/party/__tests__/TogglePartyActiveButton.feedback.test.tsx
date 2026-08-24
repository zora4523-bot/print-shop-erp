import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PartyMutationResult } from '@/actions/owner-parties.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as PartyMutationResult | null,
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

vi.mock('@/actions/owner-parties', () => ({
  setPartyActiveAction: vi.fn(),
}));

import { TogglePartyActiveButton } from '../TogglePartyActiveButton';

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('party active toggle structured feedback', () => {
  it('renders explicit success and invariant failure receipts', () => {
    actionState.current = { status: 'success' };
    const successHtml = renderToStaticMarkup(
      <TogglePartyActiveButton partyId="party-1" currentlyActive />,
    );
    expect(successHtml).toContain('data-tone="success"');
    expect(successHtml).toContain('客户/供应商已停用');

    actionState.current = {
      status: 'error',
      message: '客户/供应商仍被未完成订单引用',
    };
    const errorHtml = renderToStaticMarkup(
      <TogglePartyActiveButton partyId="party-1" currentlyActive />,
    );
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('客户/供应商仍被未完成订单引用');
    expect(errorHtml).not.toContain('客户/供应商已停用');
  });

  it('sets form busy, gives a precise pending label and removes stale failure', () => {
    actionState.current = {
      status: 'error',
      message: '客户/供应商仍被未完成订单引用',
    };
    actionState.pending = true;

    const html = renderToStaticMarkup(
      <TogglePartyActiveButton partyId="party-1" currentlyActive />,
    );

    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('正在停用客户/供应商…');
    expect(html).not.toContain('客户/供应商仍被未完成订单引用');
  });
});
