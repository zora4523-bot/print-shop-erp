import { WorkerProductionJobs } from '@/components/business/production/WorkerProductionJobs';
import { firstSearchParam } from '@/lib/admin/table';
import { WorkerTaskFilters } from '@/components/business/production/WorkerTaskFilters';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { listWorkerTaskPage } from '@/lib/production/worker-task-page';
import Link from 'next/link';
import { Suspense } from 'react';
import { Inbox } from 'lucide-react';
import { PieceworkOperationType } from '@/generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { EmptyState, PageHeader, SectionLoading, StatusBadge } from '@/components/ui-business';
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

export default async function WorkerTasksPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; view?: string; page?: string; productionPage?: string }> }) {
  const sp = await searchParams;
  const query = firstSearchParam(sp.q).trim().slice(0, 100);
  const view = sp.view === 'progress' ? 'progress' : 'paid';
  const { user } = await requireSession();
  const actor = { id: user.id, role: user.role };
  // 两块取数互不依赖：各自一个 Suspense 分区并行加载，key 随筛选变化以重新显示加载态。

  return (
    <div className="min-w-0 space-y-3">
      <PageHeader size="worker" title="生产工序" className="worker-wrap-anywhere" />

      <Suspense key={`jobs|${query}|${sp.productionPage ?? ''}`} fallback={<SectionLoading label="已安排的生产" />}>
        <WorkerProductionJobs actor={actor} query={query} page={sp.productionPage} />
      </Suspense>
      <h2 className="font-semibold">其他可报工工序</h2>
      <WorkerTaskFilters query={query} view={view} />
      <Suspense key={`ops|${view}|${query}|${sp.page ?? ''}`} fallback={<SectionLoading label="工序" />}>
        <OtherOperations actor={actor} view={view} query={query} page={sp.page} />
      </Suspense>
    </div>
  );
}

async function OtherOperations({ actor, view, query, page: pageParam }: { actor: Parameters<typeof listWorkerTaskPage>[0]; view: 'paid' | 'progress'; query: string; page?: string }) {
  const page = await listWorkerTaskPage(actor, { view, q: query, page: pageParam });
  const { operations, progressSteps } = page;

  return (
    <>
      {operations.length === 0 && progressSteps.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="暂无其他待处理工序"
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
                  {operation.sourceLabels?.map((label, index) => <p key={index} className="worker-wrap-anywhere mt-2 text-base font-medium">{label}</p>)}
                  {operation.customName ? (
                    <p className="worker-wrap-anywhere mt-1 text-sm">
                      {operation.customName}
                    </p>
                  ) : null}
                  <p className="worker-wrap-anywhere mt-1 text-sm text-muted-foreground">
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
                  <p className="worker-wrap-anywhere mt-1 text-sm text-muted-foreground">
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
      {page.pageCount > 1 && <AdminPagination basePath="/worker/tasks" {...page} queryParams={{ q: query, view }} />}
    </>
  );
}
