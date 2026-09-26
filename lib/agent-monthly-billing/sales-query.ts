import 'server-only';
import { AgentMonthlyBillStatus, Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';

type Actor = { id: string; role: Role };
const select = {
  id: true, period: true, status: true, memberSubtotal: true,
  adjustmentAmount: true, totalAmount: true, confirmedAt: true, paidAt: true,
} as const;

function scope(actor: Actor) {
  if (actor.role !== Role.SALES) throw new Error('仅销售可查询自己的账单');
  return { agentUserId: actor.id };
}

export async function listSalesMonthlyBills(actor: Actor, filter: { period?: string; status?: string } = {}) {
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(filter.period ?? '') ? filter.period : undefined;
  const status = Object.values(AgentMonthlyBillStatus).find((value) => value === filter.status);
  return db.agentMonthlyBill.findMany({
    where: { ...scope(actor), ...(period ? { period } : {}), ...(status ? { status } : {}) },
    select, orderBy: [{ period: 'desc' }, { id: 'desc' }],
  });
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
      } },
      adjustments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
        id: true, amount: true, credit: { select: { sourceItem: { select: { orderNoSnapshot: true } } } },
      } },
    },
  });
}
