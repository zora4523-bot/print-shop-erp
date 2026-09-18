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

/**
 * Orders whose delivery is priced from the published logistics book (中通省份
 * 阶梯 + 纸箱耗材) and billed as customer charges. Only free (NO_CHARGE) orders
 * never bill logistics; internal and factory-direct orders follow the same
 * rules as external sales (业主 2026-09-18 拍板，取代「内部结算不新增物流应收」).
 */
export function settlementBillsLogistics(settlementType: OrderSettlementType): boolean {
  return settlementType !== OrderSettlementType.NO_CHARGE;
}

export const ORDER_SETTLEMENT_LABELS: Record<OrderSettlementType, string> = {
  [OrderSettlementType.EXTERNAL_SALES]: '外部销售应付工厂',
  [OrderSettlementType.INTERNAL_SALES]: '内部销售业绩',
  [OrderSettlementType.FACTORY_DIRECT]: '工厂直接业务',
  [OrderSettlementType.NO_CHARGE]: '免费工单',
};
