import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { WorkerType } from '../../../generated/prisma/client';
import {
  calcHourlyPayroll,
  HourlyPayrollError,
} from '../hourly-payroll';

function eq(actual: Decimal, expected: string): void {
  expect(actual.toFixed(4)).toBe(new Decimal(expected).toFixed(4));
}

const PACKER_RULES = {
  hourlyRate: 11,
  otMultiplier: 1.0,
};

const CLEANER_RULES = {
  hourlyRate: 11,
  otMultiplier: 1.0,
};

const COOK_RULES = {
  monthlyBase: 3000,
  spareHourlyRate: 11, // PACKER rate
  otMultiplier: 1.0, // ignored for COOK
};

describe('calcHourlyPayroll — PACKER / CLEANER', () => {
  it('SPEC §7.4 reproduction: 176 normal + 12 ot × 11 × 1.0 = 2068', async () => {
    const r = calcHourlyPayroll(
      {
        workerType: WorkerType.PACKER,
        totalNormalHours: 176,
        totalOtHours: 12,
      },
      PACKER_RULES,
    );
    // 176 × 11 = 1936; 12 × 11 × 1.0 = 132; total = 2068
    eq(r.normalPay, '1936');
    eq(r.otPay, '132');
    eq(r.totalSalary, '2068');
    eq(r.monthlyBasePay, '0');
    eq(r.sparePay, '0');
  });

  it('CLEANER flows through the same math (same rule shape)', () => {
    const r = calcHourlyPayroll(
      {
        workerType: WorkerType.CLEANER,
        totalNormalHours: 160,
        totalOtHours: 0,
      },
      CLEANER_RULES,
    );
    eq(r.totalSalary, '1760'); // 160 × 11
  });

  it('applies OT multiplier when > 1.0', () => {
    const r = calcHourlyPayroll(
      {
        workerType: WorkerType.PACKER,
        totalNormalHours: 160,
        totalOtHours: 20,
      },
      { hourlyRate: 11, otMultiplier: 1.5 },
    );
    // normal 160 × 11 = 1760; ot 20 × 11 × 1.5 = 330; total = 2090
    eq(r.otPay, '330');
    eq(r.totalSalary, '2090');
  });

  it('defaults otMultiplier to 1.0 when omitted', () => {
    const r = calcHourlyPayroll(
      {
        workerType: WorkerType.PACKER,
        totalNormalHours: 0,
        totalOtHours: 10,
      },
      { hourlyRate: 11 },
    );
    eq(r.otPay, '110');
  });

  it('refuses non-COOK path without hourlyRate', () => {
    expect(() =>
      calcHourlyPayroll(
        {
          workerType: WorkerType.PACKER,
          totalNormalHours: 10,
          totalOtHours: 0,
        },
        {},
      ),
    ).toThrow(HourlyPayrollError);
  });

  it('rejects negative hours (data-entry guard)', () => {
    expect(() =>
      calcHourlyPayroll(
        {
          workerType: WorkerType.PACKER,
          totalNormalHours: -1,
          totalOtHours: 0,
        },
        PACKER_RULES,
      ),
    ).toThrow(/不能为负/);
  });

  it('Decimal precision: 0.1 × 3 = 0.30, no float drift', () => {
    const r = calcHourlyPayroll(
      {
        workerType: WorkerType.PACKER,
        totalNormalHours: 3,
        totalOtHours: 0,
      },
      { hourlyRate: 0.1, otMultiplier: 1.0 },
    );
    expect(r.normalPay.toFixed(2)).toBe('0.30');
  });
});

describe('calcHourlyPayroll — COOK', () => {
  it('SPEC §5.4: flat monthlyBase, spare hours paid at PACKER rate', () => {
    const r = calcHourlyPayroll(
      {
        workerType: WorkerType.COOK,
        totalNormalHours: 160, // ignored for COOK
        totalOtHours: 10, // ignored for COOK
        totalSpareHours: 20,
      },
      COOK_RULES,
    );
    // base 3000 + spare 20 × 11 = 3220
    eq(r.monthlyBasePay, '3000');
    eq(r.sparePay, '220');
    eq(r.totalSalary, '3220');
    // Normal / OT pay stay zero — COOK does NOT double-dip.
    eq(r.normalPay, '0');
    eq(r.otPay, '0');
  });

  it('COOK without spare hours: just the monthly flat', () => {
    const r = calcHourlyPayroll(
      {
        workerType: WorkerType.COOK,
        totalNormalHours: 160,
        totalOtHours: 0,
      },
      COOK_RULES,
    );
    eq(r.totalSalary, '3000');
  });

  it('COOK without COOK_MONTHLY rule throws', () => {
    expect(() =>
      calcHourlyPayroll(
        {
          workerType: WorkerType.COOK,
          totalNormalHours: 0,
          totalOtHours: 0,
          totalSpareHours: 10,
        },
        {},
      ),
    ).toThrow(/COOK_MONTHLY/);
  });

  it('COOK without spare rate: sparePay = 0 even with spare hours', () => {
    const r = calcHourlyPayroll(
      {
        workerType: WorkerType.COOK,
        totalNormalHours: 0,
        totalOtHours: 0,
        totalSpareHours: 20,
      },
      { monthlyBase: 3000 },
    );
    eq(r.sparePay, '0');
    eq(r.totalSalary, '3000');
  });

  it('rejects negative spare hours', () => {
    expect(() =>
      calcHourlyPayroll(
        {
          workerType: WorkerType.COOK,
          totalNormalHours: 0,
          totalOtHours: 0,
          totalSpareHours: -5,
        },
        COOK_RULES,
      ),
    ).toThrow(/不能为负/);
  });
});

describe('calcHourlyPayroll — input flexibility', () => {
  it('accepts Decimal inputs', () => {
    const r = calcHourlyPayroll(
      {
        workerType: WorkerType.PACKER,
        totalNormalHours: new Decimal('176'),
        totalOtHours: new Decimal('12'),
      },
      PACKER_RULES,
    );
    eq(r.totalSalary, '2068');
  });

  it('accepts string inputs', () => {
    const r = calcHourlyPayroll(
      {
        workerType: WorkerType.PACKER,
        totalNormalHours: '176.00',
        totalOtHours: '12.00',
      },
      PACKER_RULES,
    );
    eq(r.totalSalary, '2068');
  });
});
