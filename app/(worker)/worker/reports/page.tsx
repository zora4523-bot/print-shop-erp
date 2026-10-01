import { firstSearchParam } from '@/lib/admin/table';
import Link from 'next/link';
import Form from 'next/form';
import { requirePermission } from '@/lib/auth/permissions';
import { listWorkerReports } from '@/lib/production/worker-report-portal';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { REPORT_OPERATION_LABELS } from '@/lib/salary/report-display';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, PageHeader, FilterClearLink } from '@/components/ui-business';

export const metadata = { title: '我的报工' };
const ENTRY_LABELS: Record<string, string> = { ADJUSTMENT: '人工调整', REVERSAL: '报工冲正' };
export default async function WorkerReportsPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string | string[]; operationId?: string | string[] }> }) {
  const actor = await requirePermission('salary:view:self');
  const raw = await searchParams;
  const sp = { ...raw, q: firstSearchParam(raw.q), operationId: firstSearchParam(raw.operationId) || undefined };
  const result = await listWorkerReports(actor, sp);
  return <div className="space-y-4"><PageHeader size="worker" title="我的报工" />
    {/* next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。 */}
    <Form id="worker-report-filters" key={JSON.stringify([sp.q ?? '', sp.operationId ?? ''])} action="/worker/reports" className="flex flex-wrap gap-2 rounded-xl border bg-card p-3"><label className="min-w-0 flex-1"><span className="sr-only">工单号或名称</span><Input className="w-full" name="q" defaultValue={sp.q} placeholder="工单号或名称" /></label><Button type="submit">搜索</Button><FilterClearLink formId="worker-report-filters" href="/worker/reports" className="inline-flex min-h-11 items-center underline">清除筛选</FilterClearLink>{sp.operationId && <input type="hidden" name="operationId" value={sp.operationId} />}</Form>
    {!result.rows.length ? <EmptyState title="暂无报工记录" /> : <ul className="space-y-3">{result.rows.map((row) => <li key={row.id}><Link href={`/worker/reports/${row.id}`} className="block space-y-2 rounded-xl border bg-card p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{row.operation.order.orderNo}</strong><strong className="tabular-nums">{formatMoney(row.amount)}</strong></div><p>{REPORT_OPERATION_LABELS[row.operation.operationType]} · {ENTRY_LABELS[row.entryType] ?? `合格 ${row.reportedCompletedQty}`}</p><p className="text-sm text-muted-foreground">{formatDateTimeShanghai(row.reportedAt)}{row.operation.payrollReviewRequired ? ' · 待核定' : ''}</p><p className="text-sm underline">查看明细与反馈</p></Link></li>)}</ul>}
    {result.pageCount > 1 && <AdminPagination basePath="/worker/reports" {...result} queryParams={{ q: sp.q, operationId: sp.operationId }} />}
  </div>;
}
