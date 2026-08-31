import Decimal from 'decimal.js';
import { OrderCostCategory } from '../../generated/prisma/enums';

type CostOrder = {
  productionOperations?: Array<{
    reports: Array<{ amount: Decimal.Value }>;
  }>;
  items: Array<{
    tasks: Array<{ pieceworkAmount: Decimal.Value }>;
  }>;
  outsourceOrders: Array<{ amount: Decimal.Value | null }>;
  costEntries: Array<{
    category: OrderCostCategory;
    amount: Decimal.Value;
  }>;
};

type CostOrderWithReworks = CostOrder & { reworkOrders: CostOrder[] };

type DetailedCostEntry = CostOrder['costEntries'][number] & {
  id: string;
  description: string;
  quantity: Decimal.Value | null;
  unit: string | null;
  unitPrice: Decimal.Value | null;
  remark: string | null;
  createdAt: Date;
  createdBy: { displayName: string };
};

type DetailedCostOrder = Omit<CostOrder, 'costEntries'> & {
  id: string;
  orderNo: string;
  costEntries: DetailedCostEntry[];
};

type DetailedCostOrderWithReworks = DetailedCostOrder & {
  reworkOrders: DetailedCostOrder[];
};

export type OrderCostBreakdown = {
  piecework: Decimal;
  pieceworkSource: 'automatic' | 'legacy' | 'none';
  outsource: Decimal;
  outsourceSource: 'automatic' | 'legacy' | 'none';
  manual: Decimal;
  rework: Decimal;
  totalCost: Decimal;
};

export type OrderCostEntryDetail = {
  sourceOrderId: string;
  sourceOrderNo: string;
  source: 'original' | 'rework';
  includedInCostTotal: boolean;
  entry: DetailedCostEntry;
};

const AUTOMATIC_COST_CATEGORIES = new Set<OrderCostCategory>([
  OrderCostCategory.PIECEWORK,
  OrderCostCategory.OUTSOURCE,
]);

function directCost(order: CostOrder) {
  const completedTasks = order.items.flatMap((item) => item.tasks);
  const legacyTaskPiecework = completedTasks.reduce(
    (sum, task) => sum.plus(new Decimal(task.pieceworkAmount)),
    new Decimal(0),
  );
  // Generation-exclusive read: an order with new operations is costed only
  // from immutable ProductionReport snapshots (including signed reversals).
  // Legacy ProductionTask amounts remain the historical source only when the
  // order has no new-generation operation at all.
  const hasOperationLedger = (order.productionOperations?.length ?? 0) > 0;
  const operationPiecework = (order.productionOperations ?? [])
    .flatMap((operation) => operation.reports)
    .reduce(
      (sum, report) => sum.plus(new Decimal(report.amount)),
      new Decimal(0),
    );
  const automaticPiecework = hasOperationLedger
    ? operationPiecework
    : legacyTaskPiecework;
  const postedOutsourceOrders = order.outsourceOrders.filter(
    (entry) => entry.amount !== null,
  );
  const automaticOutsource = postedOutsourceOrders.reduce(
    (sum, entry) => sum.plus(new Decimal(entry.amount ?? 0)),
    new Decimal(0),
  );
  // New manual PIECEWORK / OUTSOURCE rows are rejected at the write boundary.
  // Historical rows predate that rule, though, and may be the only surviving
  // cost evidence. Suppress them only when the corresponding authoritative
  // ledger actually has evidence; otherwise retain them as the historical
  // fallback instead of silently understating an old bill.
  const hasAutomaticPiecework = hasOperationLedger || completedTasks.length > 0;
  const hasAutomaticOutsource = postedOutsourceOrders.length > 0;
  const legacyPiecework = order.costEntries.reduce(
    (sum, entry) =>
      entry.category === OrderCostCategory.PIECEWORK
        ? sum.plus(new Decimal(entry.amount))
        : sum,
    new Decimal(0),
  );
  const legacyOutsource = order.costEntries.reduce(
    (sum, entry) =>
      entry.category === OrderCostCategory.OUTSOURCE
        ? sum.plus(new Decimal(entry.amount))
        : sum,
    new Decimal(0),
  );
  const piecework = hasAutomaticPiecework
    ? automaticPiecework
    : legacyPiecework;
  const outsource = hasAutomaticOutsource
    ? automaticOutsource
    : legacyOutsource;
  const manual = order.costEntries.reduce(
    (sum, entry) =>
      AUTOMATIC_COST_CATEGORIES.has(entry.category)
        ? sum
        : sum.plus(new Decimal(entry.amount)),
    new Decimal(0),
  );
  return {
    piecework,
    pieceworkSource: hasAutomaticPiecework
      ? 'automatic'
      : legacyPiecework.isZero()
        ? 'none'
        : 'legacy',
    outsource,
    outsourceSource: hasAutomaticOutsource
      ? 'automatic'
      : legacyOutsource.isZero()
        ? 'none'
        : 'legacy',
    manual,
  } as const;
}

export function calculateOrderCostBreakdown(
  order: CostOrderWithReworks,
): OrderCostBreakdown {
  const direct = directCost(order);
  const rework = order.reworkOrders.reduce((sum, reworkOrder) => {
    const costs = directCost(reworkOrder);
    return sum.plus(costs.piecework).plus(costs.outsource).plus(costs.manual);
  }, new Decimal(0));
  return {
    piecework: direct.piecework,
    pieceworkSource: direct.pieceworkSource,
    outsource: direct.outsource,
    outsourceSource: direct.outsourceSource,
    manual: direct.manual,
    rework,
    totalCost: direct.piecework
      .plus(direct.outsource)
      .plus(direct.manual)
      .plus(rework),
  };
}

/**
 * Lists every auditable manual cost row from the billed order and its reworks.
 * `includedInCostTotal` mirrors `directCost`: historical PIECEWORK/OUTSOURCE
 * rows remain visible, but are excluded once their authoritative production
 * ledger has evidence.
 */
export function listOrderCostEntryDetails(
  order: DetailedCostOrderWithReworks,
): OrderCostEntryDetail[] {
  const collect = (
    sourceOrder: DetailedCostOrder,
    source: OrderCostEntryDetail['source'],
  ) => {
    const costs = directCost(sourceOrder);
    return sourceOrder.costEntries.map((entry) => {
      const includedInCostTotal =
        entry.category === OrderCostCategory.PIECEWORK
          ? costs.pieceworkSource === 'legacy'
          : entry.category === OrderCostCategory.OUTSOURCE
            ? costs.outsourceSource === 'legacy'
            : true;
      return {
        sourceOrderId: sourceOrder.id,
        sourceOrderNo: sourceOrder.orderNo,
        source,
        includedInCostTotal,
        entry,
      };
    });
  };

  return [
    ...collect(order, 'original'),
    ...order.reworkOrders.flatMap((reworkOrder) =>
      collect(reworkOrder, 'rework'),
    ),
  ];
}

export function isAutomaticOrderCostCategory(
  category: OrderCostCategory,
): boolean {
  return AUTOMATIC_COST_CATEGORIES.has(category);
}
