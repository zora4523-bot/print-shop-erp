import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { getWorkerReport } from '@/lib/production/worker-report-portal';
import { REPORT_OPERATION_LABELS, reportWageLines } from '@/lib/salary/report-display';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { ReportDisputeForm } from '@/components/business/production/ReportDisputeForms';
import { TaskDisputeStatusBadge } from '@/components/business/production/TaskDisputeStatusBadge';

export const metadata = { title: '我的报工明细' };
export default async function WorkerReportPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('salary:view:self');
  const report = await getWorkerReport((await params).id, actor);
  if (!report) notFound();
  const lines = reportWageLines({ ...report, operationType: report.operation.operationType, amount: report.amount.toString(), chargeableQty: report.chargeableQty.toString(), rate: report.rate.toString() });
  return <div className="space-y-5">
    <header className="space-y-2"><Link href="/worker/reports" className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>返回我的报工</Link><h1 className="text-xl font-semibold">我的报工明细</h1><p>{report.operation.order.orderNo} · {REPORT_OPERATION_LABELS[report.operation.operationType]}</p><p className="text-sm text-muted-foreground">{formatDateTimeShanghai(report.reportedAt)}</p></header>
    <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">本次提成</h2><p className="text-2xl font-semibold tabular-nums">{formatMoney(report.amount)}</p>
      {report.operation.payrollReviewRequired && <p className="text-sm text-warning-foreground">待管理员核定</p>}
      {lines.map((line, index) => <p key={index} className="text-sm">{line}</p>)}
      <p className="text-sm">合格 {report.reportedCompletedQty.toString()} · 缺陷 {report.defectQty.toString()} · 返工 {report.reworkQty.toString()}</p>
      {report.settlementItem && <Link className="inline-flex min-h-11 items-center underline" href={`/worker/salary/${report.settlementItem.settlement.id}`}>查看所属工资单</Link>}
    </section>
    <section className="space-y-4 rounded-xl border bg-card p-4"><h2 className="font-semibold">报工与工资问题</h2>
      {report.disputes.some((row) => row.status === 'PENDING') ? <p role="status">问题待处理，请等待管理员回复。</p> : <ReportDisputeForm reportId={report.id} />}
      {report.disputes.map((row) => <article key={row.id} className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm"><TaskDisputeStatusBadge status={row.status} /><p className="break-words whitespace-pre-wrap">{row.reason}</p><p>{formatDateTimeShanghai(row.createdAt)}</p>{row.resolution && <div className="space-y-1 border-t pt-2"><p className="font-medium">管理员回复</p><p className="break-words whitespace-pre-wrap">{row.resolution}</p><p>{row.resolvedBy?.displayName} · {formatDateTimeShanghai(row.resolvedAt)}</p></div>}</article>)}
    </section>
  </div>;
}
