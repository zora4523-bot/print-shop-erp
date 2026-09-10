import { describe, expect, it } from 'vitest';
import { OrderPricingStatus, OrderStatus } from '../../../generated/prisma/enums';
import { orderAmountPresentation } from '../amount-presentation';

describe('orderAmountPresentation', () => {
  it('shows 未报价 for an unquoted draft, never a zero amount', () => {
    expect(
      orderAmountPresentation({ status: OrderStatus.DRAFT, amount: null }),
    ).toEqual({ label: '未报价', estimated: false, pending: true });
  });

  it('shows 待工厂核价 while the factory has not confirmed the price', () => {
    expect(
      orderAmountPresentation({
        status: OrderStatus.SUBMITTED,
        amount: '1200.00',
        pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
      }),
    ).toEqual({ label: '待工厂核价', estimated: false, pending: true });
    expect(
      orderAmountPresentation({ status: OrderStatus.SUBMITTED, amount: null }),
    ).toEqual({ label: '待工厂核价', estimated: false, pending: true });
  });

  it('separates an incomplete fee from ordinary pending pricing', () => {
    expect(
      orderAmountPresentation({
        status: OrderStatus.IN_PRODUCTION,
        amount: null,
        incomplete: true,
      }),
    ).toEqual({ label: '金额不完整', estimated: false, pending: true });
  });

  it('marks quoted amounts as estimated and confirmed amounts as plain', () => {
    expect(
      orderAmountPresentation({
        status: OrderStatus.IN_PRODUCTION,
        amount: '1234.5',
        estimated: true,
      }),
    ).toEqual({ label: '¥ 1,234.50', estimated: true, pending: false });
    expect(
      orderAmountPresentation({
        status: OrderStatus.FINISHED,
        amount: '1234.5',
        pricingStatus: OrderPricingStatus.ADMIN_CONFIRMED,
      }),
    ).toEqual({ label: '¥ 1,234.50', estimated: false, pending: false });
  });
});
