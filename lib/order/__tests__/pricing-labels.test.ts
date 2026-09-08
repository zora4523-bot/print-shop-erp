import { describe, expect, it } from 'vitest';
import { orderPricingSourceLabel } from '../pricing-source';
import { orderPricingStatusLabel } from '../pricing-status';

describe('工单计价业务名称', () => {
  it('映射已知的价格状态', () => {
    expect(orderPricingStatusLabel('AUTO_CONFIRMED')).toBe('系统自动确认');
  });

  it.each([
    ['ORDER_CREATED_AUTO', '建单自动计价'],
    ['ORDER_CREATED_PROVISIONAL', '建单暂定价'],
    ['EXTERNAL_SUBMIT_QUOTE', '外部销售提交报价'],
    ['ADMIN_FULL_REPRICE', '管理员重新计价'],
    ['ADMIN_SNAPSHOT_CONFIRMATION', '工厂核价'],
    ['FACTORY_CONFIRM_CURRENT_PUBLISHED', '工厂按当前价表确认'],
    ['SHIPMENT_CHARGES_FINALIZED', '发货费用确认'],
    ['SF_COLLECT_CHANGED_PENDING', '顺丰到付调整'],
    ['CHANGE_REQUEST_APPLIED_PENDING', '工单变更待确认'],
    ['CHANGE_REQUEST_APPLIED_AUTO_CONFIRMED', '工单变更自动计价'],
    [
      'CHANGE_REQUEST_APPROVED_CURRENT_PUBLISHED',
      '工单变更按当前价表确认',
    ],
    ['REWORK_ORDER_CREATED_NO_CHARGE', '返工单免收费'],
    ['ADMIN_MANUAL_CHARGE', '管理员调整附加费用'],
    ['ADMIN_MANUAL_CHARGE_REMOVED', '管理员删除附加费用'],
    ['ORDER_ITEM_PLATE_DETAIL', '管理员调整制版费用'],
    ['ORDER_ITEM_PLATE_DETAIL_REMOVED', '管理员删除制版费用'],
    ['LEGACY_BACKFILL', '历史价格回填'],
  ])('映射价格修订来源 %s', (source, expected) => {
    expect(orderPricingSourceLabel(source)).toBe(expected);
  });

  it('未知值不回显内部标识', () => {
    expect(orderPricingStatusLabel('RAW_PRICING_STATUS')).toBe('未识别状态');
    expect(orderPricingSourceLabel('RAW_PRICING_SOURCE')).toBe('未识别来源');
    expect(orderPricingStatusLabel(null)).toBe('—');
    expect(orderPricingSourceLabel(undefined)).toBe('—');
  });
});
