import 'server-only';
import { cache } from 'react';
import { Prisma } from '@/generated/prisma/client';
import type { ProductCategory } from '@/generated/prisma/enums';
import { productCategoryLabel } from '@/lib/auth/role-labels';
import { analyticsRead, type AnalyticsActor } from './queries';
import { analyticsRange, analyticsUrl, type AnalyticsFilters } from './filters';
import type { AnalyticsGroup, AnalyticsMetric } from './types';

/** Overview aggregates stay in PostgreSQL and do not load or cap order details. */
export const getAnalyticsOverview = cache(async (actor: AnalyticsActor, filters: AnalyticsFilters) => analyticsRead(actor, async tx => {
  const { gte, lt } = analyticsRange(filters);
  const where = Prisma.sql`o."submittedAt" >= ${gte} AND o."submittedAt" < ${lt} AND o.status != 'CANCELLED' ${filters.sales ? Prisma.sql`AND o."submitterId" = ${filters.sales}` : Prisma.empty}`;
  const [totals, sales, categories] = await Promise.all([
    tx.$queryRaw<Array<{ count: bigint; processing: string; pending: bigint; free: bigint }>>`
      SELECT count(*) AS count, COALESCE(sum(o."processingAmount"), 0)::text AS processing,
        count(*) FILTER (WHERE o."pricingStatus" = 'PENDING_ADMIN_CONFIRMATION') AS pending,
        count(*) FILTER (WHERE o."billingMode" = 'NO_CHARGE') AS free FROM "Order" o WHERE ${where}`,
    tx.$queryRaw<Array<{ id: string; name: string; amount: string; count: bigint }>>`
      SELECT u.id, u."displayName" AS name, sum(o."processingAmount")::text AS amount, count(*) AS count
      FROM "Order" o JOIN "User" u ON u.id = o."submitterId" WHERE ${where} AND o."processingAmount" > 0
      GROUP BY u.id, u."displayName" ORDER BY sum(o."processingAmount") DESC, u.id LIMIT 10`,
    tx.$queryRaw<Array<{ category: string; count: bigint }>>`
      SELECT COALESCE(p.category::text, 'UNCATEGORIZED') AS category, count(DISTINCT o.id) AS count
      FROM "Order" o JOIN "OrderItem" i ON i."orderId" = o.id LEFT JOIN "Product" p ON p.id = i."productId"
      WHERE ${where} GROUP BY p.category ORDER BY count(DISTINCT o.id) DESC, category`,
  ]);
  const total = totals[0];
  const metrics: AnalyticsMetric[] = [
    { label: '提交工单', value: String(total?.count ?? 0), format: 'quantity', hint: '按提交日期，不含取消工单' },
    { label: '加工费', value: total?.processing ?? '0', format: 'money', hint: '含入袋加工费及待核价金额' },
    { label: '待核价', value: String(total?.pending ?? 0), format: 'quantity' },
    { label: '免费工单', value: String(total?.free ?? 0), format: 'quantity' },
  ];
  const ranking: AnalyticsGroup[] = sales.map(row => ({ name: row.name, value: row.amount, count: Number(row.count), href: analyticsUrl(filters, { view: 'orders', sales: row.id }) }));
  const distribution: AnalyticsGroup[] = categories.map(row => ({ name: row.category === 'UNCATEGORIZED' ? '未分类' : productCategoryLabel(row.category as ProductCategory), value: String(row.count), count: Number(row.count) }));
  return { metrics, ranking, distribution };
}));
