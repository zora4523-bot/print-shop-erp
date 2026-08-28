import { OrderPricingStatus, OrderStatus } from '../../generated/prisma/enums';
import type { SalesOrderListRow } from './sales-list-query';

export type SalesOrderStatusPresentation = {
  label: string;
  tone: 'muted' | 'outline' | 'production' | 'shipped' | 'attention';
};

const STATUS_PRESENTATION: Record<
  OrderStatus,
  SalesOrderStatusPresentation
> = {
  [OrderStatus.DRAFT]: { label: '草稿', tone: 'muted' },
  [OrderStatus.PENDING_FACTORY]: { label: '待工厂确认', tone: 'outline' },
  [OrderStatus.SUBMITTED]: { label: '待工厂确认', tone: 'outline' },
  [OrderStatus.SCHEDULING]: { label: '生产中', tone: 'production' },
  [OrderStatus.IN_PRODUCTION]: { label: '生产中', tone: 'production' },
  [OrderStatus.COMPLETED]: { label: '生产中', tone: 'production' },
  [OrderStatus.SHIPPED]: { label: '已发货', tone: 'shipped' },
  [OrderStatus.FINISHED]: { label: '已完成', tone: 'muted' },
  [OrderStatus.CANCELLED]: { label: '已取消', tone: 'muted' },
};

export function salesOrderStatusPresentation(
  status: OrderStatus,
): SalesOrderStatusPresentation {
  return STATUS_PRESENTATION[status];
}

export type SalesOrderAmountPresentation = {
  label: string;
  estimated: boolean;
  pending: boolean;
};

export function salesOrderAmountPresentation(
  order: Pick<
    SalesOrderListRow,
    'status' | 'pricingStatus' | 'totalAmount' | 'feeLines'
  >,
): SalesOrderAmountPresentation {
  if (order.status === OrderStatus.DRAFT) {
    return { label: '—', estimated: false, pending: false };
  }
  if (
    order.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION
  ) {
    return {
      label: '待管理员确认价格',
      estimated: false,
      pending: true,
    };
  }
  return {
    label: `¥${formatMoney(order.totalAmount)}`,
    estimated: order.feeLines.some((line) => line.estimated),
    pending: false,
  };
}

export function salesOrderPrimaryAction(
  order: Pick<SalesOrderListRow, 'status' | 'needsAction'>,
): string {
  if (order.status === OrderStatus.DRAFT) return '查看草稿';
  if (order.needsAction) return '查看原因';
  return '查看详情';
}

export function formatSalesOrderUpdatedAt(
  updatedAt: string,
  nowIso: string,
): string {
  const updated = Date.parse(updatedAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(updated) || !Number.isFinite(now)) return '更新时间未知';
  const seconds = Math.max(0, Math.floor((now - updated) / 1000));
  if (seconds < 60) return '刚刚更新';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} 天前更新`;
  return `${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(updated))} 更新`;
}

export function formatMoney(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return number.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
