import { describe, it, expect } from 'vitest';
import { OrderStatus } from '../../../generated/prisma/enums';
import {
  DUE_SOON_DAYS,
  promisedDateAlert,
  promisedDaysLeft,
} from '../promised-date';

// promisedDate 存日历日的 UTC 零点（parseStrictYmd 口径）；now 取
// 上海时间 2026-07-07 的某个时刻（UTC 2026-07-07T04:00 = 上海 12:00）。
const NOW = new Date('2026-07-07T04:00:00Z');
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

describe('promisedDaysLeft', () => {
  it('今天到期 = 0，明天 = 1，昨天 = -1（上海日历日口径）', () => {
    expect(promisedDaysLeft(d('2026-07-07'), NOW)).toBe(0);
    expect(promisedDaysLeft(d('2026-07-08'), NOW)).toBe(1);
    expect(promisedDaysLeft(d('2026-07-06'), NOW)).toBe(-1);
  });

  it('上海已过日界而 UTC 未过时按上海日算', () => {
    // UTC 2026-07-06 20:00 = 上海 2026-07-07 04:00 → 今天是 07-07
    const lateUtc = new Date('2026-07-06T20:00:00Z');
    expect(promisedDaysLeft(d('2026-07-07'), lateUtc)).toBe(0);
    expect(promisedDaysLeft(d('2026-07-06'), lateUtc)).toBe(-1);
  });
});

describe('promisedDateAlert', () => {
  it('逾期返回 overdue + 逾期天数', () => {
    expect(
      promisedDateAlert(d('2026-07-04'), OrderStatus.IN_PRODUCTION, NOW),
    ).toEqual({ kind: 'overdue', days: 3 });
  });

  it('DUE_SOON_DAYS 内返回 due-soon；之外返回 null', () => {
    expect(
      promisedDateAlert(d('2026-07-07'), OrderStatus.SUBMITTED, NOW),
    ).toEqual({ kind: 'due-soon', days: 0 });
    expect(
      promisedDateAlert(d('2026-07-10'), OrderStatus.SUBMITTED, NOW),
    ).toEqual({ kind: 'due-soon', days: DUE_SOON_DAYS });
    expect(
      promisedDateAlert(d('2026-07-11'), OrderStatus.SUBMITTED, NOW),
    ).toBeNull();
  });

  it('已发货/已完结/已取消不预警；未填交期不预警', () => {
    for (const status of [
      OrderStatus.SHIPPED,
      OrderStatus.FINISHED,
      OrderStatus.CANCELLED,
    ]) {
      expect(promisedDateAlert(d('2026-07-01'), status, NOW)).toBeNull();
    }
    expect(promisedDateAlert(null, OrderStatus.IN_PRODUCTION, NOW)).toBeNull();
  });
});
