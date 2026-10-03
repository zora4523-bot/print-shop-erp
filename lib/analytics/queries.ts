import 'server-only';
import { cache } from 'react';
import Decimal from 'decimal.js';
import { Prisma } from '@/generated/prisma/client';
import { Role, OrderCraft } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { UnauthorizedError } from '@/lib/auth/errors';
import { canonicalAnalyticsCraft } from './crafts';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { ANALYTICS_RECORD_LIMIT, AnalyticsInputError, analyticsRange, type AnalyticsFilters } from './filters';

export type AnalyticsActor = { id: string; role: Role };
export function assertAnalyticsActor(actor: AnalyticsActor) {
  if (actor.role !== Role.ADMIN) throw new UnauthorizedError('无权查看经营数据');
}
export type AnalyticsTx = Prisma.TransactionClient;
export async function analyticsRead<T>(actor: AnalyticsActor, read: (tx: AnalyticsTx) => Promise<T>): Promise<T> {
  assertAnalyticsActor(actor);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
    return read(tx);
  }, { isolationLevel: 'RepeatableRead', timeout: 15000, maxWait: 5000 });
}

export function orderWhere(filters: AnalyticsFilters, includeCancelled = false, craftIds?: string[]): Prisma.OrderWhereInput {
  const items: Prisma.OrderItemWhereInput = {
    ...(filters.paper ? { paperType: filters.paper } : {}),
    ...(filters.craft ? { OR: [
      ...(Object.values(OrderCraft).includes(filters.craft as OrderCraft) ? [{ craft: filters.craft as OrderCraft }] : []),
      { crafts: craftIds ? { hasSome: craftIds } : { has: filters.craft } },
    ] } : {}),
  };
  return {
    submittedAt: analyticsRange(filters),
    ...(!includeCancelled ? { status: { not: 'CANCELLED' } } : {}),
    ...(filters.sales ? { submitterId: filters.sales } : {}),
    ...(filters.customer ? { customerRef: filters.customer } : {}),
    ...(filters.paper || filters.craft ? { items: { some: items } } : {}),
    ...(filters.q ? { OR: [{ orderNo: { contains: filters.q, mode: 'insensitive' } }, { customName: { contains: filters.q, mode: 'insensitive' } }, { customerRef: { contains: filters.q, mode: 'insensitive' } }] } : {}),
  };
}

export const orderSelect = {
  id: true, orderNo: true, customName: true, customerRef: true, submittedAt: true,
  status: true, kind: true, sourceOrderId: true, billingMode: true, pricingStatus: true,
  processingAmount: true, packagingAmount: true, settledFee: true, settledAt: true,
  submitter: { select: { id: true, displayName: true, role: true } },
  items: { select: { id: true, craft: true, crafts: true, paperType: true, specification: true, quantity: true, subtotal: true, product: { select: { category: true } } } },
  customerCharges: { select: { amount: true, status: true, category: { select: { name: true } } } },
  agentMonthlyBillItem: { select: { settledFeeSnapshot: true, settlementDetailSnapshot: true, credits: { select: { requestedAmount: true, allocations: { select: { amount: true, bill: { select: { status: true } } } } } }, bill: { select: { id: true, status: true } } } },
} satisfies Prisma.OrderSelect;
export type AnalyticsOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

export function checkRecordLimit(count: number, limit = ANALYTICS_RECORD_LIMIT) {
  if (count > limit) throw new AnalyticsInputError(`当前范围超过 ${limit} 条记录，请缩短日期范围或增加筛选条件。`);
}
export async function readOrders(tx: AnalyticsTx, filters: AnalyticsFilters, includeCancelled = false) {
  let craftIds: string[] | undefined;
  if (filters.craft) {
    const crafts = await tx.craft.findMany({ select: { id: true, name: true } });
    const names = new Map(crafts.map(craft => [craft.id, craft.name]));
    const craft = canonicalAnalyticsCraft(filters.craft, names);
    craftIds = [...new Set([craft, ...crafts.filter(row => canonicalAnalyticsCraft(row.id, names) === craft).map(row => row.id)])];
    filters = { ...filters, craft };
  }
  const where = orderWhere(filters, includeCancelled, craftIds);
  const count = await tx.order.count({ where });
  checkRecordLimit(count);
  // Count and rows share the same repeatable-read snapshot; no truncated totals.
  return tx.order.findMany({ where, select: orderSelect, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: ANALYTICS_RECORD_LIMIT });
}

export const getAnalyticsCrafts = cache((actor: AnalyticsActor) => analyticsRead(actor, tx => tx.craft.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })));

export const getAnalyticsSales = cache(async (actor: AnalyticsActor) => {
  assertAnalyticsActor(actor);
  return db.user.findMany({ where: { role: { in: ['SALES', 'ADMIN'] } }, select: { id: true, displayName: true }, orderBy: [{ displayName: 'asc' }, { id: 'asc' }], take: 1000 });
});

export async function readAnalyticsFinance(tx: AnalyticsTx, filters: AnalyticsFilters) {
    const scope = filters.sales ? { agentUserId: filters.sales } : {};
    const [issued, receipts, outstanding, settled] = await Promise.all([
      tx.agentMonthlyBill.aggregate({ where: { ...scope, status: { in: ['CONFIRMED', 'PAID'] }, confirmedAt: analyticsRange(filters) }, _sum: { totalAmount: true }, _count: true }),
      tx.agentMonthlyBillReceipt.aggregate({ where: { receivedAt: analyticsRange(filters), ...(filters.sales ? { bill: { agentUserId: filters.sales } } : {}) }, _sum: { amount: true }, _count: true }),
      tx.agentMonthlyBill.aggregate({ where: { ...scope, status: 'CONFIRMED' }, _sum: { totalAmount: true }, _count: true }),
      tx.order.aggregate({ where: { settlementType: 'EXTERNAL_SALES', settledAt: analyticsRange(filters), ...(filters.sales ? { submitterId: filters.sales } : {}) }, _sum: { settledFee: true }, _count: true }),
    ]);
    const money = (value: { toString(): string } | null) => new Decimal(value?.toString() ?? 0).toFixed(2);
    return { issued: money(issued._sum.totalAmount), received: money(receipts._sum.amount), outstanding: money(outstanding._sum.totalAmount), settled: money(settled._sum.settledFee) };
}
export const getAnalyticsFinance = (actor: AnalyticsActor, filters: AnalyticsFilters) => analyticsRead(actor, tx => readAnalyticsFinance(tx, filters));

export async function readAnalyticsTrend(tx: AnalyticsTx, filters: AnalyticsFilters) {
    const { gte, lt } = analyticsRange(filters);
    const monthly = (lt.getTime() - gte.getTime()) / 86400000 > 62;
    const format = monthly ? 'YYYY-MM' : 'YYYY-MM-DD';
    const rows = await tx.$queryRaw<Array<{ day: string; count: bigint; submitted: bigint }>>`
      WITH events AS (
        SELECT "completedAt" AS date, 1 AS completed, 0 AS submitted FROM "Order"
        WHERE "completedAt" >= ${gte} AND "completedAt" < ${lt} AND status != 'CANCELLED'
        ${filters.sales ? Prisma.sql`AND "submitterId" = ${filters.sales}` : Prisma.empty}
        UNION ALL
        SELECT "submittedAt" AS date, 0 AS completed, 1 AS submitted FROM "Order"
        WHERE "submittedAt" >= ${gte} AND "submittedAt" < ${lt} AND status != 'CANCELLED'
        ${filters.sales ? Prisma.sql`AND "submitterId" = ${filters.sales}` : Prisma.empty}
      )
      SELECT to_char(((date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai'), ${format}) AS day,
        sum(completed) AS count, sum(submitted) AS submitted FROM events GROUP BY day ORDER BY day`;
    const counts = new Map(rows.map(row => [row.day, { count: Number(row.count), submitted: Number(row.submitted) }]));
    const keys = new Set<string>();
    for (let time = gte.getTime(); time < lt.getTime(); time += 86400000) keys.add(todayShanghai(new Date(time)).slice(0, monthly ? 7 : 10));
    return [...keys].map(day => ({ day, count: counts.get(day)?.count ?? 0, submitted: counts.get(day)?.submitted ?? 0 }));
}
export const getAnalyticsTrend = (actor: AnalyticsActor, filters: AnalyticsFilters) => analyticsRead(actor, tx => readAnalyticsTrend(tx, filters));
