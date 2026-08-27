import { parseStrictYmd } from '../auth/schemas';
import { formatDateInputShanghai } from '../format/dates';

// Shanghai-calendar helpers for the owner dashboard. Same pattern as
// `lib/salary/daily.ts:shanghaiDayRange` — `Asia/Shanghai` is UTC+8 with
// no DST so a calendar day is a fixed [-08h, +16h) window around UTC
// midnight.
//
// Keep these helpers free of Prisma and decimal.js so pages, tests and other
// pure date utilities can import one canonical Shanghai wall-clock source.

const SHANGHAI_OFFSET_HOURS = 8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns the YYYY-MM-DD calendar date at `now` in Asia/Shanghai.
 * Defaults to the current wall-clock — pass an explicit `now` for tests
 * that need a deterministic boundary.
 */
export function todayShanghai(now: Date = new Date()): string {
  return formatDateInputShanghai(now);
}

/**
 * Returns the YYYY-MM string for the Shanghai calendar month at `now`.
 */
export function currentShanghaiMonth(now: Date = new Date()): string {
  return todayShanghai(now).slice(0, 7);
}

// YYYY-MM-DD 与 YYYY-MM 都是零填充定宽，所以字符串 `>` 就是日历比较 ——
// 不用再 parse 回 Date、也不用二次推导时区。调用方必须先做过格式校验
// （parseStrictYmd / isStrictYmd / Zod 字段），这两个谓词只回答
// 「它是不是晚于上海的墙上时钟」。
//
// 为什么薪资路径需要它：还没开始的一天 / 一个月，按定义没有任何已完工
// 任务或考勤，结算它只会冻结出一条凭空的 dailyBase / monthlyBase 行 ——
// 而这行还能被标记已发，等真实工作发生后重算又被 paid guard 挡住，只能
// 人工撤销。所以在源头拒绝，而不是写完再补救。

/** `date`（YYYY-MM-DD）是否晚于上海日历的今天。 */
export function isFutureShanghaiDate(
  date: string,
  now: Date = new Date(),
): boolean {
  return date > todayShanghai(now);
}

/** `month`（YYYY-MM）是否晚于上海日历的本月。 */
export function isFutureShanghaiMonth(
  month: string,
  now: Date = new Date(),
): boolean {
  return month > currentShanghaiMonth(now);
}

/**
 * Returns `[start, end)` UTC instants spanning the Shanghai calendar
 * day for the given YYYY-MM-DD string.
 *
 * Throws if the input isn't a valid calendar date (e.g. "2026-02-31" —
 * `new Date()` would silently roll forward to March, which is exactly
 * the kind of bug we don't want leaking into KPI windows).
 */
export function shanghaiDayBoundary(date: string): { start: Date; end: Date } {
  const utcMidnight = parseStrictYmd(date);
  if (!utcMidnight) {
    throw new Error(`非法 YYYY-MM-DD：${date}`);
  }
  const start = new Date(
    utcMidnight.getTime() - SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000,
  );
  const end = new Date(start.getTime() + MS_PER_DAY);
  return { start, end };
}
