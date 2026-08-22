import { CalendarCheck } from 'lucide-react';
import { getPendingSchedulingBoard } from '@/lib/production';
import { EmptyState, PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { PendingSchedulingBoard } from '@/components/business/production/PendingSchedulingBoard';

export const metadata = { title: '待排产工单' };

export default async function SchedulingListPage() {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('order:schedule');
  const board = await getPendingSchedulingBoard();

  return (
    <div className="space-y-6">
      <PageHeader
        title="待排产"
        subtitle="已提交工单按急单、承诺交期和提交时间排列。先选师傅，再跨工单批量分配其兼容工艺；其他工艺继续等待对应师傅。"
      />

      {board.orders.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="没有待排产的工单"
          description="销售 / 客服提交的工单会出现在这里等待排产。"
        />
      ) : (
        <PendingSchedulingBoard
          orders={board.orders}
          workers={board.workers}
        />
      )}
    </div>
  );
}
