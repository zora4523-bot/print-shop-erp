import { parseStrictYmd } from '../auth/schemas';

// Shanghai-calendar helpers for the owner dashboard. Same pattern as
// `lib/salary/daily.ts:shanghaiDayRange` — `Asia/Shanghai` is UTC+8 with
// no DST so a calendar day is a fixed [-08h, +16h) window around UTC
// midnight.
//
// Why duplicate instead of importing from lib/salary/daily? Two reasons:
//   1. lib/salary/daily.ts pulls Prisma + decimal.js. Dashboard helpers
//      should stay free of that so they're cheap to import in pages /
//      tests / future client-side helpers.
//   2. The 3 callsites that hand-roll `todayShanghai()` (summary.ts,
//      daily/page.tsx, hourly/page.tsx) aren't being refactored here
//      (Slice A scope). Once those are moved over we'll delete the
//      private copies — but not in this slice.

const SHANGHAI_OFFSET_HOURS = 8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const YMD_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Returns the YYYY-MM-DD calendar date at `now` in Asia/Shanghai.
 * Defaults to the current wall-clock — pass an explicit `now` for tests
 * that need a deterministic boundary.
 */
export function todayShanghai(now: Date = new Date()): string {
  return YMD_FMT.format(now);
}

/**
 * Returns the YYYY-MM string for the Shanghai calendar month at `now`.
 */
export function currentShanghaiMonth(now: Date = new Date()): string {
  return todayShanghai(now).slice(0, 7);
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
