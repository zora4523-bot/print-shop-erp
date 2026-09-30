import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentMonthlyBillStatus,
  OrderBillingMode,
  OrderSettlementType,
  OrderStatus,
} from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    agentMonthlyBill: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    order: { count: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getAgentMonthlyBillDetail,
  getAgentMonthlyBillingStats,
  listAgentMonthlyBills,
  listUnbilledAgentOrders,
} from '../query';

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.$transaction.mockImplementation((callback) => callback(dbMock));
  dbMock.agentMonthlyBill.groupBy.mockResolvedValue([]);
  dbMock.agentMonthlyBill.aggregate.mockResolvedValue({
    _sum: { totalAmount: '321.00' },
    _count: { _all: 2 },
  });
  dbMock.agentMonthlyBill.count.mockResolvedValue(0);
  dbMock.agentMonthlyBill.findMany.mockResolvedValue([]);
  dbMock.order.count.mockResolvedValue(3);
});

describe('agent monthly billing owner queries', () => {
  it('derives the receivable and unbilled cards only from v2 truth', async () => {
    await expect(getAgentMonthlyBillingStats()).resolves.toEqual({
      receivableAmount: '321.00',
      receivableBillCount: 2,
      unbilledOrderCount: 3,
      draftBillCount: 0,
    });
    expect(dbMock.agentMonthlyBill.aggregate).toHaveBeenCalledWith({
      where: { status: AgentMonthlyBillStatus.CONFIRMED },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });
    expect(dbMock.order.count).toHaveBeenCalledWith({
      where: {
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        billingMode: OrderBillingMode.CHARGE,
        status: { in: [OrderStatus.SETTLED, OrderStatus.CANCELLED] },
        settledFee: { not: null },
        settledAt: { not: null },
        agentMonthlyBillItem: { is: null },
      },
    });
  });

  it('paginates on the server and caps caller-controlled page size', async () => {
    dbMock.agentMonthlyBill.count.mockResolvedValue(205);
    await expect(
      listAgentMonthlyBills({
        period: '2026-05',
        status: AgentMonthlyBillStatus.PAID,
        agentUserId: 'agent-1',
        page: 2,
        pageSize: 500,
      }),
    ).resolves.toMatchObject({
      page: 2,
      pageSize: 100,
      total: 205,
      pageCount: 3,
    });
    expect(dbMock.agentMonthlyBill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          period: '2026-05',
          status: AgentMonthlyBillStatus.PAID,
          agentUserId: 'agent-1',
        },
        skip: 100,
        take: 100,
      }),
    );
  });

  it('summarizes the whole filtered population with the same filter as the page', async () => {
    dbMock.agentMonthlyBill.count.mockResolvedValue(61);
    dbMock.agentMonthlyBill.groupBy.mockResolvedValue([
      { status: AgentMonthlyBillStatus.CONFIRMED, _sum: { totalAmount: { toFixed: () => '6100.00' } }, _count: { _all: 61 } },
    ]);
    const result = await listAgentMonthlyBills({ period: '2026-08', status: AgentMonthlyBillStatus.CONFIRMED, agentUserId: 'agent-1', page: 3 });
    const listWhere = dbMock.agentMonthlyBill.findMany.mock.calls[0][0].where;
    expect(listWhere).toEqual({ period: '2026-08', status: AgentMonthlyBillStatus.CONFIRMED, agentUserId: 'agent-1' });
    expect(dbMock.agentMonthlyBill.count).toHaveBeenCalledWith({ where: listWhere });
    expect(dbMock.agentMonthlyBill.groupBy).toHaveBeenCalledWith({
      by: ['status'], where: listWhere, _sum: { totalAmount: true }, _count: { _all: true },
    });
    expect(result.summary).toEqual({
      DRAFT: { amount: '0.00', count: 0 },
      CONFIRMED: { amount: '6100.00', count: 61 },
      PAID: { amount: '0.00', count: 0 },
    });
  });

  it('joins each frozen member to its order name only for the detail label', async () => {
    dbMock.agentMonthlyBill.findUnique.mockResolvedValue(null);
    await expect(getAgentMonthlyBillDetail('bill-1')).resolves.toBeNull();
    const query = dbMock.agentMonthlyBill.findUnique.mock.calls[0][0];
    expect(query.where).toEqual({ id: 'bill-1' });
    // 客户名称/简称停用后明细改列工单名称：关联只取名称，金额等仍读成员快照。
    expect(query.include.items.include.order).toEqual({ select: { customName: true } });
  });
});

it('locates the same unbilled population using Shanghai settlement month and bounded paging', async () => {
  dbMock.order.count.mockResolvedValue(31);
  dbMock.order.findMany.mockResolvedValue([]);
  const result = await listUnbilledAgentOrders({ page: 999, period: '2026-09' });
  expect(result.page).toBe(2);
  expect(dbMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
    select: expect.objectContaining({ submitter: { select: { id: true, username: true, displayName: true } } }),
    skip: 30, take: 30, where: expect.objectContaining({
      billingMode: 'CHARGE', settlementType: 'EXTERNAL_SALES', agentMonthlyBillItem: { is: null },
      settledAt: { gte: new Date('2026-08-31T16:00:00Z'), lt: new Date('2026-09-30T16:00:00Z') },
    }),
  }));
});
