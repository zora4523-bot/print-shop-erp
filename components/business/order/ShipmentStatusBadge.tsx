import type { ShipmentStatus } from '@/generated/prisma/enums';
import { StatusBadge } from '@/components/ui-business';
import { SHIPMENT_STATUS_REGISTRY } from '@/lib/ui/status-registry';

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  const definition = SHIPMENT_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}
