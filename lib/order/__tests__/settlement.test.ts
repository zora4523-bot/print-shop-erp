import { describe, expect, it } from 'vitest';
import { OrderSettlementType } from '../../../generated/prisma/enums';
import { hasLogisticsChargeRows, orderBillsLogistics } from '../settlement';

describe('orderBillsLogistics', () => {
  const bound = { category: { code: 'SHIPPING_FEE' }, priceBookId: 'book-1' };
  // 补录 rows carry priceBookId: null (pricing-review.ts) and cannot be
  // requoted at ship time; they must not switch the order onto that path.
  const manual = { category: { code: 'SHIPPING_FEE' }, priceBookId: null };

  it('only counts price-book-bound logistics rows', () => {
    expect(hasLogisticsChargeRows([bound])).toBe(true);
    expect(hasLogisticsChargeRows([manual])).toBe(false);
    expect(hasLogisticsChargeRows([{ category: { code: 'OTHER' }, priceBookId: 'book-1' }])).toBe(false);
  });

  it('always bills external sales and samples, never proofs or free orders', () => {
    expect(orderBillsLogistics({ settlementType: OrderSettlementType.EXTERNAL_SALES, hasLogisticsRows: false })).toBe(true);
    expect(orderBillsLogistics({ settlementType: OrderSettlementType.EXTERNAL_SALES, purpose: 'SAMPLE_SHIPMENT', hasLogisticsRows: false })).toBe(true);
    expect(orderBillsLogistics({ settlementType: OrderSettlementType.EXTERNAL_SALES, purpose: 'PROOF', hasLogisticsRows: true })).toBe(false);
    expect(orderBillsLogistics({ settlementType: OrderSettlementType.NO_CHARGE, hasLogisticsRows: true })).toBe(false);
  });
});
