import 'server-only';
import Decimal from 'decimal.js';
import { analyticsRange, analyticsUrl, type AnalyticsFilters } from './filters';
import { checkRecordLimit, type AnalyticsTx } from './queries';
import { paginateTable, sumMoney } from './reports';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { moneyCell, quantityCell, textCell, type AnalyticsReport, type AnalyticsTable } from './types';

export async function inventoryReport(tx: AnalyticsTx, filters: AnalyticsFilters, all = false): Promise<AnalyticsReport> {
  const supplier = filters.supplier ? { supplierName: filters.supplier } : {};
  const material = filters.q ? { name: { contains: filters.q, mode: 'insensitive' as const } } : {};
  const purchaseWhere = { purchaseOrder: { ...supplier, createdAt: analyticsRange(filters), status: { not: 'CANCELLED' as const } }, material };
  const receiptWhere = { receipt: { status: 'POSTED' as const, receivedAt: analyticsRange(filters), purchaseOrder: supplier }, material };
  const [purchaseCount, receiptCount, stockCount] = await Promise.all([
    tx.purchaseOrderItem.count({ where: purchaseWhere }), tx.purchaseReceiptItem.count({ where: receiptWhere }), tx.material.count({ where: material }),
  ]);
  for (const count of [purchaseCount, receiptCount, stockCount]) checkRecordLimit(count);
  const [purchases, receipts, stocks] = await Promise.all([
    tx.purchaseOrderItem.findMany({ where: purchaseWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { quantity: true, unitCost: true, material: { select: { name: true, specification: true, unit: true } }, purchaseOrder: { select: { id: true, purchaseNo: true, supplierName: true, createdAt: true } } } }),
    tx.purchaseReceiptItem.findMany({ where: receiptWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { quantity: true, unitCost: true, material: { select: { name: true, specification: true, unit: true } }, receipt: { select: { receiptNo: true, receivedAt: true, purchaseOrder: { select: { id: true, supplierName: true } } } } } }),
    tx.material.findMany({ where: material, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, specification: true, unit: true, currentStock: true, safetyStock: true, averageCost: true } }),
  ]);
  const amount = (quantity: { toString(): string }, price: { toString(): string } | null) => price === null ? null : new Decimal(quantity.toString()).mul(price.toString()).toFixed(2);
  const purchaseTable: AnalyticsTable = { title: '采购下单明细', columns: ['采购单', '供应商', '下单日期', '物料', '规格', '数量', '单位', '原单价', '已知金额'], rows: purchases.map(row => [textCell(row.purchaseOrder.purchaseNo, `/owner/purchases/${row.purchaseOrder.id}`), textCell(row.purchaseOrder.supplierName), textCell(todayShanghai(row.purchaseOrder.createdAt)), textCell(row.material.name), textCell(row.material.specification), quantityCell(row.quantity.toString()), textCell(row.material.unit), { value: row.unitCost?.toString() ?? null, format: 'price' }, moneyCell(amount(row.quantity, row.unitCost))]) };
  const receiptTable: AnalyticsTable = { title: '实际收货明细', columns: ['收货单', '供应商', '收货日期', '物料', '规格', '数量', '单位', '原单价', '已知金额'], rows: receipts.map(row => [textCell(row.receipt.receiptNo, `/owner/purchases/${row.receipt.purchaseOrder.id}`), textCell(row.receipt.purchaseOrder.supplierName), textCell(todayShanghai(row.receipt.receivedAt)), textCell(row.material.name), textCell(row.material.specification), quantityCell(row.quantity.toString()), textCell(row.material.unit), { value: row.unitCost?.toString() ?? null, format: 'price' }, moneyCell(amount(row.quantity, row.unitCost))]) };
  const stockTable: AnalyticsTable = { title: '当前库存明细', columns: ['物料', '规格', '当前数量', '单位', '安全库存', '平均成本', '参考金额', '缺料'], rows: stocks.map(row => [textCell(row.name, `/owner/materials/${row.id}`), textCell(row.specification), quantityCell(row.currentStock.toString()), textCell(row.unit), row.safetyStock === null ? textCell(null) : quantityCell(row.safetyStock.toString()), { value: row.averageCost?.toString() ?? null, format: 'price' }, moneyCell(amount(row.currentStock, row.averageCost)), textCell(row.safetyStock !== null && new Decimal(row.currentStock.toString()).lt(row.safetyStock.toString()) ? '低于安全库存' : '—')]) };
  const suppliers = new Map<string, { count: number; known: Decimal; missing: number }>();
  for (const row of purchases) {
    const name = row.purchaseOrder.supplierName, group = suppliers.get(name) ?? { count: 0, known: new Decimal(0), missing: 0 };
    group.count++; if (row.unitCost === null) group.missing++; else group.known = group.known.plus(amount(row.quantity, row.unitCost)!);
    suppliers.set(name, group);
  }
  return {
    metrics: [
      { label: '采购已知金额', value: purchases.some(row => row.unitCost !== null) ? sumMoney(purchases.map(row => amount(row.quantity, row.unitCost))) : null, format: 'money', hint: `${purchaseCount} 条，${purchases.filter(row => row.unitCost === null).length} 条单价待录` },
      { label: '收货已知金额', value: receipts.some(row => row.unitCost !== null) ? sumMoney(receipts.map(row => amount(row.quantity, row.unitCost))) : null, format: 'money', hint: `${receiptCount} 条有效收货，不与采购重复相加` },
      { label: '当前库存参考金额', value: stocks.some(row => row.averageCost !== null) ? sumMoney(stocks.map(row => amount(row.currentStock, row.averageCost))) : null, format: 'money', hint: `${stocks.filter(row => row.averageCost === null).length} 种物料成本待录` },
      { label: '低于安全库存', value: String(stocks.filter(row => row.safetyStock !== null && new Decimal(row.currentStock.toString()).lt(row.safetyStock.toString())).length), format: 'quantity' },
    ],
    tables: [{ title: '供应商采购', columns: ['供应商', '明细数', '已知金额', '单价待录'], rows: [...suppliers].sort((a, b) => b[1].known.comparedTo(a[1].known)).map(([name, g]) => [textCell(name, analyticsUrl(filters, { supplier: name, page: 1 })), quantityCell(String(g.count)), moneyCell(g.missing === g.count ? null : g.known.toFixed(2)), quantityCell(String(g.missing))]) }],
    ...paginateTable({ purchases: purchaseTable, receipts: receiptTable, stock: stockTable }[filters.inventoryKind], filters.page, all),
    notes: ['采购按下单日期、收货按实际收货日期；当前库存含停用物料余额，不受日期和供应商筛选影响，仅按物料关键词筛选。不同单位的数量分别查看。'],
  };
}
