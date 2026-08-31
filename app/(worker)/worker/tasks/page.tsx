import { Inbox } from 'lucide-react';
import { requireSession } from '@/lib/auth/session';
import { listClaimableTasks, listWorkerTasks } from '@/lib/production';
import { EmptyState } from '@/components/ui-business';
import { WorkerTaskBatchList } from '@/components/business/production/WorkerTaskBatchList';
import { ClaimTaskButton } from '@/components/business/production/ClaimTaskButton';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import {
  machineTypeLabel,
  workerTypeLabel,
} from '@/lib/auth/role-labels';
import { formatDateShanghai } from '@/lib/format/dates';

export const metadata = { title: '我的任务' };

export default async function WorkerTasksPage() {
  const { user } = await requireSession();
  const [tasks, claimableTasks] = await Promise.all([
    listWorkerTasks(user.id),
    listClaimableTasks({ id: user.id, role: user.role }),
  ]);

  return (
    <div className="min-w-0 space-y-3">
      <div className="worker-wrap-anywhere">
        <h1 className="text-lg font-semibold">我的任务</h1>
        <p className="text-xs text-muted-foreground">
          进行中优先，其次待开始；急单和较早工单靠前。
        </p>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="暂无待处理任务"
          description={
            claimableTasks.length > 0
              ? '可以先从下方抢单池选择一个适合的任务。'
              : '管理员派工后会出现在这里。'
          }
        />
      ) : (
        <WorkerTaskBatchList
          tasks={tasks}
          workerName={user.displayName}
        />
      )}

      {claimableTasks.length > 0 ? (
        <section aria-labelledby="claim-pool-heading" className="space-y-3 pt-2">
          <div className="worker-wrap-anywhere">
            <h2 id="claim-pool-heading" className="text-base font-semibold">
              可抢任务
            </h2>
            <p className="text-xs text-muted-foreground">
              只显示符合岗位、机型和工艺能力的任务；抢单后请在“我的任务”开始生产。
            </p>
          </div>
          <ul className="space-y-3">
            {claimableTasks.map((task) => (
              <li
                key={task.id}
                className="worker-wrap-anywhere space-y-3 rounded-xl border bg-card p-4 shadow-sm"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-sans text-sm tabular-nums">
                    {task.order.orderNo}
                  </span>
                  {task.order.isUrgent ? <UrgentBadge /> : null}
                </div>
                <div>
                  <h3 className="font-semibold">
                    #{task.item.sequence} · {task.item.name}
                  </h3>
                  {task.order.customName ? (
                    <p className="text-sm font-medium">{task.order.customName}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    工艺：{task.craft.name} · 计划 {task.plannedQty} 个 · 接单人：
                    {task.order.submitterName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {task.workerType === 'MACHINE'
                      ? `机型：${task.claimMachineTypes
                          .map((machine) => machineTypeLabel(machine))
                          .join('、')}`
                      : `岗位：${workerTypeLabel(task.workerType)}`}
                    {' · '}交期：
                    {formatDateShanghai(task.order.promisedDate, '未设置')}
                  </p>
                </div>
                <ClaimTaskButton taskId={task.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
