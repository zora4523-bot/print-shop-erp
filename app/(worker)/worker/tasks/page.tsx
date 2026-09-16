import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { PieceworkOperationType } from '@/generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import {
  listProductionOperationsForReporter,
  listProductionProgressForReporter,
} from '@/lib/production/operation-portal';
import { OperationReportingError } from '@/lib/production/operation-reporting';
import { EmptyState, StatusBadge } from '@/components/ui-business';
import { Badge } from '@/components/ui/badge';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { formatDateShanghai } from '@/lib/format/dates';
import { PRODUCTION_OPERATION_STATUS_REGISTRY } from '@/lib/ui/status-registry';

export const metadata = { title: '生产工序' };

const OPERATION_LABELS: Record<PieceworkOperationType, string> = {
  [PieceworkOperationType.PARTIAL]: '局部烫金',
  [PieceworkOperationType.FULL]: '专版烫金',
  [PieceworkOperationType.PACKING]: '打包入袋',
};

export default async function WorkerTasksPage() {
  const { user } = await requireSession();
  const actor = { id: user.id, role: user.role };
  let operations: Awaited<
    ReturnType<typeof listProductionOperationsForReporter>
  > = [];
  try {
    operations = await listProductionOperationsForReporter(actor);
  } catch (error) {
    // CLEANER/other WORKER accounts have no paid lane but still see shared
    // no-pay progress. Inactive or non-worker sessions are rejected again by
    // listProductionProgressForReporter below.
    if (
      !(error instanceof OperationReportingError) ||
      error.code !== 'ACCOUNT_NOT_AUTHORIZED'
    ) {
      throw error;
    }
  }
  const progressSteps = await listProductionProgressForReporter(actor);

  return (
    <div className="min-w-0 space-y-3">
      <header className="worker-wrap-anywhere">
        <h1 className="text-lg font-semibold">生产工序</h1>
        <p className="text-xs text-muted-foreground">
          计件工序按账号固定岗位展示；其他内制步骤全员可见、不计薪。
        </p>
      </header>

      {operations.length === 0 && progressSteps.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="暂无待处理工序"
          description="价格确认并生成工序后会自动出现在这里。"
        />
      ) : (
        <ul className="space-y-3">
          {operations.map((operation) => {
            const statusDefinition =
              PRODUCTION_OPERATION_STATUS_REGISTRY[operation.status];
            return (
              <li key={operation.id}>
                <Link
                  href={`/worker/tasks/${operation.id}`}
                  className="block min-h-11 min-w-0 rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-sans text-sm tabular-nums">
                      {operation.orderNo}
                    </span>
                    {operation.isUrgent ? <UrgentBadge /> : null}
                    <StatusBadge
                      tone={statusDefinition.tone}
                      dot={statusDefinition.dot}
                    >
                      {statusDefinition.label}
                    </StatusBadge>
                  </div>
                  <h2 className="worker-wrap-anywhere mt-2 font-semibold">
                    {OPERATION_LABELS[operation.operationType]}
                  </h2>
                  {operation.customName ? (
                    <p className="worker-wrap-anywhere mt-1 text-sm">
                      {operation.customName}
                    </p>
                  ) : null}
                  <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                    已完成 {operation.completedQty} /{' '}
                    {operation.plannedCompletedQty}
                    {operation.operationType === PieceworkOperationType.PARTIAL
                      ? ` · 每个计薪 ${operation.payrollPassCount} 次`
                      : ''}
                    {operation.promisedDate
                      ? ` · 交期 ${formatDateShanghai(operation.promisedDate)}`
                      : ''}
                  </p>
                </Link>
              </li>
            );
          })}
          {progressSteps.map((step) => {
            const statusDefinition =
              PRODUCTION_OPERATION_STATUS_REGISTRY[step.status];
            return (
              <li key={step.id}>
                <Link
                  href={`/worker/tasks/${step.id}`}
                  className="block min-h-11 min-w-0 rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-sans text-sm tabular-nums">
                      {step.orderNo}
                    </span>
                    {step.isUrgent ? <UrgentBadge /> : null}
                    <StatusBadge
                      tone={statusDefinition.tone}
                      dot={statusDefinition.dot}
                    >
                      {statusDefinition.label}
                    </StatusBadge>
                    <Badge variant="outline">进度·不计薪</Badge>
                  </div>
                  <h2 className="worker-wrap-anywhere mt-2 font-semibold">
                    {step.craftName}
                  </h2>
                  <p className="worker-wrap-anywhere mt-1 text-sm">
                    #{step.orderItemSequence} · {step.orderItemName}
                  </p>
                  <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                    已完成 {step.completedQty} / {step.plannedQty}
                    {step.promisedDate
                      ? ` · 交期 ${formatDateShanghai(step.promisedDate)}`
                      : ''}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
