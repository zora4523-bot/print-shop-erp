import { describe, it, expect } from 'vitest';
import {
  currentShanghaiMonth,
  isFutureShanghaiDate,
  isFutureShanghaiMonth,
  shanghaiDayBoundary,
  todayShanghai,
} from '../shanghai-clock';

describe('todayShanghai', () => {
  it('返回 YYYY-MM-DD（Asia/Shanghai 日历）', () => {
    // UTC 2026-04-25T16:30:00Z = Shanghai 2026-04-26 00:30
    expect(todayShanghai(new Date('2026-04-25T16:30:00Z'))).toBe('2026-04-26');
  });

  it('UTC 当日 = Shanghai 当日', () => {
    // UTC 2026-04-25T08:00 = Shanghai 2026-04-25T16:00
    expect(todayShanghai(new Date('2026-04-25T08:00:00Z'))).toBe('2026-04-25');
  });

  it('跨日边界：UTC 15:59 vs 16:00（Shanghai 23:59 vs 次日 00:00）', () => {
    expect(todayShanghai(new Date('2026-04-26T15:59:59Z'))).toBe('2026-04-26');
    expect(todayShanghai(new Date('2026-04-26T16:00:00Z'))).toBe('2026-04-27');
  });

  it('跨月边界（4 月 30 日 Shanghai 23:59 → 5 月 1 日 00:00）', () => {
    expect(todayShanghai(new Date('2026-04-30T15:59:00Z'))).toBe('2026-04-30');
    expect(todayShanghai(new Date('2026-04-30T16:00:00Z'))).toBe('2026-05-01');
  });

  it('跨年边界', () => {
    expect(todayShanghai(new Date('2026-12-31T15:59:00Z'))).toBe('2026-12-31');
    expect(todayShanghai(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
  });
});

describe('currentShanghaiMonth', () => {
  it('返回 YYYY-MM', () => {
    expect(currentShanghaiMonth(new Date('2026-04-25T08:00:00Z'))).toBe(
      '2026-04',
    );
  });

  it('跨月在 Shanghai 时区下 flip', () => {
    // Shanghai 2026-04-30 23:59 还在 4 月
    expect(currentShanghaiMonth(new Date('2026-04-30T15:59:00Z'))).toBe(
      '2026-04',
    );
    // Shanghai 2026-05-01 00:00 已是 5 月
    expect(currentShanghaiMonth(new Date('2026-04-30T16:00:00Z'))).toBe(
      '2026-05',
    );
  });
});

describe('isFutureShanghaiDate', () => {
  it('当天不是未来、次日是未来（Shanghai 23:59:59 仍算当天）', () => {
    // UTC 2026-04-26T15:59:59Z = Shanghai 2026-04-26 23:59:59
    const now = new Date('2026-04-26T15:59:59Z');
    expect(isFutureShanghaiDate('2026-04-26', now)).toBe(false);
    expect(isFutureShanghaiDate('2026-04-27', now)).toBe(true);
  });

  it('按上海日历翻页，不是 UTC：UTC 16:00 之后次日已成为「今天」', () => {
    // UTC 2026-04-26T16:00:00Z = Shanghai 2026-04-27 00:00。UTC 实现
    // 会把 2026-04-27 判成未来 —— 这条就是钉死时区口径的用例。
    const now = new Date('2026-04-26T16:00:00Z');
    expect(isFutureShanghaiDate('2026-04-27', now)).toBe(false);
  });

  it('过去的日期永远不是未来', () => {
    expect(isFutureShanghaiDate('2026-04-25', new Date('2026-04-26T15:59:59Z'))).toBe(
      false,
    );
  });

  it('跨年边界', () => {
    // Shanghai 2027-01-01 00:00
    expect(isFutureShanghaiDate('2027-01-01', new Date('2026-12-31T16:00:00Z'))).toBe(
      false,
    );
    // Shanghai 2026-12-31 23:59 —— 元旦还没到
    expect(isFutureShanghaiDate('2027-01-01', new Date('2026-12-31T15:59:00Z'))).toBe(
      true,
    );
  });
});

describe('isFutureShanghaiMonth', () => {
  it('当月不是未来、下月是未来（Shanghai 4-30 23:59 仍在 4 月）', () => {
    const now = new Date('2026-04-30T15:59:00Z');
    expect(isFutureShanghaiMonth('2026-04', now)).toBe(false);
    expect(isFutureShanghaiMonth('2026-05', now)).toBe(true);
  });

  it('按上海日历翻月：UTC 4-30T16:00 之后 5 月已是当月', () => {
    const now = new Date('2026-04-30T16:00:00Z');
    expect(isFutureShanghaiMonth('2026-05', now)).toBe(false);
  });

  it('过去的月份永远不是未来', () => {
    expect(isFutureShanghaiMonth('2026-03', new Date('2026-04-30T15:59:00Z'))).toBe(
      false,
    );
  });

  it('跨年边界', () => {
    expect(isFutureShanghaiMonth('2027-01', new Date('2026-12-31T16:00:00Z'))).toBe(
      false,
    );
    expect(isFutureShanghaiMonth('2027-01', new Date('2026-12-31T15:59:00Z'))).toBe(
      true,
    );
  });
});

describe('shanghaiDayBoundary', () => {
  it('Shanghai 当日 [start, end) = UTC [前一日 16:00, 当日 16:00)', () => {
    const { start, end } = shanghaiDayBoundary('2026-04-26');
    expect(start.toISOString()).toBe('2026-04-25T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-26T16:00:00.000Z');
  });

  it('range 长度恰好 24 小时', () => {
    const { start, end } = shanghaiDayBoundary('2026-04-26');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('非法日历日期抛错（2 月 31 日 / 月份越界）', () => {
    expect(() => shanghaiDayBoundary('2026-02-31')).toThrow(
      /非法 YYYY-MM-DD/,
    );
    expect(() => shanghaiDayBoundary('2026-13-01')).toThrow(
      /非法 YYYY-MM-DD/,
    );
    expect(() => shanghaiDayBoundary('not-a-date')).toThrow(/非法 YYYY-MM-DD/);
  });
});
