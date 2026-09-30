import { OrderStatus } from '../../generated/prisma/enums';
import type { SalesOrderListRow } from './sales-list-query';
import {
  orderAmountPresentation,
  type OrderAmountPresentation,
} from './amount-presentation';
import type { StatusDefinition, StatusRegistry } from '../ui/status-registry';

/**
 * 销售进度沿用共享状态色：排产及加工显示生产中；包装和已报完工显示
 * 待打包发货。后者仍用 info，表示配送流程尚未结束。
 * 词表独立于管理员历史状态标签，不能直接合并到 ORDER_STATUS_REGISTRY。
 */
const SALES_ORDER_STATUS_REGISTRY: StatusRegistry<OrderStatus> = {
  [OrderStatus.DRAFT]: { label: '草稿', tone: 'neutral' },
  [OrderStatus.PENDING_FACTORY]: { label: '待工厂处理', tone: 'info' },
  [OrderStatus.REJECTED]: { label: '已驳回', tone: 'danger' },
  [OrderStatus.CONFIRMED]: { label: '待下发生产', tone: 'success' },
  [OrderStatus.ON_HOLD]: { label: '已暂停', tone: 'warning', dot: true },
  [OrderStatus.RELEASED]: { label: '生产中', tone: 'info', dot: true },
  [OrderStatus.FOILING]: { label: '生产中', tone: 'info', dot: true },
  [OrderStatus.PACKING]: { label: '待打包发货', tone: 'info', dot: true },
  [OrderStatus.SETTLED]: { label: '已结算', tone: 'success' },
  [OrderStatus.SUBMITTED]: { label: '待工厂处理', tone: 'info' },
  [OrderStatus.SCHEDULING]: { label: '生产中', tone: 'info', dot: true },
  [OrderStatus.IN_PRODUCTION]: { label: '生产中', tone: 'info', dot: true },
  [OrderStatus.COMPLETED]: { label: '待打包发货', tone: 'info', dot: true },
  [OrderStatus.SHIPPED]: { label: '已发货', tone: 'success' },
  [OrderStatus.FINISHED]: { label: '已完成', tone: 'neutral' },
  [OrderStatus.CANCELLED]: { label: '已取消', tone: 'danger' },
};

export type SalesOrderStatusPresentation = StatusDefinition;

type SalesOrderProgressPresentation =
  | { currentStep: 0 | 1 | 2 | 3 | 4; message?: never }
  | { currentStep: null; message: string };

// Enumerate both lifecycles: adding a status must never silently imply completion.
// A paused order does not identify its previous stage, so do not infer one.
const SALES_ORDER_PROGRESS: Record<OrderStatus, SalesOrderProgressPresentation> = {
  [OrderStatus.DRAFT]: { currentStep: null, message: '草稿尚未提交' },
  [OrderStatus.PENDING_FACTORY]: { currentStep: 0 },
  [OrderStatus.SUBMITTED]: { currentStep: 0 },
  [OrderStatus.CONFIRMED]: { currentStep: 1 },
  [OrderStatus.SCHEDULING]: { currentStep: 1 },
  [OrderStatus.RELEASED]: { currentStep: 2 },
  [OrderStatus.FOILING]: { currentStep: 2 },
  [OrderStatus.PACKING]: { currentStep: 2 },
  [OrderStatus.IN_PRODUCTION]: { currentStep: 2 },
  [OrderStatus.COMPLETED]: { currentStep: 2 },
  [OrderStatus.SHIPPED]: { currentStep: 3 },
  [OrderStatus.SETTLED]: { currentStep: 4 },
  [OrderStatus.FINISHED]: { currentStep: 4 },
  [OrderStatus.REJECTED]: { currentStep: null, message: '工单已驳回，待修改后重新提交' },
  [OrderStatus.ON_HOLD]: { currentStep: null, message: '工单已暂停' },
  [OrderStatus.CANCELLED]: { currentStep: null, message: '工单已取消' },
};

export function salesOrderProgressPresentation(status: OrderStatus): SalesOrderProgressPresentation {
  return SALES_ORDER_PROGRESS[status] ?? { currentStep: null, message: '工单进度暂不可用' };
}

export function salesOrderStatusPresentation(
  status: OrderStatus,
): SalesOrderStatusPresentation {
  return SALES_ORDER_STATUS_REGISTRY[status];
}

export type SalesOrderAmountPresentation = OrderAmountPresentation;

export function salesOrderAmountPresentation(
  order: Pick<
    SalesOrderListRow,
    'status' | 'pricingStatus' | 'totalAmount' | 'feeLines'
  >,
): SalesOrderAmountPresentation {
  if (order.status === OrderStatus.DRAFT) {
    return { label: '—', estimated: false, pending: false };
  }
  return orderAmountPresentation({
    status: order.status,
    pricingStatus: order.pricingStatus,
    amount: order.totalAmount,
    estimated: order.feeLines.some((line) => line.estimated),
  });
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
