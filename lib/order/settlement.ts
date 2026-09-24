import { OrderSettlementType } from '../../generated/prisma/enums';

/**
 * 业主 2026-09-24：所有业务都以外部销售身份开展。管理员建单必须指定一个启用的
 * 外部销售账号，工单按 EXTERNAL_SALES 结算、提交人为该销售。
 */
export const ADMIN_EXTERNAL_SALES_REQUIRED_MESSAGE = '请选择关联外部销售';

/**
 * Orders whose delivery is priced from the published logistics book (中通省份
 * 阶梯 + 纸箱耗材) and billed as customer charges. Only free (NO_CHARGE) orders
 * never bill logistics; internal and factory-direct orders follow the same
 * rules as external sales (业主 2026-09-18 拍板，取代「内部结算不新增物流应收」).
 */
export function settlementBillsLogistics(settlementType: OrderSettlementType): boolean {
  return settlementType !== OrderSettlementType.NO_CHARGE;
}

export const LOGISTICS_CHARGE_CATEGORY_CODES = ['SHIPPING_FEE', 'PACKING_MATERIAL'] as const;

/**
 * SHIPPING_FEE / PACKING_MATERIAL rows written by the submit finalizer, i.e.
 * bound to a published price book. Rows an administrator 补录-ed through the
 * full fee editor carry `priceBookId: null` and cannot be requoted at ship
 * time, so they must not switch the order onto the logistics path.
 */
export function hasLogisticsChargeRows(
  charges: readonly { category: { code: string }; priceBookId?: string | null }[],
): boolean {
  return charges.some((charge) =>
    (LOGISTICS_CHARGE_CATEGORY_CODES as readonly string[]).includes(String(charge.category.code)) &&
    charge.priceBookId != null,
  );
}

/**
 * Whether the order's delivery is priced and finalized through logistics
 * rows: external sales and samples always; internal / factory-direct orders
 * once their rows exist (orders submitted before 2026-09-18 have none and
 * keep the processing-only flows).
 */
export function orderBillsLogistics(order: {
  settlementType: OrderSettlementType;
  purpose?: string | null;
  hasLogisticsRows: boolean;
}): boolean {
  if (order.purpose === 'PROOF') return false;
  if (order.settlementType === OrderSettlementType.EXTERNAL_SALES || order.purpose === 'SAMPLE_SHIPMENT') return true;
  return settlementBillsLogistics(order.settlementType) && order.hasLogisticsRows;
}

export const ORDER_SETTLEMENT_LABELS: Record<OrderSettlementType, string> = {
  [OrderSettlementType.EXTERNAL_SALES]: '外部销售应付工厂',
  [OrderSettlementType.INTERNAL_SALES]: '内部销售业绩',
  [OrderSettlementType.FACTORY_DIRECT]: '工厂直接业务',
  [OrderSettlementType.NO_CHARGE]: '免费工单',
};
