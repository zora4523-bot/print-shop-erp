import { OrderStatus } from '@/generated/prisma/enums';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';

export function batchOrder(overrides: Partial<AdminOrderWorkspaceRow> = {}): AdminOrderWorkspaceRow {
  return {
    id: 'order-1', orderNo: 'GD-260907-001', revision: 4, workOrderVersion: 2,
    customName: '中秋红包', customer: { id: null, name: '客户甲', filterValue: '客户甲' },
    submitter: { id: 'sales-1', name: '业务员甲' }, status: OrderStatus.CONFIRMED,
    statusSummary: null, isUrgent: false, isStarred: false,
    createdAt: '2026-09-07T00:00:00Z', submittedAt: null, promisedDate: null, dueAlert: null,
    itemCount: 1, totalQuantity: 1000, craftSummary: '局部烫金', thumbnail: null, items: [],
    fee: { amount: '1234.50', source: 'CONFIRMED', estimated: false },
    feeStages: { quoted: '1200.00', confirmed: '1234.50', settled: null, active: 'CONFIRMED' },
    priceComparison: null, priceComparisonError: null, confirmationPreflight: { ok: true, issues: [] },
    capabilities: { confirm: false, reject: false, hold: true, resume: false, release: true, ship: false, settle: false, createPrint: false, markPrinted: false, reviewChange: false },
    billing: null, pendingChangeRequest: null, printPending: false, pendingPrintJobId: null, trackingNo: null,
    progress: { orderTotal: '1000', foilingProgress: '0', packingProgress: '0', foilingOverLimit: false, packingOverLimit: false, packingAhead: false, stagnant: false, stagnationDays: 0, firstClaimedAt: null },
    logs: [], ...overrides,
  };
}

export function batchSelection(orders: readonly AdminOrderWorkspaceRow[]) {
  return orders.map((order) => ({ id: order.id, orderNo: order.orderNo, status: order.status, canSchedule: false }));
}
