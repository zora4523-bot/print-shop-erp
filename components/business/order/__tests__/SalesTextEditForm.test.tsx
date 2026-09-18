import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { actionState } = vi.hoisted(() => ({
  actionState: { current: null as unknown, pending: false },
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), actionState.pending],
  };
});
vi.mock('@/actions/order-sales-text', () => ({
  editSalesTextAction: Object.assign(vi.fn(), { bind: () => vi.fn() }),
}));

import { SalesTextEditForm } from '../SalesTextEditForm';

function render() {
  return renderToStaticMarkup(
    <SalesTextEditForm
      orderId="o1"
      targetId="i1"
      field="itemName"
      version={3}
      value="红包 A"
      label="款式名称"
    />,
  );
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('SalesTextEditForm feedback', () => {
  it('shows no receipt before submit', () => {
    const html = render();
    expect(html).not.toContain('data-slot="action-notice"');
    expect(html).toContain('name="expectedEditVersion"');
  });

  it('tells the operator when nothing changed, which otherwise looks like a no-op', () => {
    actionState.current = { saved: true, changed: false };
    const html = render();
    expect(html).toContain('data-slot="action-notice"');
    expect(html).toContain('data-tone="info"');
    expect(html).toContain('款式名称没有变化，未保存');
    expect(html).not.toContain('aria-busy="true"');
  });

  it('confirms a saved change politely and freezes the form until remount', () => {
    actionState.current = { saved: true, changed: true };
    const html = render();
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('款式名称已保存');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });

  it('still announces server errors assertively', () => {
    actionState.current = { error: '请刷新工单后重试' };
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain('请刷新工单后重试');
    expect(html).not.toContain('data-slot="action-notice"');
  });
});
