import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryCountMutationResult } from '@/actions/owner-inventory.types';

const { actionState, fetchState } = vi.hoisted(() => ({
  actionState: {
    current: null as InventoryCountMutationResult | null,
    pending: false,
  },
  fetchState: { pending: false },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), actionState.pending],
    useTransition: () => [fetchState.pending, vi.fn()],
  };
});

import { InventoryCountClient } from '../InventoryCountClient';

function render() {
  return renderToStaticMarkup(
    <InventoryCountClient action={vi.fn()} initialIdempotencyKey="key-1" />,
  );
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
  fetchState.pending = false;
});

describe('InventoryCountClient structured feedback contract', () => {
  it('exposes inventory fetch progress on both the search form and result region', () => {
    fetchState.pending = true;

    const html = render();

    expect(html).toMatch(
      /<form[^>]*id="inventory-count-search-form"[^>]*aria-busy="true"/,
    );
    expect(html).toMatch(
      /id="inventory-count-items"[^>]*aria-busy="true"/,
    );
    expect(html).toContain('读取中…');
    expect(html).toContain('正在读取库存...');
  });

  it('maps each server validation family to a real summary target', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        idempotencyKey: ['盘点请求标识格式非法'],
        items: ['盘点明细格式非法'],
        remark: ['备注过长'],
      },
    };

    const html = render();

    expect(html).toContain('href="#inventory-count-form"');
    expect(html).toContain('href="#inventory-count-items"');
    expect(html).toContain('href="#inventory-count-remark"');
    expect(html).toMatch(
      /id="inventory-count-items"[^>]*aria-errormessage="inventory-count-items-message"/,
    );
    expect(html).toMatch(
      /id="inventory-count-remark"[^>]*aria-errormessage="inventory-count-remark-message"/,
    );
    expect(html).toContain('id="inventory-count-items-message"');
    expect(html).toContain('id="inventory-count-remark-message"');
  });

  it('clears stale action feedback while posting and announces explicit progress', () => {
    actionState.current = { status: 'error', message: '账面数已变动，未过账' };
    actionState.pending = true;

    const html = render();

    expect(html).toMatch(
      /<form[^>]*id="inventory-count-form"[^>]*aria-busy="true"/,
    );
    expect(html).toContain('正在提交盘点过账…');
    expect(html).not.toContain('账面数已变动，未过账');
  });

  it('distinguishes full success, partial posting and full failure', () => {
    actionState.current = {
      status: 'success',
      message: '盘点单 IC-000001 已过账',
    };
    const successHtml = render();
    expect(successHtml).toContain('data-tone="success"');
    expect(successHtml).toContain('盘点已过账');

    actionState.current = {
      status: 'success',
      message: '已过账 2 条；1 条账面数已变动未过账',
      staleKeys: ['material-1:location-1'],
    };
    const partialHtml = render();
    expect(partialHtml).toContain('data-tone="warning"');
    expect(partialHtml).toContain('盘点已部分过账');
    expect(partialHtml).toContain('1 条账面数已变动未过账');

    actionState.current = { status: 'error', message: '全部行账面数均已变动' };
    const errorHtml = render();
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('盘点过账失败');
    expect(errorHtml).toContain('全部行账面数均已变动');
  });
});
