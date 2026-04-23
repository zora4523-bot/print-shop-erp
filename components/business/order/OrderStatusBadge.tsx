import { OrderStatus } from '../../../generated/prisma/enums';
import { Badge } from '@/components/ui/badge';

const STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.DRAFT]: '草稿',
  [OrderStatus.SUBMITTED]: '已提交',
  [OrderStatus.SCHEDULING]: '排产中',
  [OrderStatus.IN_PRODUCTION]: '生产中',
  [OrderStatus.COMPLETED]: '已完工',
  [OrderStatus.SHIPPED]: '已发货',
  [OrderStatus.FINISHED]: '已完成',
  [OrderStatus.CANCELLED]: '已取消',
};

const STATUS_VARIANT: Record<OrderStatus, 'default' | 'secondary' | 'outline'> = {
  [OrderStatus.DRAFT]: 'outline',
  [OrderStatus.SUBMITTED]: 'default',
  [OrderStatus.SCHEDULING]: 'default',
  [OrderStatus.IN_PRODUCTION]: 'default',
  [OrderStatus.COMPLETED]: 'default',
  [OrderStatus.SHIPPED]: 'default',
  [OrderStatus.FINISHED]: 'secondary',
  [OrderStatus.CANCELLED]: 'secondary',
};

export function orderStatusLabel(status: OrderStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{orderStatusLabel(status)}</Badge>;
}
