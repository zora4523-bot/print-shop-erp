import { OrderSettlementType, Role } from '../../generated/prisma/enums';

/**
 * Freeze the commercial settlement path when an order is created.
 *
 * Roles answer "what may this account do".  This snapshot answers "who owes
 * whom for this order" and must therefore not be recalculated after a user is
 * renamed or moved to another role.
 */
export function settlementTypeForOrderCreator(
  role: Role,
): OrderSettlementType {
  switch (role) {
    case Role.SALES:
      return OrderSettlementType.EXTERNAL_SALES;
    case Role.CUSTOMER_SERVICE:
      return OrderSettlementType.INTERNAL_SALES;
    case Role.ADMIN:
      return OrderSettlementType.FACTORY_DIRECT;
    case Role.WORKER:
      throw new Error('师傅账号不能创建销售工单');
  }
}

export const ORDER_SETTLEMENT_LABELS: Record<OrderSettlementType, string> = {
  [OrderSettlementType.EXTERNAL_SALES]: '外部销售应付工厂',
  [OrderSettlementType.INTERNAL_SALES]: '内部销售业绩',
  [OrderSettlementType.FACTORY_DIRECT]: '工厂直接业务',
  [OrderSettlementType.NO_CHARGE]: '免费工单',
};
