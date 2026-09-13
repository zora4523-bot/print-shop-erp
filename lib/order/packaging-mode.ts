import { OrderPackagingMode } from '@/generated/prisma/enums';

export type PackagingType = 'BAG' | 'UNPACKED' | 'BOX';
export type PackagingBoxType = 'RED_CARD' | 'TACTILE';

/** Customer-approved capacities. Prices belong to the published price book. */
export const PACKAGING_BOXES = {
  RED_CARD: { label: '红卡盒子 230g', capacity: 10 },
  TACTILE: { label: '触感盒子 250g', capacity: 8 },
} as const;

export function packagingType(mode: OrderPackagingMode): PackagingType {
  if (mode === OrderPackagingMode.UNPACKED) return 'UNPACKED';
  return packagingBoxType(mode) ? 'BOX' : 'BAG';
}

export function packagingBoxType(mode: OrderPackagingMode): PackagingBoxType | null {
  if (mode === 'BOX_RED_CARD' || mode === 'BOX_RED_CARD_MIXED') return 'RED_CARD';
  if (mode === 'BOX_TACTILE' || mode === 'BOX_TACTILE_MIXED') return 'TACTILE';
  return null;
}

export function isMixedPackaging(mode: OrderPackagingMode): boolean {
  return mode === 'MIXED_STYLE' || mode === 'BOX_RED_CARD_MIXED' || mode === 'BOX_TACTILE_MIXED';
}

export function packagingModeFor(
  type: PackagingType,
  mixed = false,
  box: PackagingBoxType = 'RED_CARD',
): OrderPackagingMode {
  if (type === 'UNPACKED') return OrderPackagingMode.UNPACKED;
  if (type === 'BAG')
    return mixed ? OrderPackagingMode.MIXED_STYLE : OrderPackagingMode.SINGLE_STYLE;
  if (box === 'TACTILE')
    return mixed ? OrderPackagingMode.BOX_TACTILE_MIXED : OrderPackagingMode.BOX_TACTILE;
  return mixed ? OrderPackagingMode.BOX_RED_CARD_MIXED : OrderPackagingMode.BOX_RED_CARD;
}

export function packagingModeWithStyleCount(
  mode: OrderPackagingMode,
  count: number,
): OrderPackagingMode {
  return packagingModeFor(packagingType(mode), count > 1, packagingBoxType(mode) ?? 'RED_CARD');
}

export function packagingCapacity(mode: OrderPackagingMode): number | null {
  if (mode === 'UNPACKED') return null;
  const box = packagingBoxType(mode);
  return box ? PACKAGING_BOXES[box].capacity : 12;
}

export function packagingUnit(mode: OrderPackagingMode): '袋' | '盒' {
  return packagingBoxType(mode) ? '盒' : '袋';
}

export function packagingModeLabel(mode: OrderPackagingMode): string {
  if (mode === 'UNPACKED') return '不包装';
  const box = packagingBoxType(mode);
  if (box) return `${PACKAGING_BOXES[box].label}${isMixedPackaging(mode) ? ' · 混装' : ''}`;
  return isMixedPackaging(mode) ? '混装入袋' : '常规入袋';
}

export function packagingCapacityError(mode: OrderPackagingMode): string {
  const box = packagingBoxType(mode);
  return box
    ? `每盒数量不能超过 ${PACKAGING_BOXES[box].capacity} 个，请调整包装数量`
    : '每包数量不能超过 12 个，请调整包装数量';
}

export const PACKAGING_MODE_LABELS: Record<OrderPackagingMode, string> = Object.fromEntries(
  Object.values(OrderPackagingMode).map((mode) => [
    mode,
    mode === 'SINGLE_STYLE' ? '单款装' : mode === 'MIXED_STYLE' ? '混装' : packagingModeLabel(mode),
  ]),
) as Record<OrderPackagingMode, string>;

export function packagingShipmentQuantities(
  items: readonly { quantity: number }[],
  additional: readonly { itemQuantities: readonly number[] }[],
): number[][] {
  return [
    items.map(
      (item, index) =>
        item.quantity -
        additional.reduce((sum, shipment) => sum + (shipment.itemQuantities[index] ?? 0), 0),
    ),
    ...additional.map((shipment) => [...shipment.itemQuantities]),
  ];
}
