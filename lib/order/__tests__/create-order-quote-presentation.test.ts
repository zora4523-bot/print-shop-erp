import { describe, expect, it } from 'vitest';
import { calculateCreateOrderQuote } from '../../price/create-order';
import { calculateExternalOrderCharges } from '../../price/external-order-charges';
import {
  CREATE_ORDER_GOLDEN_SNAPSHOT,
  createGoldenOrderItem,
  createGoldenOrderInput,
} from '../../price/__tests__/fixtures/create-order-golden-fixtures';
import { presentCreateOrderQuote } from '../create-order-quote-presentation';

function quoteLogistics(
  input: ReturnType<typeof createGoldenOrderInput>,
) {
  const itemsByKey = new Map(input.items.map((item) => [item.itemKey, item]));
  return calculateExternalOrderCharges(
    {
      isSfCollect: input.isSfCollect,
      shipments: input.shipments.map((shipment) => ({
        shipmentKey: shipment.shipmentKey,
        province: shipment.province,
        billableWeightKg: shipment.trustedBillableWeightKg ?? null,
        itemQuantity: Object.values(shipment.itemQuantities).reduce(
          (sum, quantity) => sum + quantity,
          0,
        ),
        weightItems: Object.entries(shipment.itemQuantities).flatMap(
          ([itemKey, quantity]) => {
            const item = itemsByKey.get(itemKey);
            return item && quantity > 0
              ? [
                  {
                    itemKey,
                    quantity,
                    paperWeightGsm: item.paperWeightGsm,
                    paperType: item.paperType,
                    productStructure: item.productStructure,
                  },
                ]
              : [];
          },
        ),
      })),
    },
    CREATE_ORDER_GOLDEN_SNAPSHOT.orderCharges.rules,
    CREATE_ORDER_GOLDEN_SNAPSHOT.orderCharges.logisticsPolicy,
  );
}

describe('create-order pure quote presentation', () => {
  it('keeps the existing form DTO while storing a versioned pure snapshot', () => {
    const input = createGoldenOrderInput([
      createGoldenOrderItem({ quantity: 1_000 }),
    ]);
    const quote = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    const presentation = presentCreateOrderQuote({
      factsKey: 'facts-1',
      input,
      quote,
      logistics: quoteLogistics(input),
      quoteToken: 'token-1',
    });

    expect(presentation.items[0]).toMatchObject({
      complete: true,
      suggestedUnitPrice: '0.1300',
      suggestedFixedFee: '40.00',
      suggestedSubtotal: '170.00',
    });
    expect(presentation.items[0]?.components.map((line) => line.ruleCode)).toEqual(
      ['PARTIAL_BLANK', 'PARTIAL_MACHINE'],
    );
    expect(presentation.items[0]?.snapshot).toMatchObject({
      schemaVersion: 2,
      engineVersion: 'CREATE_ORDER_PURE_V1',
      status: 'QUOTED',
      complete: true,
    });
    expect(presentation.packaging).toMatchObject({
      suggestedTotal: '10.00',
      requiresAdminConfirmation: false,
    });
    expect(presentation).toMatchObject({
      total: null,
      hasManualPricing: true,
      totalSemantics: 'EXCLUDES_MANUAL_ITEMS',
      plateFee: { status: 'PENDING', amount: null },
    });
    expect(presentation.quoteToken).toBe('token-1');
  });

  it('represents a per-order print total as fixed fee instead of multiplying it', () => {
    const input = createGoldenOrderInput([
      createGoldenOrderItem({
        craft: 'PRINT',
        paperType: '铜版纸',
        paperWeightGsm: 200,
        specification: '大号封',
        frontColors: [],
        backColors: [],
        quantity: 1_000,
      }),
    ]);
    const quote = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    const presentation = presentCreateOrderQuote({
      factsKey: 'facts-print',
      input,
      quote,
      logistics: quoteLogistics(input),
      quoteToken: 'token-print',
    });

    expect(presentation.items[0]).toMatchObject({
      complete: true,
      suggestedUnitPrice: '0.0000',
      suggestedFixedFee: '310.00',
      suggestedSubtotal: '310.00',
    });
  });

  it('does not fabricate item or packaging amounts for manual pricing', () => {
    const input = createGoldenOrderInput([
      createGoldenOrderItem({
        configuration: {
          paper: 'CUSTOM',
          paperWeight: 'CATALOG',
          specification: 'CATALOG',
          craft: 'CATALOG',
        },
      }),
    ]);
    const quote = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    const presentation = presentCreateOrderQuote({
      factsKey: 'facts-manual',
      input,
      quote,
      logistics: quoteLogistics(input),
      quoteToken: 'token-manual',
    });

    expect(presentation.items[0]).toMatchObject({
      complete: false,
      suggestedUnitPrice: null,
      suggestedFixedFee: null,
      suggestedSubtotal: null,
    });
    expect(presentation.packaging).toMatchObject({
      suggestedTotal: null,
      requiresAdminConfirmation: true,
    });
    expect(presentation.totalSemantics).toBe('EXCLUDES_MANUAL_ITEMS');
    expect(presentation.hasManualPricing).toBe(true);
  });
});
