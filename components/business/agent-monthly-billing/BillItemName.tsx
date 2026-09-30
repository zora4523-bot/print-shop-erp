import type Decimal from 'decimal.js';
import { readBillSettlementDetail } from '@/lib/agent-monthly-billing/settlement-detail';

export function BillItemName({ item }: { item: {
  settlementDetailSnapshot?: unknown; settledFeeSnapshot: Decimal.Value; order: { customName: string | null };
} }) {
  const detail = readBillSettlementDetail(item.settlementDetailSnapshot, item.settledFeeSnapshot);
  const name = detail ? detail.orderName : item.order.customName;
  return <>{name?.trim() || '未命名工单'}{!detail ? <span className="block text-xs text-muted-foreground">当前名称</span> : null}</>;
}
