import { describe, expect, it } from 'vitest';
import { calculateCreateOrderQuote, type CreateOrderPriceSnapshot } from '../create-order';
import {
  CREATE_ORDER_GOLDEN_SNAPSHOT,
  createGoldenOrderInput,
  createGoldenOrderItem,
} from './fixtures/create-order-golden-fixtures';
import { calculateCreateOrderBagCount } from '../../order/create-order-packaging';
import { deriveProductionOperationPlan } from '../../production/operation-materializer';
import { buildCreateOrderExternalChargeInput } from '../../order/create-order-charge-input';
import { calculatePieceworkAmount } from '../../salary/piecework-pricing';

const snapshot: CreateOrderPriceSnapshot = {
  ...CREATE_ORDER_GOLDEN_SNAPSHOT,
  boxing: { redCardEmptyBox: '1.3', tactileEmptyBox: '1.8', packingPerBox: '0.5' },
};
function input(mode: 'UNPACKED' | 'BOX_RED_CARD' | 'BOX_TACTILE', quantity = 101, units = 10) {
  const item = createGoldenOrderItem({ quantity });
  return {
    ...createGoldenOrderInput([item], {
      packagingGroups: [
        { groupKey: 'pack', mode, items: [{ itemKey: item.itemKey, unitsPerBag: units }] },
      ],
    }),
    includeOrderCharges: false,
  };
}
describe('explicit packaging types', () => {
  it('keeps rounded component evidence equal to the combined packaging charge', () => {
    const result = calculateCreateOrderQuote(input('BOX_RED_CARD', 1), {
      ...snapshot,
      boxing: {redCardEmptyBox: '0.005', tactileEmptyBox: '1.8', packingPerBox: '0.005'},
    });
    expect(result.packagingGroups[0].amount).toBe('0.01');
    expect(result.packagingGroups[0].line.basis).toMatchObject({
      emptyBoxAmount: '0.01', packingAmount: '0.00',
    });
  });

  it('unpacked is zero even for manual products and keeps other processing charges', () => {
    const normal = calculateCreateOrderQuote(input('UNPACKED'), snapshot);
    expect(normal.packagingGroups[0]).toMatchObject({
      bagCount: 0,
      amount: '0.00',
      status: 'QUOTED',
    });
    expect(normal.packagingGroups[0].line).toMatchObject({
      code: 'NO_PACKAGING',
      basis: { rate: '0.0000' },
    });
    expect(Number(normal.items[0].amount)).toBeGreaterThan(0);
    const manual = input('UNPACKED');
    manual.items = [
      {
        ...manual.items[0],
        manualPricingReason: '自定义纸张',
        configuration: { ...manual.items[0].configuration, paper: 'CUSTOM' },
      },
    ];
    expect(calculateCreateOrderQuote(manual, snapshot).packagingGroups[0].amount).toBe('0.00');
  });
  it.each([
    ['BOX_RED_CARD', 10, '19.80', '14.30', '5.50'],
    ['BOX_TACTILE', 8, '29.90', '23.40', '6.50'],
  ] as const)(
    '%s adds empty-box cost and labor once, rounding up',
    (mode, units, amount, material, labor) => {
      const result = calculateCreateOrderQuote(input(mode, 101, units), snapshot);
      expect(result.packagingGroups[0]).toMatchObject({ status: 'QUOTED', amount });
      expect(result.packagingGroups[0].line.basis).toMatchObject({
        emptyBoxAmount: material,
        packingAmount: labor,
      });
      expect(result.packagingGroups[0].line.code).toBe('BOX_PACKAGING');
    },
  );
  it('rounds each address separately, and preserves the unknown box weight', () => {
    const facts = input('BOX_RED_CARD', 10);
    facts.shipments = [
      { shipmentKey: '1', province: '广东', itemQuantities: { 'style-1': 5 } },
      { shipmentKey: '2', province: '广东', itemQuantities: { 'style-1': 5 } },
    ];
    const result = calculateCreateOrderQuote(facts, snapshot);
    expect(result.packagingGroups[0]).toMatchObject({ bagCount: 2, amount: '3.60' });
    expect(
      buildCreateOrderExternalChargeInput(facts).shipments.every(
        (shipment) => shipment.requiresActualWeight,
      ),
    ).toBe(true);
    const freight = calculateCreateOrderQuote({ ...facts, includeOrderCharges: true }, snapshot);
    expect(freight.order.lines.find((line) => line.code === 'SHIPPING:1')?.amount).toBeNull();
  });
  it('old books cannot silently quote boxes at zero', () => {
    const result = calculateCreateOrderQuote(input('BOX_RED_CARD'), CREATE_ORDER_GOLDEN_SNAPSHOT);
    expect(result.packagingGroups[0].amount).toBeNull();
    expect(result.packagingGroups[0].errors.join()).toContain('当前价格版本缺少');
  });
  it.each([
    ['BOX_RED_CARD', 11],
    ['BOX_TACTILE', 9],
    ['BOX_RED_CARD_MIXED', 6],
  ] as const)('rejects %s over-capacity composition', (mode, units) => {
    const mixed = mode.endsWith('MIXED');
    expect(
      calculateCreateOrderBagCount({
        mode,
        itemQuantities: mixed ? [100, 100] : [100],
        itemUnitsPerBag: mixed ? [units, units] : [units],
      }).complete,
    ).toBe(false);
  });
  it('mixed boxes require matching composition in each shipment', () => {
    expect(
      calculateCreateOrderBagCount({
        mode: 'BOX_RED_CARD_MIXED',
        itemQuantities: [10, 10],
        itemUnitsPerBag: [5, 5],
        shipmentQuantities: [
          [5, 0],
          [5, 10],
        ],
      }).complete,
    ).toBe(false);
    expect(
      calculateCreateOrderBagCount({
        mode: 'BOX_RED_CARD_MIXED',
        itemQuantities: [10, 10],
        itemUnitsPerBag: [5, 5],
        shipmentQuantities: [
          [5, 5],
          [5, 5],
        ],
      }),
    ).toMatchObject({ complete: true, bagCount: 2 });
  });
  it('unpacked skips the paid packing operation; boxes carry a separate payroll unit', () => {
    const item = {
      id: 'i',
      sequence: 1,
      craft: 'FULL' as const,
      quantity: 10,
      frontFoilColors: [],
      backFoilColors: [],
      hasLocalFoil: false,
    };
    const group = {
      id: 'g',
      sequence: 1,
      mode: 'UNPACKED' as const,
      actualBagCount: 0,
      lines: [{ orderItemId: 'i', unitsPerBag: 10 }],
    };
    const unpacked = deriveProductionOperationPlan({
      orderId: 'o',
      items: [item],
      packagingGroups: [group],
    });
    expect(unpacked.ok).toBe(true);
    expect(unpacked.specs.some((operation) => operation.operationType === 'PACKING')).toBe(false);
    const boxed = deriveProductionOperationPlan({
      orderId: 'o',
      items: [item],
      packagingGroups: [{ ...group, mode: 'BOX_RED_CARD', actualBagCount: 2 }],
      shipments: [
        { lines: [{ orderItemId: 'i', quantity: 5 }] },
        { lines: [{ orderItemId: 'i', quantity: 5 }] },
      ],
    });
    expect(boxed.ok).toBe(true);
    expect(boxed.specs.find((operation) => operation.operationType === 'PACKING')).toMatchObject({
      unit: 'PER_BOX',
      plannedQty: '2',
    });
  });
  it('cannot apply a bag wage to a box operation or invent an unpublished wage', () => {
    expect(() =>
      calculatePieceworkAmount(
        { operationType: 'PACKING', unit: 'PER_BOX', completedQty: 2 },
        { operationType: 'PACKING', unit: 'PER_BAG', amount: '0.1' },
      ),
    ).toThrow('单位不一致');
    expect(() =>
      calculatePieceworkAmount(
        { operationType: 'PACKING', unit: 'PER_BOX', completedQty: 2 },
        { operationType: 'PACKING', unit: 'PER_BOX', amount: null },
      ),
    ).toThrow('尚未发布');
    expect(
      calculatePieceworkAmount(
        { operationType: 'PACKING', unit: 'PER_BOX', completedQty: 2 },
        { operationType: 'PACKING', unit: 'PER_BOX', amount: '0.2' },
      ).amount,
    ).toBe('0.40');
  });
});
