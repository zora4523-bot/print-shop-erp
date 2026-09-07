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
  OrderChangeCompactPreview,
  OrderChangePendingChargeEditor,
  OrderChangePricingPreviewPanel,
  buildOrderChangePendingChargeResolutions,
  orderChangeApprovalImpactItems,
  orderChangeRejectionImpactItems,
  orderChangeReviewResultMessage,
  previewOrderChangeRequestPricingWithRecovery,
  reviewOrderChangeRequestWithRecovery,
} from '../OrderChangeReviewForm';
import type {
  OrderChangePendingCharge,
  OrderChangePendingChargeDrafts,
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
  overrides: Partial<
    OrderChangePricingPreview & {
      priceRevision: number;
      pendingCharges: OrderChangePendingCharge[];
      totalExcludesPendingPlateFee: boolean;
    }
  > = {},
): OrderChangePricingPreview & {
  priceRevision: number;
  pendingCharges: OrderChangePendingCharge[];
  totalExcludesPendingPlateFee: boolean;
} {
  return {
    requestId: 'request-1',
    orderId: 'order-1',
    baseRevision: 2,
    quotedAt: '2026-08-07T08:00:00.000Z',
    priceRevision: 4,
    quoteToken: `order-change-approval-v1:${'a'.repeat(64)}`,
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
        previousQuantity: 1000,
        quantity: 1200,
        previousSpecification: '90×165',
        specification: '90×165',
        previousFrontFoilColors: ['金色'],
        frontFoilColors: ['金色'],
        previousBackFoilColors: [],
        backFoilColors: [],
        priceImpact: 'QUOTED',
        oldSubtotal: '1000.00',
        newSubtotal: '960.00',
        suggestedUnitPrice: '0.8000',
        suggestedFixedFee: '0.00',
        errors: [],
      },
    ],
    pendingCharges: [],
    totalExcludesPendingPlateFee: false,
    ...overrides,
  };
}

function shippingCharge(
  overrides: Partial<OrderChangePendingCharge> = {},
): OrderChangePendingCharge {
  return {
    businessKey: 'shipping:shipment-2',
    categoryCode: 'SHIPPING_FEE',
    shipmentId: 'shipment-2',
    shipmentSequence: 2,
    destinationProvince: '广东省',
    projectedQuantity: 400,
    description: '多地址配送运费待核对',
    errors: ['未匹配到唯一物流规则'],
    amount: null,
    reason: null,
    ...overrides,
  };
}

describe('OrderChangePricingPreviewPanel', () => {
  it('renders totals, delta and per-style quote while declaring the preview non-authoritative', () => {
    const html = renderToStaticMarkup(
      <OrderChangePricingPreviewPanel preview={preview()} />,
    );

    expect(html).toContain('修改审批计价预览（只读）');
    expect(html).toContain('¥1000.00');
    expect(html).toContain('¥960.00');
    expect(html).toContain('-¥40.00');
    expect(html).toContain('自动单价 ¥0.8000');
    expect(html).toContain('由系统按最新规则自动重算');
    expect(html).toContain('当前预览仅供核对');
  });

  it('withholds incomplete totals and requires the pricing gaps to be resolved', () => {
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
                previousQuantity: 1000,
                quantity: 1200,
                previousSpecification: '90×165',
                specification: '90×165',
                previousFrontFoilColors: ['金色'],
                frontFoilColors: ['金色'],
                previousBackFoilColors: [],
                backFoilColors: [],
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
    expect(html).toContain('自动计价规则尚未得出完整结果');
    expect(html).toContain('未找到适用的价格阶梯');
    expect(html).not.toContain('¥960.00');
  });

  it('shows the proposed quantity diff instead of presenting approval as manual pricing', () => {
    const html = renderToStaticMarkup(
      <OrderChangePricingPreviewPanel
        preview={
          preview({
            items: [
              {
                ...preview().items[0]!,
                specification: '100×180',
                frontFoilColors: ['银色'],
                backFoilColors: ['红金'],
              },
            ],
          })
        }
        currentItems={[
          { id: 'item-1', sequence: 1, name: '红包 A', quantity: 1000 },
        ]}
      />,
    );

    expect(html).toContain('拟变更款式与计价差异');
    expect(html).toContain('修改款式 #1');
    expect(html).toContain('数量 1,000 → 1,200');
    expect(html).toContain('规格 90×165 → 100×180');
    expect(html).toContain('正面烫金 金色 → 银色');
    expect(html).toContain('反面烫金 无 → 红金');
    expect(html).toContain('已自动计价');
  });

  it('separates deferred plate pricing from the automatic preview total', () => {
    const withDeferredPlateFee = preview({
      totalExcludesPendingPlateFee: true,
      newTotal: '39.70',
      delta: '-960.30',
    });
    const html = renderToStaticMarkup(
      <OrderChangePricingPreviewPanel preview={withDeferredPlateFee} />,
    );
    const impact = orderChangeApprovalImpactItems(withDeferredPlateFee).join(
      '\n',
    );

    expect(html).toContain('制烫金版费不自动计算');
    expect(html).toContain('新总额（暂不含版费）');
    expect(html).toContain('整单差额');
    expect(html).toContain('版费核定后可计算');
    expect(html).toContain('口径不同');
    expect(html).toContain('不会自动记为 0 元');
    expect(html).not.toContain('-¥960.30');
    expect(impact).toContain('已知费用预览');
    expect(impact).toContain('不展示整单差额');
    expect(impact).toContain('批准修改后会进入后续管理员核价');
    expect(impact).toContain('核定版费后才能比较整单差额');
    expect(impact).toContain('制烫金版费保持待核价');
    expect(impact).toContain('核定后再补入工单应收');
    expect(impact).not.toContain('-¥960.30');
  });

  it('maps each validated shipping draft to the server resolution guard fields', () => {
    const charges = [shippingCharge()];
    const drafts: OrderChangePendingChargeDrafts = {
      'shipping:shipment-2': {
        amount: '88.50',
        reason: '物流商报价 Q-20260903',
      },
    };

    expect(buildOrderChangePendingChargeResolutions(charges, drafts)).toEqual({
      missing: [],
      resolutions: [
        {
          businessKey: 'shipping:shipment-2',
          shipmentId: 'shipment-2',
          expectedSequence: 2,
          expectedProjectedQuantity: 400,
          expectedDestinationProvince: '广东省',
          amount: '88.50',
          reason: '物流商报价 Q-20260903',
        },
      ],
    });
    expect(
      buildOrderChangePendingChargeResolutions(charges, {
        'shipping:shipment-2': { amount: '1e2', reason: '' },
      }),
    ).toEqual({
      resolutions: [],
      missing: ['第 2 票运费金额', '第 2 票运费依据'],
    });
  });

  it('renders per-shipment amount and evidence controls without replacing automatic item pricing', () => {
    const charge = shippingCharge();
    const html = renderToStaticMarkup(
      <OrderChangePendingChargeEditor
        charges={[charge]}
        drafts={{}}
        disabled={false}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('逐票运费核对');
    expect(html).toContain('第 2 票 · 广东省 · 400 个');
    expect(html).toContain('未匹配到唯一物流规则');
    expect(html).toContain('不会替代款式自动计价');
    expect(html).toContain('第 2 票运费金额');
    expect(html).toContain('第 2 票运费依据');
  });

  it('distinguishes unresolved shipping from shipping already included by re-preview', () => {
    const unresolvedHtml = renderToStaticMarkup(
      <OrderChangePricingPreviewPanel
        preview={
          preview({
            complete: false,
            newTotal: null,
            delta: null,
            pendingCharges: [shippingCharge()],
          })
        }
      />,
    );
    const resolvedHtml = renderToStaticMarkup(
      <OrderChangePricingPreviewPanel
        preview={
          preview({
            pendingCharges: [
              shippingCharge({ amount: '88.50', reason: '物流商报价' }),
            ],
          })
        }
      />,
    );

    expect(unresolvedHtml).toContain('需逐票补录后重新预览');
    expect(resolvedHtml).toContain('1 票物流费已按录入金额纳入本次预览');
    expect(resolvedHtml).not.toContain('需逐票补录后重新预览');
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
            previousQuantity: null,
            previousSpecification: null,
            previousFrontFoilColors: null,
            previousBackFoilColors: null,
            oldSubtotal: null,
          },
        ],
      }),
    );

    expect(impact).toContain(
      '申请基于工单第 2 版，共 2 项款式变更（修改 1 项、新增 1 项）。',
    );
    expect(impact.join('\n')).toContain(
      '修改款式“红包 A”：1,200 个；款式小计 ¥1000.00 → ¥960.00',
    );
    expect(impact.join('\n')).toContain(
      '新增款式“红包 B”：1,200 个',
    );
    expect(impact.join('\n')).toContain('¥1000.00 → ¥960.00');
    expect(impact.join('\n')).toContain('正面烫金 金色');
    expect(impact.join('\n')).toContain('校验结果与本次预览一致');
    expect(impact.join('\n')).toContain('本次批准不会执行');
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
    expect(source).toContain("onConfirm={() => submit('DENY')}");
    expect(source).not.toContain("onClick={() => submit('APPROVE')}");
    expect(source).not.toContain("onClick={() => submit('DENY')}");
  });

  it('binds approval to the latest preview revision and the exact re-previewed shipping resolution set', () => {
    expect(source).toContain(
      'previewOrderChangeRequestPricingWithRecovery(null, { requestId })',
    );
    expect(source).toContain(
      'expectedPriceRevision: lastPreview.priceRevision',
    );
    expect(source).toContain(
      'expectedQuoteToken: lastPreview.quoteToken ?? undefined',
    );
    expect(source).toContain(
      'pendingChargeResolutions: pendingChargeBuild.resolutions',
    );
    expect(source).toContain(
      'verifiedResolutionFingerprint === resolutionFingerprint',
    );
    expect(source).toContain("if (decision === 'DENY')");
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


describe('compact approval preview', () => {
  it('keeps quantity and amount changes visible while folding calculation details', () => {
    const html = renderToStaticMarkup(<OrderChangeCompactPreview preview={preview()} currentItems={[]} />);
    const visible = html.split('<details')[0];
    expect(visible).toContain('1,000 → 1,200');
    expect(visible).toContain('修改后金额');
    expect(visible).not.toContain('自动单价');
    const disclosureTag = html.match(/<details\b[^>]*>/)?.[0];
    expect(disclosureTag).toContain('data-slot="disclosure"');
    expect(disclosureTag).not.toMatch(/\sopen(?:[\s=>])/);
  });
  it('does not present incomplete amounts as comparable final totals', () => {
    const html = renderToStaticMarkup(<OrderChangeCompactPreview preview={preview({ totalExcludesPendingPlateFee: true, complete: false, newTotal: null, delta: null })} currentItems={[]} />);
    const visible = html.split('<details')[0];
    expect(visible).toContain('不含版费');
    expect(visible).toContain('待核定');
    expect(visible).toContain('批准后仍需补核版费');
    expect(visible).not.toContain('<dt>差额</dt>');
  });
});
