import { OrderStatus } from '../../generated/prisma/enums';

/** 生产中的工单：可创建打印任务，并计入待打印队列。 */
export const ORDER_PRINTABLE_STATUSES = [
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
] as const;

// 暂停期间批准改单会为当前版本生成补打请求，确认已打印同样放行。
// 已取消、已发货、已结算等不在生产中的工单不再有打印待办。
const PRINT_CONFIRMABLE_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  ...ORDER_PRINTABLE_STATUSES,
  OrderStatus.ON_HOLD,
]);

/** 工单状态是否允许确认“已打印”；工作台能力与服务端写入共用。 */
export function canConfirmOrderPrinted(status: OrderStatus): boolean {
  return PRINT_CONFIRMABLE_STATUSES.has(status);
}
