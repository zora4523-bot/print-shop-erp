import type { OrderStatus } from '@/generated/prisma/enums';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { canAttachOutsource } from './status-machine';

export function outsourceUnavailableReason(order: {
  status: OrderStatus;
  completedAt?: Date | string | null;
}): string | null {
  if (!canAttachOutsource(order.status)) {
    return `当前工单${ORDER_STATUS_REGISTRY[order.status].label}，不能新建外协单`;
  }
  if (order.completedAt) {
    return '当前工单已完成生产，不能新建外协单；请通过工单变更生成新版本';
  }
  return null;
}
