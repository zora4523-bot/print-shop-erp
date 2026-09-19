import { describe, expect, it } from 'vitest';
import { reportWageLines } from '../report-display';

const base = { entryType: 'REPORT', operationType: 'FULL', unit: 'PER_PIECE', chargeableQty: '4000', rate: '0.01', amount: '60', snapshot: {} };
const tier = (band = 'LARGE', fixed = '20', recorded = false) => ({ payroll: { foilWage: { mode: 'TIERED', band, multiplier: 2, smallOrderAmount: '20', setupRate: '10', pieceAmount: band === 'SMALL' ? '0' : '40', fixedAmount: fixed, fixedAlreadyRecorded: recorded } } });
describe('historic worker wage display', () => {
  it('explains two-colour 2000-piece wage as 40 plus 20, using saved amounts', () => {
    const text = reportWageLines({ ...base, snapshot: tier() }).join(' ');
    expect(text).toContain('计件费 ¥ 40.00'); expect(text).toContain('本次装版费 ¥ 20.00'); expect(text).toContain('本次记录 ¥ 60.00');
    expect(text).not.toContain('PER_PIECE');
  });
  it('shows a small-job package without pretending it equals quantity times rate', () => {
    const text = reportWageLines({ ...base, amount: '40', snapshot: tier('SMALL', '40') }).join(' ');
    expect(text).toContain('含装版'); expect(text).toContain('2 色'); expect(text).toContain('本次包价 ¥ 40.00'); expect(text).not.toContain('计薪 4000');
  });
  it('does not charge the fixed fee a second time in the explanation', () => {
    const text = reportWageLines({ ...base, amount: '40', snapshot: tier('LARGE', '0', true) }).join(' ');
    expect(text).toContain('本次装版费 ¥ 0.00'); expect(text).toContain('此前报工或承接记录');
  });
  it('renders partial pass counts, manual review, reversal and adjustment independently', () => {
    expect(reportWageLines({ ...base, operationType: 'PARTIAL', snapshot: tier() }).join(' ')).toContain('2 次');
    expect(reportWageLines({ ...base, snapshot: { payroll: { foilWage: { mode: 'MANUAL' } } } })[0]).toBe('人工核定计件');
    expect(reportWageLines({ ...base, entryType: 'REVERSAL', amount: '-60' }).join(' ')).toContain('冲正');
    expect(reportWageLines({ ...base, entryType: 'ADJUSTMENT', amount: '5' })).toEqual(['人工调整', '调整金额 ¥ 5.00']);
  });
  it('retains legacy linear reports only when they explain the saved amount', () => {
    expect(reportWageLines({ ...base, amount: '40', snapshot: null })[0]).toContain('4000 个');
    expect(reportWageLines({ ...base, amount: '40', snapshot: { payroll: { foilWage: null } } })[0]).toContain('4000 个');
    expect(reportWageLines(base)[0]).toBe('按报工时保存的工资记录展示');
  });
  it('does not invent a linear formula for malformed tier metadata', () => {
    for (const snapshot of [tier('OTHER'), { payroll: { foilWage: { ...tier().payroll.foilWage, fixedAmount: 'not money' } } }]) {
      expect(reportWageLines({ ...base, snapshot })[0]).toBe('按报工时保存的工资记录展示');
    }
  });
});
