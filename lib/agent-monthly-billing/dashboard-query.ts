import 'server-only';
import Decimal from 'decimal.js';
import { db } from '@/lib/db';
import { Role } from '@/generated/prisma/enums';
import { formatDateInputShanghai } from '@/lib/format/dates';
import { AgentMonthlyBillingError } from './errors';

export function dashboardPeriods(now: Date) {
  const current = formatDateInputShanghai(now).slice(0, 7);
  const [year, month] = current.split('-').map(Number);
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 12 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export async function getAgentBillDashboard(actor: { role: Role }, now = new Date()) {
  if (actor.role !== Role.ADMIN) throw new AgentMonthlyBillingError('仅管理员可查看全部账单概览');
  const periods = dashboardPeriods(now);
  return db.$transaction(async (tx) => {
    const monthly = await tx.agentMonthlyBill.groupBy({
      by: ['period', 'status'], where: { period: { in: periods } },
      _sum: { totalAmount: true }, _count: { _all: true },
    });
    const accounts = await tx.agentMonthlyBill.groupBy({
      by: ['agentUserId'], where: { status: 'CONFIRMED' },
      _sum: { totalAmount: true }, _count: { _all: true },
      orderBy: [{ _sum: { totalAmount: 'desc' } }, { agentUserId: 'asc' }], take: 10,
    });
    return {
      periods: periods.map((period) => {
        const rows = monthly.filter((row) => row.period === period);
        const amount = (status: string) => rows.find((row) => row.status === status)?._sum.totalAmount?.toFixed(2) ?? '0.00';
        return { period, draft: amount('DRAFT'), confirmed: amount('CONFIRMED'), paid: amount('PAID'),
          total: rows.reduce((sum, row) => sum.plus(row._sum.totalAmount?.toString() ?? '0'), new Decimal(0)).toFixed(2) };
      }),
      accounts: accounts.map((row) => ({ agentUserId: row.agentUserId, amount: row._sum.totalAmount?.toFixed(2) ?? '0.00', count: row._count._all })),
    };
  }, { isolationLevel: 'RepeatableRead' });
}
