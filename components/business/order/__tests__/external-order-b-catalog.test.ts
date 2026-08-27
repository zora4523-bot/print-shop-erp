import { describe, expect, it } from 'vitest';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import {
  EXTERNAL_ORDER_PAPERS,
  externalOrderWeightsForSelection,
} from '../external-order-b-catalog';

describe('external order B catalog', () => {
  it('reserves 120g pearl flash for the mini stock envelope', () => {
    const pearlFlash = EXTERNAL_ORDER_PAPERS.find(
      (paper) => paper.key === 'PEARL_FLASH',
    );
    expect(pearlFlash).toBeDefined();

    expect(
      externalOrderWeightsForSelection(
        pearlFlash!,
        OrderItemPricingRoute.STOCK_BLANK,
        '迷你封50×80',
      ),
    ).toEqual([120]);
    expect(
      externalOrderWeightsForSelection(
        pearlFlash!,
        OrderItemPricingRoute.STOCK_BLANK,
        '大号封90×165',
      ),
    ).toEqual([160]);
    expect(
      externalOrderWeightsForSelection(
        pearlFlash!,
        OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        '大号封90×165',
      ),
    ).toEqual([160]);
  });
});
