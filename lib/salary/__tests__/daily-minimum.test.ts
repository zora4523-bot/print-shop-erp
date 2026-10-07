import { describe, expect, it } from 'vitest';
import { dailyMinimumPay, hasDailyMinimum, hasMinimumProduction, lateCommissionDifference, settlementAdjustmentLabel } from '../daily-minimum';

describe('师傅每日保底', () => {
  it.each([['0', '100.00', '100.00'], ['99.99', '0.01', '100.00'], ['100', '0.00', '100.00'], ['100.01', '0.00', '100.01'], ['150', '0.00', '150.00']])('%s 元当日提成', (amount, topup, payable) => {
    expect(dailyMinimumPay(amount, '2026-10-06', true)).toEqual({ reportAmount: Number(amount).toFixed(2), adjustmentAmount: topup, payableAmount: payable, applies: true });
  });
  it('生效日前和没有发薪依据的日期不补足', () => {
    expect(dailyMinimumPay('15', '2026-10-05', true).payableAmount).toBe('15.00');
    expect(dailyMinimumPay('0', '2026-10-06', false).payableAmount).toBe('0.00');
  });
  it.each(['-1', 'NaN', 'Infinity', '0.001'])('拒绝无效提成 %s', amount => expect(() => dailyMinimumPay(amount, '2026-10-06', true)).toThrow('当日提成金额无效'));
  it.each([null, 'old', [], {}, { dailyMinimum: null }, { dailyMinimum: 'old' }, { dailyMinimum: [] }, { dailyMinimum: { applies: false } }])('旧快照没有保底标记 %j', value => {
    expect(hasDailyMinimum(value)).toBe(false);
    expect(settlementAdjustmentLabel(value)).toBe('调整');
  });
  it('新快照明确区分日薪补足', () => expect(settlementAdjustmentLabel({ dailyMinimum: { applies: true } })).toBe('日薪补足'));
  it('原报工被全额冲正、误登记被撤销后不以生产领日薪', () => {
    const report = (id: string, qty: string) => ({ operation: { id }, reportedCompletedQty: qty });
    expect(hasMinimumProduction([report('one', '100'), report('one', '-100')], [], '2026-10-06')).toBe(false);
    expect(hasMinimumProduction([report('one', '100'), report('two', '-100')], [], '2026-10-06')).toBe(true);
    expect(hasMinimumProduction([], [{ job: { workDate: null, completedQty: null } }], '2026-10-06')).toBe(false);
    expect(hasMinimumProduction([], [{ job: { workDate: new Date('2026-10-06'), completedQty: '100' } }], '2026-10-06')).toBe(true);
    expect(hasMinimumProduction([], [{ job: { workDate: new Date('2026-10-06'), completedQty: null } }], '2026-10-06')).toBe(false);
    expect(hasMinimumProduction([], [{ job: { workDate: new Date('2026-10-07'), completedQty: '100' } }], '2026-10-06')).toBe(false);
  });
  it('跨多笔补登记只补超出原日保底的增量', () => {
    expect(lateCommissionDifference('0', '100', '0', '60')).toBe('0.00');
    expect(lateCommissionDifference('0', '100', '60', '60')).toBe('20.00');
    expect(lateCommissionDifference('0', '100', '120', '30')).toBe('30.00');
    expect(lateCommissionDifference('120', '120', '0', '10')).toBe('10.00');
  });
});
