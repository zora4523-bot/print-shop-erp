export type AnalyticsCell = { value: string | null; format?: 'money' | 'quantity' | 'price'; href?: string };
export type AnalyticsTable = { title: string; columns: string[]; rows: AnalyticsCell[][]; note?: string };
export type AnalyticsMetric = AnalyticsCell & { label: string; hint?: string };
export type AnalyticsGroup = { name: string; value: string; count: number; href?: string };
export type AnalyticsReport = {
  metrics: AnalyticsMetric[]; tables: AnalyticsTable[]; details: AnalyticsTable;
  total: number; page: number; pages: number; notes: string[];
};
export const textCell = (value: string | null, href?: string): AnalyticsCell => ({ value, ...(href ? { href } : {}) });
export const moneyCell = (value: string | null): AnalyticsCell => ({ value, format: 'money' });
export const quantityCell = (value: string): AnalyticsCell => ({ value, format: 'quantity' });
