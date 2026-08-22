import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  calcCsCommission,
  calcCsMonthlyBaseTotal,
  calcCsTotalIncome,
  type CsTiersConfig,
} from '../cs-commission';

const SEED_TIERS: CsTiersConfig = {
  mode: 'FLAT',
  tiers: [
    { minSales: 100000, rate: 0.01 },
    { minSales: 200000, rate: 0.02 },
    { minSales: 300000, rate: 0.03 },
    { minSales: 400000, rate: 0.045 },
    { minSales: 500000, rate: 0.06 },
    { minSales: 600000, rate: 0.065 },
    { minSales: 700000, rate: 0.07 },
    { minSales: 800000, rate: 0.075 },
    { minSales: 900000, rate: 0.08 },
    { minSales: 1000000, rate: 0.085 },
  ],
};

function eq(actual: Decimal, expected: string): void {
  expect(actual.toFixed(4)).toBe(new Decimal(expected).toFixed(4));
}

describe('calcCsCommission (SPEC §5.3 FLAT mode)', () => {
  it('SPEC §7.3 reproduction: 55万业绩 → tier 5 (rate 0.06) → 33000', () => {
    const r = calcCsCommission(550000, SEED_TIERS);
    expect(r.belowAllTiers).toBe(false);
    expect(r.tierIndex).toBe(4); // tiers[4] is minSales=500000
    eq(r.tierRate, '0.06');
    eq(r.commissionAmount, '33000');
  });

  it('exactly-at-threshold picks the higher tier', () => {
    // 100,000 → minSales=100000 is ≤, so tier 0 wins with rate 0.01
    const r = calcCsCommission(100000, SEED_TIERS);
    expect(r.tierIndex).toBe(0);
    eq(r.tierRate, '0.01');
    eq(r.commissionAmount, '1000');
  });

  it('below lowest tier: belowAllTiers=true, commission=0', () => {
    // 99,999 < 100,000 min threshold
    const r = calcCsCommission(99999, SEED_TIERS);
    expect(r.belowAllTiers).toBe(true);
    expect(r.tierIndex).toBeNull();
    eq(r.commissionAmount, '0');
  });

  it('above highest tier: highest tier wins (rate stays at 0.085)', () => {
    // 1,500,000 >= all minSales; tier 9 with rate 0.085 wins
    const r = calcCsCommission(1500000, SEED_TIERS);
    expect(r.tierIndex).toBe(9);
    eq(r.tierRate, '0.085');
    eq(r.commissionAmount, '127500');
  });

  it('FLAT applies the rate to the WHOLE total, not just the excess', () => {
    // 600,000 → tier 5 (minSales=600000, rate=0.065), FLAT means
    // 600000 × 0.065 = 39000, not a stepwise calculation.
    const r = calcCsCommission(600000, SEED_TIERS);
    eq(r.commissionAmount, '39000');
  });

  it('accepts Decimal and string inputs for totalSales', () => {
    eq(calcCsCommission('550000', SEED_TIERS).commissionAmount, '33000');
    eq(calcCsCommission(new Decimal('550000'), SEED_TIERS).commissionAmount, '33000');
  });

  it('throws on non-FLAT mode (stepped is P2)', () => {
    expect(() =>
      calcCsCommission(500000, { ...SEED_TIERS, mode: 'STEPPED' }),
    ).toThrow(/不支持的提成模式/);
  });

  it('handles out-of-order tier definitions (sorts internally)', () => {
    // Reversed order should still pick the right tier.
    const reversed: CsTiersConfig = {
      mode: 'FLAT',
      tiers: [...SEED_TIERS.tiers].reverse(),
    };
    const r = calcCsCommission(550000, reversed);
    eq(r.tierRate, '0.06');
    eq(r.commissionAmount, '33000');
  });

  it('tierIndex refers to original unsorted position', () => {
    // Important for UI that displays "第 N 档" — must match the
    // input ordering, not the internal sort.
    const r = calcCsCommission(550000, SEED_TIERS);
    expect(SEED_TIERS.tiers[r.tierIndex!]?.rate).toBe(0.06);
  });

  it('rejects empty, duplicate, or out-of-range tiers instead of computing ambiguous pay', () => {
    expect(() =>
      calcCsCommission(100000, { mode: 'FLAT', tiers: [] }),
    ).toThrow(/不能为空/);
    expect(() =>
      calcCsCommission(100000, {
        mode: 'FLAT',
        tiers: [
          { minSales: 100000, rate: 0.01 },
          { minSales: '100000.00', rate: 0.02 },
        ],
      }),
    ).toThrow(/不能重复/);
    expect(() =>
      calcCsCommission(100000, {
        mode: 'FLAT',
        tiers: [{ minSales: 100000, rate: 1.0001 }],
      }),
    ).toThrow(/0% 到 100%/);
  });
});

describe('calcCsMonthlyBaseTotal / calcCsTotalIncome', () => {
  it('SPEC §7.3: 2000 × 4 = 8000 base, + 33000 commission = 41000 total', () => {
    const baseTotal = calcCsMonthlyBaseTotal(2000, 4);
    eq(baseTotal, '8000');
    const total = calcCsTotalIncome(baseTotal, new Decimal('33000'));
    eq(total, '41000');
  });

  it('no JS float drift: 2000.50 × 3 = 6001.50 exact', () => {
    const baseTotal = calcCsMonthlyBaseTotal('2000.50', 3);
    eq(baseTotal, '6001.50');
  });
});

describe('守卫路径（§4.3 要求 100% 覆盖；这些是"拒绝继续"而不是静默算错的闸口）', () => {
  it('业绩金额非有限数 → 抛错，不产出提成', () => {
    expect(() => calcCsCommission(new Decimal(NaN), SEED_TIERS)).toThrow(
      '客服业绩金额非法',
    );
    expect(() => calcCsCommission(new Decimal(Infinity), SEED_TIERS)).toThrow(
      '客服业绩金额非法',
    );
  });

  it('档位门槛非法（负数 / 非有限 / 超两位小数）→ 抛错', () => {
    const negative: CsTiersConfig = {
      mode: 'FLAT',
      tiers: [{ minSales: '-1', rate: '0.01' }],
    };
    expect(() => calcCsCommission(new Decimal(100000), negative)).toThrow(
      '客服提成档位的业绩门槛非法',
    );

    const tooPrecise: CsTiersConfig = {
      mode: 'FLAT',
      tiers: [{ minSales: '100000.123', rate: '0.01' }],
    };
    expect(() => calcCsCommission(new Decimal(100000), tooPrecise)).toThrow(
      '客服提成档位的业绩门槛非法',
    );
  });
});
