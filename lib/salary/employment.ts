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
