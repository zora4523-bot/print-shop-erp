import { describe, it, expect } from 'vitest';
import {
  formatDateInputShanghai,
  formatDateTimeLocalShanghai,
  formatDateShanghai,
  formatDateTimeShanghai,
} from '../dates';

// UTC 2026-07-08 20:30 = 上海 2026-07-09 04:30 —— 跨日样本，
// 锁定"按上海时区而非服务器本地/UTC"的口径。
const CROSS_DAY = new Date('2026-07-08T20:30:00Z');

describe('formatDateShanghai', () => {
  it('YYYY/MM/DD，按 Asia/Shanghai 日界', () => {
    expect(formatDateShanghai(CROSS_DAY)).toBe('2026/07/09');
  });

  it('null/undefined → 默认占位符 —，可自定义', () => {
    expect(formatDateShanghai(null)).toBe('—');
    expect(formatDateShanghai(undefined)).toBe('—');
    expect(formatDateShanghai(null, '-')).toBe('-');
  });
});

describe('formatDateTimeShanghai', () => {
  it('YYYY/MM/DD HH:mm 24 小时制，按 Asia/Shanghai', () => {
    expect(formatDateTimeShanghai(CROSS_DAY)).toBe('2026/07/09 04:30');
  });

  it('null → 占位符', () => {
    expect(formatDateTimeShanghai(null)).toBe('—');
  });
});

describe('formatDateInputShanghai', () => {
  it('returns the Shanghai calendar date for an HTML date input', () => {
    expect(formatDateInputShanghai(CROSS_DAY)).toBe('2026-07-09');
    expect(formatDateInputShanghai(null)).toBe('');
  });
});

describe('formatDateTimeLocalShanghai', () => {
  it('formats the Shanghai wall clock for datetime-local inputs', () => {
    expect(formatDateTimeLocalShanghai(CROSS_DAY)).toBe('2026-07-09T04:30');
  });

  it('keeps midnight as hour 00 instead of rolling to 24', () => {
    expect(
      formatDateTimeLocalShanghai(new Date('2026-07-08T16:00:00.000Z')),
    ).toBe('2026-07-09T00:00');
  });
});
