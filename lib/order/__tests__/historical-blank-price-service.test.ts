import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { OrderFoilTechnique, OrderItemPricingRoute, OrderLamination, OrderProductStructure } from '@/generated/prisma/enums';
import type { CreateOrderPriceSnapshot } from '@/lib/price/create-order/types';
import { CREATE_ORDER_GOLDEN_SNAPSHOT } from '@/lib/price/__tests__/fixtures/create-order-golden-fixtures';
import { buildBlankMaterialConfirmation, type HistoricalBlankItem } from '../historical-blank-price';

const mocks = vi.hoisted(() => ({ prices: vi.fn(), products: vi.fn(), crafts: vi.fn(), materials: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/order/create-order-published-rule-adapter', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/order/create-order-published-rule-adapter')>(),
  readPublishedCreateOrderPriceSnapshot: mocks.prices,
}));
import { calculateCreateOrderQuoteFromCatalogInTx } from '../create-order-quote-service';
const tx = { product: { findMany: mocks.products }, craft: { findMany: mocks.crafts }, material: { findMany: mocks.materials } } as unknown as Prisma.TransactionClient;
const now = new Date('2026-09-20T00:00:00Z');
const original = { itemKey: 'original', fig: 1, productId: null, pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
  productStructure: OrderProductStructure.STANDARD_ENVELOPE, pricingGroup: 'LARGE', specification: '大号封90×165',
  actualWidthMm: 90, actualHeightMm: 165, paperType: '160g珠光艳闪', paperWeightGsm: 160,
  quantity: 2000, crafts: ['partial'], foilColors: ['哑金'], frontFoilColors: ['哑金'], backFoilColors: [],
  foilTechnique: OrderFoilTechnique.FLAT, hasLocalFoil: true, lamination: OrderLamination.NONE };
const facts = { items: [original], packagingGroups: [], isSfCollect: true, shipments: [{ shipmentKey: 'primary', province: '广东', itemQuantities: { original: 2000 } }] };
async function confirmedItem(): Promise<HistoricalBlankItem> {
  const quote = await calculateCreateOrderQuoteFromCatalogInTx(tx, { now, facts, includeOrderCharges: false });
  const item = quote.processing.items[0]!;
  return { ...original, id: original.itemKey, orderId: 'order', unitPrice: item.suggestedUnitPrice!,
    fixedFee: item.suggestedFixedFee!, subtotal: item.suggestedSubtotal!, pricingSnapshot: item.snapshot };
}
function stopSelling() {
  const snapshot: CreateOrderPriceSnapshot = structuredClone(CREATE_ORDER_GOLDEN_SNAPSHOT);
  snapshot.partial.blankUnitPrices = [];
  mocks.prices.mockResolvedValue(snapshot);
  mocks.materials.mockResolvedValue([{ id: 'paper', name: '160g珠光艳闪', specification: '160g', isActive: false, outOfStock: true }]);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prices.mockResolvedValue(CREATE_ORDER_GOLDEN_SNAPSHOT);
  mocks.products.mockResolvedValue([]);
  mocks.crafts.mockResolvedValue([{ id: 'partial', code: 'FLAT_FOIL_PARTIAL', isActive: true }]);
  mocks.materials.mockResolvedValue([{ id: 'paper', name: '160g珠光艳闪', specification: '160g', isActive: true, outOfStock: false }]);
});

describe('historical material price through actual transactional quote service', () => {
  it('recalculates original quantity using verified material line after sale and paper availability stop', async () => {
    const stored = await confirmedItem();
    stopSelling();
    const result = await calculateCreateOrderQuoteFromCatalogInTx(tx, { now,
      facts: { ...facts, items: [{ ...original, quantity: 1000 }], shipments: [{ shipmentKey: 'primary', province: '广东', itemQuantities: { original: 1000 } }] }, includeOrderCharges: false, historicalBlankItems: [stored] });
    expect(result.processing.items[0]).toMatchObject({ complete: true, suggestedUnitPrice: '0.1300', suggestedSubtotal: '170.00' });
    expect(result.quote.items[0]!.lines.find((line) => line.code === 'PARTIAL_BLANK')).toMatchObject({ amount: '130.00', basis: { historicalPriceSource: 'CONFIRMED_ITEM_MATERIAL_LINE' } });
  });
  it('blocks copied/new keys and changed identity even when the caller supplies a template history', async () => {
    const stored = await confirmedItem();
    stopSelling();
    await expect(calculateCreateOrderQuoteFromCatalogInTx(tx, { now, facts: { ...facts, items: [{ ...original, itemKey: 'copy' }] },
      includeOrderCharges: false, historicalBlankItems: [stored] })).rejects.toThrow('未启用');
    await expect(calculateCreateOrderQuoteFromCatalogInTx(tx, { now, facts: { ...facts, items: [{ ...original, specification: '中号封80×115', actualWidthMm: 80, actualHeightMm: 115 }] },
      includeOrderCharges: false, historicalBlankItems: [stored] })).rejects.toThrow('未启用');
  });
  it('requires material evidence instead of dividing aggregate override; explicit admin material evidence completes recalculation', async () => {
    const stored = { ...await confirmedItem(), pricingSnapshot: { source: 'ADMIN_SNAPSHOT_CONFIRMATION', actual: { subtotal: '500' } } };
    stopSelling();
    await expect(calculateCreateOrderQuoteFromCatalogInTx(tx, { now, facts, includeOrderCharges: false, historicalBlankItems: [stored] })).rejects.toThrow('历史材料单价中补核价');
    const confirmation = buildBlankMaterialConfirmation({ item: stored, unitPrice: '0.1234', reason: '已核对材料', actorId: 'admin', previousPriceRevision: 2, now });
    const result = await calculateCreateOrderQuoteFromCatalogInTx(tx, { now, facts, includeOrderCharges: false,
      historicalBlankItems: [{ ...stored, pricingSnapshot: { blankMaterialConfirmation: confirmation } }] });
    expect(result.quote.items[0]!.lines.find((line) => line.code === 'PARTIAL_BLANK')).toMatchObject({ amount: '246.80', basis: { actorId: 'admin', historicalPriceSource: 'ADMIN_MATERIAL_CONFIRMATION' } });
  });
  it('keeps different confirmed material rates for two original items with the same paper and specification', async () => {
    const first = await confirmedItem();
    const second = { ...first, id: 'second' };
    second.pricingSnapshot = { blankMaterialConfirmation: buildBlankMaterialConfirmation({ item: second, unitPrice: '0.15', reason: '合同价', actorId: 'admin', previousPriceRevision: 2, now }) };
    stopSelling();
    const result = await calculateCreateOrderQuoteFromCatalogInTx(tx, { now,
      facts: { ...facts, items: [original, { ...original, itemKey: 'second', fig: 2 }], shipments: [{ shipmentKey: 'primary', province: '广东', itemQuantities: { original: 2000, second: 2000 } }] },
      includeOrderCharges: false, historicalBlankItems: [first, second] });
    expect(result.quote.items.map((item) => item.lines.find((line) => line.code === 'PARTIAL_BLANK')?.amount)).toEqual(['260.00', '300.00']);
  });
});
