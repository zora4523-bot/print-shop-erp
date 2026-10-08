import 'server-only';
import Decimal from 'decimal.js';
import { Prisma } from '@/generated/prisma/client';
import { calculateOrderCostBreakdown } from '@/lib/bill/costing';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { ANALYTICS_RECORD_LIMIT, type AnalyticsFilters } from './filters';
import { checkRecordLimit, type AnalyticsOrder, type AnalyticsTx } from './queries';
import { adjustmentTotals, paginateTable, sumMoney } from './reports';
import { moneyCell, textCell, type AnalyticsReport } from './types';

type CostAggregate = {
  id: string; tasks: bigint; taskAmount: string; operations: bigint; reports: bigint; wages: bigint; reportAmount: string;
  wageAmount: string; pendingWages: bigint; pendingProduction: bigint; outsources: bigint; outsourceAmount: string; pendingOutsources: bigint;
};

/** Aggregate immutable sources in SQL, then use the existing generation/fallback policy. */
export async function costReport(tx: AnalyticsTx, orders: AnalyticsOrder[], filters: AnalyticsFilters, all = false): Promise<AnalyticsReport> {
  const roots = orders.filter(order => !order.sourceOrderId);
  const reworks = roots.length ? await tx.order.findMany({ where: { sourceOrderId: { in: roots.map(order => order.id) } }, select: { id: true, sourceOrderId: true, orderNo: true }, take: ANALYTICS_RECORD_LIMIT + 1 }) : [];
  checkRecordLimit(roots.length + reworks.length);
  const ids = [...roots.map(order => order.id), ...reworks.map(order => order.id)];
  const raw = ids.length ? await tx.$queryRaw<CostAggregate[]>`
    WITH scope AS (SELECT id FROM "Order" WHERE id IN (${Prisma.join(ids)})),
    legacy AS (
      SELECT i."orderId", count(t.id) AS count, sum(t."pieceworkAmount") AS amount
      FROM "OrderItem" i JOIN scope s ON s.id = i."orderId"
      JOIN "ProductionTask" t ON t."orderItemId" = i.id AND t.status = 'COMPLETED' GROUP BY i."orderId"
    ), operations AS (
      SELECT o."orderId", count(DISTINCT o.id) AS count, count(r.id) AS reports, sum(r.amount) AS amount
      FROM "ProductionOperation" o JOIN scope s ON s.id = o."orderId"
      LEFT JOIN "ProductionReport" r ON r."operationId" = o.id GROUP BY o."orderId"
    ), wages AS (
      SELECT j."orderId", sum(w.amount) AS amount, count(w.amount) AS count, count(w.id) FILTER (WHERE w.amount IS NULL) AS pending
      FROM "ProductionJob" j JOIN scope s ON s.id = j."orderId"
      JOIN "ProductionWage" w ON w."jobId" = j.id GROUP BY j."orderId"
    ), obligations AS (
      SELECT j."orderId", count(*) AS pending FROM "ProductionJob" j
      JOIN scope s ON s.id = j."orderId"
      LEFT JOIN "ProductionFactReview" r ON r."jobId" = j.id
      WHERE j.status = 'REQUESTED' OR r.status IN ('OPEN', 'CONFLICT', 'WAGES_DUE')
      GROUP BY j."orderId"
    ), outsource AS (
      SELECT o."orderId", count(o.amount) AS count, sum(o.amount) AS amount, count(*) FILTER (WHERE o.amount IS NULL) AS pending
      FROM "OutsourceOrder" o JOIN scope s ON s.id = o."orderId" WHERE o.status != 'CANCELLED' GROUP BY o."orderId"
    )
    SELECT s.id, COALESCE(l.count, 0) AS tasks, COALESCE(l.amount, 0)::text AS "taskAmount",
      COALESCE(p.count, 0) AS operations, COALESCE(p.reports, 0) AS reports, COALESCE(w.count, 0) AS wages, COALESCE(p.amount, 0)::text AS "reportAmount",
      COALESCE(w.amount, 0)::text AS "wageAmount", COALESCE(w.pending, 0) AS "pendingWages",
      COALESCE(f.pending, 0) AS "pendingProduction",
      COALESCE(o.count, 0) AS outsources, COALESCE(o.amount, 0)::text AS "outsourceAmount", COALESCE(o.pending, 0) AS "pendingOutsources"
    FROM scope s LEFT JOIN legacy l ON l."orderId" = s.id LEFT JOIN operations p ON p."orderId" = s.id
    LEFT JOIN wages w ON w."orderId" = s.id LEFT JOIN obligations f ON f."orderId" = s.id
    LEFT JOIN outsource o ON o."orderId" = s.id
  ` : [];
  const entries = ids.length ? await tx.orderCostEntry.groupBy({ by: ['orderId', 'category'], where: { orderId: { in: ids } }, _sum: { amount: true }, _count: true }) : [];
  const byId = new Map(raw.map(row => [row.id, row]));
  const manual = new Map<string, typeof entries>();
  for (const entry of entries) manual.set(entry.orderId, [...(manual.get(entry.orderId) ?? []), entry]);
  const children = new Map<string, typeof reworks>();
  for (const rework of reworks) if (rework.sourceOrderId) children.set(rework.sourceOrderId, [...(children.get(rework.sourceOrderId) ?? []), rework]);
  function source(id: string) {
    const row = byId.get(id);
    return {
      items: [{ tasks: row && row.tasks > BigInt(0) ? [{ pieceworkAmount: row.taskAmount }] : [] }],
      productionOperations: row && row.operations > BigInt(0) ? [{ reports: [{ amount: row.reportAmount }] }] : [],
      productionJobs: row && row.wages > BigInt(0) ? [{ wages: [{ amount: row.wageAmount }] }] : [],
      outsourceOrders: row && row.outsources > BigInt(0) ? [{ amount: row.outsourceAmount }] : [],
      costEntries: (manual.get(id) ?? []).map(entry => ({ category: entry.category, amount: entry._sum.amount?.toString() ?? '0' })),
    };
  }
  const results = roots.map(order => {
    const related = [order.id, ...(children.get(order.id) ?? []).map(child => child.id)];
    const costs = calculateOrderCostBreakdown({ ...source(order.id), reworkOrders: related.slice(1).map(source) });
    const pending = related.some(id => { const row = byId.get(id); return row && (row.pendingWages > BigInt(0) || row.pendingProduction > BigInt(0) || row.pendingOutsources > BigInt(0)); });
    const hasEvidence = related.some(id => { const row = byId.get(id); return (manual.get(id)?.length ?? 0) > 0 || (row && (row.tasks > BigInt(0) || row.reports > BigInt(0) || row.outsources > BigInt(0) || row.wages > BigInt(0))); });
    const frozen = order.agentMonthlyBillItem;
    const fee = frozen && frozen.bill.status !== 'DRAFT' ? frozen.settledFeeSnapshot.toString() : order.settledFee?.toString() ?? null;
    const adjustment = adjustmentTotals(order);
    return { order, costs, fee, pending, hasEvidence, adjustment, difference: order.status !== 'CANCELLED' && adjustment.count === 0 && fee !== null && hasEvidence && !pending ? new Decimal(fee).minus(costs.totalCost).toFixed(2) : null };
  });
  const comparable = results.filter(row => row.difference !== null);
  return {
    metrics: [
      { label: '原工单', value: String(roots.length), format: 'quantity', hint: '按原单提交日期，包含取消工单' },
      { label: '已记成本', value: sumMoney(results.map(row => row.costs.totalCost)), format: 'money', hint: '包含关联重做成本' },
      { label: '可核对差额', value: comparable.length ? sumMoney(comparable.map(row => row.difference)) : null, format: 'money', hint: `${comparable.length} 单结算金额减已记成本，非完整利润` },
      { label: '成本待核对', value: String(results.filter(row => row.pending || !row.hasEvidence).length), format: 'quantity' },
    ],
    tables: [
      { title: '成本构成', columns: ['项目', '已记金额'], rows: [
        [textCell('计件与提成'), moneyCell(sumMoney(results.map(row => row.costs.piecework)))],
        [textCell('外协'), moneyCell(sumMoney(results.map(row => row.costs.outsource)))],
        [textCell('材料及其他手工成本'), moneyCell(sumMoney(results.map(row => row.costs.manual)))],
        [textCell('重做成本'), moneyCell(sumMoney(results.map(row => row.costs.rework)))],
      ] },
      { title: '本期提交的重做工单', columns: ['重做工单', '原工单'], rows: orders.filter(order => order.sourceOrderId).map(order => [textCell(order.customName || order.orderNo, `/orders/${order.id}`), textCell('查看原工单', `/orders/${order.sourceOrderId}`)]), note: '重做成本按原工单提交日期归集，不在本期重复相加。' },
    ],
    ...paginateTable({ title: '逐单成本', columns: ['工单', '状态', '结算金额', '计件与提成', '外协', '材料及其他', '重做', '已记成本', '差额', '成本记录', '抵扣/补收', '已入账调整'], rows: results.map(({ order, costs, fee, pending, hasEvidence, difference, adjustment }) => [textCell(order.customName || order.orderNo, `/orders/${order.id}`), textCell(ORDER_STATUS_REGISTRY[order.status].label), moneyCell(fee), moneyCell(costs.piecework.toFixed(2)), moneyCell(costs.outsource.toFixed(2)), moneyCell(costs.manual.toFixed(2)), moneyCell(costs.rework.toFixed(2)), moneyCell(hasEvidence ? costs.totalCost.toFixed(2) : null), moneyCell(difference), textCell(order.status === 'CANCELLED' ? '取消结算，不计差额' : adjustment.count ? '有后续调整，不计差额' : pending ? '有金额待核' : hasEvidence ? '已有记录，完整性待核' : '待录'), moneyCell(adjustment.requested), moneyCell(adjustment.applied)]) }, filters.page, all),
    notes: ['有抵扣/补收的工单单列调整金额，不计入可核对差额。差额仅覆盖结算金额与已有成本均可核对的工单；未分摊的期间费用、未录材料和损耗不代表零。取消工单的已有成本仍计入。'],
  };
}
