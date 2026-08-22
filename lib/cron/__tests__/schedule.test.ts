import { describe, expect, it } from 'vitest';
import {
  isStrictYearMonth,
  isStrictYmd,
  previousShanghaiMonth,
  shanghaiCalendarDate,
  yesterdayShanghai,
} from '../schedule';

describe('cron schedule helpers', () => {
  it('uses the Shanghai calendar across UTC boundaries', () => {
    const now = new Date('2026-07-17T16:30:00.000Z');
    expect(shanghaiCalendarDate(now)).toBe('2026-07-18');
    expect(yesterdayShanghai(now)).toBe('2026-07-17');
  });

  it('handles previous-month year rollover', () => {
    expect(previousShanghaiMonth(new Date('2026-01-15T00:00:00.000Z'))).toBe(
      '2025-12',
    );
  });

  it('strictly validates calendar inputs', () => {
    expect(isStrictYmd('2026-02-28')).toBe(true);
    expect(isStrictYmd('2026-02-30')).toBe(false);
    expect(isStrictYearMonth('2026-12')).toBe(true);
    expect(isStrictYearMonth('2026-13')).toBe(false);
  });
});
