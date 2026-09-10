import type {
  OrderChangeRequestStatus,
  OrderChangeRequestType,
} from '@/generated/prisma/enums';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui-business';
import {
  ORDER_CHANGE_REQUEST_STATUS_REGISTRY,
  ORDER_CHANGE_REQUEST_TYPE_REGISTRY,
} from '@/lib/ui/status-registry';

// 工单修改 / 取消申请的两颗徽章。原先在 app/(admin)/orders/[id]/page.tsx 与
// app/(admin)/owner/order-changes/page.tsx 各写了一份（状态徽章逐字重复，
// 后者还多一张写死的中文类型映射）。
// - 状态（待审核 / 已批准 / 已拒绝…）是进度，走 StatusBadge + 状态 registry；
// - 类型（修改申请 / 取消申请）是分类不是状态，按 UI 规范 §6 留在 shadcn
//   Badge 上，只把文案收进 registry，避免与同排的状态徽章视觉同权。

export function ChangeRequestStatusBadge({
  status,
}: {
  status: OrderChangeRequestStatus;
}) {
  const definition = ORDER_CHANGE_REQUEST_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}

export function ChangeRequestTypeBadge({
  type,
}: {
  type: OrderChangeRequestType;
}) {
  return (
    <Badge variant="outline">
      {ORDER_CHANGE_REQUEST_TYPE_REGISTRY[type].label}
    </Badge>
  );
}
