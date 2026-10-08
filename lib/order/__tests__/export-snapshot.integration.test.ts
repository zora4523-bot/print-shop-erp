import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ afterOrderRead: null as null | (() => Promise<void>) }));
vi.mock('@/lib/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { db: actual.db.$extends({ query: { order: { async findMany({ args, query }) {
    const result = await query(args);
    if (args.select?.totalAmount && hooks.afterOrderRead) {
      const hook = hooks.afterOrderRead;
      hooks.afterOrderRead = null;
      await hook();
    }
    return result;
  } } } }) };
});

// This test writes immutable audit facts. Run only against an explicitly named disposable copy.
const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = database && ['localhost', '127.0.0.1'].includes(database.hostname)
  && database.pathname.slice(1).startsWith('first_use_ui_test_')
  && process.env.E2E_DATABASE_CONFIRM_DATABASE === database.pathname.slice(1);

describe.skipIf(!isolated)('real PostgreSQL + XLSX export snapshot', () => {
  it('keeps a complete 15-sheet workbook on one snapshot during a concurrent price update', async () => {
    const { db } = await import('@/lib/db');
    const { requestOrderExport, processQueuedOrderExport } = await import('../export');
    const { orderExportArtifactPath, deleteOrderExportArtifact } = await import('../export-artifact');
    const actor = await db.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true }, select: { id: true, role: true, username: true, displayName: true } });
    const { calculateCreateOrderQuote } = await import('@/lib/price/create-order');
    const { calculateExternalOrderCharges } = await import('@/lib/price/external-order-charges');
    const { CREATE_ORDER_GOLDEN_SNAPSHOT: golden, createGoldenOrderItem, createGoldenOrderInput } = await import('@/lib/price/__tests__/fixtures/create-order-golden-fixtures');
    const { presentCreateOrderQuote } = await import('../create-order-quote-presentation');
    const input = createGoldenOrderInput([createGoldenOrderItem({ craft: 'FULL', paperType: '触感纸', paperWeightGsm: 200, quantity: 1010 })], { isSfCollect: true, packagingGroups: [] });
    const snapshot = { ...golden, full: { ...golden.full,
      unitPrices: golden.full.unitPrices.map(rule => ({ ...rule, unitPrice: '0.1004' })),
      paperSurcharges: golden.full.paperSurcharges.map(rule => ({ ...rule, unitSurcharge: '0.0204' })),
    } };
    const quote = calculateCreateOrderQuote(input, snapshot);
    const logistics = calculateExternalOrderCharges({ isSfCollect: true, shipments: [] }, golden.orderCharges.rules, golden.orderCharges.logisticsPolicy);
    const preview = presentCreateOrderQuote({ factsKey: 'integration', input, quote, logistics, quoteToken: 'test-only' }).items[0]!;
    expect(preview.suggestedSubtotal).toBe('122.00');
    expect(preview.suggestedUnitPrice).toBe('0.1207');
    expect(preview.suggestedFixedFee).toBe('0.09');
    const key = `snapshot-${randomUUID()}`;
    const order = await db.order.create({ data: {
      orderNo: key, submitterId: actor.id, createdById: actor.id, submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES',
      totalAmount: '122.00', processingAmount: '122.00',
      items: { create: { sequence: 1, name: 'snapshot fixture', pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL', productStructure: 'STANDARD_ENVELOPE', quantity: 1010, foilTechnique: 'FLAT', crafts: [], unitPrice: preview.suggestedUnitPrice!, fixedFee: preview.suggestedFixedFee!, subtotal: preview.suggestedSubtotal! } },
    } });
    const persisted = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(persisted.unitPrice.times(1010).toDecimalPlaces(2).plus(persisted.fixedFee).toFixed(2)).toBe(preview.suggestedSubtotal);
    expect(persisted.subtotal.toFixed(2)).toBe(preview.suggestedSubtotal);
    const request = await requestOrderExport({ actor, requestKey: randomUUID(), scope: 'selected', params: {}, selectedOrderIds: [order.id], durable: false });
    hooks.afterOrderRead = async () => {
      await db.$transaction(async tx => {
        await tx.order.update({ where: { id: order.id }, data: { totalAmount: '222.00', processingAmount: '222.00' } });
        await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { subtotal: '222.00', fixedFee: '100.09' } });
      });
    };
    const start = performance.now();
    try {
      await processQueuedOrderExport(request.id);
      expect(hooks.afterOrderRead, 'concurrent write must actually run between sheets').toBeNull();
      const exported = await db.orderExport.findUniqueOrThrow({ where: { id: request.id } });
      expect(exported.status).toBe('READY');
      const artifact = orderExportArtifactPath(exported.artifactName!);
      const xml = (sheet: number) => execFileSync('unzip', ['-p', artifact, `xl/worksheets/sheet${sheet}.xml`], { encoding: 'utf8' });
      expect(xml(1)).toMatch(/<c r="S2"[^>]*><v>122\.00<\/v>/);
      const itemsXml = xml(2);
      expect(itemsXml).toMatch(/<c r="P1"[^>]*>.*?成交单价<\/t>/);
      expect(itemsXml).toMatch(/<c r="Q1"[^>]*>.*?一次性费用<\/t>/);
      expect(itemsXml).toMatch(/<c r="R1"[^>]*>.*?成交小计<\/t>/);
      expect(itemsXml).toMatch(/<c r="P2"[^>]*><v>0\.1207<\/v>/);
      expect(itemsXml).toMatch(/<c r="Q2"[^>]*><v>0\.09<\/v>/);
      expect(itemsXml).toMatch(/<c r="R2"[^>]*><v>122\.00<\/v>/);
      expect(Object.keys(exported.rowCounts as object)).toHaveLength(15);
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).totalAmount.toFixed(2)).toBe('222.00');
      appendFileSync(join(tmpdir(), 'first-use-export-measurements.jsonl'), JSON.stringify({ case: 'concurrent-export', sheets: 15, orders: 1, elapsedMs: Math.round(performance.now() - start) }) + '\n');
      await deleteOrderExportArtifact(exported.artifactName!);
    } finally { hooks.afterOrderRead = null; }
  }, 60_000);
  it('measures a 5000-order selected export at the supported selection limit', async () => {
    const { db } = await import('@/lib/db');
    const { requestOrderExport, processQueuedOrderExport } = await import('../export');
    const { deleteOrderExportArtifact } = await import('../export-artifact');
    const actor = await db.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true }, select: { id: true, role: true, username: true, displayName: true } });
    const prefix = `capacity-${randomUUID()}`;
    const ids = Array.from({ length: 5000 }, (_, index) => `${prefix}-${index}`);
    await db.order.createMany({ data: ids.map(id => ({ id, orderNo: id, submitterId: actor.id, createdById: actor.id, submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES', totalAmount: '122.00', processingAmount: '122.00' })) });
    await db.orderItem.createMany({ data: ids.map(orderId => ({ orderId, sequence: 1, name: 'capacity fixture', pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL', productStructure: 'STANDARD_ENVELOPE', quantity: 1010, foilTechnique: 'FLAT', crafts: [], unitPrice: '0.1207', fixedFee: '0.09', subtotal: '122.00' })) });
    const request = await requestOrderExport({ actor, requestKey: randomUUID(), scope: 'selected', params: {}, selectedOrderIds: ids, durable: false });
    const start = performance.now();
    await processQueuedOrderExport(request.id);
    const elapsedMs = Math.round(performance.now() - start);
    const result = await db.orderExport.findUniqueOrThrow({ where: { id: request.id } });
    expect(result.status).toBe('READY');
    expect(result.matchedOrderCount).toBe(5000);
    expect(result.rowCounts).toMatchObject({ '工单': 5000, '款式': 5000 });
    expect(Object.keys(result.rowCounts as object)).toHaveLength(15);
    appendFileSync(join(tmpdir(), 'first-use-export-measurements.jsonl'), JSON.stringify({ case: 'selected-limit', sheets: 15, orders: 5000, items: 5000, elapsedMs, byteSize: result.byteSize?.toString() }) + '\n');
    await deleteOrderExportArtifact(result.artifactName!);
  }, 120_000);

});
