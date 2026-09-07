import { describe, expect, it } from 'vitest';
import { actionLabel, formatOrderLogChanges } from '../log-format';
import { orderPricingSourceLabel } from '../pricing-source';

describe('fulfillment pricing audit presentation', () => {
  it('labels the financial confirmation and hides internal request fingerprints', () => {
    expect(actionLabel('FULFILLMENT_PRICING_CONFIRMED')).toBe('确认物流费用');
    expect(actionLabel('SF_COLLECT_FULFILLMENT_CHANGED')).toBe('提交到付费用更正');
    expect(orderPricingSourceLabel('FULFILLMENT_SHIPPING_CONFIRMED')).toBe('管理员确认物流费用');
    const rows = formatOrderLogChanges({
      confirmedFee: { before: null, after: '100.00' },
      revision: { before: 2, after: 3 },
      shipmentChargeCorrections: { before: null, after: [{ sequence: 1, shippingFee: '10.00' }] },
      fulfillmentRequest: { before: 'internal', after: 'fingerprint' },
    });
    expect(rows.map((row) => row.label)).toEqual(['已确认应收', '工单修订', '物流费用明细']);
    expect(rows[2]?.after).toBe('1 个地址的费用更正');
    expect(JSON.stringify(rows)).not.toContain('fingerprint');
  });
});
