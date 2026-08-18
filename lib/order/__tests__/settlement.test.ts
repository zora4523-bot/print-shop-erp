import { describe, expect, it } from 'vitest';
import { OrderSettlementType, Role } from '../../../generated/prisma/enums';
import { settlementTypeForOrderCreator } from '../settlement';

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
