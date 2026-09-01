const DAY_MS = 24 * 60 * 60 * 1000;

export type EmploymentWindow = Readonly<{
  employmentStartDate?: Date | null;
  employmentEndDate?: Date | null;
}>;

/** Employment dates are inclusive database DATE values. */
export function employmentCoversDate(
  date: Date,
  employment: EmploymentWindow,
): boolean {
  const value = date.getTime();
  return (
    (!employment.employmentStartDate ||
      value >= employment.employmentStartDate.getTime()) &&
    (!employment.employmentEndDate ||
      value <= employment.employmentEndDate.getTime())
  );
}

/**
 * Monthly salary is intentionally not prorated without an owner-approved
 * daily formula. A calendar month is eligible when it overlaps at least one
 * employment date; a wholly pre-employment/post-employment month is not.
 */
export function employmentOverlapsDateRange(
  startInclusive: Date,
  endExclusive: Date,
  employment: EmploymentWindow,
): boolean {
  return (
    (!employment.employmentStartDate ||
      employment.employmentStartDate.getTime() < endExclusive.getTime()) &&
    (!employment.employmentEndDate ||
      employment.employmentEndDate.getTime() >= startInclusive.getTime())
  );
}

export function monthStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function nextMonthStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export function monthEndUtc(date: Date): Date {
  return new Date(nextMonthStartUtc(date).getTime() - DAY_MS);
}

function monthOrdinal(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const candidate = new Date(Date.UTC(year, month + months, day));
  const expectedMonth = ((month + months) % 12 + 12) % 12;
  if (candidate.getUTCMonth() !== expectedMonth) {
    return new Date(
      Date.UTC(
        year + Math.floor((month + months) / 12),
        expectedMonth + 1,
        0,
      ),
    );
  }
  return candidate;
}

/** Inclusive end of an N-calendar-month period, preserving its start day. */
export function computeMonthlyPeriodEnd(
  periodStart: Date,
  durationMonths: number,
): Date {
  return new Date(addMonthsUtc(periodStart, durationMonths).getTime() - DAY_MS);
}

export type MonthlySalaryWindow = Readonly<{
  periodStart: Date;
  periodEnd: Date;
  durationMonths: number;
}>;

/**
 * Clamp an automatic whole-month salary window to employment months. The
 * first/last partial employment month remains a full salary month: this is an
 * eligibility guard, not an invented daily-proration policy.
 */
export function clampMonthlySalaryWindow(
  requestedStart: Date,
  requestedDurationMonths: number,
  employment: EmploymentWindow,
): MonthlySalaryWindow | null {
  let start = monthStartUtc(requestedStart);
  if (employment.employmentStartDate) {
    const employmentStartMonth = monthStartUtc(employment.employmentStartDate);
    if (employmentStartMonth.getTime() > start.getTime()) {
      start = employmentStartMonth;
    }
  }

  if (
    employment.employmentEndDate &&
    monthStartUtc(employment.employmentEndDate).getTime() < start.getTime()
  ) {
    return null;
  }

  let durationMonths = requestedDurationMonths;
  if (employment.employmentEndDate) {
    const availableMonths =
      monthOrdinal(employment.employmentEndDate) - monthOrdinal(start) + 1;
    durationMonths = Math.min(durationMonths, availableMonths);
  }
  if (durationMonths < 1) return null;

  const endMonth = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + durationMonths - 1, 1),
  );
  return {
    periodStart: start,
    periodEnd: monthEndUtc(endMonth),
    durationMonths,
  };
}

/**
 * Clamp an automatic successor without moving its contiguous start backward.
 * Historical/manual CS periods may begin mid-month, so normalizing their
 * successor to month day 1 would overlap the period that was just settled.
 */
export function clampContinuousMonthlySalaryWindow(
  requestedStart: Date,
  requestedDurationMonths: number,
  employment: EmploymentWindow,
): MonthlySalaryWindow | null {
  let start = new Date(requestedStart.getTime());
  if (employment.employmentStartDate) {
    const requestedMonth = monthStartUtc(start);
    const employmentStartMonth = monthStartUtc(employment.employmentStartDate);
    if (employmentStartMonth.getTime() > requestedMonth.getTime()) {
      start = employmentStartMonth;
    }
  }
  if (
    employment.employmentEndDate &&
    monthStartUtc(employment.employmentEndDate).getTime() <
      monthStartUtc(start).getTime()
  ) {
    return null;
  }

  let durationMonths = requestedDurationMonths;
  if (employment.employmentEndDate) {
    const finalEmploymentMonth = monthStartUtc(
      employment.employmentEndDate,
    ).getTime();
    while (
      durationMonths > 0 &&
      monthStartUtc(computeMonthlyPeriodEnd(start, durationMonths)).getTime() >
        finalEmploymentMonth
    ) {
      durationMonths -= 1;
    }
  }
  if (durationMonths < 1) return null;

  return {
    periodStart: start,
    periodEnd: computeMonthlyPeriodEnd(start, durationMonths),
    durationMonths,
  };
}

/** Manual CS periods must stay inside the employment calendar months. */
export function monthlySalaryWindowWithinEmployment(
  periodStart: Date,
  periodEnd: Date,
  employment: EmploymentWindow,
): boolean {
  const startMonth = monthStartUtc(periodStart).getTime();
  const endMonth = monthStartUtc(periodEnd).getTime();
  return (
    (!employment.employmentStartDate ||
      startMonth >= monthStartUtc(employment.employmentStartDate).getTime()) &&
    (!employment.employmentEndDate ||
      endMonth <= monthStartUtc(employment.employmentEndDate).getTime())
  );
}
