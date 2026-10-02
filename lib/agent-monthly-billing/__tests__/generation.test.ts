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

import { allocateOutstandingCreditsInTx, generateAgentMonthlyBillsForPeriod, synchronizeDraftBillInTx } from '../generation';
import { lockAgentBillCredit } from '../locks';

const ORDER = {
  id: 'order-1',
  orderNo: 'GD-260501-001',
  customName: '节日礼盒',
  submitterId: 'agent-1',
  status: OrderStatus.SETTLED,
  customerRef: '客户甲',
  workOrderVersion: 2,
  settledFee: '25.00',
  processingAmount: '20.00',
  totalAmount: '25.00',
  customerCharges: [{ amount: '5.00', description: '运费' }],
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
    .mockReset()
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
      errors: [],
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
    // 客户名称/简称已不展示，但确认触发器仍要求快照与 Order.customerRef 一致
    // （IS DISTINCT FROM 比对），生成必须照旧逐字写入，不能省略或改写。
    const member = tx.agentMonthlyBillItem.upsert.mock.calls[0]?.[0];
    for (const row of [member.create, member.update]) expect(row.settlementDetailSnapshot).toEqual({
      schemaVersion: 1, orderName: '节日礼盒', processingAmount: '20.00',
      charges: [{ description: '运费', amount: '5.00' }],
    });
    expect(member.create.customerRefSnapshot).toBe(ORDER.customerRef);
    expect(member.update.customerRefSnapshot).toBe(ORDER.customerRef);
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
    ).rejects.toThrow(/GD-260501-001.*尚未入账/);
    expect(tx.agentMonthlyBillItem.upsert).not.toHaveBeenCalled();
    expect(tx.agentMonthlyBill.update).not.toHaveBeenCalled();
  });
});

it.each([
  { processingAmount: '20.00', totalAmount: '25.00', customerCharges: [{ amount: '4.99' }] },
  { processingAmount: '20.00', totalAmount: '26.00', customerCharges: [{ amount: '6.00' }] },
  { processingAmount: 'NaN', totalAmount: '25.00', customerCharges: [] },
  { processingAmount: '20.00', totalAmount: '25.00', customerCharges: [{ amount: 'NaN' }] },
])('refuses an inconsistent order before creating or rewriting its agent bill: %j', async (facts) => {
  tx.order.findMany.mockResolvedValue([{ ...ORDER, ...facts }]);
  const result = await generateAgentMonthlyBillsForPeriod('2026-05', { id: 'admin-1', role: Role.ADMIN }, { now: new Date('2026-06-02T00:00:00Z') });
  expect(result).toMatchObject({ generated: [], errors: [{ agentUserId: 'agent-1', message: expect.stringContaining(ORDER.orderNo) }] });
  expect(tx.agentMonthlyBill.create).not.toHaveBeenCalled();
  expect(tx.agentMonthlyBillItem.upsert).not.toHaveBeenCalled();
  expect(tx.agentMonthlyBillItem.deleteMany).not.toHaveBeenCalled();
});

it('keeps a corrupt agent untouched while generating another consistent agent', async () => {
  const rows = [ORDER, { ...ORDER, id: 'bad', orderNo: 'GD-BAD', submitterId: 'agent-2', settledFee: '99.00' }];
  tx.order.findMany.mockImplementation(async ({ where }) => rows.filter(order => !where.submitterId || order.submitterId === where.submitterId));
  const result = await generateAgentMonthlyBillsForPeriod('2026-05', { id: 'admin', role: Role.ADMIN }, { now: new Date('2026-06-02T00:00:00Z') });
  expect(result.generated.map(row => row.agentUserId)).toEqual(['agent-1']);
  expect(result.errors).toEqual([{ agentUserId: 'agent-2', message: expect.stringContaining('GD-BAD') }]);
  expect(tx.agentMonthlyBillItem.upsert).toHaveBeenCalledTimes(1);
});

it('rejects direct draft synchronization before removing existing members', async () => {
  tx.agentMonthlyBill.findUnique.mockReset().mockResolvedValue({ status: AgentMonthlyBillStatus.DRAFT });
  tx.order.findMany.mockResolvedValue([{ ...ORDER, totalAmount: '99.00' }]);
  // The same eligibility guard protects manual confirmation, not just cron.
  await expect(synchronizeDraftBillInTx(tx as never, { billId: 'bill-1', agentUserId: 'agent-1', period: '2026-05' })).rejects.toThrow(ORDER.orderNo);
  expect(tx.agentMonthlyBillItem.deleteMany).not.toHaveBeenCalled();
  expect(tx.agentMonthlyBillItem.upsert).not.toHaveBeenCalled();
});

// 业主 2026-10-01：补收（正数）先全额计入草稿账单并提高可抵扣额度，抵扣（负数）再在额度内分摊。
it('allocates surcharges in full before capping credits by the raised capacity', async () => {
  tx.agentMonthlyBill.findUnique.mockReset().mockResolvedValue({ status: AgentMonthlyBillStatus.DRAFT });
  tx.agentMonthlyBillItem.aggregate.mockResolvedValue({ _sum: { settledFeeSnapshot: '50.00' } });
  const source = { sourceItem: { bill: { period: '2026-05' } } };
  tx.agentMonthlyBillCredit.findMany.mockResolvedValue([
    { id: 'credit-a', requestedAmount: '-100.00', createdAt: new Date('2026-05-02'), allocations: [], ...source },
    { id: 'surcharge-b', requestedAmount: '30.00', createdAt: new Date('2026-05-03'), allocations: [], ...source },
    { id: 'surcharge-done', requestedAmount: '10.00', createdAt: new Date('2026-05-01'), allocations: [{ billId: 'older-bill', amount: '10.00' }], ...source },
  ]);
  tx.agentMonthlyBillAdjustment.aggregate.mockResolvedValue({ _sum: { amount: '-50.00' } });

  await allocateOutstandingCreditsInTx(tx as never, { billId: 'bill-6', agentUserId: 'agent-1', period: '2026-06' });

  expect(tx.agentMonthlyBillAdjustment.create.mock.calls.map(([args]) => args.data)).toEqual([
    { billId: 'bill-6', creditId: 'surcharge-b', amount: '30.00' },
    { billId: 'bill-6', creditId: 'credit-a', amount: '-80.00' },
  ]);
  expect(tx.agentMonthlyBill.update).toHaveBeenCalledWith(expect.objectContaining({
    data: { memberSubtotal: '50.00', adjustmentAmount: '-50.00', totalAmount: '0.00' },
  }));
});

// Codex 审查 P2：分摊额度在持有来源锁之后再读；补收只进来源之后最早的草稿账单。
it('reads allocations only after locking every source, and leaves a surcharge for an earlier open draft', async () => {
  tx.agentMonthlyBill.findUnique.mockReset().mockResolvedValue({ status: AgentMonthlyBillStatus.DRAFT });
  tx.agentMonthlyBillItem.aggregate.mockResolvedValue({ _sum: { settledFeeSnapshot: '50.00' } });
  tx.agentMonthlyBillCredit.findMany
    .mockResolvedValueOnce([{ id: 'surcharge-b' }, { id: 'credit-a' }])
    .mockResolvedValueOnce([
      { id: 'credit-a', requestedAmount: '-20.00', createdAt: new Date('2026-05-02'), allocations: [], sourceItem: { bill: { period: '2026-05' } } },
      { id: 'surcharge-b', requestedAmount: '30.00', createdAt: new Date('2026-05-03'), allocations: [], sourceItem: { bill: { period: '2026-05' } } },
    ]);
  // 6 月草稿仍在：本次重排的是 7 月，补收要留给 6 月。
  tx.agentMonthlyBill.findMany.mockResolvedValue([{ period: '2026-06' }]);
  tx.agentMonthlyBillAdjustment.aggregate.mockResolvedValue({ _sum: { amount: '-20.00' } });

  await allocateOutstandingCreditsInTx(tx as never, { billId: 'bill-7', agentUserId: 'agent-1', period: '2026-07' });

  const lock = vi.mocked(lockAgentBillCredit);
  expect(lock.mock.calls.map(([, id]) => id)).toEqual(['credit-a', 'surcharge-b']);
  const allocationRead = tx.agentMonthlyBillCredit.findMany.mock.invocationCallOrder[1];
  expect(Math.max(...lock.mock.invocationCallOrder)).toBeLessThan(allocationRead);
  expect(tx.agentMonthlyBillCredit.findMany.mock.calls[1][0].where).toEqual({ id: { in: ['credit-a', 'surcharge-b'] } });
  expect(tx.agentMonthlyBillAdjustment.create.mock.calls.map(([args]) => args.data)).toEqual([
    { billId: 'bill-7', creditId: 'credit-a', amount: '-20.00' },
  ]);
});

// Codex 审查 P2：录入后工单合计又增长（如结算更正）时，放不进本账单存储上限的补收整笔留待之后，
// 账单生成 / 确认不能因溢出失败。
it('defers a surcharge that would push the draft past the bill amount column limit', async () => {
  tx.agentMonthlyBill.findUnique.mockReset().mockResolvedValue({ status: AgentMonthlyBillStatus.DRAFT });
  tx.agentMonthlyBillItem.aggregate.mockResolvedValue({ _sum: { settledFeeSnapshot: '9999999000.00' } });
  tx.agentMonthlyBillCredit.findMany.mockResolvedValue([
    { id: 'surcharge-big', requestedAmount: '1000.00', createdAt: new Date('2026-05-02'), allocations: [], sourceItem: { bill: { period: '2026-05' } } },
    { id: 'surcharge-small', requestedAmount: '999.99', createdAt: new Date('2026-05-03'), allocations: [], sourceItem: { bill: { period: '2026-05' } } },
  ]);

  await allocateOutstandingCreditsInTx(tx as never, { billId: 'bill-6', agentUserId: 'agent-1', period: '2026-06' });

  expect(tx.agentMonthlyBillAdjustment.create.mock.calls.map(([args]) => args.data)).toEqual([
    { billId: 'bill-6', creditId: 'surcharge-small', amount: '999.99' },
  ]);
});
