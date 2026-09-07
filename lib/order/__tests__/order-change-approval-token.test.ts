import { describe, expect, it } from 'vitest';
import {
  createOrderChangeApprovalToken,
  type OrderChangeApprovalResolutionEvidence,
} from '../order-change-approval-token';

const firstResolution: OrderChangeApprovalResolutionEvidence = {
  businessKey: 'SHIPMENT:1:SHIPPING_FEE',
  shipmentId: 'shipment-1',
  expectedSequence: 1,
  expectedProjectedQuantity: 1_200,
  expectedDestinationProvince: '广东',
  amount: '12.30',
  reason: '按承运方报价',
};

const secondResolution: OrderChangeApprovalResolutionEvidence = {
  businessKey: 'SHIPMENT:2:SHIPPING_FEE',
  shipmentId: 'shipment-2',
  expectedSequence: 2,
  expectedProjectedQuantity: 800,
  expectedDestinationProvince: null,
  amount: '8.00',
  reason: '跨区附加费',
};

function token(
  overrides: Partial<{
    requestId: string;
    baseRevision: number;
    priceRevision: number;
    pureQuoteToken: string;
    pendingChargeResolutions: readonly OrderChangeApprovalResolutionEvidence[];
  }> = {},
): string {
  return createOrderChangeApprovalToken({
    requestId: overrides.requestId ?? 'request-1',
    baseRevision: overrides.baseRevision ?? 2,
    priceRevision: overrides.priceRevision ?? 5,
    pureQuoteToken:
      overrides.pureQuoteToken ?? `create-order-quote-v2:${'a'.repeat(64)}`,
    pendingChargeResolutions:
      overrides.pendingChargeResolutions ?? [firstResolution, secondResolution],
  });
}

describe('createOrderChangeApprovalToken', () => {
  it('对决议顺序、金额精度与允许的空白做稳定归一化', () => {
    const canonical = token();
    const reorderedAndNormalized = token({
      requestId: ' request-1 ',
      pendingChargeResolutions: [
        {
          ...secondResolution,
          businessKey: ' shipment:2:shipping_fee ',
          shipmentId: ' shipment-2 ',
          amount: '8',
          reason: ' 跨区附加费 ',
        },
        {
          ...firstResolution,
          businessKey: ' shipment:1:shipping_fee ',
          shipmentId: ' shipment-1 ',
          expectedDestinationProvince: ' 广东 ',
          amount: '12.3',
          reason: ' 按承运方报价 ',
        },
      ],
    });

    expect(canonical).toMatch(/^order-change-approval-v1:[a-f\d]{64}$/u);
    expect(reorderedAndNormalized).toBe(canonical);
    expect(token({ pendingChargeResolutions: [] })).toBe(
      token({ pendingChargeResolutions: [] }),
    );
  });

  it.each([
    ['requestId', { requestId: 'request-2' }],
    ['baseRevision', { baseRevision: 3 }],
    ['priceRevision', { priceRevision: 6 }],
    [
      'pureQuoteToken',
      { pureQuoteToken: `create-order-quote-v2:${'b'.repeat(64)}` },
    ],
    [
      'amount',
      {
        pendingChargeResolutions: [
          { ...firstResolution, amount: '12.31' },
          secondResolution,
        ],
      },
    ],
    [
      'reason',
      {
        pendingChargeResolutions: [
          { ...firstResolution, reason: '改用另一承运方' },
          secondResolution,
        ],
      },
    ],
    [
      'shipment facts',
      {
        pendingChargeResolutions: [
          { ...firstResolution, expectedProjectedQuantity: 1_201 },
          secondResolution,
        ],
      },
    ],
  ] as const)('任一 %s 证据变化都会改变凭证', (_label, overrides) => {
    expect(token(overrides)).not.toBe(token());
  });
});
