import { OrderStatus } from '../../generated/prisma/enums';
import type { ShipmentStatus } from '../../generated/prisma/enums';
import { ORDER_MODIFIABLE_STATUSES } from './editable-fields';
import { hasShippedShipment } from './change-request-shipment-guard';

/** 与 lib/order/change-request.ts 的 CANCELLABLE_BY_REQUEST_STATUSES 保持一致。 */
const CANCELLATION_REQUEST_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  OrderStatus.ON_HOLD,
  OrderStatus.CONFIRMED,
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
]);

export type OrderChangeRequestOptions = {
  /** 是否展示「申请修改工单」区块。 */
  canRequestModify: boolean;
  /** 修改申请是否允许改款式/数量；false 时只能改交期。 */
  allowItemChanges: boolean;
  /** 是否展示「申请取消」。 */
  canRequestCancellation: boolean;
  /** 任一地址已发货：正常收费，没有取消选项（业主 2026-09-24）。 */
  shipped: boolean;
};

/**
 * 销售详情页修改 / 取消申请入口的唯一判断。服务端闸口见
 * change-request-shipment-guard.ts；这里只决定界面是否提供入口。
 */
export function resolveOrderChangeRequestOptions(input: {
  status: OrderStatus;
  hasPendingChange: boolean;
  shipments: readonly { status: ShipmentStatus }[];
}): OrderChangeRequestOptions {
  const shipped = hasShippedShipment(input.shipments);
  const canRequestModify =
    !input.hasPendingChange && ORDER_MODIFIABLE_STATUSES.includes(input.status);
  return {
    canRequestModify,
    allowItemChanges: canRequestModify && !shipped,
    canRequestCancellation:
      !input.hasPendingChange && !shipped && CANCELLATION_REQUEST_STATUSES.has(input.status),
    shipped,
  };
}
