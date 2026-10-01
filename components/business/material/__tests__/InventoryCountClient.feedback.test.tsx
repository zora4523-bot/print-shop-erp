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

import {
  createInventoryCountSubmitGate,
  InventoryCountClient,
} from '../InventoryCountClient';

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
    expect(html).toContain('正在读取…');
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
    expect(html).toContain('href="#inventory-count-submit-trigger"');
    expect(html).toMatch(
      /id="inventory-count-items"[^>]*aria-errormessage="inventory-count-items-message"/,
    );
    expect(html).toContain('id="inventory-count-items-message"');
    expect(html).toContain('盘点过账原因：备注过长');
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

  it('routes posting through a controlled L3 confirmation gate', () => {
    const html = render();

    expect(html).toMatch(
      /<form[^>]*id="inventory-count-form"[^>]*data-risk-level="L3"/,
    );
    expect(html).toContain('name="remark"');
    expect(html).toContain('id="inventory-count-submit-trigger"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('核对并提交盘点过账');
    expect(html).toContain('disabled');
  });

  it('consumes confirmation authorization exactly once', () => {
    const gate = createInventoryCountSubmitGate();

    // 普通 submit / Enter 没有确认 token，必须被组件拦截。
    expect(gate.consume()).toBeNull();
    expect(gate.arm('  月末例行盘点  ')).toBe('月末例行盘点');
    expect(gate.snapshot()).toEqual({
      armed: true,
      remark: '月末例行盘点',
    });

    expect(gate.consume()).toBe('月末例行盘点');
    expect(gate.consume()).toBeNull();
    expect(gate.snapshot()).toEqual({ armed: false, remark: '' });
  });

  it('clears both the armed state and audit reason on cancel or Escape', () => {
    const gate = createInventoryCountSubmitGate();

    gate.arm('已输入但取消的原因');
    gate.clear();

    expect(gate.snapshot()).toEqual({ armed: false, remark: '' });
    expect(gate.consume()).toBeNull();
    expect(gate.arm('   ')).toBeNull();
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
