import 'server-only';
import { analyticsRead, readOrders, type AnalyticsTx, type AnalyticsActor } from './queries';
import { categoryGroups, orderReport, structureReport } from './reports';
import { costReport } from './costs';
import { inventoryReport } from './inventory';
import { quantityCell, textCell } from './types';
import type { AnalyticsFilters } from './filters';

export async function getAnalyticsReport(actor: AnalyticsActor, filters: AnalyticsFilters, all = false) {
  return analyticsRead(actor, tx => readAnalyticsReport(tx, filters, all));
}
export async function readAnalyticsReport(tx: AnalyticsTx, filters: AnalyticsFilters, all = false) {
    if (filters.view === 'inventory') return inventoryReport(tx, filters, all);
    const orders = await readOrders(tx, filters, filters.view === 'costs');
    if (filters.view === 'costs') return costReport(tx, orders, filters, all);
    if (filters.view === 'structure') {
      const crafts = await tx.craft.findMany({ select: { id: true, name: true } });
      return structureReport(orders, filters, new Map(crafts.map(craft => [craft.id, craft.name])), all);
    }
    const report = orderReport(orders, filters, all);
    if (filters.view === 'overview') report.tables.unshift({ title: '产品线分布', columns: ['产品线', '工单数'], rows: categoryGroups(orders).map(group => [textCell(group.name), quantityCell(String(group.count))]), note: '同一工单可属于多条产品线，各组不可相加。' });
    return report;
}
