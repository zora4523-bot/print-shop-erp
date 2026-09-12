import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  OrderPricingStatus,
  OrderSettlementType,
  OrderStatus,
  Role,
} from '../../../generated/prisma/enums';

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    orderLog: { create: vi.fn() },
    orderChangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return {
    tx,
    transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    activate: vi.fn(),
    dispatch: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    ...mocks.tx,
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/background-jobs/mode', () => ({
  backgroundJobsMode: () => 'inline',
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: mocks.dispatch,
}));
vi.mock('@/lib/order/production-readiness', () => ({
  prepareOrderForProductionInTx: mocks.activate,
}));

import { submitOrder } from '../../order';

const actor = { id: 'owner-1', role: Role.ADMIN };
const now = new Date('2026-08-28T08:00:00.000Z');

function arrangeSubmit(pricingStatus: OrderPricingStatus) {
  mocks.tx.order.findUnique
    .mockResolvedValueOnce({
      id: 'order-1',
      status: OrderStatus.DRAFT,
      submitterId: 'owner-1',
      receiverAddress: '佛山市南海区测试路 1 号',
      receiverPhone: null,
      settlementType: OrderSettlementType.FACTORY_DIRECT,
      pricingStatus,
      priceRevision: 1,
    })
    .mockResolvedValueOnce({
      submitterId: 'owner-1',
      submitterRole: Role.ADMIN,
      billingMode: OrderBillingMode.CHARGE,
      settlementType: OrderSettlementType.FACTORY_DIRECT,
      totalAmount: '180.00',
      revision: 1,
    })
    .mockResolvedValueOnce({
      billingMode: OrderBillingMode.CHARGE,
      pricingStatus,
    })
    .mockResolvedValueOnce(null);
  mocks.tx.order.update.mockResolvedValue({
    id: 'order-1',
    status: OrderStatus.SUBMITTED,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(
    async (run: (client: typeof mocks.tx) => unknown) => run(mocks.tx),
  );
});

describe('submitOrder pricing-to-production handoff', () => {
  it('prepares AUTO_CONFIRMED work without materializing production before release', async () => {
    arrangeSubmit(OrderPricingStatus.AUTO_CONFIRMED);
    mocks.activate.mockResolvedValue({
      orderId: 'order-1',
      status: OrderStatus.CONFIRMED,
      operationIds: [],
      operationsCreated: 0,
      idempotentReplay: false,
    });

    const result = await submitOrder('order-1', actor, now);

    expect(mocks.activate).toHaveBeenCalledWith(
      mocks.tx,
      'order-1',
      actor,
      now,
    );
    expect(result).toMatchObject({
      id: 'order-1',
      status: OrderStatus.CONFIRMED,
    });
  });

  it('leaves manual pricing at SUBMITTED until factory confirmation', async () => {
    arrangeSubmit(OrderPricingStatus.PENDING_ADMIN_CONFIRMATION);

    mocks.activate.mockResolvedValue({ status: OrderStatus.SUBMITTED, ready: false, issues: ['待人工核价'] });
    const result = await submitOrder('order-1', actor, now);

    expect(mocks.activate).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      id: 'order-1',
      status: OrderStatus.SUBMITTED,
    });
  });
});
