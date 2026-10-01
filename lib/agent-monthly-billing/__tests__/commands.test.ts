import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMonthlyBillStatus, Role } from '../../../generated/prisma/enums';

const { tx, dbMock, events, synchronizeMock, clockMock } = vi.hoisted(() => {
  const events: string[] = [];
  const tx = {
    agentMonthlyBill: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    agentMonthlyBillReceipt: { create: vi.fn() },
    agentMonthlyBillItem: { findUnique: vi.fn() },
    agentMonthlyBillCredit: { findUnique: vi.fn(), create: vi.fn() },
    agentMonthlyBillAdjustment: { deleteMany: vi.fn() },
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
