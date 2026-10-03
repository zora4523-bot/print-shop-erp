import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { Prisma } from '@/generated/prisma/client';
import { OrderStatus, OrderPricingStatus, OrderSettlementType } from '@/generated/prisma/enums';
const { append } = vi.hoisted(() => ({ append: vi.fn() }));
vi.mock('../pricing-revision', () => ({ appendOrderPricingRevisionInTx: append }));
import { inspectOrderProductionReadinessInTx, prepareOrderForProductionInTx } from '../production-readiness';
const amount = (value: string) => new Decimal(value);
const now = new Date('2026-09-08T02:00:00Z');
function fixture() {
  return {
    id: 'order-1', status: OrderStatus.PENDING_FACTORY as OrderStatus, revision: 2, workOrderVersion: 1, priceRevision: 3,
    pricingStatus: OrderPricingStatus.AUTO_CONFIRMED as OrderPricingStatus, settlementType: OrderSettlementType.EXTERNAL_SALES,
    processingAmount: amount('12.30'), packagingAmount: amount('2.20'), totalAmount: amount('15.60'),
    quotedFee: amount('15.60'), confirmedFee: null, settledAt: null as Date | null, settledFee: null as Decimal | null,
    receiverAddress: '广东省广州市测试路', receiverPhone: '13800000000',
    items: [{ id: 'item-1', sequence: 1, craft: 'PARTIAL', crafts: [] as string[], hasLocalFoil: true, frontFoilColors: ['亚金'], backFoilColors: [], quantity: 100, subtotal: amount('10.10'), pricingSnapshot: {}, quoteDisposition: 'AUTO', manualQuoteReason: null }],
    packagingGroups: [{ id: 'pack-1', sequence: 1, actualBagCount: 10, lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }], subtotal: amount('2.20'), pricingSnapshot: {} }],
    customerCharges: [{ amount: amount('3.30'), status: 'ESTIMATED', pricingSnapshot: {} }],
    _count: { changeRequests: 0 },
  };
}
function client(order = fixture()) {
  const tx = {
    $executeRaw: vi.fn(),
    order: { findUniqueOrThrow: vi.fn().mockResolvedValue(order), findMany: vi.fn().mockResolvedValue([order]), update: vi.fn() },
    orderLog: { create: vi.fn() },
    craft: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { tx, call: () => prepareOrderForProductionInTx(tx as unknown as Prisma.TransactionClient, order.id, { id: 'actor-1' }, now) };
}
beforeEach(() => vi.clearAllMocks());
describe('automatic preparation for production', () => {
  it('accepts saved Decimal totals, preserves quote and creates no production/print side effects', async () => {
    const { tx, call } = client();
    await expect(call()).resolves.toEqual({ ready: true, status: OrderStatus.CONFIRMED, issues: [] });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'order-1' }, data: { status: OrderStatus.CONFIRMED, confirmedFee: '15.60' } });
    expect(append).toHaveBeenCalledWith(tx, expect.objectContaining({ source: 'ORDER_READY_FOR_PRODUCTION', expectedPriceRevision: 3, incrementOrderRevision: true,
      orderFeeSnapshot: { quotedFee: amount('15.60'), confirmedFee: '15.60', settledFee: null } }));
    expect(tx.orderLog.create).toHaveBeenCalledOnce();
  });
  it.each([
    ['pending request', (o: ReturnType<typeof fixture>) => { o._count.changeRequests = 1; }],
    ['manual pricing', (o: ReturnType<typeof fixture>) => { o.pricingStatus = OrderPricingStatus.PENDING_ADMIN_CONFIRMATION; }],
    ['legacy evidence', (o: ReturnType<typeof fixture>) => { o.pricingStatus = OrderPricingStatus.LEGACY_CONFIRMED; }],
    ['missing address', (o: ReturnType<typeof fixture>) => { o.receiverAddress = ''; }],
    ['missing phone', (o: ReturnType<typeof fixture>) => { o.receiverPhone = ''; }],
    ['total mismatch', (o: ReturnType<typeof fixture>) => { o.totalAmount = amount('999'); }],
    ['processing mismatch', (o: ReturnType<typeof fixture>) => { o.processingAmount = amount('13'); }],
    ['packaging mismatch', (o: ReturnType<typeof fixture>) => { o.packagingAmount = amount('3'); }],
    ['manual charge', (o: ReturnType<typeof fixture>) => { o.customerCharges[0].status = 'PENDING_AMOUNT'; }],
    ['missing packaging', (o: ReturnType<typeof fixture>) => { o.packagingGroups = []; }],
    ['missing craft dictionary', (o: ReturnType<typeof fixture>) => { o.items[0].crafts = ['missing']; }],
    ['missing items', (o: ReturnType<typeof fixture>) => { o.items = []; }],
  ])('keeps %s pending without accepting partial prices', async (_, change) => {
    const order = fixture(); change(order);
    const { tx, call } = client(order);
    const result = await call();
    expect(result.ready).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
  it('is idempotent once ready', async () => {
    const order = { ...fixture(), status: OrderStatus.CONFIRMED };
    const { tx, call } = client(order);
    expect((await call()).ready).toBe(true);
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
  it.each([OrderStatus.DRAFT, OrderStatus.REJECTED, OrderStatus.ON_HOLD, OrderStatus.RELEASED, OrderStatus.SHIPPED, OrderStatus.SETTLED])('does not advance %s as a side effect', async (status) => {
    const { tx, call } = client({ ...fixture(), status });
    expect((await call()).status).toBe(status);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});

describe('readiness inspection and financial boundaries', () => {
  it('inspects a complete order without locks, status writes or pricing history writes', async () => {
    const order = fixture();
    const { tx } = client(order);
    const result = await inspectOrderProductionReadinessInTx(
      tx as unknown as Prisma.TransactionClient,
      order.id,
    );
    expect(result).toMatchObject({ ready: true, status: OrderStatus.PENDING_FACTORY, issues: [] });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderLog.create).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('rechecks pending amendments when preparing after an earlier successful inspection', async () => {
    const order = fixture();
    const { tx, call } = client(order);
    const preview = await inspectOrderProductionReadinessInTx(
      tx as unknown as Prisma.TransactionClient,
      order.id,
    );
    expect(preview.ready).toBe(true);
    tx.order.findUniqueOrThrow.mockResolvedValueOnce({ ...order, _count: { changeRequests: 1 } });
    await expect(call()).resolves.toMatchObject({ ready: false, issues: ['存在待裁决变更申请'] });
    expect(tx.order.findUniqueOrThrow).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it.each([
    { settledAt: now, settledFee: null },
    { settledAt: null, settledFee: amount('15.60') },
    { settledAt: null, settledFee: amount('0.00') },
  ])('rejects settlement evidence even when the legacy status is pending: %j', async (settlement) => {
    const { tx, call } = client({ ...fixture(), ...settlement });
    const result = await call();
    expect(result.ready).toBe(false);
    expect(result.issues).toContain('已结算工单不能重新安排生产');
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderLog.create).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
});
