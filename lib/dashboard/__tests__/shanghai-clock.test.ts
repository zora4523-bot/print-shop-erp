import { describe, it, expect } from 'vitest';
import {
  currentShanghaiMonth,
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
