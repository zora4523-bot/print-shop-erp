import type {
  PurchaseOrderStatus,
  PurchaseReceiptStatus,
} from '@/generated/prisma/enums';
import { StatusBadge } from '@/components/ui-business';
import {
  PURCHASE_ORDER_STATUS_REGISTRY,
  PURCHASE_RECEIPT_STATUS_REGISTRY,
} from '@/lib/ui/status-registry';

export function PurchaseOrderStatusBadge({
  status,
}: {
  status: PurchaseOrderStatus;
}) {
  const definition = PURCHASE_ORDER_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}

export function PurchaseReceiptStatusBadge({
  status,
}: {
  status: PurchaseReceiptStatus;
}) {
  const definition = PURCHASE_RECEIPT_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}
