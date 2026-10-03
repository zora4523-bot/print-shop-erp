import Decimal from 'decimal.js';
import { csvDecimal, csvDocument, type CsvCell } from '@/lib/export/csv';
import { ANALYTICS_VIEWS, type AnalyticsFilters } from './filters';
import type { AnalyticsCell, AnalyticsReport, AnalyticsTable } from './types';

const cell = (value: AnalyticsCell): CsvCell => value.value === null ? (value.format ? '待核对' : '未填写') : value.format === 'money' ? csvDecimal(value.value) : value.format === 'price' ? new Decimal(value.value).toFixed(4) : value.value;
export function analyticsCsv(report: AnalyticsReport, filters: AnalyticsFilters, extra: AnalyticsTable[] = []) {
  const rows: CsvCell[][] = [[ANALYTICS_VIEWS[filters.view]], ['开始日期', filters.from, '结束日期', filters.to, '时区', 'Asia/Shanghai'], ['销售', filters.sales, '客户', filters.customer, '工艺', filters.craft, '纸张', filters.paper, '供应商', filters.supplier, '关键词', filters.q]];
  rows.push([], ['指标', '数值', '口径'], ...report.metrics.map(metric => [metric.label, cell(metric), metric.hint ?? '']));
  for (const note of report.notes) rows.push(['说明', note]);
  for (const table of [...report.tables, report.details, ...extra]) {
    rows.push([], [table.title]);
    if (table.note) rows.push(['说明', table.note]);
    rows.push(table.columns, ...table.rows.map(row => row.map(cell)));
  }
  return csvDocument(rows);
}
