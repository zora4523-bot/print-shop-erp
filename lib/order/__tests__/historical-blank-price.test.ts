import { describe, expect, it } from 'vitest';
import { buildBlankMaterialConfirmation, readConfirmedHistoricalBlankPrice, sameHistoricalBlankIdentity,
  type HistoricalBlankItem } from '../historical-blank-price';
import { calculateCreateOrderQuote, type CreateOrderPriceSnapshot } from '@/lib/price/create-order';
import { CREATE_ORDER_GOLDEN_SNAPSHOT, createGoldenOrderInput, createGoldenOrderItem } from '@/lib/price/__tests__/fixtures/create-order-golden-fixtures';
import { presentCreateOrderProcessingQuote } from '../create-order-quote-presentation';

function stored(rate = '0.1300'): HistoricalBlankItem {
  const input = createGoldenOrderInput([createGoldenOrderItem({ itemKey: 'item', quantity: 1000 })]);
  const snapshot: CreateOrderPriceSnapshot = structuredClone(CREATE_ORDER_GOLDEN_SNAPSHOT);
  snapshot.partial.blankUnitPrices = snapshot.partial.blankUnitPrices.map((price) => ({ ...price, unitPrice: rate }));
  const quote = calculateCreateOrderQuote(input, snapshot);
  const preview = presentCreateOrderProcessingQuote({ input, quote }).items[0]!;
  return { id: 'item', orderId: 'order', pricingRoute: 'STOCK_BLANK', paperType: input.items[0]!.paperType,
    paperWeightGsm: input.items[0]!.paperWeightGsm, specification: input.items[0]!.specification,
    quantity: 1000, unitPrice: preview.suggestedUnitPrice!, fixedFee: preview.suggestedFixedFee!,
    subtotal: preview.suggestedSubtotal!, pricingSnapshot: preview.snapshot };
}

describe('historical material price authority', () => {
  it('extracts only the independent confirmed material line, preserving historical zero', () => {
    expect(readConfirmedHistoricalBlankPrice(stored())).toMatchObject({ unitPrice: '0.1300', source: 'CONFIRMED_ITEM_MATERIAL_LINE' });
    expect(readConfirmedHistoricalBlankPrice(stored('0'))?.unitPrice).toBe('0.0000');
  });
  it('rejects whole-item overrides, stale quantity, corrupted line and changed identity', () => {
    expect(readConfirmedHistoricalBlankPrice({ ...stored(), subtotal: '10.00' })).toBeNull();
    expect(readConfirmedHistoricalBlankPrice({ ...stored(), quantity: 2000 })).toBeNull();
    expect(readConfirmedHistoricalBlankPrice({ ...stored(), paperWeightGsm: 230 })).toBeNull();
    const item = stored();
    const snapshot = item.pricingSnapshot as { lines: Array<{ code: string; amount: string }> };
    snapshot.lines.find((line) => line.code === 'PARTIAL_BLANK')!.amount = '0.01';
    expect(readConfirmedHistoricalBlankPrice(item)).toBeNull();
    expect(readConfirmedHistoricalBlankPrice({ ...stored(), pricingSnapshot: { source: 'ADMIN_SNAPSHOT_CONFIRMATION', actual: { subtotal: '500.00' } } })).toBeNull();
  });
  it('binds explicit material confirmation to the real order/item and identity', () => {
    const item = stored();
    const confirmation = buildBlankMaterialConfirmation({ item, unitPrice: '0.1234', reason: '已核对采购单', actorId: 'admin', previousPriceRevision: 2, now: new Date('2026-09-20T00:00:00Z') });
    const confirmed = { ...item, pricingSnapshot: { blankMaterialConfirmation: confirmation } };
    expect(readConfirmedHistoricalBlankPrice(confirmed)).toMatchObject({ unitPrice: '0.1234', actorId: 'admin' });
    expect(readConfirmedHistoricalBlankPrice({ ...confirmed, id: 'copy' })).toBeNull();
    expect(readConfirmedHistoricalBlankPrice({ ...confirmed, orderId: 'another-order' })).toBeNull();
    expect(readConfirmedHistoricalBlankPrice({ ...confirmed, specification: '中号封' })).toBeNull();
    expect(() => buildBlankMaterialConfirmation({ item, unitPrice: '0', reason: 'test', actorId: 'admin', previousPriceRevision: 2, now: new Date() })).toThrow();
  });
  it('requires exact dimensions as well as canonical paper/specification for historical exemption', () => {
    const item = stored();
    expect(sameHistoricalBlankIdentity(item, item)).toBe(true);
    expect(sameHistoricalBlankIdentity(item, { ...item, actualWidthMm: 1 })).toBe(false);
    expect(sameHistoricalBlankIdentity(item, { ...item, pricingRoute: 'PRINT_FINISHED' })).toBe(false);
  });
  it('current positive price wins; zero/missing use per-item confirmed prices and independent provenance', () => {
    const first = stored();
    const historical = readConfirmedHistoricalBlankPrice(first)!;
    const item = createGoldenOrderItem({ itemKey: 'item', quantity: 1000, historicalBlankPrice: { ...historical, unitPrice: '0.1234' } });
    const input = createGoldenOrderInput([item]);
    const current = calculateCreateOrderQuote(input, CREATE_ORDER_GOLDEN_SNAPSHOT);
    expect(current.items[0]!.lines.find((line) => line.code === 'PARTIAL_BLANK')?.amount).toBe('130.00');
    const unavailable: CreateOrderPriceSnapshot = structuredClone(CREATE_ORDER_GOLDEN_SNAPSHOT);
    unavailable.partial.blankUnitPrices = [];
    const fallback = calculateCreateOrderQuote(input, unavailable);
    expect(fallback.items[0]!.lines.find((line) => line.code === 'PARTIAL_BLANK')).toMatchObject({ amount: '123.40', basis: { historicalPriceSource: historical.source, sourceItemId: 'item' } });
    expect(fallback.items[0]!.lines.find((line) => line.code === 'PARTIAL_MACHINE')).toEqual(current.items[0]!.lines.find((line) => line.code === 'PARTIAL_MACHINE'));
    unavailable.partial.blankUnitPrices = CREATE_ORDER_GOLDEN_SNAPSHOT.partial.blankUnitPrices.map((price) => ({ ...price, unitPrice: '0' }));
    expect(calculateCreateOrderQuote(input, unavailable).items[0]!.lines.find((line) => line.code === 'PARTIAL_BLANK')?.amount).toBe('123.40');
  });
});
