import { ShipmentStatus } from '../../generated/prisma/enums';
import { OrderChangeRequestError } from './change-request-error';

type ShipmentFact = { status: ShipmentStatus };

const MESSAGES = {
  REQUEST: {
    CANCEL: '工单已有地址发货，不能申请取消',
    ITEMS: '工单已有地址发货，只能申请修改交期',
  },
  REVIEW: {
    CANCEL: '工单已有地址发货，不能批准取消，请驳回该申请',
    ITEMS: '工单已有地址发货，不能批准款式或数量修改，请驳回该申请',
  },
} as const;

/**
 * 已发货地址的分货与物流是履约事实（与 add-shipment / 收货信息编辑的边界一致）。
 * 任一地址发货后，工单不能再整单取消，款式或数量变更也不能改写已发货地址；
 * 只改交期的申请不触及分货，仍然放行。
 */
export function assertChangeRequestRespectsShippedShipments(input: {
  phase: keyof typeof MESSAGES;
  isCancellation: boolean;
  itemChangeCount: number;
  shipments: readonly ShipmentFact[];
}): void {
  if (!input.shipments.some((shipment) => shipment.status === ShipmentStatus.SHIPPED)) return;
  if (input.isCancellation) throw new OrderChangeRequestError(MESSAGES[input.phase].CANCEL);
  if (input.itemChangeCount > 0) throw new OrderChangeRequestError(MESSAGES[input.phase].ITEMS);
}
