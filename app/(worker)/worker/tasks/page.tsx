import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { requireSession } from '@/lib/auth/session';
import { listWorkerTasks } from '@/lib/production';
import { Badge } from '@/components/ui/badge';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { TaskStatus, WorkerType } from '@/generated/prisma/enums';
import { EmptyState } from '@/components/ui-business';

export const metadata = { title: '我的任务' };

export default async function WorkerTasksPage() {
  const { user } = await requireSession();
  const tasks = await listWorkerTasks(user.id);

  return (
    <div className="min-w-0 space-y-3">
      <div className="worker-wrap-anywhere">
        <h1 className="text-lg font-semibold">待处理任务</h1>
        <p className="text-xs text-muted-foreground">
          按急单优先、派工先后顺序排列。点击卡片开始或报工。
        </p>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="暂无待处理任务"
          description="管理员派工后会出现在这里。"
        />
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link
                href={`/worker/tasks/${t.id}`}
                className="block min-h-11 min-w-0 rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="worker-wrap-anywhere min-w-0 font-sans tabular-nums text-sm">
                        {t.order.orderNo}
                      </span>
                      {t.order.isUrgent ? (
                        <Badge
                          variant="destructive"
                          className="bg-destructive text-background dark:bg-destructive dark:text-background"
                        >
                          急单
                        </Badge>
                      ) : null}
                      {t.status === TaskStatus.IN_PROGRESS ? (
                        <Badge variant="secondary">进行中</Badge>
                      ) : (
                        <Badge variant="outline">待开始</Badge>
                      )}
                    </div>
                    <div className="worker-wrap-anywhere text-sm font-medium">
                      #{t.item.sequence} · {t.item.name}
                    </div>
                    {t.order.customName ? (
                      <div className="worker-wrap-anywhere text-xs font-medium text-foreground">
                        {t.order.customName}
                      </div>
                    ) : null}
                    <div className="worker-wrap-anywhere text-xs text-muted-foreground">
                      {t.craft.name}
                      {t.machineType
                        ? ` · ${MACHINE_TYPE_LABELS[t.machineType] ?? t.machineType}`
                        : t.workerType === WorkerType.MACHINE
                          ? ' · 机型未配置'
                          : ' · 时薪任务'}
                      {' · '}
                      {t.item.isDoubleSided ? '双面' : '单面'} ·{' '}
                      {t.item.isDoubleColor ? '双色' : '单色'}
                    </div>
                  </div>
                  <div className="ml-auto shrink-0 text-right">
                    <div className="text-xs text-muted-foreground">计划</div>
                    <div className="font-sans tabular-nums text-base">
                      {t.plannedQty.toLocaleString()}
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
