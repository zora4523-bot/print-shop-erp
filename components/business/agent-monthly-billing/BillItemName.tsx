import type Decimal from 'decimal.js';
import { billItemName } from '@/lib/agent-monthly-billing/item-list';

export function BillItemName({ item }: { item: {
  settlementDetailSnapshot?: unknown; settledFeeSnapshot: Decimal.Value; order: { customName: string | null };
} }) {
  const { name, current } = billItemName(item);
  return <>{name}{current ? <span className="block text-xs text-muted-foreground">当前名称</span> : null}</>;
}
