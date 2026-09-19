import { beforeEach, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client';

const mocks = vi.hoisted(() => ({ adapter: vi.fn(), findUniqueOrThrow: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('../create-order-quote-facts-adapter', () => ({
  buildCreateOrderQuoteInputFromCatalog: mocks.adapter,
}));

import { finalizeSampleOrderInTx, SampleOrderError } from '../sample-order';

const tx = { order: { findUniqueOrThrow: mocks.findUniqueOrThrow } } as unknown as Prisma.TransactionClient;
const proofItem = { id: 'item-1', sequence: 1, fig: 1, pricingRoute: 'STOCK_BLANK', paperType: '120g珠光艳闪', paperWeightGsm: 120 };
const proofOrder = {
  id: 'order-1', purpose: 'PROOF', status: 'DRAFT', isSfCollect: false, samplePackagingRuleCode: null,
  items: [proofItem], packagingGroups: [],
  shipments: [{ sequence: 1, destinationProvince: '上海', weightKg: null, lines: [{ orderItemId: 'item-1', quantity: 1 }] }],
};

beforeEach(() => { vi.clearAllMocks(); mocks.findUniqueOrThrow.mockResolvedValue(proofOrder); });

// The shared adapter no longer rejects 120g (change requests must reprice
// historical orders), so the proof submit path must gate old drafts itself.
it('rejects a pre-retirement PROOF draft with 120g paper before any quote or write', async () => {
  const pending = finalizeSampleOrderInTx(tx, 'order-1', 'sales-1', new Date(), null);
  await expect(pending).rejects.toBeInstanceOf(SampleOrderError);
  await expect(pending).rejects.toThrow('120g 纸张已停用');
  expect(mocks.adapter).not.toHaveBeenCalled();
});
