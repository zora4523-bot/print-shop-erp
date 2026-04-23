import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { listWorkerTasks } from '@/lib/production';
import { Badge } from '@/components/ui/badge';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { TaskStatus } from '@/generated/prisma/enums';

export const metadata = { title: '我的任务' };

export default async function WorkerTasksPage() {
  const { user } = await requireSession();
  const tasks = await listWorkerTasks(user.id);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold">待处理任务</h1>
        <p className="text-xs text-muted-foreground">
          按急单优先、派工先后顺序排列。点击卡片开始或报工。
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          暂无待处理任务。
        </div>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link
                href={`/worker/tasks/${t.id}`}
                className="block rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {t.order.orderNo}
                      </span>
                      {t.order.isUrgent ? (
                        <Badge variant="destructive">急单</Badge>
                      ) : null}
                      {t.status === TaskStatus.IN_PROGRESS ? (
                        <Badge variant="secondary">进行中</Badge>
                      ) : (
                        <Badge variant="outline">待开始</Badge>
                      )}
                    </div>
                    <div className="text-sm font-medium">
                      #{t.item.sequence} · {t.item.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.craft.name}
                      {t.machineType
                        ? ` · ${MACHINE_TYPE_LABELS[t.machineType] ?? t.machineType}`
                        : ''}
                      {' · '}
                      {t.item.isDoubleSided ? '双面' : '单面'} ·{' '}
                      {t.item.isDoubleColor ? '双色' : '单色'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">计划</div>
                    <div className="font-mono text-base">
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
