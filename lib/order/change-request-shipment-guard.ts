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
 * 任一收货地址已发货（SHIPPED）即视为履约开始：工单正常收费，不再提供取消选项
 * （业主 2026-09-24），款式或数量也不能再改，只能改交期。界面入口与服务端闸口共用此判断。
 */
export function hasShippedShipment(shipments: readonly ShipmentFact[]): boolean {
  return shipments.some((shipment) => shipment.status === ShipmentStatus.SHIPPED);
}

/**
 * 已发货地址的分货与物流是履约事实（与 add-shipment / 收货信息编辑的边界一致）。
 * 任一地址发货后，工单不能再整单取消，款式或数量变更也不能改写已发货地址；
 * 只改交期的申请不触及分货，仍然放行。
 */
type ShippedShipmentGuardInput = {
  phase: keyof typeof MESSAGES;
  isCancellation: boolean;
  itemChangeCount: number;
  shipments: readonly ShipmentFact[];
};

/** 违反发货闸口时返回拒绝原因，否则 null；界面据此隐藏入口并说明原因。 */
export function shippedShipmentViolation(input: ShippedShipmentGuardInput): string | null {
  if (!hasShippedShipment(input.shipments)) return null;
  if (input.isCancellation) return MESSAGES[input.phase].CANCEL;
  if (input.itemChangeCount > 0) return MESSAGES[input.phase].ITEMS;
  return null;
}

export function assertChangeRequestRespectsShippedShipments(input: ShippedShipmentGuardInput): void {
  const violation = shippedShipmentViolation(input);
  if (violation) throw new OrderChangeRequestError(violation);
}
