import { StatusBadge } from '@/components/ui-business';
import { billOrderStatus } from '@/lib/agent-monthly-billing/presentation';

export function OrderStatusSnapshotBadge({ snapshot }: { snapshot: string }) {
  const definition = billOrderStatus(snapshot);
  return <StatusBadge tone={definition.tone} dot={definition.dot}>{definition.label}</StatusBadge>;
}
