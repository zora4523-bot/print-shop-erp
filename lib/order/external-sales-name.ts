import { OrderSettlementType } from '../../generated/prisma/enums';

/**
 * 工单归属的外部销售（业主 2026-09-27）：收费工单（EXTERNAL_SALES）即提交的外部销售；
 * 免费重做（NO_CHARGE）由管理员发起，取原单的外部销售。原“客户名称/简称”自
 * 2026-09-13 起不再录入，凡按工单指认“是谁的单”都用这里的名字。
 */
export const ORDER_EXTERNAL_SALES_SELECT = {
  settlementType: true,
  submitter: { select: { displayName: true } },
  sourceOrder: { select: { submitter: { select: { displayName: true } } } },
} as const;

type SubmitterName = { displayName: string } | null | undefined;

export type OrderExternalSalesFacts = {
  settlementType: OrderSettlementType | string | null | undefined;
  submitter?: SubmitterName;
  sourceOrder?: { submitter?: SubmitterName } | null;
};

export function orderExternalSalesName(order: OrderExternalSalesFacts): string | null {
  const name = order.settlementType === OrderSettlementType.EXTERNAL_SALES
    ? order.submitter?.displayName
    : order.sourceOrder?.submitter?.displayName;
  return name?.trim() || null;
}
