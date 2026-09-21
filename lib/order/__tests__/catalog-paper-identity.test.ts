import { expect, it } from 'vitest';
import { catalogPaperPricingFacts } from '../catalog-paper-identity';
import { catalogPaperPricingFacts as compatibilityExport } from '../create-order-quote-facts-adapter';

it('keeps the original export callable by maintenance scripts and existing consumers', () => {
  expect(compatibilityExport).toBe(catalogPaperPricingFacts);
});

it.each([
  [{ name: '红卡', specification: '160g' }, [{ paperType: '红卡', paperWeightGsm: 160 }]],
  [{ name: '160g 红卡 / 160g 冰白纸', specification: '160g红卡 ／ 160g珠光纸' }, [
    { paperType: '红卡', paperWeightGsm: 160 }, { paperType: '冰白纸', paperWeightGsm: 160 },
    { paperType: '珠光纸', paperWeightGsm: 160 },
  ]],
  [{ name: '180g红卡', specification: '160g' }, []],
  [{ name: '验收纸张', specification: null }, []],
  [{ name: '160g红卡', specification: null }, [{ paperType: '红卡', paperWeightGsm: 160 }]],
  [{ name: '160g纸X', specification: '160g纸×' }, [{ paperType: '纸×', paperWeightGsm: 160 }]],
])('preserves name/specification splitting, weight precedence and normalized deduplication: %j', (paper, expected) => {
  expect(catalogPaperPricingFacts(paper)).toEqual(expected);
});
