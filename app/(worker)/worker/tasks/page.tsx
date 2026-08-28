import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { PieceworkOperationType } from '@/generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { listProductionOperationsForReporter } from '@/lib/production/operation-portal';
import { EmptyState, StatusBadge } from '@/components/ui-business';
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
  const operations = await listProductionOperationsForReporter({
    id: user.id,
    role: user.role,
  });

  return (
    <div className="min-w-0 space-y-3">
      <header className="worker-wrap-anywhere">
        <h1 className="text-lg font-semibold">生产工序</h1>
        <p className="text-xs text-muted-foreground">
          按账号固定工序展示；无需领取或等待管理员派工。
        </p>
      </header>

      {operations.length === 0 ? (
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
                    {operation.passCount > 1
                      ? ` · 每个 ${operation.passCount} 次烫印`
                      : ''}
                    {operation.promisedDate
                      ? ` · 交期 ${formatDateShanghai(operation.promisedDate)}`
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
