import Decimal from 'decimal.js';
import { ANALYTICS_CRAFT_LABELS, canonicalAnalyticsCraft } from './crafts';
import { productCategoryLabel } from '@/lib/auth/role-labels';
import type { ProductCategory } from '@/generated/prisma/enums';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { readBillSettlementDetail } from '@/lib/agent-monthly-billing/settlement-detail';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { ANALYTICS_PAGE_SIZE, analyticsUrl, type AnalyticsFilters } from './filters';
import type { AnalyticsOrder } from './queries';
import { moneyCell, quantityCell, textCell, type AnalyticsGroup, type AnalyticsReport, type AnalyticsTable } from './types';

export const sumMoney = (values: Array<Decimal.Value | null>) => values.reduce<Decimal>((sum, value) => sum.plus(value ?? 0), new Decimal(0)).toFixed(2);
export function paginateTable(details: AnalyticsTable, page: number, all = false) {
  const total = details.rows.length, pages = Math.max(1, Math.ceil(total / ANALYTICS_PAGE_SIZE));
  const current = Math.min(page, pages);
  return { details: { ...details, rows: all ? details.rows : details.rows.slice((current - 1) * ANALYTICS_PAGE_SIZE, current * ANALYTICS_PAGE_SIZE) }, total, page: current, pages };
}

export function salesGroups(orders: AnalyticsOrder[], filters: AnalyticsFilters): AnalyticsGroup[] {
  const map = new Map<string, { name: string; total: Decimal; count: number }>();
  for (const order of orders) {
    if (new Decimal(order.processingAmount.toString()).lte(0)) continue;
    const group = map.get(order.submitter.id) ?? { name: order.submitter.displayName, total: new Decimal(0), count: 0 };
    group.total = group.total.plus(order.processingAmount.toString()); group.count++;
    map.set(order.submitter.id, group);
  }
  return [...map].sort((a, b) => b[1].total.comparedTo(a[1].total) || a[0].localeCompare(b[0])).map(([id, group]) => ({ name: group.name, value: group.total.toFixed(2), count: group.count, href: analyticsUrl(filters, { view: 'orders', sales: id, page: 1 }) }));
}

export function categoryGroups(orders: AnalyticsOrder[]): AnalyticsGroup[] {
  const groups = new Map<string, Set<string>>();
  for (const order of orders) for (const item of order.items) {
    const category = item.product?.category ?? 'UNCATEGORIZED';
    const ids = groups.get(category) ?? new Set(); ids.add(order.id); groups.set(category, ids);
  }
  return [...groups].map(([key, orders]) => ({ name: key === 'UNCATEGORIZED' ? '未分类' : productCategoryLabel(key as ProductCategory), value: String(orders.size), count: orders.size })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function adjustmentTotals(order: AnalyticsOrder) {
  const credits = order.agentMonthlyBillItem?.credits ?? [];
  const requested = sumMoney(credits.map(credit => credit.requestedAmount.toString()));
  const applied = sumMoney(credits.flatMap(credit => credit.allocations.filter(allocation => allocation.bill.status !== 'DRAFT').map(allocation => allocation.amount.toString())));
  return { count: credits.length, requested, applied, remaining: new Decimal(requested).minus(applied).toFixed(2) };
}

export function orderReport(orders: AnalyticsOrder[], filters: AnalyticsFilters, all = false): AnalyticsReport {
  const pending = orders.filter(order => order.pricingStatus === 'PENDING_ADMIN_CONFIRMATION').length;
  const feeGroups = new Map<string, Decimal>();
  let uncovered = 0;
  const add = (name: string, amount: Decimal.Value) => feeGroups.set(name, (feeGroups.get(name) ?? new Decimal(0)).plus(amount));
  for (const order of orders) {
    const frozen = order.agentMonthlyBillItem;
    if (frozen && frozen.bill.status !== 'DRAFT') {
      const evidence = readBillSettlementDetail(frozen.settlementDetailSnapshot, frozen.settledFeeSnapshot.toString());
      if (!evidence) { uncovered++; add('已出账未分解', frozen.settledFeeSnapshot.toString()); continue; }
      if (evidence.processingAmount !== null) add('加工费（含入袋）', evidence.processingAmount);
      for (const charge of evidence.charges) add('其他收费（已出账）', charge.amount);
    } else {
      add('加工费（含入袋）', order.processingAmount.toString());
      let missing = false;
      for (const charge of order.customerCharges) {
        if (charge.status === 'WAIVED') continue;
        if (charge.amount === null) { missing = true; continue; }
        add(`${charge.category.name}${charge.status === 'ESTIMATED' ? '（预估）' : ''}`, charge.amount.toString());
      }
      if (missing) uncovered++;
    }
  }
  const customers = new Map<string, { count: number; total: Decimal }>();
  for (const order of orders) {
    const key = order.customerRef ?? '';
    const group = customers.get(key) ?? { count: 0, total: new Decimal(0) };
    group.count++; group.total = group.total.plus(order.processingAmount.toString()); customers.set(key, group);
  }
  return {
    metrics: [
      { label: '提交工单', value: String(orders.length), format: 'quantity', hint: '按提交日期，取消工单另在成本中核对' },
      { label: '加工费', value: sumMoney(orders.map(o => o.processingAmount.toString())), format: 'money', hint: '含入袋加工费及待核价金额' },
      { label: '待核价', value: String(pending), format: 'quantity' },
      { label: '免费工单', value: String(orders.filter(o => o.billingMode === 'NO_CHARGE').length), format: 'quantity' },
    ],
    tables: [
      { title: '销售排行', columns: ['销售', '加工费', '工单数'], rows: salesGroups(orders, filters).map(g => [textCell(g.name, g.href), moneyCell(g.value), quantityCell(String(g.count))]) },
      { title: '客户加工费', columns: ['客户', '加工费', '工单数'], rows: [...customers].sort((a, b) => b[1].total.comparedTo(a[1].total)).map(([name, g]) => [textCell(name || '未填客户', name ? analyticsUrl(filters, { customer: name, page: 1 }) : undefined), moneyCell(g.total.toFixed(2)), quantityCell(String(g.count))]) },
      { title: '抵扣与补收', columns: ['工单', '抵扣/补收', '已入账', '待入账'], rows: orders.flatMap(order => { const adjustment = adjustmentTotals(order); return adjustment.count ? [[textCell(order.customName || order.orderNo, `/orders/${order.id}`), moneyCell(adjustment.requested), moneyCell(adjustment.applied), moneyCell(adjustment.remaining)]] : []; }), note: '按所选原工单归集全部后续调整；负数为抵扣，正数为补收，不重复加入加工费。' },
      { title: '收费构成', columns: ['收费项目', '已知金额'], rows: [...feeGroups].map(([name, amount]) => [textCell(name), moneyCell(amount.toFixed(2))]), note: `已出账工单使用账单金额；${uncovered} 单的分项待核对。加工费已含入袋费。` },
    ],
    ...paginateTable({ title: '工单明细', columns: ['工单', '销售', '客户', '提交日期', '加工费', '状态'], rows: orders.map(o => [textCell(o.customName || o.orderNo, `/orders/${o.id}`), textCell(o.submitter.displayName), textCell(o.customerRef), textCell(o.submittedAt ? todayShanghai(o.submittedAt) : null), moneyCell(o.processingAmount.toString()), textCell(ORDER_STATUS_REGISTRY[o.status].label)]) }, filters.page, all),
    notes: [],
  };
}

export function structureReport(orders: AnalyticsOrder[], filters: AnalyticsFilters, craftNames: Map<string, string>, all = false): AnalyticsReport {
  const craftLabel = (value: string) => craftNames.get(value) ?? (ANALYTICS_CRAFT_LABELS[value] ?? '历史工艺');
  const craftKeys = (item: AnalyticsOrder['items'][number]) => [...new Set([...(item.craft ? [item.craft] : []), ...item.crafts].map(key => canonicalAnalyticsCraft(key, craftNames)))];
  const selectedCraft = canonicalAnalyticsCraft(filters.craft, craftNames);
  const items = orders.flatMap(order => order.items.filter(item => (!filters.paper || item.paperType === filters.paper) && (!selectedCraft || craftKeys(item).includes(selectedCraft))).map(item => ({ order, item })));
  const rollup = (dimension: 'craft' | 'paper' | 'specification'): AnalyticsTable => {
    const groups = new Map<string, { ids: Set<string>; qty: Decimal }>();
    for (const { order, item } of items) {
      const keys = dimension === 'craft' ? (craftKeys(item).length ? craftKeys(item) : ['']) : [dimension === 'paper' ? item.paperType ?? '' : item.specification ?? ''];
      for (const key of keys) {
        const group = groups.get(key) ?? { ids: new Set(), qty: new Decimal(0) };
        group.ids.add(order.id); group.qty = group.qty.plus(item.quantity); groups.set(key, group);
      }
    }
    return { title: { craft: '工艺分布', paper: '纸张分布', specification: '规格分布' }[dimension], columns: [dimension === 'craft' ? '工艺' : dimension === 'paper' ? '纸张' : '规格', '工单数', '数量'], rows: [...groups].sort((a, b) => b[1].qty.comparedTo(a[1].qty)).map(([key, group]) => [textCell(key ? dimension === 'craft' ? craftLabel(key) : key : '未填写', key && dimension !== 'specification' ? analyticsUrl(filters, { [dimension]: key, page: 1 }) : undefined), quantityCell(String(group.ids.size)), quantityCell(group.qty.toString())]), note: '同一工单可能包含多种工艺、纸张或规格，各组工单数和数量不可相加。' };
  };
  return {
    metrics: [{ label: '涉及工单', value: String(new Set(items.map(i => i.order.id)).size), format: 'quantity' }, { label: '款式明细', value: String(items.length), format: 'quantity' }, { label: '订购数量', value: items.reduce((sum, { item }) => sum.plus(item.quantity), new Decimal(0)).toString(), format: 'quantity' }],
    tables: [rollup('craft'), rollup('paper'), rollup('specification')],
    ...paginateTable({ title: '款式明细', columns: ['工单', '工艺', '纸张', '规格', '订购数量'], rows: items.map(({ order, item }) => [textCell(order.customName || order.orderNo, `/orders/${order.id}`), textCell(craftKeys(item).map(craftLabel).join('、') || null), textCell(item.paperType), textCell(item.specification), quantityCell(String(item.quantity))]) }, filters.page, all),
    notes: ['数量为订单订购数量；同款多道工艺不重复算作工厂产量。'],
  };
}
