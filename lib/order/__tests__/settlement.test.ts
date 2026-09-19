import { describe, expect, it } from 'vitest';
import { OrderSettlementType, Role } from '../../../generated/prisma/enums';
import { hasLogisticsChargeRows, orderBillsLogistics, settlementTypeForOrderCreator } from '../settlement';

describe('settlementTypeForOrderCreator', () => {
  it.each([
    [Role.SALES, OrderSettlementType.EXTERNAL_SALES],
    [Role.CUSTOMER_SERVICE, OrderSettlementType.INTERNAL_SALES],
    [Role.ADMIN, OrderSettlementType.FACTORY_DIRECT],
  ])('maps %s to the immutable settlement path %s', (role, expected) => {
    expect(settlementTypeForOrderCreator(role)).toBe(expected);
  });

  it('rejects worker-side order creation', () => {
    expect(() => settlementTypeForOrderCreator(Role.WORKER)).toThrow(
      '师傅账号不能创建销售工单',
    );
  });
});

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

  it.each([OrderSettlementType.INTERNAL_SALES, OrderSettlementType.FACTORY_DIRECT])(
    'puts a %s order on the logistics path only once the finalizer wrote its rows',
    (settlementType) => {
      expect(orderBillsLogistics({ settlementType, hasLogisticsRows: false })).toBe(false);
      expect(orderBillsLogistics({ settlementType, hasLogisticsRows: true })).toBe(true);
    },
  );

  it('always bills external sales and samples, never proofs or free orders', () => {
    expect(orderBillsLogistics({ settlementType: OrderSettlementType.EXTERNAL_SALES, hasLogisticsRows: false })).toBe(true);
    expect(orderBillsLogistics({ settlementType: OrderSettlementType.FACTORY_DIRECT, purpose: 'SAMPLE_SHIPMENT', hasLogisticsRows: false })).toBe(true);
    expect(orderBillsLogistics({ settlementType: OrderSettlementType.EXTERNAL_SALES, purpose: 'PROOF', hasLogisticsRows: true })).toBe(false);
    expect(orderBillsLogistics({ settlementType: OrderSettlementType.NO_CHARGE, hasLogisticsRows: true })).toBe(false);
  });
});
