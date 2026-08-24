import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialMutationResult } from '@/actions/owner-materials.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as MaterialMutationResult | null,
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

vi.mock('@/actions/owner-materials', () => ({
  setMaterialActiveAction: vi.fn(),
}));

import { StockTransactionForm } from '../StockTransactionForm';
import { ToggleMaterialActiveButton } from '../ToggleMaterialActiveButton';

function renderTransaction() {
  return renderToStaticMarkup(
    <StockTransactionForm action={vi.fn()} unit="张" locationOptions={[]} />,
  );
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('material action forms structured feedback', () => {
  it('summarizes stock validation and links controls to stable messages', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        quantity: ['数量必须大于 0'],
        remark: ['备注过长'],
      },
    };

    const html = renderTransaction();

    expect(html).toContain('href="#quantity"');
    expect(html).toContain('href="#remark"');
    expect(html).toMatch(
      /id="quantity"[^>]*aria-errormessage="quantity-message"/,
    );
    expect(html).toMatch(
      /id="remark"[^>]*aria-errormessage="remark-message"/,
    );
    expect(html).toContain('id="quantity-message"');
    expect(html).toContain('id="remark-message"');
  });

  it('removes stale transaction feedback during pending and emits success after', () => {
    actionState.current = { status: 'error', message: '库存不足，不能出库' };
    actionState.pending = true;
    const pendingHtml = renderTransaction();
    expect(pendingHtml).toMatch(/<form[^>]*aria-busy="true"/);
    expect(pendingHtml).toContain('正在更新库存…');
    expect(pendingHtml).not.toContain('库存不足，不能出库');

    actionState.pending = false;
    actionState.current = { status: 'success', message: '库存已更新' };
    const successHtml = renderTransaction();
    expect(successHtml).toContain('data-tone="success"');
    expect(successHtml).toContain('库存已更新');
  });

  it('uses explicit material toggle success, error and progress labels', () => {
    actionState.current = { status: 'success' };
    const successHtml = renderToStaticMarkup(
      <ToggleMaterialActiveButton materialId="material-1" currentlyActive />,
    );
    expect(successHtml).toContain('物料已停用');
    expect(successHtml).toContain('data-tone="success"');

    actionState.current = { status: 'error', message: '该物料仍被未完成工单引用' };
    const errorHtml = renderToStaticMarkup(
      <ToggleMaterialActiveButton materialId="material-1" currentlyActive />,
    );
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('该物料仍被未完成工单引用');

    actionState.pending = true;
    const pendingHtml = renderToStaticMarkup(
      <ToggleMaterialActiveButton materialId="material-1" currentlyActive />,
    );
    expect(pendingHtml).toContain('正在停用物料…');
    expect(pendingHtml).not.toContain('该物料仍被未完成工单引用');
  });
});
