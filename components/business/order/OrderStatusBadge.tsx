import { OrderStatus } from '../../../generated/prisma/enums';
import { StatusBadge } from '@/components/ui-business';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';

// 工单状态徽章——委托给 ui-business 的 StatusBadge + ORDER_STATUS_REGISTRY
// 集中映射，让&ldquo;状态色 / dot / 文案&rdquo;在跨页面（OrdersTable / 详情头 /
// dashboard 列表 / production-flow E2E）保持一致。
//
// 旧版本（直接调 shadcn Badge variant=default/secondary/outline）所有
// "运行中" 状态都用同一种 default 色——无法区分 SUBMITTED/SCHEDULING/
// IN_PRODUCTION/COMPLETED/SHIPPED。新版按状态语义着色，看一眼就知道。

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_REGISTRY[status].label;
}

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const cfg = ORDER_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={cfg.tone} dot={cfg.dot} className={className}>
      {cfg.label}
    </StatusBadge>
  );
}
