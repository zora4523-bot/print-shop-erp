import 'server-only';
import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';

import { paginationWindow, paginatedResult } from '@/lib/admin/table';
import { agentBillWhere, parseAgentBillFilters, type AgentBillSearchParams } from './list-filter';
import { summarizeAgentBills } from './list-summary';

type Actor = { id: string; role: Role };
const select = {
  id: true, period: true, status: true, memberSubtotal: true,
  adjustmentAmount: true, totalAmount: true, confirmedAt: true, paidAt: true,
} as const;

function scope(actor: Actor) {
  if (actor.role !== Role.SALES) throw new Error('仅销售可查询自己的账单');
  return { agentUserId: actor.id };
}

export async function listSalesMonthlyBills(actor: Actor, filter: AgentBillSearchParams = {}) {
  const parsed = parseAgentBillFilters(filter);
  // Ownership always comes from the authenticated actor, never from query parameters.
  const where = agentBillWhere({ ...parsed, ...scope(actor) });
  return db.$transaction(async (tx) => {
    const total = await tx.agentMonthlyBill.count({ where });
    const window = paginationWindow(total, parsed.page, 30);
    const rows = await tx.agentMonthlyBill.findMany({
      where, select, orderBy: [{ period: 'desc' }, { id: 'desc' }],
      skip: window.skip, take: window.take,
    });
    const summary = await summarizeAgentBills(tx, where);
    return { ...paginatedResult(rows, total, window), summary };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function getSalesMonthlyBill(actor: Actor, id: string) {
  return db.agentMonthlyBill.findFirst({
    where: { ...scope(actor), id },
    select: { ...select,
      receipt: { select: { amount: true, receivedAt: true, paymentMethod: true, referenceNo: true } },
      items: { orderBy: [{ settledAtSnapshot: 'asc' }, { id: 'asc' }], select: {
        id: true, orderId: true, orderNoSnapshot: true, workOrderVersionSnapshot: true, orderStatusSnapshot: true,
        settledFeeSnapshot: true, settledAtSnapshot: true,
        // 只取工单名称作明细标签；当前价格等工单事实仍不出现在销售账单投影里。
        order: { select: { customName: true } },
        credits: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
          id: true, requestedAmount: true, createdAt: true,
          allocations: { where: { bill: scope(actor) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
            id: true, amount: true, bill: { select: { id: true, period: true } },
          } },
        } },
      } },
      adjustments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
        id: true, amount: true, credit: { select: { sourceItem: { select: { orderNoSnapshot: true, bill: { select: { id: true, period: true } } } } } },
      } },
    },
  });
}
