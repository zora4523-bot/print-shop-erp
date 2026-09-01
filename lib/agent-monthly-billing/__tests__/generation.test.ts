import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentMonthlyBillStatus,
  OrderBillingMode,
  OrderSettlementType,
  OrderStatus,
  Role,
} from '../../../generated/prisma/enums';

const { tx, dbMock, events } = vi.hoisted(() => {
  const events: string[] = [];
  const tx = {
    order: { findMany: vi.fn() },
    agentMonthlyBill: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: { findMany: vi.fn() },
    agentMonthlyBillItem: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
      aggregate: vi.fn(),
    },
    agentMonthlyBillCredit: { findMany: vi.fn() },
    agentMonthlyBillAdjustment: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
  };
  return {
    events,
    tx,
    dbMock: { $transaction: vi.fn(async (callback) => callback(tx)) },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/finance/settlement-cutoff-lock', () => ({
  lockSettlementCutoffExclusive: vi.fn(async () => {
    events.push('cutoff');
  }),
}));
vi.mock('../locks', () => ({
  lockAgentPeriod: vi.fn(async () => events.push('period')),
  lockAgentBill: vi.fn(async () => events.push('bill')),
  lockAgentBillCredit: vi.fn(async () => events.push('credit')),
}));

import { generateAgentMonthlyBillsForPeriod } from '../generation';

const ORDER = {
  id: 'order-1',
  orderNo: 'GD-260501-001',
  submitterId: 'agent-1',
  status: OrderStatus.SETTLED,
  customerRef: '客户甲',
  workOrderVersion: 2,
  settledFee: '25.00',
  settledAt: new Date('2026-05-01T00:00:00.000Z'),
};

beforeEach(() => {
  events.length = 0;
  vi.clearAllMocks();
  tx.order.findMany.mockResolvedValue([ORDER]);
  tx.agentMonthlyBill.findMany.mockResolvedValue([]);
  tx.user.findMany.mockResolvedValue([
    { id: 'agent-1', username: 'sales01', displayName: '代理商一' },
  ]);
  tx.agentMonthlyBill.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValue({ status: AgentMonthlyBillStatus.DRAFT });
  tx.agentMonthlyBill.create.mockResolvedValue({
    id: 'bill-1',
    agentUserId: 'agent-1',
    period: '2026-05',
    status: AgentMonthlyBillStatus.DRAFT,
    memberSubtotal: '0.00',
    adjustmentAmount: '0.00',
    totalAmount: '0.00',
  });
  tx.agentMonthlyBillItem.findMany.mockResolvedValue([]);
  tx.agentMonthlyBillItem.deleteMany.mockResolvedValue({ count: 0 });
  tx.agentMonthlyBillItem.upsert.mockResolvedValue({ id: 'item-1' });
  tx.agentMonthlyBillCredit.findMany.mockResolvedValue([]);
  tx.agentMonthlyBillAdjustment.deleteMany.mockResolvedValue({ count: 0 });
  tx.agentMonthlyBillItem.aggregate.mockResolvedValue({
    _sum: { settledFeeSnapshot: '25.00' },
  });
  tx.agentMonthlyBillAdjustment.aggregate.mockResolvedValue({
    _sum: { amount: null },
  });
  tx.agentMonthlyBill.update.mockResolvedValue({ id: 'bill-1' });
});

describe('generateAgentMonthlyBillsForPeriod', () => {
  it('locks the cutoff before scanning and uses only settled v2 truth fields', async () => {
    tx.order.findMany.mockImplementation(async (args) => {
      events.push('scan');
      expect(args.where).toMatchObject({
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        billingMode: OrderBillingMode.CHARGE,
        status: { in: [OrderStatus.SETTLED, OrderStatus.CANCELLED] },
        settledFee: { not: null },
        settledAt: {
          gte: new Date('2026-04-30T16:00:00.000Z'),
          lt: new Date('2026-05-31T16:00:00.000Z'),
        },
      });
      return [ORDER];
    });

    await expect(
      generateAgentMonthlyBillsForPeriod(
        '2026-05',
        { id: 'admin-1', role: Role.ADMIN },
        { now: new Date('2026-06-02T00:00:00.000Z') },
      ),
    ).resolves.toEqual({
      period: '2026-05',
      generated: [
        expect.objectContaining({
          billId: 'bill-1',
          agentUserId: 'agent-1',
          orderCount: 1,
          totalAmount: '25.00',
          created: true,
        }),
      ],
    });

    expect(events[0]).toBe('cutoff');
    expect(events.indexOf('period')).toBeGreaterThan(events.indexOf('scan'));
    expect(events.indexOf('bill')).toBeGreaterThan(events.indexOf('period'));
    expect(tx.agentMonthlyBillItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          settledFeeSnapshot: '25.00',
          settledAtSnapshot: ORDER.settledAt,
        }),
      }),
    );
  });

  it('fails closed when a frozen month has a newly visible candidate', async () => {
    tx.agentMonthlyBill.findMany.mockResolvedValue([
      { id: 'bill-1', agentUserId: 'agent-1' },
    ]);
    tx.agentMonthlyBill.findUnique.mockReset().mockResolvedValue({
      id: 'bill-1',
      agentUserId: 'agent-1',
      period: '2026-05',
      status: AgentMonthlyBillStatus.CONFIRMED,
      memberSubtotal: '0.00',
      adjustmentAmount: '0.00',
      totalAmount: '0.00',
    });
    tx.agentMonthlyBillItem.findMany.mockResolvedValue([]);

    await expect(
      generateAgentMonthlyBillsForPeriod(
        '2026-05',
        { id: 'admin-1', role: Role.ADMIN },
        { now: new Date('2026-06-02T00:00:00.000Z') },
      ),
    ).rejects.toThrow(/未入账.*GD-260501-001/);
    expect(tx.agentMonthlyBillItem.upsert).not.toHaveBeenCalled();
    expect(tx.agentMonthlyBill.update).not.toHaveBeenCalled();
  });
});
