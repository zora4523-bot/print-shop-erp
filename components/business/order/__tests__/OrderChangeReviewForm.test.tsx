import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrderChangePricingPreview } from '@/lib/order/change-request';

vi.mock('@/actions/order', () => ({
  previewOrderChangeRequestPricingAction: vi.fn(),
  reviewOrderChangeRequestAction: vi.fn(),
}));

import { OrderChangePricingPreviewPanel } from '../OrderChangeReviewForm';

function preview(
  overrides: Partial<OrderChangePricingPreview> = {},
): OrderChangePricingPreview {
  return {
    requestId: 'request-1',
    orderId: 'order-1',
    baseRevision: 2,
    quotedAt: '2026-08-07T08:00:00.000Z',
    complete: true,
    requiresReviewRemark: false,
    oldTotal: '1000.00',
    newTotal: '960.00',
    delta: '-40.00',
    items: [
      {
        changeIndex: 0,
        operation: 'UPDATE',
        sourceItemId: 'item-1',
        previousName: '红包 A',
        name: '红包 A',
        quantity: 1200,
        priceImpact: 'QUOTED',
        oldSubtotal: '1000.00',
        newSubtotal: '960.00',
        suggestedUnitPrice: '0.8000',
        suggestedFixedFee: '0.00',
        errors: [],
      },
    ],
    ...overrides,
  };
}

describe('OrderChangePricingPreviewPanel', () => {
  it('renders totals, delta and per-style quote while declaring the preview non-authoritative', () => {
    const html = renderToStaticMarkup(
      <OrderChangePricingPreviewPanel preview={preview()} />,
    );

    expect(html).toContain('审批计价预览（只读）');
    expect(html).toContain('¥1000.00');
    expect(html).toContain('¥960.00');
    expect(html).toContain('-¥40.00');
    expect(html).toContain('建议单价 ¥0.8000');
    expect(html).toContain('批准时服务器会在事务内按最新规则再次报价');
    expect(html).toContain('此预览不作为提交金额');
  });

  it('withholds incomplete totals and explicitly says carrying the old price is conditional', () => {
    const html = renderToStaticMarkup(
      <OrderChangePricingPreviewPanel
        preview={
          preview({
            complete: false,
            requiresReviewRemark: true,
            newTotal: null,
            delta: null,
            items: [
              {
                changeIndex: 0,
                operation: 'UPDATE',
                sourceItemId: 'item-1',
                previousName: '红包 A',
                name: '红包 A',
                quantity: 1200,
                priceImpact: 'INCOMPLETE',
                oldSubtotal: '1000.00',
                newSubtotal: null,
                suggestedUnitPrice: null,
                suggestedFixedFee: null,
                errors: ['未找到适用的价格阶梯，产品也没有基础单价'],
              },
            ],
          })
        }
      />,
    );

    expect(html).toContain('待补全价格规则');
    expect(html).toContain('暂无法计算');
    expect(html).toContain('系统不会自动沿用原成交价');
    expect(html).toContain('只有填写审核备注并批准后');
    expect(html).toContain('未找到适用的价格阶梯');
    expect(html).not.toContain('¥960.00');
  });
});
