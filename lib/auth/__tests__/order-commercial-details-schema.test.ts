import { describe, expect, it } from 'vitest';
import {
  saveOrderManualChargeSchema,
  saveOrderPlateDetailSchema,
} from '@/lib/auth/schemas';

describe('structured order commercial detail schemas', () => {
  it('requires approval information for a signed adjustment', () => {
    const missingApproval = saveOrderManualChargeSchema.safeParse({
      orderId: 'order-1',
      chargeId: null,
      expectedPriceRevision: 2,
      categoryCode: 'APPROVED_ADJUSTMENT',
      description: '折让',
      amount: '-20.00',
      reason: '交期延误',
      approvalReference: '',
    });
    expect(missingApproval.success).toBe(false);

    const valid = saveOrderManualChargeSchema.safeParse({
      orderId: 'order-1',
      chargeId: null,
      expectedPriceRevision: '2',
      categoryCode: 'APPROVED_ADJUSTMENT',
      description: '折让',
      amount: '-20.00',
      reason: '交期延误',
      approvalReference: '审批单 AP-1',
    });
    expect(valid.success).toBe(true);
  });

  it('never accepts a negative sample or other packaging fee', () => {
    for (const categoryCode of ['SAMPLE_FEE', 'OTHER_PACKAGING_FEE']) {
      expect(
        saveOrderManualChargeSchema.safeParse({
          orderId: 'order-1',
          chargeId: null,
          expectedPriceRevision: 2,
          categoryCode,
          description: '收费',
          amount: '-0.01',
          reason: '测试',
          approvalReference: null,
        }).success,
      ).toBe(false);
    }
  });

  it('normalizes a valid multi-line plate input without trusting amount', () => {
    const parsed = saveOrderPlateDetailSchema.parse({
      orderId: 'order-1',
      orderItemId: 'item-1',
      plateDetailId: null,
      expectedPriceRevision: '3',
      name: '烫金版',
      plateGroupId: ' PG-1 ',
      specification: '80 × 50 mm',
      quantity: '2',
      unitPrice: '17.50',
      remark: '',
      amount: '999999.00',
    });
    expect(parsed).toMatchObject({
      expectedPriceRevision: 3,
      plateGroupId: 'PG-1',
      quantity: 2,
      unitPrice: '17.50',
      remark: null,
    });
    expect(parsed).not.toHaveProperty('amount');
  });
});
