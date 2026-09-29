import { beforeEach, expect, it, vi } from 'vitest';
import { Prisma } from '../../../generated/prisma/client';
import { CREATE_ORDER_GOLDEN_SNAPSHOT } from '@/lib/price/__tests__/fixtures/create-order-golden-fixtures';

const mocks = vi.hoisted(() => ({
  adapter: vi.fn(), findUniqueOrThrow: vi.fn(), snapshot: vi.fn(), revision: vi.fn(),
  shipmentUpdate: vi.fn(), chargeUpsert: vi.fn(), orderUpdate: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('../create-order-quote-facts-adapter', () => ({
  buildCreateOrderQuoteInputFromCatalog: mocks.adapter,
}));
vi.mock('../create-order-published-rule-adapter', () => ({
  readPublishedCreateOrderPriceSnapshot: mocks.snapshot,
}));
vi.mock('../pricing-revision', () => ({ appendOrderPricingRevisionInTx: mocks.revision }));

import { finalizeSampleOrderInTx, SampleOrderError, SampleQuoteChangedError } from '../sample-order';

const tx = {
  order: { findUniqueOrThrow: mocks.findUniqueOrThrow, update: mocks.orderUpdate },
  orderItem: { updateMany: vi.fn() },
  orderPackagingGroup: { updateMany: vi.fn() },
  orderShipment: { update: mocks.shipmentUpdate },
  customerChargeCategory: { findUnique: vi.fn(async () => ({ id: 'category', isActive: true })) },
  customerPriceRule: { findFirst: vi.fn(async () => ({ id: 'rule' })) },
  orderCustomerCharge: { upsert: mocks.chargeUpsert },
  orderPriceVersionLock: { createMany: vi.fn() },
} as unknown as Prisma.TransactionClient;
const proofItem = { id: 'item-1', sequence: 1, fig: 1, pricingRoute: 'STOCK_BLANK', paperType: '120g珠光艳闪', paperWeightGsm: 120 };
const proofOrder = {
  id: 'order-1', purpose: 'PROOF', status: 'DRAFT', isSfCollect: false, samplePackagingRuleCode: null,
  items: [proofItem], packagingGroups: [],
  shipments: [{ sequence: 1, destinationProvince: '上海', weightKg: null, lines: [{ orderItemId: 'item-1', quantity: 1 }] }],
};
function sampleOrder(province: string, weightKg: Prisma.Decimal | null = null) {
  return {
    id: 'order-2', purpose: 'SAMPLE_SHIPMENT', status: 'DRAFT', isSfCollect: false, samplePackagingRuleCode: null,
    priceRevision: 0, items: [{ id: 'item-1', sequence: 1 }], packagingGroups: [],
    shipments: [{ id: 'ship-1', sequence: 1, destinationProvince: province, weightKg, lines: [{ orderItemId: 'item-1', quantity: 3 }] }],
  };
}
async function submitWithCurrentQuote() {
  const stale = await finalizeSampleOrderInTx(tx, 'order-2', 'sales-1', new Date(), null).catch((error: unknown) => error);
  expect(stale).toBeInstanceOf(SampleQuoteChangedError);
  expect(mocks.shipmentUpdate).not.toHaveBeenCalled();
  return finalizeSampleOrderInTx(tx, 'order-2', 'sales-1', new Date(), (stale as SampleQuoteChangedError).quote.quoteToken);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUniqueOrThrow.mockResolvedValue(proofOrder);
  mocks.snapshot.mockResolvedValue(CREATE_ORDER_GOLDEN_SNAPSHOT);
  mocks.revision.mockResolvedValue({ pricingRevisionId: 'revision-1' });
});

// The shared adapter no longer rejects 120g (change requests must reprice
// historical orders), so the proof submit path must gate old drafts itself.
it('rejects a pre-retirement PROOF draft with 120g paper before any quote or write', async () => {
  const pending = finalizeSampleOrderInTx(tx, 'order-1', 'sales-1', new Date(), null);
  await expect(pending).rejects.toBeInstanceOf(SampleOrderError);
  await expect(pending).rejects.toThrow('120g 纸张已停用');
  expect(mocks.adapter).not.toHaveBeenCalled();
});

it('auto-confirms a prepaid sample at the first weight and records it as the billable weight', async () => {
  mocks.findUniqueOrThrow.mockResolvedValue(sampleOrder('浙江'));
  await expect(submitWithCurrentQuote()).resolves.toEqual({ quotedFee: '3.80', quotedFeeCompleteness: 'COMPLETE' });
  expect(mocks.shipmentUpdate).toHaveBeenCalledExactlyOnceWith({ where: { id: 'ship-1' }, data: { weightKg: '1' } });
  const shipping = mocks.chargeUpsert.mock.calls.map(([args]) => args.create)
    .find((row) => row.businessKey === 'SHIPMENT:1:SHIPPING_FEE');
  expect(shipping).toMatchObject({ amount: '2.80', status: 'ESTIMATED',
    pricingSnapshot: { weightBasis: 'SAMPLE_FIRST_WEIGHT_DEFAULT' } });
  expect(mocks.revision).toHaveBeenCalledWith(tx, expect.objectContaining({ status: 'AUTO_CONFIRMED' }));
});

it('re-derives the default on resubmission instead of trusting an earlier province weight', async () => {
  mocks.findUniqueOrThrow.mockResolvedValue(sampleOrder('新疆', new Prisma.Decimal('2')));
  await expect(submitWithCurrentQuote()).resolves.toMatchObject({ quotedFee: '13.00' });
  expect(mocks.shipmentUpdate).toHaveBeenCalledExactlyOnceWith({ where: { id: 'ship-1' }, data: { weightKg: '1' } });
});
