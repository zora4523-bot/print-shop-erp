import { Inbox } from 'lucide-react';
import { requireSession } from '@/lib/auth/session';
import { listWorkerTasks } from '@/lib/production';
import { EmptyState } from '@/components/ui-business';
import { WorkerTaskBatchList } from '@/components/business/production/WorkerTaskBatchList';

export const metadata = { title: '我的任务' };

export default async function WorkerTasksPage() {
  const { user } = await requireSession();
  const tasks = await listWorkerTasks(user.id);

  return (
    <div className="min-w-0 space-y-3">
      <div className="worker-wrap-anywhere">
        <h1 className="text-lg font-semibold">待处理任务</h1>
        <p className="text-xs text-muted-foreground">
          按急单分组后，以工单创建日期从早到晚排列。
        </p>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="暂无待处理任务"
          description="管理员派工后会出现在这里。"
        />
      ) : (
        <WorkerTaskBatchList tasks={tasks} />
      )}
    </div>
  );
}
