import { parseStrictYmd } from '@/lib/auth/schemas';
import { shanghaiDayBoundary, todayShanghai } from '@/lib/dashboard/shanghai-clock';

import { ANALYTICS_VIEWS } from './views';
export { ANALYTICS_VIEWS } from './views';
export type AnalyticsView = keyof typeof ANALYTICS_VIEWS;
export type AnalyticsFilters = {
  view: AnalyticsView; from: string; to: string; sales: string; customer: string;
  craft: string; paper: string; supplier: string; q: string; page: number;
  inventoryKind: 'purchases' | 'receipts' | 'stock';
};
export type AnalyticsParams = Record<string, string | string[] | undefined>;
export const ANALYTICS_PAGE_SIZE = 25;
export const ANALYTICS_RECORD_LIMIT = 30000;
export class AnalyticsInputError extends Error {}

const DAY = 86_400_000;
export function analyticsPeriod(period: string, now = new Date()) {
  const today = todayShanghai(now);
  const [year, month] = today.split('-').map(Number);
  if (period === 'previous') return {
    from: new Date(Date.UTC(year!, month! - 2, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year!, month! - 1, 0)).toISOString().slice(0, 10),
  };
  if (period === 'rolling') return { from: new Date(Date.parse(today) - 29 * DAY).toISOString().slice(0, 10), to: today };
  if (period === 'year') return { from: `${year}-01-01`, to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function parseAnalyticsFilters(params: AnalyticsParams, now = new Date()): AnalyticsFilters {
  function value(key: string, limit = 120) {
    const raw = params[key];
    if (Array.isArray(raw) || (raw?.length ?? 0) > limit) throw new AnalyticsInputError('筛选条件无效，请重新选择。');
    return raw?.trim() ?? '';
  }
  const view = value('view') || 'overview';
  if (!Object.hasOwn(ANALYTICS_VIEWS, view)) throw new AnalyticsInputError('分析视图不存在，请重新选择。');
  const defaults = analyticsPeriod('month', now);
  const from = value('from', 10) || defaults.from;
  const to = value('to', 10) || defaults.to;
  const start = parseStrictYmd(from), end = parseStrictYmd(to);
  if (!start || !end || from < '2000-01-01' || to > '2100-12-31' || from > to || end.getTime() - start.getTime() >= 366 * DAY) {
    throw new AnalyticsInputError('请选择有效日期，结束日期不能早于开始日期，范围最多 366 天。');
  }
  const pageText = value('page', 7) || '1';
  if (!/^[1-9]\d*$/.test(pageText) || Number(pageText) > 200000) throw new AnalyticsInputError('页码无效，请返回第一页。');
  const inventoryKind = value('inventoryKind') || 'purchases';
  if (!['purchases', 'receipts', 'stock'].includes(inventoryKind)) throw new AnalyticsInputError('采购库存视图无效。');
  const filters: AnalyticsFilters = {
    view: view as AnalyticsView, from, to, sales: value('sales', 80), customer: value('customer'),
    craft: value('craft', 80), paper: value('paper'), supplier: value('supplier'), q: value('q'), page: Number(pageText), inventoryKind: inventoryKind as AnalyticsFilters['inventoryKind'],
  };
  // Dimensions only apply where the source actually owns that dimension.
  if (view === 'overview') Object.assign(filters, { customer: '', craft: '', paper: '', supplier: '', q: '' });
  if (view !== 'inventory') filters.supplier = '';
  if (view === 'inventory') Object.assign(filters, { sales: '', customer: '', craft: '', paper: '' });
  return filters;
}

export function analyticsRange(filters: Pick<AnalyticsFilters, 'from' | 'to'>) {
  return { gte: shanghaiDayBoundary(filters.from).start, lt: shanghaiDayBoundary(filters.to).end };
}

export function analyticsUrl(filters: AnalyticsFilters, changes: Partial<AnalyticsFilters> = {}, path = '/owner/analytics') {
  const next = { ...filters, ...changes };
  if (changes.view && changes.view !== filters.view) Object.assign(next, { customer: '', craft: '', paper: '', supplier: '', q: '', page: 1 });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) if (value !== '' && !(key === 'page' && value === 1)) params.set(key, String(value));
  return `${path}?${params}`;
}
