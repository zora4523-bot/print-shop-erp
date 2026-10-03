import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { UnauthorizedError } from '@/lib/auth/errors';
import { AnalyticsInputError, parseAnalyticsFilters, type AnalyticsParams } from '@/lib/analytics/filters';
import { readAnalyticsReport } from '@/lib/analytics/service';
import { analyticsRead, readAnalyticsFinance, readAnalyticsTrend } from '@/lib/analytics/queries';
import { analyticsCsv } from '@/lib/analytics/export';
import { quantityCell, textCell, type AnalyticsTable } from '@/lib/analytics/types';
export async function handleAnalyticsExport(request: NextAuthRequest): Promise<Response> {
  try {
    const actor = await requireSessionPermission('report:all', request.auth);
    const params: AnalyticsParams = {};
    for (const [key, value] of new URL(request.url).searchParams) params[key] = key in params ? [String(params[key]), value] : value;
    const filters = parseAnalyticsFilters(params);
    const csv = await analyticsRead(actor, async tx => {
    const report = await readAnalyticsReport(tx, filters, true);
    const extra: AnalyticsTable[] = [];
    if (filters.view === 'overview') {
      const [finance, trend] = await Promise.all([readAnalyticsFinance(tx, filters), readAnalyticsTrend(tx, filters)]);
      report.metrics.push({ label: '本期出账', value: finance.issued, format: 'money', hint: '按账单确认日期' }, { label: '本期收款', value: finance.received, format: 'money', hint: '按收款日期' }, { label: '当前待收款', value: finance.outstanding, format: 'money', hint: '全部未收账单，不受日期影响' }, { label: '本期结算', value: finance.settled, format: 'money', hint: '按外部销售工单结算日期' });
      extra.push({ title: '工单趋势', columns: ['日期', '完工工单数', '提交工单数'], rows: trend.map(row => [textCell(row.day), quantityCell(String(row.count)), quantityCell(String(row.submitted))]) });
    }
    return analyticsCsv(report, filters, extra);
    });
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="analytics-${filters.view}-${filters.from}-${filters.to}.csv"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof AnalyticsInputError) return NextResponse.json({ error: error instanceof AnalyticsInputError ? error.message : '请确认登录账户有权查看经营数据。' }, { status: error instanceof UnauthorizedError ? 401 : 400, headers: { 'Cache-Control': 'private, no-store' } });
    throw error;
  }
}
