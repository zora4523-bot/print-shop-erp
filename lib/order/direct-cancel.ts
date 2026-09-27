import { OrderStatus, Role } from '../../generated/prisma/enums';
import type { ShipmentStatus } from '../../generated/prisma/enums';
import { hasShippedShipment } from './change-request-shipment-guard';

/**
 * 可直接撤回的工单状态：尚未进入已确认生产合同（SPEC §4.3「任意非终态均可转
 * CANCELLED（需对应权限）」）。SUBMITTED 是内部 / 直营单提交后待资料或核价的
 * 状态，与外销的 PENDING_FACTORY 同属待工厂确认；CONFIRMED 及之后必须走取消申请，
 * 由管理员裁决已产数量与结算。cancelOrder 的领域校验与详情页入口共用这一张表。
 */
const DIRECT_CANCEL_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  OrderStatus.DRAFT,
  OrderStatus.SUBMITTED,
  OrderStatus.PENDING_FACTORY,
  OrderStatus.REJECTED,
]);

export function isDirectCancelStatus(status: OrderStatus): boolean {
  return DIRECT_CANCEL_STATUSES.has(status);
}

/**
 * 管理后台工单详情页是否显示直接取消入口。外部销售走 SalesOrderDetailView；
 * action 层仍由 requirePermission 与 cancelOrder
 * 的领域校验把关，这里只决定界面入口。
 */
export function canShowAdminDirectCancel(
  role: Role,
  status: OrderStatus,
  shipments: readonly { status: ShipmentStatus }[] = [],
): boolean {
  // 任一地址已发货即正常收费、没有取消选项（业主 2026-09-24）。
  return role === Role.ADMIN && isDirectCancelStatus(status) && !hasShippedShipment(shipments);
}
