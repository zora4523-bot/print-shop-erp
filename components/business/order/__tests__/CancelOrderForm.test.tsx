import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderMutationResult } from '@/actions/order.types';
import { confirmationCanSubmit } from '@/components/ui-business';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as OrderMutationResult | null,
    pending: false,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [
      actionState.current,
      vi.fn(),
      actionState.pending,
    ],
  };
});
vi.mock('@/actions/order', () => ({
  cancelOrderAction: Object.assign(vi.fn(), { bind: () => vi.fn() }),
}));

import {
  CancelOrderForm,
  cancelOrderImpactItems,
} from '../CancelOrderForm';

const impact = [
  { label: '取消未开工的生产任务', value: '2 个' },
  { label: '已完工任务保留计件工资', value: '1 个' },
];

function render(nextImpact = impact) {
  return renderToStaticMarkup(
    <CancelOrderForm
      orderId="order-1"
      orderNo="PS-20260824-001"
      impact={nextImpact}
      compact
    />,
  );
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('CancelOrderForm', () => {
  it('opens the cancellation from an L3 alert-dialog trigger', () => {
    const html = render();

    expect(html).toContain('data-risk-level="L3"');
    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('取消工单');
    expect(html).not.toContain('<details');
    expect(confirmationCanSubmit('L3', '')).toBe(false);
    expect(confirmationCanSubmit('L3', '客户书面确认取消')).toBe(true);
  });

  it('passes through only the real impact supplied by the order page', () => {
    expect(cancelOrderImpactItems(impact)).toEqual([
      '取消未开工的生产任务：2 个',
      '已完工任务保留计件工资：1 个',
    ]);
    expect(cancelOrderImpactItems([])).toEqual([]);
  });

  it('blocks cancellation when the page did not supply an impact scope', () => {
    const html = render([]);

    expect(html).toContain('暂不能确认取消');
    expect(html).toContain('订单影响数据未传入');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-slot="alert-dialog-trigger"/);
  });

  it('links server validation back to the dialog trigger', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: { reason: ['请填写取消原因'] },
    };
    const html = render();

    expect(html).toContain('data-slot="form-error-summary"');
    expect(html).toContain('取消原因：请填写取消原因');
    expect(html).toMatch(/href="#([^"]+-cancel-trigger)"/);
  });

  it('uses structured pending, failure and success feedback', () => {
    actionState.pending = true;
    const pendingHtml = render();
    expect(pendingHtml).toMatch(/<form[^>]*aria-busy="true"/);
    expect(pendingHtml).toContain('正在取消…');

    actionState.pending = false;
    actionState.current = { status: 'error', message: '工单已进入不可取消状态' };
    const errorHtml = render();
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('工单已进入不可取消状态');

    actionState.current = { status: 'success' };
    const successHtml = render();
    expect(successHtml).toContain('data-tone="success"');
    expect(successHtml).toContain('工单已取消');
  });
});
