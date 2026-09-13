import Decimal from 'decimal.js';
import type { OrderPackagingMode } from '@/generated/prisma/enums';
import { calculatePackagingBagCount } from './packaging-bag-count';
import { packagingBoxType } from './packaging-mode';

type BoxGroup = {
  id: string;
  sequence: number;
  mode: OrderPackagingMode;
  actualBagCount: number;
  unitPrice: { toString(): string };
  subtotal: { toString(): string };
  lines: readonly { orderItemId: string; unitsPerBag: number }[];
};

/** Reuse the order's agreed rate; splitting deliveries must not adopt new prices. */
export function repriceShipmentBoxes(input: {
  items: readonly { id: string; quantity: number }[];
  groups: readonly BoxGroup[];
  shipments: readonly {
    lines: readonly { orderItemId: string; quantity: number }[];
  }[];
}) {
  return input.groups.flatMap((group) => {
    if (!packagingBoxType(group.mode)) return [];
    const count = calculatePackagingBagCount({
      mode: group.mode,
      itemQuantities: input.items.map((item) => item.quantity),
      itemUnitsPerBag: input.items.map(
        (item) =>
          group.lines.find((line) => line.orderItemId === item.id)
            ?.unitsPerBag ?? 0,
      ),
      shipmentQuantities: input.shipments.map((shipment) =>
        input.items.map(
          (item) =>
            shipment.lines.find((line) => line.orderItemId === item.id)
              ?.quantity ?? 0,
        ),
      ),
    });
    if (!count.complete) throw new Error(count.errors.join('；'));
    if (count.bagCount === group.actualBagCount) return [];
    const rate = new Decimal(group.unitPrice.toString());
    const subtotal = rate
      .times(count.bagCount)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (
      !rate.isFinite() ||
      rate.isNegative() ||
      rate.decimalPlaces() > 4 ||
      !subtotal.isFinite() ||
      subtotal.gt('9999999999.99')
    ) {
      throw new Error('装盒费用超出范围，请核对原包装单价');
    }
    return [
      {
        groupId: group.id,
        sequence: group.sequence,
        oldBoxCount: group.actualBagCount,
        boxCount: count.bagCount,
        unitPrice: rate.toFixed(4),
        oldSubtotal: new Decimal(group.subtotal.toString()).toFixed(2),
        subtotal: subtotal.toFixed(2),
        delta: subtotal.minus(group.subtotal.toString()).toFixed(2),
      },
    ];
  });
}
