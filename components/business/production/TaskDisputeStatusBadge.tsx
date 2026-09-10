import type { ProductionTaskDisputeStatus } from '@/generated/prisma/enums';
import { StatusBadge } from '@/components/ui-business';
import { PRODUCTION_TASK_DISPUTE_STATUS_REGISTRY } from '@/lib/ui/status-registry';

// 报工/计件异议状态徽章。师傅端（TaskDisputePanel）与管理端
// （TaskDisputeAdminPanel）共用，因此独立成文件，避免管理端反向
// import 师傅端的面板文件。label / tone / dot 全部取自 registry。
export function TaskDisputeStatusBadge({
  status,
}: {
  status: ProductionTaskDisputeStatus;
}) {
  const definition = PRODUCTION_TASK_DISPUTE_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}
