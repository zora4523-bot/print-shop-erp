import { parseStrictYmd } from '../auth/schemas';

// Asia/Shanghai is the business timezone (UTC+8, no DST). A calendar
// date for salary purposes means a 24-hour window starting at Shanghai
// midnight, i.e. UTC day-previous 16:00 → UTC day 16:00.
const SHANGHAI_OFFSET_HOURS = 8;

export class DailySalaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailySalaryError';
  }
}

/** Returns the UTC instant range for one strict Shanghai calendar date. */
export function shanghaiDayRange(date: string): { start: Date; end: Date } {
  const utcMidnight = parseStrictYmd(date);
  if (!utcMidnight) {
    throw new DailySalaryError(
      `日期格式非法或非法日历日期（应为合法 YYYY-MM-DD）：${date}`,
    );
  }
  const start = new Date(
    utcMidnight.getTime() - SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000,
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
