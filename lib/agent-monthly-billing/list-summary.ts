import type { Prisma } from '@/generated/prisma/client';
import type { AgentMonthlyBillStatus } from '@/generated/prisma/enums';

/** Aggregate bills directly: joining items, credits or receipts would multiply amounts. */
export async function summarizeAgentBills(tx: Prisma.TransactionClient, where: Prisma.AgentMonthlyBillWhereInput) {
  const groups = await tx.agentMonthlyBill.groupBy({
    by: ['status'], where, _sum: { totalAmount: true }, _count: { _all: true },
  });
  const summary: Record<AgentMonthlyBillStatus, { amount: string; count: number }> = {
    DRAFT: { amount: '0.00', count: 0 },
    CONFIRMED: { amount: '0.00', count: 0 },
    PAID: { amount: '0.00', count: 0 },
  };
  for (const group of groups) summary[group.status] = {
    amount: group._sum.totalAmount?.toFixed(2) ?? '0.00', count: group._count._all,
  };
  return summary;
}
