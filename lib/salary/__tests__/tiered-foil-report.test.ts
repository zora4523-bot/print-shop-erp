import { describe, expect, it } from 'vitest';
import { reportUsesTieredFoilWage } from '../tiered-foil-report';

const report = (unit: string, rules: Array<{ operationType: string; unit: string; smallOrderAmount: string | null }>) => ({ unit, priceBook: { rules } });

describe('reportUsesTieredFoilWage', () => {
  it('matches a foil report priced by a rule with a small-order amount of the same type and unit', () => {
    expect(reportUsesTieredFoilWage('PARTIAL', report('PER_PASS', [{ operationType: 'PARTIAL', unit: 'PER_PASS', smallOrderAmount: '12.0000' }]))).toBe(true);
    expect(reportUsesTieredFoilWage('FULL', report('PER_PIECE', [{ operationType: 'FULL', unit: 'PER_PIECE', smallOrderAmount: '20.0000' }]))).toBe(true);
  });

  it('ignores flat rules, other units, other operation types and packing', () => {
    expect(reportUsesTieredFoilWage('PARTIAL', report('PER_PASS', [{ operationType: 'PARTIAL', unit: 'PER_PASS', smallOrderAmount: null }]))).toBe(false);
    expect(reportUsesTieredFoilWage('PARTIAL', report('PER_PIECE', [{ operationType: 'PARTIAL', unit: 'PER_PASS', smallOrderAmount: '12.0000' }]))).toBe(false);
    expect(reportUsesTieredFoilWage('PARTIAL', report('PER_PASS', [{ operationType: 'FULL', unit: 'PER_PASS', smallOrderAmount: '12.0000' }]))).toBe(false);
    expect(reportUsesTieredFoilWage('PACKING', report('PER_BAG', [{ operationType: 'PACKING', unit: 'PER_BAG', smallOrderAmount: '1.0000' }]))).toBe(false);
  });
});
