import { describe, expect, it, vi } from 'vitest';
import {
  OrderItemPricingRoute,
  OrderLamination,
} from '@/generated/prisma/enums';
import {
  createExternalOrderItem,
  normalizeExternalOrderItem,
} from '@/lib/order/order-item-configuration';
import { orderItemSelectionUpdate } from '@/lib/order/order-item-selection';
import { workbenchItemQuoteSchema } from '../item-quote';
import {
  readWorkbenchTransfer,
  saveWorkbenchTransfer,
  workbenchTransferKey,
} from '../order-transfer';
import {
  WORKBENCH_CATALOG as catalog,
  WORKBENCH_CRAFTS as crafts,
} from './item-fixtures';
function initial() {
  return createExternalOrderItem(
    crafts,
    catalog.products,
    catalog.papers,
    '亚金',
  );
}
function store() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
describe('shared order configuration', () => {
  it('uses the same paper, weight and product identity and never prices an unavailable linked paper', () => {
    expect(initial()).toMatchObject({
      productId: 'stock',
      paperWeightGsm: 160,
    });
    const unavailable = catalog.papers.map((p) => ({ ...p, outOfStock: true }));
    expect(
      createExternalOrderItem(crafts, catalog.products, unavailable, '亚金')
        .productId,
    ).toBeNull();
  });
  it('preserves lamination and distinguishes partial from full printed foil', () => {
    const route = orderItemSelectionUpdate(
      initial(),
      { type: 'route', value: OrderItemPricingRoute.COLOR_PRINT },
      catalog.products,
      catalog,
    )!;
    const printed = normalizeExternalOrderItem({
      ...route.options,
      item: route.item,
      crafts,
      products: catalog.products,
      paperMaterials: catalog.papers,
    });
    expect(printed.lamination).toBe(OrderLamination.MATTE);
    for (const value of ['PARTIAL', 'FULL'] as const) {
      const next = orderItemSelectionUpdate(
        printed,
        { type: 'printFoil', value },
        catalog.products,
        catalog,
      )!;
      const parsed = workbenchItemQuoteSchema.parse({
        item: normalizeExternalOrderItem({
          ...next.options,
          item: next.item,
          crafts,
          products: catalog.products,
          paperMaterials: catalog.papers,
        }),
      });
      expect(parsed.item.hasLocalFoil).toBe(value === 'PARTIAL');
      expect(parsed.item.lamination).toBe(OrderLamination.MATTE);
    }
  });
  it('never chooses an arbitrary duplicate product; preserves an explicit choice', () => {
    const products = [
      ...catalog.products,
      { ...catalog.products[0]!, id: 'duplicate' },
    ];
    const duplicated = createExternalOrderItem(
      crafts,
      products,
      catalog.papers,
      '亚金',
    );
    expect(duplicated.productId).toBeNull();
    expect(
      normalizeExternalOrderItem({
        item: { ...duplicated, productId: 'duplicate' },
        crafts,
        products,
        paperMaterials: catalog.papers,
      }).productId,
    ).toBe('duplicate');
  });
  it.each([0, 1.5, -1, 10000000])(
    'rejects invalid quantity %s with the order schema',
    (quantity) => {
      expect(
        workbenchItemQuoteSchema.safeParse({ item: { ...initial(), quantity } })
          .success,
      ).toBe(false);
    },
  );
  it('rejects manual overrides and excludes every price from the request', () => {
    expect(
      workbenchItemQuoteSchema.safeParse({
        item: { ...initial(), manualQuoteReason: '绕过目录' },
      }).success,
    ).toBe(false);
    const parsed = workbenchItemQuoteSchema.parse({
      item: { ...initial(), unitPrice: '1', suggestedSubtotal: '1' },
      markup: 100,
      quoteToken: 'fake',
    });
    expect(parsed.item).not.toHaveProperty('unitPrice');
    expect(parsed.item).not.toHaveProperty('suggestedSubtotal');
    expect(parsed).not.toHaveProperty('quoteToken');
  });
});
describe('order transfer', () => {
  it('isolates each account and transfer, retaining only validated facts', () => {
    const storage = store();
    const input = workbenchItemQuoteSchema.parse({ item: initial() });
    const id = saveWorkbenchTransfer(storage, 'sales-1', input);
    expect(readWorkbenchTransfer(storage, 'sales-1', id)).toEqual(input);
    expect(readWorkbenchTransfer(storage, 'sales-2', id)).toBeNull();
    expect(readWorkbenchTransfer(storage, 'sales-1', '../bad')).toBeNull();
    storage.setItem(workbenchTransferKey('sales-1', id), 'invalid json');
    expect(readWorkbenchTransfer(storage, 'sales-1', id)).toBeNull();
  });
  it('expires old conditions and accepts no malformed facts', () => {
    const storage = store();
    const id = saveWorkbenchTransfer(
      storage,
      's',
      workbenchItemQuoteSchema.parse({ item: initial() }),
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000);
    expect(readWorkbenchTransfer(storage, 's', id)).toBeNull();
    vi.restoreAllMocks();
    storage.setItem(
      workbenchTransferKey('s', id),
      JSON.stringify({ item: { quantity: -1 }, expiresAt: Date.now() + 10000 }),
    );
    expect(readWorkbenchTransfer(storage, 's', id)).toBeNull();
  });
});
