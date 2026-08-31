import { describe, expect, it } from 'vitest';
import { OrderCraft } from '../../../generated/prisma/enums';
import {
  deriveProductionOperationPlan,
  type CanonicalProductionOrderFacts,
} from '../operation-materializer';

function orderFacts(
  overrides: Partial<CanonicalProductionOrderFacts> = {},
): CanonicalProductionOrderFacts {
  return {
    orderId: 'order-1',
    items: [
      {
        id: 'item-1',
        sequence: 1,
        craft: OrderCraft.PARTIAL,
        quantity: 1_000,
        frontFoilColors: ['gold'],
        backFoilColors: ['gold'],
        hasLocalFoil: true,
      },
    ],
    packagingGroups: [
      {
        id: 'group-1',
        sequence: 1,
        actualBagCount: 10,
        lines: [{ orderItemId: 'item-1', unitsPerBag: 100 }],
      },
    ],
    ...overrides,
  };
}

describe('deriveProductionOperationPlan', () => {
  it('preserves PARTIAL completed pieces and pass-count evidence', () => {
    const plan = deriveProductionOperationPlan(orderFacts());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.specs).toEqual([
      expect.objectContaining({
        operationType: 'PARTIAL',
        unit: 'PER_PASS',
        plannedQty: '2000',
        passCount: 2,
        sources: [
          expect.objectContaining({
            sourceQty: '2000',
            completedPieceQty: '1000',
            passCount: 2,
          }),
        ],
      }),
      expect.objectContaining({
        operationType: 'PACKING',
        unit: 'PER_BAG',
        plannedQty: '10',
      }),
    ]);
  });

  it('creates no foil operation for pure print', () => {
    const plan = deriveProductionOperationPlan(
      orderFacts({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            craft: OrderCraft.PRINT,
            quantity: 1_000,
            frontFoilColors: [],
            backFoilColors: [],
            hasLocalFoil: false,
          },
        ],
      }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.specs.map((spec) => spec.operationType)).toEqual(['PACKING']);
  });

  it('maps print plus foil using hasLocalFoil and splits different PARTIAL pass counts', () => {
    const plan = deriveProductionOperationPlan(
      orderFacts({
        items: [
          {
            id: 'item-local-1',
            sequence: 1,
            craft: OrderCraft.PRINT,
            quantity: 100,
            frontFoilColors: ['gold'],
            backFoilColors: [],
            hasLocalFoil: true,
          },
          {
            id: 'item-local-2',
            sequence: 2,
            craft: OrderCraft.PRINT,
            quantity: 100,
            frontFoilColors: ['gold'],
            backFoilColors: ['red'],
            hasLocalFoil: true,
          },
          {
            id: 'item-full',
            sequence: 3,
            craft: OrderCraft.PRINT,
            quantity: 100,
            frontFoilColors: ['gold'],
            backFoilColors: [],
            hasLocalFoil: false,
          },
        ],
        packagingGroups: [
          {
            id: 'mixed',
            sequence: 1,
            actualBagCount: 10,
            lines: [
              { orderItemId: 'item-local-1', unitsPerBag: 10 },
              { orderItemId: 'item-local-2', unitsPerBag: 10 },
              { orderItemId: 'item-full', unitsPerBag: 10 },
            ],
          },
        ],
      }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(
      plan.specs.map((spec) => [
        spec.operationType,
        spec.passCount,
        spec.plannedQty,
      ]),
    ).toEqual([
      ['PARTIAL', 1, '100'],
      ['PARTIAL', 2, '200'],
      ['FULL', 1, '100'],
      ['PACKING', 1, '10'],
    ]);
  });

  it('charges each mixed packaging group once rather than once per item', () => {
    const plan = deriveProductionOperationPlan(
      orderFacts({
        items: [
          {
            id: 'a',
            sequence: 1,
            craft: OrderCraft.PRINT,
            quantity: 120,
            frontFoilColors: [],
            backFoilColors: [],
            hasLocalFoil: false,
          },
          {
            id: 'b',
            sequence: 2,
            craft: OrderCraft.PRINT,
            quantity: 240,
            frontFoilColors: [],
            backFoilColors: [],
            hasLocalFoil: false,
          },
        ],
        packagingGroups: [
          {
            id: 'mixed',
            sequence: 1,
            actualBagCount: 120,
            lines: [
              { orderItemId: 'a', unitsPerBag: 1 },
              { orderItemId: 'b', unitsPerBag: 2 },
            ],
          },
        ],
      }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.specs).toHaveLength(1);
    expect(plan.specs[0]).toMatchObject({
      operationType: 'PACKING',
      plannedQty: '120',
    });
  });

  it('allows a partially filled final bag using the canonical ceil rule', () => {
    const plan = deriveProductionOperationPlan(
      orderFacts({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            craft: OrderCraft.PRINT,
            quantity: 1_001,
            frontFoilColors: [],
            backFoilColors: [],
            hasLocalFoil: false,
          },
        ],
        packagingGroups: [
          {
            id: 'group-1',
            sequence: 1,
            actualBagCount: 11,
            lines: [{ orderItemId: 'item-1', unitsPerBag: 100 }],
          },
        ],
      }),
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.specs).toEqual([
      expect.objectContaining({
        operationType: 'PACKING',
        unit: 'PER_BAG',
        plannedQty: '11',
      }),
    ]);
  });

  it('rejects the same item appearing in more than one packaging group', () => {
    const plan = deriveProductionOperationPlan(
      orderFacts({
        packagingGroups: [
          {
            id: 'group-1',
            sequence: 1,
            actualBagCount: 10,
            lines: [{ orderItemId: 'item-1', unitsPerBag: 100 }],
          },
          {
            id: 'group-2',
            sequence: 2,
            actualBagCount: 10,
            lines: [{ orderItemId: 'item-1', unitsPerBag: 100 }],
          },
        ],
      }),
    );

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.issues).toContainEqual(
      expect.objectContaining({
        code: 'PACKAGING_QUANTITY_MISMATCH',
        path: 'items[1].packaging',
      }),
    );
  });

  it('fails closed instead of guessing incomplete legacy facts', () => {
    const plan = deriveProductionOperationPlan(
      orderFacts({
        items: [
          {
            id: 'item-1',
            sequence: 1,
            craft: OrderCraft.PRINT,
            quantity: 1_000,
            frontFoilColors: ['gold'],
            backFoilColors: [],
            hasLocalFoil: null,
          },
        ],
        packagingGroups: [],
      }),
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'AMBIGUOUS_PRINT_FOIL_MODE',
        'NO_PACKAGING_GROUPS',
        'PACKAGING_QUANTITY_MISMATCH',
      ]),
    );
  });

  it('blocks incomplete or duplicated packaging coverage', () => {
    const plan = deriveProductionOperationPlan(
      orderFacts({
        packagingGroups: [
          {
            id: 'group-1',
            sequence: 1,
            actualBagCount: 9,
            lines: [
              { orderItemId: 'item-1', unitsPerBag: 100 },
              { orderItemId: 'item-1', unitsPerBag: 100 },
            ],
          },
        ],
      }),
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'DUPLICATE_PACKAGING_LINE',
        'PACKAGING_QUANTITY_MISMATCH',
      ]),
    );
  });
});
