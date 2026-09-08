import Decimal from 'decimal.js';
import { adminOrderCraftTags, adminOrderDueHint } from '@/lib/order/admin-list-presentation';
import type { OrderChangeRequestStatus } from '@/generated/prisma/enums';
import type { getOrderDetail } from '@/lib/order';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import type { listOrderProductionOperations, listOrderProductionProgressSteps } from '@/lib/production/operation-order-view';
import { actionLabel, formatOrderLogChanges } from '@/lib/order/log-format';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { resolveOrderItemFoilSides } from '@/lib/order/pricing-route';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { hasAdminPricingConfirmationMarker, isTrustedAdminItemPricingSnapshot, isTrustedAdminPackagingPricingSnapshot, isTrustedAdminPricingSnapshot } from '@/lib/order/admin-pricing-snapshot';

export type DetailFee = { id: string; label: string; amount: string | null };
export type DetailDiff = { id: string; label: string; before: string; after: string; targetItemId: string | null; targetSection?: 'items' | 'fees' | 'overview' };
export type DetailItem = {
  id: string; fig: number; sequence: number; name: string; qty: number; pack: string | null;
  specs: { label: string; value: string }[];
  images: { id: string; url: string; name: string }[];
  hasCdr: boolean; fees: DetailFee[]; remark: string | null; isNew: boolean;
  progress: { label: string; done: string; total: string; unit: string }[];
};
export type DetailChange = {
  id: string; status: OrderChangeRequestStatus; reason: string; at: string; reviewedAt: string | null;
  reviewer: string | null; requester: string | null; fromVersion: number | null;
  toVersion: number | null; diffs: DetailDiff[];
};
export type DetailWork = {
  id: string; at: string; actor: string; label: string; quantity: string | null;
  cumulative: string | null; unit: string;
};
export type DetailLog = {
  id: string; at: string; actor: string; label: string; remark: string | null;
  changes: { label: string; before: string; after: string }[];
};
export type DetailShipment = {
  id: string; sequence: number; name: string | null; phone: string | null;
  address: string | null; trackingNo: string | null; carrier: string | null; items: string[];
};
export type AdminOrderDetailModel = {
  id: string; no: string; name: string; version: number; status: AdminOrderWorkspaceRow['status'];
  customer: string; sales: string; craft: string; due: string | null; dueLeft: string;
  qty: number; isUrgent: boolean; items: DetailItem[]; orderFees: DetailFee[];
  total: string | null; feeSource: AdminOrderWorkspaceRow['fee']['source'];
  feeStages: { key: 'quoted' | 'confirmed' | 'settled'; title: string; total: string | null; current: boolean }[];
  vdiff: { from: number; to: number; at: string; items: DetailDiff[] } | null;
  changes: DetailChange[]; works: DetailWork[]; logs: DetailLog[]; shipments: DetailShipment[];
  progress: AdminOrderWorkspaceRow['progress'];
};

type Order = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;
type DecimalSource = string | number | { toString(): string };
export type DetailWorkReportSource = {
  id: string; reportedAt: Date | string; reporterName: string;
  stage: 'FOILING' | 'PACKING'; quantity: DecimalSource; workOrderVersion: number;
  /** Only provide a cumulative value calculated from the complete current-version ledger. */
  cumulative?: DecimalSource | null;
};
export type AdminOrderDetailInput = {
  order: Order;
  workspace: AdminOrderWorkspaceRow;
  productionOperations?: Awaited<ReturnType<typeof listOrderProductionOperations>>;
  productionProgressSteps?: Awaited<ReturnType<typeof listOrderProductionProgressSteps>>;
  workReports?: readonly DetailWorkReportSource[];
  /** Authorization and signing remain on the server; CDR objects never receive read URLs here. */
  signImageUrl: (url: string) => string;
};

function decimal(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && !Decimal.isDecimal(value)) return null;
  try {
    const result = new Decimal(value);
    return result.isFinite() ? result : null;
  } catch { return null; }
}

function amount(value: unknown): string | null {
  return decimal(value)?.toFixed(2) ?? null;
}

function quantity(value: DecimalSource | null | undefined): string | null {
  return value == null ? null : decimal(value.toString())?.toString() ?? null;
}

function dateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? formatDateTimeShanghai(date) : '未记录';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function personName(value: unknown): string | null {
  const name = record(value).displayName;
  return typeof name === 'string' ? name : null;
}

function hasTrustedManualItemPrice(item: Order['items'][number]): boolean {
  // The shared detail query omits money for worker views, so narrow the
  // commercial fields explicitly before using the row-bound validator.
  const facts = record(item);
  const unitPrice = decimal(facts.unitPrice);
  const fixedFee = decimal(facts.fixedFee);
  const subtotal = decimal(facts.subtotal);
  if (!unitPrice || !fixedFee || !subtotal) return false;
  return isTrustedAdminItemPricingSnapshot(facts.pricingSnapshot, {
    ...item,
    unitPrice: unitPrice.toString(), fixedFee: fixedFee.toString(), subtotal: subtotal.toString(),
    manualQuoteReason: typeof facts.manualQuoteReason === 'string' ? facts.manualQuoteReason : null,
    priceOverrideReason: typeof facts.priceOverrideReason === 'string' ? facts.priceOverrideReason : null,
  });
}

function packagingHasUnknownAmount(order: Order, group: Order['packagingGroups'][number]): boolean {
  const fields = record(group);
  const unitPrice = decimal(fields.unitPrice);
  const subtotal = decimal(fields.subtotal);
  const snapshot = fields.pricingSnapshot;
  if (unitPrice && subtotal && isTrustedAdminPackagingPricingSnapshot(snapshot, {
    ...group, orderId: order.id, unitPrice: unitPrice.toString(), subtotal: subtotal.toString(),
    priceOverrideReason: typeof fields.priceOverrideReason === 'string' ? fields.priceOverrideReason : null,
    lines: group.lines.map((line) => ({ orderItemId: line.orderItem.id, unitsPerBag: line.unitsPerBag })),
  })) return false;
  // An administrator marker whose row binding is stale is not a usable quote.
  if (isTrustedAdminPricingSnapshot(snapshot) || hasAdminPricingConfirmationMarker(snapshot)) return true;
  const data = record(snapshot);
  const actual = record(data.actual);
  const status = typeof data.status === 'string' ? data.status.toUpperCase() : '';
  const source = typeof data.source === 'string' ? data.source.toUpperCase() : '';
  // Mirrors pricing-review's snapshotHasUnknownManualAmount. Only an explicit
  // unknown-amount envelope replaces persisted zero with null; unrelated
  // pending order fees and older reviewable amounts do not erase this fee.
  const requiresManual = ['MANUAL_PRICING_REQUIRED', 'PENDING_AMOUNT', 'EXCLUDED_MANUAL'].includes(status) ||
    data.complete === false || actual.provisional === true || actual.requiresAdminConfirmation === true || source.includes('MANUAL_REQUIRED');
  return requiresManual && (actual.amount === null || actual.provisional === true || actual.requiresAdminConfirmation === true);
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string').join('、') || '无';
  if (typeof value === 'number') return value.toLocaleString('zh-CN');
  if (typeof value === 'boolean') return value ? '是' : '否';
  return typeof value === 'string' ? externalPriceBusinessText(value) : '未记录';
}

const DIFF_FIELDS = [
  ['name', '款式名称'], ['quantity', '数量'], ['specification', '规格'],
  ['paperType', '纸张'], ['paperWeightGsm', '克重'],
  ['frontFoilColors', '正面烫金'], ['backFoilColors', '反面烫金'], ['foilColors', '烫金颜色'],
] as const;

function changeDiffs(request: Order['changeRequests'][number], currentItemIds: Set<string>): DetailDiff[] {
  const before = record(request.beforeSnapshot);
  const proposal = record(request.proposedChanges);
  const beforeItems = new Map(records(before.items).flatMap((item) =>
    typeof item.id === 'string' ? [[item.id, item] as const] : []));
  const rows: DetailDiff[] = [];
  if ('promisedDate' in proposal && proposal.promisedDate !== before.promisedDate) {
    rows.push({ id: `${request.id}-due`, label: '承诺交期', before: display(before.promisedDate), after: display(proposal.promisedDate), targetItemId: null, targetSection: 'overview' });
  }
  for (const [index, change] of records(proposal.items).entries()) {
    const itemId = typeof change.itemId === 'string' ? change.itemId : null;
    const source = itemId ? beforeItems.get(itemId) : undefined;
    if (change.operation !== 'ADD' && (change.operation !== 'UPDATE' || !source)) continue;
    const prefix = source ? `第 ${source.sequence ?? '—'} 款 · ` : '新增款式 · ';
    for (const [field, label] of DIFF_FIELDS) {
      if (!(field in change)) continue;
      if (source && JSON.stringify(source[field] ?? null) === JSON.stringify(change[field] ?? null)) continue;
      rows.push({
        id: `${request.id}-${index}-${field}`, label: `${prefix}${label}`,
        before: source ? display(source[field]) : '—（新增）', after: display(change[field]),
        targetItemId: itemId && currentItemIds.has(itemId) ? itemId : null,
        ...(change.operation === 'ADD' ? { targetSection: 'items' as const } : {}),
      });
    }
  }
  return rows;
}

const WORKFLOW_LOG_LABELS: Record<string, string> = {
  FACTORY_CONFIRMED: '工厂确认', FACTORY_REJECTED: '工厂驳回',
  ORDER_RELEASED: '下发生产', ORDER_PRINT_REQUESTED: '创建打印任务', ORDER_PRINTED: '标记已打印',
  ORDER_PRINT_REQUESTS_SUPERSEDED: '旧版打印任务作废', ORDER_SETTLED_V2: '工单结算',
  FACTORY_HELD: '暂停生产', FACTORY_RESUMED: '恢复生产',
};

/** Pure admin-only projection. It does not quote, infer missing records or mutate a workflow. */
export function buildAdminOrderDetailModel(input: AdminOrderDetailInput): AdminOrderDetailModel {
  const { order, workspace, signImageUrl, productionProgressSteps = [], workReports = [] } = input;
  if (order.id !== workspace.id || order.workOrderVersion !== workspace.workOrderVersion || order.revision !== workspace.revision || (workspace.editVersion !== undefined && order.editVersion !== workspace.editVersion)) {
    throw new Error('工单资料版本已变化，请刷新后重试');
  }
  const currentItemIds = new Set(order.items.map((item) => item.id));
  const changes = order.changeRequests.map((request): DetailChange => ({
    id: request.id, status: request.status, reason: request.reason, at: dateTime(request.createdAt),
    reviewedAt: request.reviewedAt ? dateTime(request.reviewedAt) : null,
    reviewer: personName(record(request).reviewedBy), requester: personName(record(request).requester),
    fromVersion: request.baseWorkOrderVersion, toVersion: request.workOrderVersionAfter,
    diffs: changeDiffs(request, currentItemIds),
  }));
  const currentApproval = order.changeRequests.find((request) =>
    request.status === 'APPROVED' && request.type === 'MODIFY' &&
    request.workOrderVersionAfter === order.workOrderVersion && request.baseWorkOrderVersion != null);
  const approvalBefore = currentApproval ? record(currentApproval.beforeSnapshot) : {};
  const previousItemIds = new Set(records(approvalBefore.items).flatMap((item) => typeof item.id === 'string' ? [item.id] : []));
  const items = order.items.map((item): DetailItem => {
    const foil = resolveOrderItemFoilSides(item);
    const packaging = order.packagingGroups.flatMap((group) =>
      group.lines.filter((line) => line.orderItem.id === item.id).map((line) =>
        `${group.name || `包装 ${group.sequence}`}：${line.unitsPerBag} 个/袋，${group.actualBagCount} 袋`));
    const itemRecord = record(item);
    const unresolvedManualQuote = item.quoteDisposition === 'MANUAL_PRICING_REQUIRED' &&
      !hasTrustedManualItemPrice(item);
    const fees: DetailFee[] = [{
      id: `${item.id}-subtotal`, label: '款式加工费',
      amount: unresolvedManualQuote ? null : amount(itemRecord.subtotal),
    }];
    if ('plateDetails' in item) {
      for (const plate of item.plateDetails.filter((row) => row.isActive)) {
        fees.push({ id: plate.id, label: `版费 · ${plate.name}`, amount: amount(plate.amount) });
      }
    }
    return {
      id: item.id, fig: item.fig ?? item.sequence, sequence: item.sequence,
      name: externalPriceBusinessText(item.name), qty: item.quantity,
      pack: packaging.length ? packaging.join('；') : item.pack == null ? null : `${item.pack} 个/袋（历史记录）`,
      specs: [
        { label: '工艺', value: [...new Set([...adminOrderCraftTags([item.craft]), ...item.craftNames])].join('、') || '未记录' },
        { label: '纸张', value: [item.paperType ? externalPriceBusinessText(item.paperType) : null, item.paperWeightGsm ? `${item.paperWeightGsm}g` : null].filter(Boolean).join(' · ') || '未记录' },
        { label: '规格', value: item.specification ? externalPriceBusinessText(item.specification) : '未记录' },
        { label: '实尺', value: item.actualWidthMm != null && item.actualHeightMm != null ? `${item.actualWidthMm.toString()} × ${item.actualHeightMm.toString()} mm` : '未记录' },
        { label: '正面烫金', value: foil.frontFoilColors.join('、') || '无' },
        { label: '反面烫金', value: foil.backFoilColors.join('、') || '无' },
      ],
      images: item.designs.filter((design) => design.fileType === 'IMAGE').map((design) => ({ id: design.id, url: signImageUrl(design.fileUrl), name: design.fileName })),
      hasCdr: item.designs.some((design) => design.fileType === 'CDR'), fees,
      remark: item.remark, isNew: Boolean(currentApproval && Array.isArray(approvalBefore.items) && !previousItemIds.has(item.id)),
      // Paid operations can span several items and have pass/bag units. Do not
      // distribute lane totals to cards; only item-addressed progress is safe.
      progress: productionProgressSteps.filter((step) => step.orderItemId === item.id).map((step) => ({
        label: step.craftName,
        done: step.reports.reduce((sum, report) => sum.plus(report.completedQty.toString()), new Decimal(step.carriedCompletedQty?.toString() ?? 0)).toString(),
        total: step.plannedQty.toString(), unit: '个',
      })),
    };
  });
  const orderRecord = record(order);
  const orderFees: DetailFee[] = [{ id: 'packaging', label: '入袋费', amount:
    order.packagingGroups.some((group) => packagingHasUnknownAmount(order, group)) ? null : amount(orderRecord.packagingAmount) }];
  const displayedPlateIds = new Set(order.items.flatMap((item) =>
    'plateDetails' in item ? item.plateDetails.filter((plate) => plate.isActive).map((plate) => plate.id) : []));
  for (const charge of order.customerCharges) {
    // Plate details and their linked customer charges are the same money.
    // Keep the item-level breakdown and do not display it a second time here.
    if (charge.businessKey.startsWith('PLATE_DETAIL:') && displayedPlateIds.has(charge.businessKey.slice('PLATE_DETAIL:'.length))) continue;
    if (charge.status === 'WAIVED') continue;
    orderFees.push({ id: charge.id, label: `${charge.category.name}${charge.shipment ? ` · 第 ${charge.shipment.sequence} 票` : ''}`, amount: amount(charge.amount) });
  }
  const dueLeft = adminOrderDueHint(workspace.dueAlert) ?? '';
  const feeStages = (['quoted', 'confirmed', 'settled'] as const).map((key) => ({
    key, title: { quoted: '提交报价', confirmed: '确认金额', settled: '结算金额' }[key],
    total: amount(workspace.feeStages[key]), current: workspace.feeStages.active === key.toUpperCase(),
  }));
  return {
    id: order.id, no: order.orderNo, name: order.customName || '未命名工单',
    version: order.workOrderVersion, status: order.status, customer: workspace.customer.name,
    sales: workspace.submitter.name, craft: workspace.craftTags?.join(' · ') || workspace.craftSummary,
    due: workspace.promisedDate?.slice(0, 10) ?? null, dueLeft, qty: workspace.totalQuantity, isUrgent: order.isUrgent,
    items, orderFees, total: amount(workspace.fee.amount), feeSource: workspace.fee.source, feeStages,
    vdiff: currentApproval && currentApproval.baseWorkOrderVersion != null ? {
      from: currentApproval.baseWorkOrderVersion, to: order.workOrderVersion,
      at: dateTime(currentApproval.reviewedAt ?? currentApproval.createdAt),
      items: changeDiffs(currentApproval, currentItemIds),
    } : null,
    changes,
    works: workReports.filter((row) => row.workOrderVersion === order.workOrderVersion).map((row) => ({
      id: row.id, at: dateTime(row.reportedAt), actor: row.reporterName,
      label: row.stage === 'FOILING' ? '烫金报工' : '打包报工',
      quantity: quantity(row.quantity), cumulative: quantity(row.cumulative), unit: '个',
    })),
    logs: order.logs.map((log) => ({
      id: log.id, at: dateTime(log.createdAt), actor: log.operator.displayName,
      label: WORKFLOW_LOG_LABELS[log.action] ?? actionLabel(log.action),
      remark: 'remark' in log && typeof log.remark === 'string' ? log.remark : null,
      changes: formatOrderLogChanges('changedFields' in log ? log.changedFields : undefined),
    })),
    shipments: order.shipments.map((shipment) => ({
      id: shipment.id, sequence: shipment.sequence, name: shipment.receiverName, phone: shipment.receiverPhone,
      address: shipment.receiverAddress, trackingNo: shipment.trackingNo, carrier: shipment.carrierCode,
      items: shipment.lines.map((line) => `第 ${line.orderItem.sequence} 款 ${line.orderItem.name} × ${line.quantity.toLocaleString('zh-CN')}`),
    })),
    progress: { ...workspace.progress },
  };
}
