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

import { PartyForm } from '../PartyForm';

function render() {
  return renderToStaticMarkup(<PartyForm mode="create" action={vi.fn()} />);
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('PartyForm structured feedback contract', () => {
  it('keeps errors discoverable in both the summary and field context', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        type: ['请选择客户/供应商类型'],
        defaultAddressDetail: ['详细地址过长'],
      },
    };

    const html = render();

    expect(html).toContain('href="#type"');
    expect(html).toContain('href="#defaultAddressDetail"');
    expect(html).toMatch(/id="type"[^>]*aria-errormessage="type-message"/);
    expect(html).toMatch(
      /id="defaultAddressDetail"[^>]*aria-errormessage="defaultAddressDetail-message"/,
    );
    expect(html).toContain('id="defaultAddressDetail-message"');
  });

  it('exposes pending on the form and removes the previous validation result', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: { name: ['请填写客户/供应商名称'] },
    };
    actionState.pending = true;

    const html = render();

    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('正在保存客户/供应商…');
    expect(html).not.toContain('请填写客户/供应商名称');
  });

  it('renders a semantic success receipt', () => {
    actionState.current = { status: 'success' };

    const html = render();

    expect(html).toContain('data-tone="success"');
    expect(html).toContain('客户/供应商已保存');
    expect(html).toContain('role="status"');
  });
});
