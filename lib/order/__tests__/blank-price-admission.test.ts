import { describe, expect, it, vi } from 'vitest';
import { CREATE_ORDER_GOLDEN_SNAPSHOT } from '@/lib/price/__tests__/fixtures/create-order-golden-fixtures';
import { assertBlankPriceAdmission, assertBlankPriceAdmissionInTx } from '../blank-price-admission';
import type { BlankAdmissionItem } from '../blank-price-admission';

vi.mock('../create-order-published-rule-adapter', () => ({ readPublishedCreateOrderPriceSnapshot: vi.fn() }));

const item: BlankAdmissionItem = {
  pricingRoute: 'STOCK_BLANK', paperType: '160g珠光艳闪', paperWeightGsm: 160,
  specification: '大号90×165', actualWidthMm: 90, actualHeightMm: 165,
};
const snapshot = CREATE_ORDER_GOLDEN_SNAPSHOT;

// Guard tests use real canonicalization and price facts. Database writes and
// other fees are deliberately outside this admission-only boundary.
describe('blank new-business admission', () => {
  it('accepts published positive canonical prices without a Product', () => {
    expect(() => assertBlankPriceAdmission([item], snapshot)).not.toThrow();
  });
  it.each(['0', null])('rejects stopped/missing unit price %s', (unitPrice) => {
    const stopped = { ...snapshot, partial: { ...snapshot.partial,
      blankUnitPrices: [{ ...snapshot.partial.blankUnitPrices[0]!, unitPrice }],
    } };
    expect(() => assertBlankPriceAdmission([item], stopped)).toThrow('未启用');
  });
  it('rejects missing and duplicate canonical keys rather than selecting one', () => {
    for (const prices of [[], [snapshot.partial.blankUnitPrices[0]!, {
      ...snapshot.partial.blankUnitPrices[0]!, specification: '大号90×165',
    }]]) {
      expect(() => assertBlankPriceAdmission([item], {
        ...snapshot, partial: { ...snapshot.partial, blankUnitPrices: prices },
      })).toThrow('未启用');
    }
  });
  it('does not let manual notes or resized blank items bypass new admission', () => {
    expect(() => assertBlankPriceAdmission([{ ...item, manualQuoteReason: '管理员允许' }], snapshot)).toThrow('配置外说明');
    expect(() => assertBlankPriceAdmission([{ ...item, actualWidthMm: 91 }], snapshot)).toThrow('标准尺寸');
  });
  it('keeps nonblank routes independent when no blank products are available', () => {
    expect(() => assertBlankPriceAdmission([{ pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL' }], {
      ...snapshot, partial: { ...snapshot.partial, blankUnitPrices: [] },
    })).not.toThrow();
  });
  it('rejects retired 120g even with a positive price', () => {
    expect(() => assertBlankPriceAdmission([{ ...item, paperType: '珠光艳闪', paperWeightGsm: 120 }], snapshot)).toThrow('120');
  });
  it.each([
    [],
    [{ id: 'paper', name: '珠光艳闪', specification: '160g', isActive: false, outOfStock: false }],
    [{ id: 'paper', name: '珠光艳闪', specification: '160g', isActive: true, outOfStock: true }],
    [1, 2].map((id) => ({ id: String(id), name: '珠光艳闪', specification: '160g', isActive: true, outOfStock: false })),
  ])('rejects missing, inactive, out-of-stock or ambiguous paper records %#', async (...papers) => {
    const tx = { material: { findMany: vi.fn().mockResolvedValue(papers) } };
    await expect(assertBlankPriceAdmissionInTx(tx as never, [item], new Date(), { snapshot })).rejects.toThrow('资料不唯一、已停用或缺货');
  });
});
