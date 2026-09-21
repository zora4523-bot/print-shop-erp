import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const mocks = vi.hoisted(() => {
  const tx = { $executeRaw: vi.fn(), order: { findUnique: vi.fn(), update: vi.fn() },
    orderItem: { update: vi.fn() }, orderLog: { create: vi.fn() } };
  return { tx, db: { ...tx, $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)) }, revision: vi.fn() };
});
vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/lib/order/pricing-revision', () => ({ appendOrderPricingRevisionInTx: mocks.revision }));
import { confirmHistoricalBlankPrice } from '../confirm-historical-blank-price';

const command = { orderId: 'order', itemId: 'item', expectedOrderRevision: 3, expectedPriceRevision: 2,
  unitPrice: '0.1234', reason: '采购单核实' };
const admin = { id: 'admin', role: Role.ADMIN };
const item = { id: 'item', orderId: 'order', pricingRoute: 'STOCK_BLANK', paperType: '红卡',
  paperWeightGsm: 180, specification: '中号封80×115', quantity: 1000,
  unitPrice: '0.5', fixedFee: '20', subtotal: '520', pricingSnapshot: null };
function order(overrides: Record<string, unknown> = {}) {
  return { id: 'order', status: 'FOILING', revision: 3, priceRevision: 2,
    pricingStatus: 'AUTO_CONFIRMED', pricingConfirmedAt: new Date('2026-09-10T00:00:00Z'),
    pricingConfirmedById: null, items: [item], ...overrides };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.order.findUnique.mockResolvedValue(order());
  mocks.revision.mockResolvedValue({ priceRevision: 3, orderRevision: 3 });
});

describe('explicit historical material confirmation', () => {
  it('records independent material evidence and a price revision without changing current money/order revision', async () => {
    await expect(confirmHistoricalBlankPrice(command, admin)).resolves.toEqual({ orderId: 'order', priceRevision: 3 });
    expect(mocks.tx.$executeRaw).toHaveBeenCalledOnce();
    const data = mocks.tx.orderItem.update.mock.calls[0]![0].data;
    expect(Object.keys(data)).toEqual(['pricingSnapshot']);
    expect(data.pricingSnapshot.blankMaterialConfirmation).toMatchObject({ unitPrice: '0.1234', itemId: 'item', orderId: 'order', actorId: 'admin', reason: command.reason });
    expect(mocks.revision).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ expectedPriceRevision: 2, incrementOrderRevision: false, status: 'AUTO_CONFIRMED' }));
    expect(mocks.tx.order.update).toHaveBeenCalledWith({ where: { id: 'order' }, data: { pricingConfirmedAt: order().pricingConfirmedAt, pricingConfirmedById: null } });
    expect(mocks.tx.orderLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'BLANK_MATERIAL_PRICE_CONFIRMED' }) }));
  });
  it('allows changing previously confirmed material price using the next price version', async () => {
    mocks.tx.order.findUnique.mockResolvedValue(order({ priceRevision: 3,
      items: [{ ...item, pricingSnapshot: { blankMaterialConfirmation: { unitPrice: '0.1234' } } }] }));
    await expect(confirmHistoricalBlankPrice({ ...command, expectedPriceRevision: 3, unitPrice: '0.15' }, admin)).resolves.toBeDefined();
    expect(mocks.tx.orderItem.update.mock.calls[0]![0].data.pricingSnapshot.blankMaterialConfirmation.unitPrice).toBe('0.1500');
  });
  it.each([
    { label: 'sales', actor: { id: 'sales', role: Role.SALES }, patch: {}, input: {} },
    { label: 'stale price', actor: admin, patch: { priceRevision: 3 }, input: {} },
    { label: 'stale facts', actor: admin, patch: { revision: 4 }, input: {} },
    { label: 'settled', actor: admin, patch: { status: 'SETTLED' }, input: {} },
    { label: 'draft', actor: admin, patch: { status: 'DRAFT' }, input: {} },
    { label: 'wrong owner', actor: admin, patch: { items: [] }, input: {} },
    { label: 'different route', actor: admin, patch: { items: [{ ...item, pricingRoute: 'PRINT_FINISHED' }] }, input: {} },
    { label: 'zero', actor: admin, patch: {}, input: { unitPrice: '0' } },
    { label: 'too precise', actor: admin, patch: {}, input: { unitPrice: '0.12345' } },
    { label: 'negative', actor: admin, patch: {}, input: { unitPrice: '-0.1' } },
    { label: 'no reason', actor: admin, patch: {}, input: { reason: ' ' } },
  ])('rejects $label without writes', async ({ actor, patch, input }) => {
    mocks.tx.order.findUnique.mockResolvedValue(order(patch));
    await expect(confirmHistoricalBlankPrice({ ...command, ...input }, actor)).rejects.toThrow();
    expect(mocks.tx.orderItem.update).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });
});
