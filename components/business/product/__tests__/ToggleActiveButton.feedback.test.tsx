import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductMutationResult } from '@/actions/owner-products.types';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as ProductMutationResult | null,
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

vi.mock('@/actions/owner-products', () => ({
  setQuoteProductActiveAction: vi.fn(),
}));

import { ToggleActiveButton } from '../ToggleActiveButton';

const impact = {
  orderCount: 3,
  bomCount: 2,
  currentExternalPriceRuleCount: 4,
};

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('product active toggle structured feedback', () => {
  it('renders explicit success and invariant failure receipts', () => {
    actionState.current = { status: 'success' };
    const successHtml = renderToStaticMarkup(
      <ToggleActiveButton
        productId="product-1"
        currentlyActive
        impact={impact}
      />,
    );
    expect(successHtml).toContain('data-tone="success"');
    expect(successHtml).toContain('产品已停用');

    actionState.current = { status: 'error', message: '产品仍被有效报价引用' };
    const errorHtml = renderToStaticMarkup(
      <ToggleActiveButton
        productId="product-1"
        currentlyActive
        impact={impact}
      />,
    );
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('产品仍被有效报价引用');
    expect(errorHtml).not.toContain('产品已停用');
  });

  it('sets form busy, gives a precise pending label and removes stale failure', () => {
    actionState.current = { status: 'error', message: '产品仍被有效报价引用' };
    actionState.pending = true;

    const html = renderToStaticMarkup(
      <ToggleActiveButton
        productId="product-1"
        currentlyActive
        impact={impact}
      />,
    );

    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toContain('正在停用产品…');
    expect(html).not.toContain('产品仍被有效报价引用');
  });

  it('uses the L3 alert-dialog contract for deactivation', () => {
    const html = renderToStaticMarkup(
      <ToggleActiveButton
        productId="product-1"
        currentlyActive
        impact={impact}
      />,
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('停用产品');
    expect(html).not.toContain('新报价');
  });
});
