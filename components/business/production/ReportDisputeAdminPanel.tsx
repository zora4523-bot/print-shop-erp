import type { listOrderReportDisputes } from '@/lib/production/report-dispute';
import { ReportDisputeReviewForm } from './ReportDisputeForms';
import { TaskDisputeStatusBadge } from './TaskDisputeStatusBadge';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { formatMoney } from '@/lib/dashboard/format';
import { REPORT_OPERATION_LABELS } from '@/lib/salary/report-display';

export function ReportDisputeAdminPanel({ disputes }: { disputes: Awaited<ReturnType<typeof listOrderReportDisputes>> }) {
  return <section aria-label="报工与工资问题" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
    <h2 className="font-semibold">报工与工资问题</h2>
    {!disputes.length ? <p className="text-sm text-muted-foreground">暂无报工问题</p> : disputes.map((row) => <article id={`report-dispute-${row.id}`} key={row.id} className="space-y-3 rounded-lg border p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2"><TaskDisputeStatusBadge status={row.status} /><strong>{row.report.reporter.displayName} · {REPORT_OPERATION_LABELS[row.report.operation.operationType]}</strong></div>
      <p>报工时间 {formatDateTimeShanghai(row.report.reportedAt)} · {formatMoney(row.report.amount)}</p>
      <p className="break-words whitespace-pre-wrap">{row.reason}</p>
      {row.status === 'PENDING' ? <ReportDisputeReviewForm disputeId={row.id} /> : <div className="space-y-2 rounded-lg bg-muted/40 p-3"><p className="break-words whitespace-pre-wrap">{row.resolution}</p><p>{row.resolvedBy?.displayName} · {formatDateTimeShanghai(row.resolvedAt)}</p></div>}
    </article>)}
  </section>;
}
