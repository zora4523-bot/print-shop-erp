import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { StatusBadge } from '@/components/ui-business';

// 管理端工作台列表的工单状态徽章。label 与 tone 全部取自
// ORDER_STATUS_REGISTRY——同一状态在管理端只有一个名字（工作台列表、
// 工单详情、筛选器一致）。这里只覆盖尺寸（列表密度更紧凑），
// 不渲染 dot：密集列表每行再加一个圆点是多余的视觉噪声。
export function AdminWorkspaceStatusBadge({
  status,
}: {
  status: AdminOrderWorkspaceRow['status'];
}) {
  const definition = ORDER_STATUS_REGISTRY[status];
  return (
    <StatusBadge
      tone={definition.tone}
      className="h-auto rounded-full px-2.5 py-0.5 text-xs font-semibold"
    >
      {definition.label}
    </StatusBadge>
  );
}
