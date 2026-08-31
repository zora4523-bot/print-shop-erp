import { describe, expect, it } from 'vitest';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import {
  NEW_ORDER_PRICING_ROUTES,
  ORDER_PRICING_ROUTE_LABELS,
  canonicalizePricingCraftCodes,
  isNewOrderPricingRoute,
  normalizeFoilFactsForPricingRoute,
  normalizeCraftIdsForPricingRoute,
  productCategoryMatchesPricingRoute,
  requiredPricingCraftGroups,
} from '../pricing-route';

describe('new-order pricing routes', () => {
  it('exposes exactly the three business routes while retaining the legacy enum', () => {
    expect(NEW_ORDER_PRICING_ROUTES).toEqual([
      OrderItemPricingRoute.STOCK_BLANK,
      OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      OrderItemPricingRoute.COLOR_PRINT,
    ]);
    expect(NEW_ORDER_PRICING_ROUTES).not.toContain(
      OrderItemPricingRoute.MANUAL_QUOTE,
    );
    expect(isNewOrderPricingRoute(OrderItemPricingRoute.MANUAL_QUOTE)).toBe(
      false,
    );
  });

  it('uses business-facing labels without leaking legacy implementation names', () => {
    expect(ORDER_PRICING_ROUTE_LABELS).toMatchObject({
      STOCK_BLANK: '局部烫金（通版现货）',
      CUSTOM_SINGLE_FLAT_FOIL: '专版烫金',
      COLOR_PRINT: '彩印',
    });
    expect(ORDER_PRICING_ROUTE_LABELS.MANUAL_QUOTE).not.toContain('完全人工报价');
  });

  it('normalizes the retired stock-foil code to canonical local foil and de-duplicates it', () => {
    expect(
      canonicalizePricingCraftCodes([
        'STOCK_FOIL',
        'FLAT_FOIL_PARTIAL',
        'PACKING',
      ]),
    ).toEqual(['FLAT_FOIL_PARTIAL', 'PACKING']);
  });

  it('locks a stock route onto the canonical craft id and removes the retired id', () => {
    const crafts = [
      { id: 'canonical', code: 'FLAT_FOIL_PARTIAL', name: '局部烫金' },
      { id: 'legacy', code: 'STOCK_FOIL', name: '现货加烫' },
      { id: 'packing', code: 'PACKING', name: '打包' },
    ];

    expect(
      normalizeCraftIdsForPricingRoute(
        OrderItemPricingRoute.STOCK_BLANK,
        ['legacy', 'packing'],
        crafts,
      ),
    ).toEqual(['canonical', 'packing']);
  });

  it('drops the stock-only craft when switching to another route', () => {
    const crafts = [
      { id: 'canonical', code: 'FLAT_FOIL_PARTIAL', name: '局部烫金' },
      { id: 'legacy', code: 'STOCK_FOIL', name: '现货加烫' },
      { id: 'packing', code: 'PACKING', name: '打包' },
    ];

    expect(
      normalizeCraftIdsForPricingRoute(
        OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        ['canonical', 'legacy', 'packing'],
        crafts,
      ),
    ).toEqual(['packing']);
  });

  it('keeps quote SKUs inside their selected route', () => {
    expect(productCategoryMatchesPricingRoute('STOCK_BLANK', 'BLANK_STOCK')).toBe(true);
    expect(productCategoryMatchesPricingRoute('STOCK_BLANK', 'GENERIC_STOCK')).toBe(true);
    expect(productCategoryMatchesPricingRoute('STOCK_BLANK', 'STOCK_FOIL_ADD')).toBe(false);
    expect(
      productCategoryMatchesPricingRoute('STOCK_BLANK', 'STOCK_FOIL_ADD', {
        allowLegacyStockFoilAdd: true,
      }),
    ).toBe(true);
    expect(
      productCategoryMatchesPricingRoute(
        'CUSTOM_SINGLE_FLAT_FOIL',
        'CUSTOM_FLAT_FOIL',
      ),
    ).toBe(true);
    expect(productCategoryMatchesPricingRoute('COLOR_PRINT', 'COLOR_PRINT')).toBe(true);
    expect(productCategoryMatchesPricingRoute('COLOR_PRINT', 'BLANK_STOCK')).toBe(false);
  });

  it('keeps pure color print free of an inherited flat-foil default', () => {
    expect(
      normalizeFoilFactsForPricingRoute({
        route: OrderItemPricingRoute.COLOR_PRINT,
        foilColors: [],
        foilTechnique: 'FLAT',
        hasLocalFoil: true,
      }),
    ).toEqual({ foilTechnique: 'NONE', hasLocalFoil: false });

    expect(
      normalizeFoilFactsForPricingRoute({
        route: OrderItemPricingRoute.COLOR_PRINT,
        foilColors: ['哑金'],
        foilTechnique: 'RELIEF',
        hasLocalFoil: true,
      }),
    ).toEqual({ foilTechnique: 'RELIEF', hasLocalFoil: true });
  });

  it('derives production-task requirements from route and pricing facts', () => {
    expect(
      requiredPricingCraftGroups({
        route: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        foilColors: ['哑金', '红金'],
        foilTechnique: 'FLAT',
      }),
    ).toEqual([
      { label: '专版双色平烫', anyOfCodes: ['FLAT_FOIL_DOUBLE'] },
    ]);
    expect(
      requiredPricingCraftGroups({
        route: OrderItemPricingRoute.COLOR_PRINT,
        foilColors: [],
        foilTechnique: 'NONE',
      }),
    ).toEqual([
      {
        label: '彩印',
        anyOfCodes: ['COATED_COLOR_PRINT', 'COLOR_PRINT'],
      },
    ]);
    expect(
      requiredPricingCraftGroups({
        route: OrderItemPricingRoute.COLOR_PRINT,
        foilColors: ['哑金'],
        foilTechnique: 'RELIEF',
      }),
    ).toEqual([
      {
        label: '彩印+烫金',
        anyOfCodes: ['COATED_COLOR_PRINT_FOIL', 'COLOR_PRINT_FOIL'],
      },
      { label: '浮雕', anyOfCodes: ['EMBOSS'] },
    ]);
  });
});
