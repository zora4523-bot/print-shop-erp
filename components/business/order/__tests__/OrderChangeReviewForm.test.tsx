import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { OrderChangePricingPreview } from '@/lib/order/change-request';
import {
  previewOrderChangeRequestPricingAction,
  reviewOrderChangeRequestAction,
} from '@/actions/order';

vi.mock('@/actions/order', () => ({
  previewOrderChangeRequestPricingAction: vi.fn(),
  reviewOrderChangeRequestAction: vi.fn(),
}));

import {
  OrderChangePricingPreviewPanel,
  orderChangeApprovalImpactItems,
  orderChangeRejectionImpactItems,
  orderChangeReviewResultMessage,
  previewOrderChangeRequestPricingWithRecovery,
  reviewOrderChangeRequestWithRecovery,
} from '../OrderChangeReviewForm';

const source = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'order',
    'OrderChangeReviewForm.tsx',
  ),
  'utf8',
);

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
    expect(html).toContain('批准时会按最新规则重新报价');
    expect(html).toContain('当前预览仅供核对');
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
    expect(html).toContain('若需沿用原成交价，请填写原因');
    expect(html).toContain('未找到适用的价格阶梯');
    expect(html).not.toContain('¥960.00');
  });

  it('builds an approval confirmation from the current revision, diff and non-authoritative quote', () => {
    const impact = orderChangeApprovalImpactItems(
      preview({
        items: [
          preview().items[0]!,
          {
            ...preview().items[0]!,
            changeIndex: 1,
            operation: 'ADD',
            sourceItemId: 'item-template',
            previousName: null,
            name: '红包 B',
            oldSubtotal: null,
          },
        ],
      }),
    );

    expect(impact).toContain(
      '申请基于工单第 2 版，共 2 项款式变更（修改 1 项、新增 1 项）。',
    );
    expect(impact.join('\n')).toContain(
      '修改款式“红包 A”：1,200 个，款式小计 ¥1000.00 → ¥960.00',
    );
    expect(impact.join('\n')).toContain(
      '新增款式“红包 B”：1,200 个',
    );
    expect(impact.join('\n')).toContain('¥1000.00 → ¥960.00');
    expect(impact.join('\n')).toContain('批准时会按最新规则重新报价');
    expect(impact.join('\n')).toContain('工单应收');
  });

  it('states the server-side required rejection reason contract', () => {
    const impact = orderChangeRejectionImpactItems().join('\n');

    expect(impact).toContain('必填的拒绝原因');
    expect(impact).toContain('工单的款式、数量、计价与生产任务保持不变');
    expect(source).toContain('拒绝时必填');
    expect(source).toContain('disabled={rejectDisabled}');
  });

  it('distinguishes a stale no-op from an applied approval and refreshes once', () => {
    expect(orderChangeReviewResultMessage('STALE')).toContain('申请未执行');
    expect(orderChangeReviewResultMessage('STALE')).toContain('已标记为失效');
    expect(orderChangeReviewResultMessage('APPROVED')).toContain('已批准');
    expect(source).toContain('refreshedResultRef.current === resultKey');
    expect(source).toContain('router.refresh()');
  });

  it('routes both approval and rejection through L2 confirmation instead of direct mutation buttons', () => {
    expect(source.match(/<ConfirmActionDialog/g)).toHaveLength(2);
    expect(source.match(/level="L2"/g)).toHaveLength(2);
    expect(source).toContain("onConfirm={() => submit('APPROVE')}");
    expect(source).toContain("onConfirm={() => submit('REJECT')}");
    expect(source).not.toContain("onClick={() => submit('APPROVE')}");
    expect(source).not.toContain("onClick={() => submit('REJECT')}");
  });

  it('turns unexpected preview and review rejections into retryable UI errors', async () => {
    vi.mocked(previewOrderChangeRequestPricingAction).mockRejectedValueOnce(
      new Error('preview connection lost'),
    );
    vi.mocked(reviewOrderChangeRequestAction).mockRejectedValueOnce(
      new Error('review connection lost'),
    );

    await expect(
      previewOrderChangeRequestPricingWithRecovery(null, {
        requestId: 'request-1',
      }),
    ).resolves.toEqual({
      status: 'error',
      message: '计价预览请求未完成，请重试。',
    });
    await expect(
      reviewOrderChangeRequestWithRecovery(null, {
        requestId: 'request-1',
        decision: 'APPROVE',
      }),
    ).resolves.toEqual({
      status: 'error',
      message: '审核请求未完成，请刷新工单后重试。',
    });
  });
});
