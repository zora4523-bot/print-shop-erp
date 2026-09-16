import Decimal from 'decimal.js';
import { WorkerType } from '../../generated/prisma/enums';

// Pure math for the 时薪工 monthly payroll (SPEC §5.4 / §7.4). No DB —
// takes already-aggregated hour totals + decoded SalaryRule values
// and returns the pay breakdown.
//
// CLEANER uses hourly rates; COOK uses a monthly base plus a separate
// spare-work hourly rate. PACKER now belongs to the operation ledger.
//
// Rule shape the caller decodes from SalaryRule.ruleValue:
//   - CLEANER_HOURLY                   : { hourlyRate: number }
//   - COOK_MONTHLY                     : { monthlyBase: number }
//   - COOK_SPARE_HOURLY                : { hourlyRate: number }
//   - OT_MULTIPLIER                    : { multiplier: number }   (default 1.0)

export type HourlyPayrollRules = {
  // Normal hourly rate for CLEANER. For COOK this is
  // ignored in favor of monthlyBase + spare-hour rate.
  hourlyRate?: string | number;
  // Overtime multiplier (e.g. 1.5 for 1.5x). Defaults to 1.0 per
  // seed's OT_MULTIPLIER.
  otMultiplier?: string | number;
  // COOK only — monthly flat.
  monthlyBase?: string | number;
  // COOK only — independently configured spare-hour packing rate.
  spareHourlyRate?: string | number;
};

export type HourlyInputs = {
  workerType: WorkerType;
  totalNormalHours: string | number | Decimal;
  totalOtHours: string | number | Decimal;
  // COOK-only: spare hours worked on packing duties. Ignored for
  // non-COOK workerType.
  totalSpareHours?: string | number | Decimal;
};

export type HourlyPayrollBreakdown = {
  normalPay: Decimal; // hourlyRate × normalHours (non-COOK)
  otPay: Decimal; // hourlyRate × otHours × otMultiplier (non-COOK)
  monthlyBasePay: Decimal; // COOK only
  sparePay: Decimal; // COOK only
  totalSalary: Decimal;
};

export class HourlyPayrollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HourlyPayrollError';
  }
}

const ZERO = new Decimal(0);

// Payroll rows are persisted as Decimal(..., 2). Round each independently
// payable component before summing so the displayed breakdown always
// reconciles to the stored total down to the cent.
function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function calcHourlyPayroll(
  input: HourlyInputs,
  rules: HourlyPayrollRules,
): HourlyPayrollBreakdown {
  const normal = dec(input.totalNormalHours);
  const ot = dec(input.totalOtHours);
  const spare = input.totalSpareHours === undefined
    ? ZERO
    : dec(input.totalSpareHours);

  if (normal.lt(0) || ot.lt(0) || spare.lt(0)) {
    throw new HourlyPayrollError('工时不能为负');
  }

  if (input.workerType === WorkerType.COOK) {
    // SPEC §5.4: COOK has a flat monthlyBase + spare hours paid at
    // spare-work rate. normal / ot hours are NOT paid separately — the
    // monthlyBase covers kitchen duty.
    if (rules.monthlyBase === undefined) {
      throw new HourlyPayrollError('厨师缺少 COOK_MONTHLY 规则');
    }
    const base = money(dec(rules.monthlyBase));
    const spareRate =
      rules.spareHourlyRate === undefined ? ZERO : dec(rules.spareHourlyRate);
    const sparePay = money(spareRate.times(spare));
    return {
      normalPay: ZERO,
      otPay: ZERO,
      monthlyBasePay: base,
      sparePay,
      totalSalary: base.plus(sparePay),
    };
  }

  // CLEANER (and any future hourly type). OT is separate so
  // the multiplier can be adjusted without touching normal pay.
  if (rules.hourlyRate === undefined) {
    throw new HourlyPayrollError('时薪工缺少 hourlyRate 规则');
  }
  const rate = dec(rules.hourlyRate);
  const multiplier =
    rules.otMultiplier === undefined ? new Decimal(1) : dec(rules.otMultiplier);
  const normalPay = money(rate.times(normal));
  const otPay = money(rate.times(ot).times(multiplier));
  return {
    normalPay,
    otPay,
    monthlyBasePay: ZERO,
    sparePay: ZERO,
    totalSalary: normalPay.plus(otPay),
  };
}

function dec(v: string | number | Decimal): Decimal {
  return new Decimal(v as Decimal.Value);
}
