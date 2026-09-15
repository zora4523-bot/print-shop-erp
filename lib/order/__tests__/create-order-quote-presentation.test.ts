import Decimal from 'decimal.js';
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
  it.each([
    [751, '244.08', '0.00'],
    [1001, '325.33', '0.00'],
    [751, '254.08', '10.00'],
  ])('半分金额 %s × 0.325，小计 %s，固定费 %s', (quantity, amount, fixedFee) => {
    const input = createGoldenOrderInput([createGoldenOrderItem({ quantity })]);
    const original = calculateCreateOrderQuote(input, CREATE_ORDER_GOLDEN_SNAPSHOT);
    const quote = { ...original, items: [{ ...original.items[0]!, status: 'QUOTED' as const, unitPrice: '0.3250', amount }] };
    const presentation = presentCreateOrderQuote({ factsKey: 'half-cent', input, quote, logistics: quoteLogistics(input), quoteToken: 'token' });
    expect(presentation.items[0]).toMatchObject({ complete: true, suggestedUnitPrice: '0.3250', suggestedFixedFee: fixedFee, suggestedSubtotal: amount });
    expect(new Decimal(presentation.items[0]!.suggestedUnitPrice!).times(quantity).plus(presentation.items[0]!.suggestedFixedFee!).toFixed(2)).toBe(amount);
  });

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
      total: presentation.knownTotal,
      hasManualPricing: false,
      totalSemantics: 'COMPLETE',
      plateFee: null,
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
    expect(presentation).toMatchObject({
      plateFee: null,
      hasManualPricing: false,
      totalSemantics: 'COMPLETE',
    });
    expect(presentation.total).toBe(presentation.knownTotal);
  });

  it('彩印单色烫金展示含版费原子固定费，不再展示独立制版待核价', () => {
    const input = createGoldenOrderInput([
      createGoldenOrderItem({
        craft: 'PRINT',
        paperType: '铜版纸',
        paperWeightGsm: 200,
        specification: '大号封',
        frontColors: ['哑金'],
        backColors: [],
        printFoilMode: 'PARTIAL',
        quantity: 1_000,
      }),
    ]);
    const quote = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    const presentation = presentCreateOrderQuote({
      factsKey: 'facts-print-foil-bundle',
      input,
      quote,
      logistics: quoteLogistics(input),
      quoteToken: 'token-print-foil-bundle',
    });

    expect(presentation.items[0]).toMatchObject({
      complete: true,
      suggestedUnitPrice: '0.0000',
      suggestedFixedFee: '510.00',
      suggestedSubtotal: '510.00',
    });
    expect(presentation.items[0]?.components.map((line) => line.ruleCode)).toEqual(
      ['PRINT_PER_ORDER', 'PRINT_FOIL_PER_ORDER'],
    );
    expect(presentation).toMatchObject({
      plateFee: null,
      hasManualPricing: false,
      totalSemantics: 'COMPLETE',
    });
  });

  it('彩印烫金转人工时在展示快照中明确整款价含制版费', () => {
    const input = createGoldenOrderInput([
      createGoldenOrderItem({
        craft: 'PRINT',
        paperType: '铜版纸',
        paperWeightGsm: 200,
        specification: '大号封',
        frontColors: ['哑金'],
        backColors: [],
        printFoilMode: 'PARTIAL',
        printFinishing: 'TACTILE',
        quantity: 1_000,
      }),
    ]);
    const quote = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    const presentation = presentCreateOrderQuote({
      factsKey: 'facts-print-foil-manual',
      input,
      quote,
      logistics: quoteLogistics(input),
      quoteToken: 'token-print-foil-manual',
    });

    expect(presentation.items[0]).toMatchObject({
      complete: false,
      suggestedUnitPrice: null,
      suggestedFixedFee: null,
      suggestedSubtotal: null,
      errors: [
        '彩印触感膜、新光膜或雷射膜加价待定',
        '彩印烫金款的人工整款价必须包含制烫金版费，不再另收独立制版费',
      ],
    });
    expect(presentation.items[0]?.snapshot).toMatchObject({
      status: 'MANUAL_PRICING_REQUIRED',
      manualReasons: expect.arrayContaining([
        expect.objectContaining({
          code: 'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE',
        }),
      ]),
    });
    expect(presentation).toMatchObject({
      plateFee: null,
      hasManualPricing: true,
      totalSemantics: 'EXCLUDES_MANUAL_ITEMS',
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
