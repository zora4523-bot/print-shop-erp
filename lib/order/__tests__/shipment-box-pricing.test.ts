import { describe, expect, it } from 'vitest';
import { OrderPackagingMode } from '@/generated/prisma/enums';
import { repriceShipmentBoxes } from '../shipment-box-pricing';

function fixture() {
  return {
    items: [{ id: 'item', quantity: 101 }],
    groups: [
      {
        id: 'box',
        sequence: 1,
        mode: OrderPackagingMode.BOX_TACTILE,
        actualBagCount: 13,
        unitPrice: '2.30',
        subtotal: '29.90',
        lines: [{ orderItemId: 'item', unitsPerBag: 8 }],
      },
    ],
    shipments: [
      { lines: [{ orderItemId: 'item', quantity: 3 }] },
      { lines: [{ orderItemId: 'item', quantity: 98 }] },
    ],
  };
}
describe('address-based box pricing', () => {
  it('charges fourteen tactile boxes for 3 + 98 pieces using the frozen rate', () => {
    expect(repriceShipmentBoxes(fixture())).toEqual([
      {
        groupId: 'box',
        sequence: 1,
        oldBoxCount: 13,
        boxCount: 14,
        unitPrice: '2.3000',
        oldSubtotal: '29.90',
        subtotal: '32.20',
        delta: '2.30',
      },
    ]);
  });
  it('does not change bagging, unpacked or an unchanged box count', () => {
    const input = fixture();
    for (const mode of [
      OrderPackagingMode.SINGLE_STYLE,
      OrderPackagingMode.UNPACKED,
    ]) {
      expect(
        repriceShipmentBoxes({
          ...input,
          groups: [{ ...input.groups[0], mode }],
        }),
      ).toEqual([]);
    }
    input.groups[0].actualBagCount = 14;
    expect(repriceShipmentBoxes(input)).toEqual([]);
  });
  it('includes unassigned styles and zero allocations without manufacturing a box', () => {
    const input = fixture();
    input.items.push({ id: 'other', quantity: 2 });
    input.shipments[1].lines.push({ orderItemId: 'other', quantity: 2 });
    expect(repriceShipmentBoxes(input)[0].boxCount).toBe(14);
  });
  it('rejects non-conserved deliveries', () => {
    const input = fixture();
    input.shipments[0].lines[0].quantity = 4;
    expect(() => repriceShipmentBoxes(input)).toThrow('分配数量');
  });
  it.each(['NaN', 'Infinity', '-1', '0.12345', '9999999999'])(
    'rejects invalid or overflowing money: %s',
    (unitPrice) => {
      const input = fixture();
      input.groups[0].unitPrice = unitPrice;
      expect(() => repriceShipmentBoxes(input)).toThrow('装盒费用超出范围');
    },
  );
});
