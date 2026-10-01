import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMonthlyBillStatus, Role } from '../../../generated/prisma/enums';

const { tx, dbMock, events, synchronizeMock, clockMock } = vi.hoisted(() => {
  const events: string[] = [];
  const tx = {
    agentMonthlyBill: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    agentMonthlyBillReceipt: { create: vi.fn() },
    agentMonthlyBillItem: { findUnique: vi.fn() },
    agentMonthlyBillCredit: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    agentMonthlyBillAdjustment: { deleteMany: vi.fn(), count: vi.fn() },
  };
  return {
    events,
    tx,
    synchronizeMock: vi.fn(),
    clockMock: vi.fn(),
    dbMock: { $transaction: vi.fn(async (callback) => callback(tx)) },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseClockNow: clockMock,
}));
vi.mock('@/lib/finance/settlement-cutoff-lock', () => ({
  lockSettlementCutoffExclusive: vi.fn(async () => events.push('cutoff-exclusive')),
  lockSettlementCutoffShared: vi.fn(async () => events.push('cutoff-shared')),
}));
vi.mock('../locks', () => ({
  lockAgentPeriod: vi.fn(async () => events.push('period')),
  lockAgentBill: vi.fn(async () => events.push('bill')),
  lockAgentBillRequest: vi.fn(async () => events.push('request')),
  lockAgentSurcharges: vi.fn(async () => events.push('surcharge-agent')),
}));
vi.mock('../generation', () => ({
  synchronizeDraftBillInTx: synchronizeMock,
  allocateOutstandingCreditsInTx: vi.fn(),
}));

import {
  confirmAgentMonthlyBill,
  createAgentMonthlyBillCredit,
  markAgentMonthlyBillPaid,
} from '../commands';

const DB_NOW = new Date('2026-06-01T01:02:03.000Z');

beforeEach(() => {
  events.length = 0;
  vi.clearAllMocks();
  clockMock.mockResolvedValue(DB_NOW);
  tx.agentMonthlyBill.update.mockResolvedValue({ id: 'bill-1' });
  tx.agentMonthlyBillReceipt.create.mockResolvedValue({ id: 'receipt-1' });
});

describe('agent monthly bill commands', () => {
  it('confirms under cutoff -> period -> bill -> request and auto-pays zero', async () => {
    tx.agentMonthlyBill.findUnique.mockImplementation(async () => {
      events.push('read');
      return {
        id: 'bill-1',
        agentUserId: 'agent-1',
        period: '2026-05',
        status: AgentMonthlyBillStatus.DRAFT,
        totalAmount: '0.00',
        confirmedAt: null,
        paidAt: null,
      };
    });
    synchronizeMock.mockResolvedValue({
      orderCount: 0,
      memberSubtotal: '0.00',
      adjustmentAmount: '0.00',
      totalAmount: '0.00',
    });

    await expect(
      confirmAgentMonthlyBill(
        'bill-1',
        { id: 'admin-1', role: Role.ADMIN },
        'confirm-1',
      ),
    ).resolves.toMatchObject({
      status: AgentMonthlyBillStatus.PAID,
      totalAmount: '0.00',
      paidAt: DB_NOW,
    });

    expect(events.slice(0, 5)).toEqual([
      'cutoff-exclusive',
      'read',
      'period',
      'bill',
      'request',
    ]);
    expect(tx.agentMonthlyBillReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billId: 'bill-1',
        amount: '0.00',
        receivedAt: DB_NOW,
        recordedById: 'admin-1',
      }),
      select: { id: true },
    });
    expect(tx.agentMonthlyBill.update).toHaveBeenLastCalledWith({
      where: { id: 'bill-1' },
      data: {
        status: AgentMonthlyBillStatus.PAID,
        paidById: 'admin-1',
        paidAt: DB_NOW,
      },
      select: { id: true },
    });
  });

  it('refuses to confirm a net-negative DRAFT without freezing it', async () => {
    tx.agentMonthlyBill.findUnique
      .mockResolvedValueOnce({
        id: 'bill-1',
        agentUserId: 'agent-1',
        period: '2026-05',
      })
      .mockResolvedValueOnce({
        id: 'bill-1',
        agentUserId: 'agent-1',
        period: '2026-05',
        status: AgentMonthlyBillStatus.DRAFT,
        totalAmount: '0.00',
        confirmedAt: null,
        paidAt: null,
      });
    synchronizeMock.mockResolvedValue({
      orderCount: 0,
      memberSubtotal: '10.00',
      adjustmentAmount: '-11.00',
      totalAmount: '-1.00',
    });

    await expect(
      confirmAgentMonthlyBill(
        'bill-1',
        { id: 'admin-1', role: Role.ADMIN },
        'confirm-negative',
      ),
    ).rejects.toThrow(/净额为负/);
    expect(tx.agentMonthlyBill.update).not.toHaveBeenCalled();
    expect(tx.agentMonthlyBillReceipt.create).not.toHaveBeenCalled();
  });

  it('records exactly the locked total and accepts no amount parameter', async () => {
    tx.agentMonthlyBill.findUnique
      .mockResolvedValueOnce({
        id: 'bill-1',
        agentUserId: 'agent-1',
        period: '2026-05',
      })
      .mockResolvedValueOnce({
        status: AgentMonthlyBillStatus.CONFIRMED,
        totalAmount: '123.45',
        receipt: null,
      });

    await expect(
      markAgentMonthlyBillPaid(
        {
          billId: 'bill-1',
          idempotencyKey: 'receipt-1',
          paymentMethod: '银行转账',
        },
        { id: 'admin-1', role: Role.ADMIN },
      ),
    ).resolves.toMatchObject({ amount: '123.45', status: 'PAID' });

    expect(events.slice(0, 4)).toEqual([
      'cutoff-shared',
      'period',
      'bill',
      'request',
    ]);
    expect(tx.agentMonthlyBillReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: '123.45' }),
      select: { id: true },
    });
  });

  it('replays an already-paid bill without appending a second receipt', async () => {
    tx.agentMonthlyBill.findUnique
      .mockResolvedValueOnce({
        id: 'bill-1',
        agentUserId: 'agent-1',
        period: '2026-05',
      })
      .mockResolvedValueOnce({
        status: AgentMonthlyBillStatus.PAID,
        totalAmount: '123.45',
        receipt: { amount: '123.45', receivedAt: DB_NOW },
      });

    await expect(
      markAgentMonthlyBillPaid(
        { billId: 'bill-1', idempotencyKey: 'receipt-replay' },
        { id: 'admin-1', role: Role.ADMIN },
      ),
    ).resolves.toEqual({
      billId: 'bill-1',
      status: AgentMonthlyBillStatus.PAID,
      amount: '123.45',
      receivedAt: DB_NOW,
    });
    expect(tx.agentMonthlyBillReceipt.create).not.toHaveBeenCalled();
    expect(tx.agentMonthlyBill.update).not.toHaveBeenCalled();
  });

  it('keeps the immutable credit fact when there is no future DRAFT', async () => {
    tx.agentMonthlyBillItem.findUnique
      .mockResolvedValueOnce({
        id: 'item-1',
        billId: 'source-bill',
        bill: { agentUserId: 'agent-1', period: '2026-05' },
      })
      .mockResolvedValueOnce({
        settledFeeSnapshot: '100.00',
        bill: { status: AgentMonthlyBillStatus.PAID },
        credits: [],
      });
    tx.agentMonthlyBillCredit.findUnique.mockResolvedValue(null);
    tx.agentMonthlyBillCredit.create.mockImplementation(async () => {
      events.push('credit-created');
      return { id: 'credit-1', requestedAmount: '-30.00' };
    });
    tx.agentMonthlyBill.findMany.mockImplementation(async () => {
      events.push('future-draft-scan');
      return [];
    });

    await expect(
      createAgentMonthlyBillCredit(
        {
          expectedBillId: 'source-bill',
          sourceItemId: 'item-1',
          direction: 'CREDIT',
          amount: '30.00',
          reason: '错单部分调整',
          idempotencyKey: 'credit-request-1',
        },
        { id: 'admin-1', role: Role.ADMIN },
      ),
    ).resolves.toEqual({
      creditId: 'credit-1',
      requestedAmount: '-30.00',
      allocatedBillIds: [],
      creditAllocated: false,
    });
    expect(events.indexOf('credit-created')).toBeLessThan(
      events.indexOf('future-draft-scan'),
    );
    expect(tx.agentMonthlyBillCredit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedAmount: '-30.00',
        sourceItemId: 'item-1',
      }),
      select: { id: true, requestedAmount: true },
    });
  });

  // 业主 2026-10-01：少收了可补收。补收存正数，不受结算金额上限约束；抵扣的上限
  // 按「结算金额 + 已录全部抵扣 / 补收」的净额计算，与数据库触发器同一规则。
  function frozenSource(credits: Array<{ requestedAmount: string }>) {
    tx.agentMonthlyBillItem.findUnique
      .mockResolvedValueOnce({ id: 'item-1', billId: 'source-bill', bill: { agentUserId: 'agent-1', period: '2026-05' } })
      .mockResolvedValueOnce({ settledFeeSnapshot: '100.00', bill: { status: AgentMonthlyBillStatus.CONFIRMED }, credits });
    tx.agentMonthlyBillCredit.findUnique.mockResolvedValue(null);
    tx.agentMonthlyBill.findMany.mockResolvedValue([]);
    tx.agentMonthlyBill.findFirst.mockResolvedValue(null);
    tx.agentMonthlyBillCredit.findMany.mockResolvedValue([]);
    tx.agentMonthlyBillCredit.create.mockImplementation(async ({ data }: { data: { requestedAmount: string } }) => ({ id: 'credit-new', requestedAmount: data.requestedAmount }));
  }
  const request = (direction: 'CREDIT' | 'SURCHARGE', amount: string) => createAgentMonthlyBillCredit(
    { expectedBillId: 'source-bill', sourceItemId: 'item-1', direction, amount, reason: '核对后调整', idempotencyKey: `req-${direction}-${amount}` },
    { id: 'admin-1', role: Role.ADMIN },
  );

  it('records a surcharge as a positive amount even after the source was fully credited', async () => {
    frozenSource([{ requestedAmount: '-100.00' }]);
    await expect(request('SURCHARGE', '15.00')).resolves.toMatchObject({ requestedAmount: '15.00' });
    expect(tx.agentMonthlyBillCredit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestedAmount: '15.00', reason: '核对后调整' }),
    }));
  });

  it.each([
    ['20.00', true],
    ['20.01', false],
  ] as const)('caps a credit of %s by the net of the settled fee and every earlier credit and surcharge', async (amount, allowed) => {
    frozenSource([{ requestedAmount: '-100.00' }, { requestedAmount: '20.00' }]);
    const pending = request('CREDIT', amount);
    if (allowed) await expect(pending).resolves.toMatchObject({ requestedAmount: '-20.00' });
    else await expect(pending).rejects.toThrow('累计抵扣不能超过来源工单的结算金额（含已补收）');
  });

  // Codex 审查 P2：补收根记录不可改，写入前确认来源净额与最早草稿账单合计都在存储范围内。
  // 按最坏情况——该销售所有未进入已确认账单的补收都落进同一张草稿——校验，包括其他来源工单的补收。
  it('refuses a surcharge that could overflow a draft together with every other pending surcharge of the agent', async () => {
    frozenSource([]);
    tx.agentMonthlyBill.findFirst.mockResolvedValue({ memberSubtotal: '9999999999.00' });
    await expect(request('SURCHARGE', '1.00')).rejects.toThrow('补收金额过大');
    expect(tx.agentMonthlyBillCredit.create).not.toHaveBeenCalled();
    // 另一张来源工单已录 60 亿补收、尚未入已确认账单；本笔 40 亿加上 100 元工单合计超限。
    frozenSource([]);
    tx.agentMonthlyBill.findFirst.mockResolvedValue({ memberSubtotal: '100.00' });
    tx.agentMonthlyBillCredit.findMany.mockResolvedValue([{ requestedAmount: '6000000000.00', allocations: [] }]);
    await expect(request('SURCHARGE', '4000000000.00')).rejects.toThrow('补收金额过大');
    // 已分摊进已确认账单的部分不再计入待分摊。
    frozenSource([]);
    tx.agentMonthlyBill.findFirst.mockResolvedValue({ memberSubtotal: '100.00' });
    tx.agentMonthlyBillCredit.findMany.mockResolvedValue([{ requestedAmount: '6000000000.00', allocations: [{ amount: '6000000000.00' }] }]);
    await expect(request('SURCHARGE', '4000000000.00')).resolves.toMatchObject({ requestedAmount: '4000000000.00' });
    expect(events).toContain('surcharge-agent');
    frozenSource([{ requestedAmount: '9999999990.00' }]);
    await expect(request('SURCHARGE', '10.00')).rejects.toThrow('补收金额过大');
  });

  it.each([
    [0, false],
    [1, true],
  ])('reports this credit as allocated only when an adjustment row exists for it (%s rows)', async (rows, allocated) => {
    frozenSource([]);
    tx.agentMonthlyBill.findMany.mockResolvedValue([{ id: 'draft-6', period: '2026-06' }]);
    tx.agentMonthlyBillAdjustment.count.mockResolvedValue(rows);
    await expect(request('SURCHARGE', '5.00')).resolves.toMatchObject({ allocatedBillIds: ['draft-6'], creditAllocated: allocated });
    expect(tx.agentMonthlyBillAdjustment.count).toHaveBeenCalledWith({ where: { creditId: 'credit-new' } });
  });

  it('refuses a replayed key whose direction changed', async () => {
    tx.agentMonthlyBillItem.findUnique.mockResolvedValueOnce({ id: 'item-1', billId: 'source-bill', bill: { agentUserId: 'agent-1', period: '2026-05' } });
    tx.agentMonthlyBillCredit.findUnique.mockResolvedValue({ id: 'credit-1', sourceItemId: 'item-1', requestedAmount: '-15.00', reason: '核对后调整' });
    await expect(request('SURCHARGE', '15.00')).rejects.toThrow('本次提交已失效');
  });

  it('rejects a credit source that belongs to another bound bill', async () => {
    tx.agentMonthlyBillItem.findUnique.mockResolvedValueOnce({
      id: 'item-from-another-bill',
      billId: 'another-bill',
      bill: { agentUserId: 'agent-2', period: '2026-05' },
    });

    await expect(
      createAgentMonthlyBillCredit(
        {
          expectedBillId: 'bound-bill',
          sourceItemId: 'item-from-another-bill',
          direction: 'CREDIT',
          amount: '30.00',
          reason: '跨账单伪造请求',
          idempotencyKey: 'credit-cross-bill',
        },
        { id: 'admin-1', role: Role.ADMIN },
      ),
    ).rejects.toThrow('来源工单不属于当前账单，请返回账单重新选择');
    expect(tx.agentMonthlyBillCredit.findUnique).not.toHaveBeenCalled();
    expect(tx.agentMonthlyBillCredit.create).not.toHaveBeenCalled();
  });
});
