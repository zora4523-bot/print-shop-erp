import { formatDateInputShanghai } from '../format/dates';

export function shanghaiCalendarDate(now: Date = new Date()): string {
  return formatDateInputShanghai(now);
}

export function yesterdayShanghai(now: Date = new Date()): string {
  return shanghaiCalendarDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

export function previousShanghaiMonth(now: Date = new Date()): string {
  const [yearText, monthText] = shanghaiCalendarDate(now).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}`;
}

export function isStrictYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function isStrictYearMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 12);
}
