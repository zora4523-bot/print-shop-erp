import Link from 'next/link';
import type { WorkerSalaryActor } from '@/lib/worker-portal';
import { listWorkerPendingReports } from '@/lib/salary/worker-pending-reports';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';

const operations = { PARTIAL: '局部烫金', FULL: '专版烫金', PACKING: '包装' };
const entries = { REPORT: '报工', REVERSAL: '冲正', ADJUSTMENT: '人工调整' };
export async function WorkerPendingReports({ actor, from, to, page }: {
  actor: WorkerSalaryActor; from?: string; to?: string; page?: string | string[];
}) {
  const result = await listWorkerPendingReports(actor, { from, to, page });
  return <section aria-labelledby="pending-reports-heading" className="min-w-0 space-y-3">
    <h2 id="pending-reports-heading" className="font-semibold">未结算报工（{result.total}）</h2>
    {result.total === 0 ? <p className="text-sm text-muted-foreground">所选日期没有未结算报工。</p> : <>
      <ul className="space-y-3">{result.rows.map((row) => <li key={row.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-4 text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="worker-wrap-anywhere min-w-0 font-medium">{row.operation.order.orderNo} · {operations[row.operation.operationType]}</p>
          <Badge variant="outline">{row.operation.payrollReviewRequired ? '待核定' : ['PENDING', 'IN_PROGRESS'].includes(row.operation.status) ? '工序未完成' : '待结算'}</Badge>
        </div>
        <p>{entries[row.entryType]} · {formatDateTimeShanghai(row.reportedAt)}</p>
        {row.entryType !== 'ADJUSTMENT' && <p>合格数量：{row.quantity}</p>}
        <p className="worker-wrap-anywhere">{row.entryType === 'ADJUSTMENT' ? '调整金额' : '暂计提成'}：{formatMoney(row.amount)}</p>
        <Link href={`/worker/reports/${row.id}`} className="inline-flex min-h-11 items-center underline">查看明细与反馈</Link>
      </li>)}</ul>
      <AdminPagination basePath="/worker/salary" {...result} pageParam="pendingPage" queryParams={{ from, to }} />
    </>}
  </section>;
}
