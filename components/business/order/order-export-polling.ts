import { OrderExportStatus } from '@/generated/prisma/enums';

export const ORDER_EXPORT_POLLING_TIMEOUT_MS = 120_000;

export function pendingOrderExportSignature(
  exports: readonly { id: string; status: OrderExportStatus }[],
): string {
  return exports
    .filter((item) => item.status === OrderExportStatus.PENDING)
    .map((item) => item.id)
    .sort()
    .join('|');
}
