import { describe, expect, it } from 'vitest';
import { orderPricingSourceLabel } from '../pricing-source';
import { orderPricingStatusLabel } from '../pricing-status';

describe('工单计价业务名称', () => {
  it('映射已知的价格状态和来源', () => {
    expect(orderPricingStatusLabel('AUTO_CONFIRMED')).toBe('系统自动确认');
    expect(orderPricingSourceLabel('ORDER_CREATED_AUTO')).toBe(
      '建单自动计价',
    );
    expect(orderPricingSourceLabel('ADMIN_FULL_REPRICE')).toBe(
      '管理员重新计价',
    );
  });

  it('未知值不回显内部标识', () => {
    expect(orderPricingStatusLabel('RAW_PRICING_STATUS')).toBe('未识别状态');
    expect(orderPricingSourceLabel('RAW_PRICING_SOURCE')).toBe('未识别来源');
    expect(orderPricingStatusLabel(null)).toBe('—');
    expect(orderPricingSourceLabel(undefined)).toBe('—');
  });
});
