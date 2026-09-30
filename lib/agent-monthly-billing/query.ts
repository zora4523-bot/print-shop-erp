import type { Prisma } from '@/generated/prisma/client';
import { agentBillPeriodRange } from './period';
import { paginationWindow, paginatedResult } from '@/lib/admin/table';
import { agentBillWhere } from './list-filter';
import { summarizeAgentBills } from './list-summary';
import {
  AgentMonthlyBillStatus,
  OrderBillingMode,
  OrderSettlementType,
  OrderStatus,
} from '../../generated/prisma/enums';
import { db } from '../db';
import { AgentMonthlyBillingError } from './errors';
import { assertAgentBillPeriod } from './period';

export type AgentMonthlyBillListFilter = {
  period?: string;
  status?: AgentMonthlyBillStatus;
  agentUserId?: string;
  page?: number;
  pageSize?: number;
};

function pageNumber(value: number | undefined): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : 1;
}

function pageSize(value: number | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) < 1) return 30;
  return Math.min(value!, 100);
}

export async function listAgentMonthlyBills(
  filter: AgentMonthlyBillListFilter = {},
) {
  if (filter.period) assertAgentBillPeriod(filter.period);
  const page = pageNumber(filter.page);
  const take = pageSize(filter.pageSize);
  const where = agentBillWhere(filter);
  return db.$transaction(async (tx) => {
    const total = await tx.agentMonthlyBill.count({ where });
    const window = paginationWindow(total, page, take);
    const rows = await tx.agentMonthlyBill.findMany({
      where,
      select: {
        id: true,
        period: true,
        agentUserId: true,
        agentUsernameSnapshot: true,
        agentDisplayNameSnapshot: true,
        memberSubtotal: true,
        adjustmentAmount: true,
        totalAmount: true,
        status: true,
        confirmedAt: true,
        paidAt: true,
        _count: { select: { items: true } },
      },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: window.skip,
      take: window.take,
    });
    const summary = await summarizeAgentBills(tx, where);
    return { ...paginatedResult(rows, total, window), summary };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function getAgentMonthlyBillDetail(id: string) {
  if (!id.trim()) throw new AgentMonthlyBillingError('账单标识不合法');
  return db.agentMonthlyBill.findUnique({
    where: { id },
    include: {
      agentUser: {
        select: { id: true, username: true, displayName: true, role: true },
      },
      confirmedBy: {
        select: { id: true, displayName: true },
      },
      paidBy: {
        select: { id: true, displayName: true },
      },
      receipt: {
        include: {
          recordedBy: { select: { id: true, displayName: true } },
        },
      },
      items: {
        orderBy: [{ settledAtSnapshot: 'asc' }, { id: 'asc' }],
        include: {
          // 明细“工单名称”列：只取名称这一展示标签，金额与状态仍读成员冻结快照。
          order: { select: { customName: true } },
          credits: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: {
              createdBy: { select: { id: true, displayName: true } },
              allocations: {
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                include: {
                  bill: {
                    select: { id: true, period: true, status: true },
                  },
                },
              },
            },
          },
        },
      },
      adjustments: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          credit: {
            include: {
              sourceItem: {
                select: {
                  id: true,
                  orderId: true,
                  orderNoSnapshot: true,
                  bill: { select: { id: true, period: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function getAgentMonthlyBillingStats() {
  const [receivable, unbilledCount, draftCount] = await Promise.all([
    db.agentMonthlyBill.aggregate({
      where: { status: AgentMonthlyBillStatus.CONFIRMED },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    db.order.count({
      where: UNBILLED_AGENT_ORDER_WHERE,
    }),
    db.agentMonthlyBill.count({
      where: { status: AgentMonthlyBillStatus.DRAFT },
    }),
  ]);
  return {
    receivableAmount: String(receivable._sum.totalAmount ?? '0.00'),
    receivableBillCount: receivable._count._all,
    unbilledOrderCount: unbilledCount,
    draftBillCount: draftCount,
  };
}

export async function listAgentBillAccounts() {
  return db.user.findMany({
    where: {
      OR: [
        { agentMonthlyBills: { some: {} } },
        {
          submittedOrders: {
            some: { settlementType: OrderSettlementType.EXTERNAL_SALES },
          },
        },
      ],
    },
    select: { id: true, username: true, displayName: true, isActive: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
  });
}

const UNBILLED_AGENT_ORDER_WHERE = {
  settlementType: OrderSettlementType.EXTERNAL_SALES,
  billingMode: OrderBillingMode.CHARGE,
  status: { in: [OrderStatus.SETTLED, OrderStatus.CANCELLED] },
  settledFee: { not: null },
  settledAt: { not: null },
  agentMonthlyBillItem: { is: null },
} satisfies Prisma.OrderWhereInput;

export async function listUnbilledAgentOrders(filter: { page: number; period?: string }) {
  const range = filter.period ? agentBillPeriodRange(filter.period) : undefined;
  const where: Prisma.OrderWhereInput = {
    ...UNBILLED_AGENT_ORDER_WHERE,
    ...(range ? { settledAt: { gte: range.start, lt: range.end } } : {}),
  };
  return db.$transaction(async (tx) => {
    const total = await tx.order.count({ where });
    const window = paginationWindow(total, pageNumber(filter.page), 30);
    const rows = await tx.order.findMany({
      where, select: { id: true, orderNo: true, customName: true, settledAt: true, settledFee: true, submitter: { select: { id: true, username: true, displayName: true } } },
      orderBy: [{ settledAt: 'asc' }, { id: 'asc' }], skip: window.skip, take: window.take,
    });
    return paginatedResult(rows, total, window);
  }, { isolationLevel: 'RepeatableRead' });
}
