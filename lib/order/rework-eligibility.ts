import { OrderStatus } from '../../generated/prisma/enums';

// 售后重做只针对已离厂的货：已发货、逐地址发货后自动结算的已结算（规范终态），
// 以及历史兼容的已完成。原单状态与应收不因重做改变（DECISIONS 2026-07-31）。
const REWORK_SOURCE_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  OrderStatus.SHIPPED,
  OrderStatus.SETTLED,
  OrderStatus.FINISHED,
]);

/** 原单状态是否允许发起售后重做；领域闸口与详情页入口共用。 */
export function canCreateReworkFromStatus(status: OrderStatus): boolean {
  return REWORK_SOURCE_STATUSES.has(status);
}
