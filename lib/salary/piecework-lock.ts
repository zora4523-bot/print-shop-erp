// Reporting and settlement share this reporter/date critical section. A
// report whose transaction timestamp belongs to a closing Shanghai day must
// either commit before that day's immutable settlement, or observe the
// LOCKED/PAID row and fail without creating a stranded report.
export function pieceworkSettlementLockKey(
  reporterId: string,
  workDate: string,
): string {
  return `print-shop-erp:piecework-settlement:${reporterId}:${workDate}`;
}

// A closed-day batch holds this gate while discovering reporters. Live report
// transactions take the same day gate before insert. Therefore the batch
// either waits for every pre-midnight report to commit and sees it, or a
// delayed report rechecks clock_timestamp() after the gate and moves to the
// still-open current day.
export function pieceworkReportingDayGateLockKey(workDate: string): string {
  return `print-shop-erp:piecework-reporting-day:${workDate}`;
}
