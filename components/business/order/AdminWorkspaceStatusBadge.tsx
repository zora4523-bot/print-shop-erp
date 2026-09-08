import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { StatusBadge } from '@/components/ui-business';

export function AdminWorkspaceStatusBadge({
  status,
}: {
  status: AdminOrderWorkspaceRow['status'];
}) {
  return <StatusBadge
    tone={ORDER_STATUS_REGISTRY[status].tone}
    className="h-auto rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
  >{STATUS_LABELS[status]}</StatusBadge>;
}

const STATUS_LABELS: Record<AdminOrderWorkspaceRow['status'], string> = {
  DRAFT: '草稿',
  PENDING_FACTORY: '待处理',
  REJECTED: '已驳回',
  CONFIRMED: '待下发生产',
  ON_HOLD: '已暂停',
  RELEASED: '已下发',
  FOILING: '烫金中',
  PACKING: '打包中',
  SHIPPED: '已发货',
  SETTLED: '已结算',
  CANCELLED: '已取消',
  SUBMITTED: '待处理',
  SCHEDULING: '排产中（历史）',
  IN_PRODUCTION: '生产中（历史）',
  COMPLETED: '已完工（历史）',
  FINISHED: '已完成（历史）',
};
