import { describe, expect, it } from 'vitest';
import { blankPriceIdentity, blankPriceIdentityFromCondition, blankPriceTriggerCondition } from '../blank-price-identity';
import { BLANK_SPECIFICATIONS } from '../blank-paper';

describe('blank price identity', () => {
  it.each(BLANK_SPECIFICATIONS)('规则、规格目录和选择键同源：$key', (spec) => {
    const identity = blankPriceIdentity({ paperType: ' 红 卡 ', paperWeightGsm: 180, specification: spec.specification });
    expect(identity).toMatchObject({ paperType: '红卡', paperWeightGsm: 180, specificationKey: spec.key, specification: spec.label });
    expect(blankPriceIdentityFromCondition(blankPriceTriggerCondition(identity!))).toEqual(identity);
    expect(blankPriceIdentity({ paperType: '180克红卡', specification: spec.label })).toEqual(identity);
  });
  it('拒绝没有克重、互相矛盾、非标准及多值身份', () => {
    for (const input of [
      { paperType: '红卡', specification: '中号封' },
      { paperType: '180g红卡', paperWeightGsm: 160, specification: '中号封' },
      { paperType: '180g红卡', specification: '自定义' },
      { paperType: '180g红卡/珠光', specification: '中号封' },
    ]) expect(blankPriceIdentity(input)).toBeNull();
  });
  it('不从重复或额外身份条件猜选第一条', () => {
    const condition = { schemaVersion: 1, target: 'ITEM', pricingRoutes: ['STOCK_BLANK'], paperTypes: ['180g红卡'], specifications: ['中号封'] };
    expect(blankPriceIdentityFromCondition({ ...condition, paperTypes: ['180g红卡', '180g红卡'] })).toBeNull();
    expect(blankPriceIdentityFromCondition({ ...condition, pricingRoutes: ['STOCK_BLANK', 'CUSTOM_FOIL'] })).toBeNull();
    expect(blankPriceIdentityFromCondition({ ...condition, specifications: ['中号封', '大号封'] })).toBeNull();
  });
});
