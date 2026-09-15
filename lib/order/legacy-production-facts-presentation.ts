import { OrderPackagingMode, OrderStatus } from '@/generated/prisma/enums';
import { PACKAGING_MODE_LABELS, packagingModeLabel } from './packaging-mode';
const allowedStatuses: readonly OrderStatus[] = [OrderStatus.DRAFT, OrderStatus.SUBMITTED, OrderStatus.PENDING_FACTORY, OrderStatus.CONFIRMED];

export function isLegacyProductionFactsRepairAllowedStatus(status: OrderStatus) {
  return allowedStatuses.includes(status);
}

/** Legacy packaging is free text. Only exact known labels/enums are evidence. */
export function legacyPackagingMode(requirement: string | null): OrderPackagingMode | undefined {
  const text = requirement?.trim();
  return Object.values(OrderPackagingMode).find((mode) => mode === text || PACKAGING_MODE_LABELS[mode] === text || packagingModeLabel(mode) === text);
}

export function getLegacyProductionFactsRepair(order: {
  id: string; revision: number; status: OrderStatus; packageRequirement: string | null;
  items: Array<{ id: string; sequence: number; name: string; craft: import('@/generated/prisma/enums').OrderCraft | null; pack: number | null; quantity: number }>;
  packagingGroups: Array<{ id: string }>;
}) {
  if (!order || !isLegacyProductionFactsRepairAllowedStatus(order.status)) return null;
  const needsPackaging = order.packagingGroups.length === 0;
  if (!needsPackaging && order.items.every((item) => item.craft !== null)) return null;
  return { orderId: order.id, expectedOrderRevision: order.revision, needsPackaging,
    packagingMode: legacyPackagingMode(order.packageRequirement), items: order.items.map(({ id, sequence, name, craft, pack, quantity }) => ({ id, sequence, name, craft, pack, quantity })) };
}

