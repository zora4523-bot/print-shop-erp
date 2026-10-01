import { packagingBoxType } from './packaging-mode';
import { hasLogisticsChargeRows, orderBillsLogistics } from './settlement';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  OrderCostCategory,
  OrderCustomerChargeStatus,
  OrderPricingStatus,
  OrderQuotedFeeCompleteness,
  OrderStatus,
  Role,
  type Prisma,
} from '../../generated/prisma/client';
import { db } from '../db';
import { databaseClockNow } from '../background-jobs/clock';
import {
  OrderCustomerChargeError,
  resolveExternalOrderChargesForFinalization,
} from '../price/order-charge-service';
import {
  buildTrustedAdminChargePricingSnapshot,
  isTrustedAdminChargePricingSnapshot,
} from './admin-pricing-snapshot';
import { isFulfillmentPricingStatus } from './fulfillment-pricing-policy';
import { orderCascadeLockKey } from './locks';
import { appendOrderPricingRevisionInTx } from './pricing-revision';
import { reconcileSampleWeightBasis } from './sample-weight-basis';

export { isFulfillmentPricingStatus } from './fulfillment-pricing-policy';

export class FulfillmentPricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FulfillmentPricingError';
  }
}

type Actor = { id: string; role: Role };
type ShipmentCorrection = {
  shipmentId: string;
  destinationProvince: string | null;
  weightKg: string | null;
  shippingFee: string | null;
  customerChargeOverrideReason: string | null;
};

export type PreviewFulfillmentPricingCommand = {
  orderId: string;
  isSfCollect: boolean;
  shipments?: readonly ShipmentCorrection[];
};

export type FulfillmentPricingMutationGuard = {
  expectedOrderRevision: number;
  expectedEditVersion: number;
  expectedWorkOrderVersion: number;
  expectedPriceRevision: number;
  idempotencyKey: string;
};

export type FinalizeFulfillmentPricingCommand = PreviewFulfillmentPricingCommand &
  FulfillmentPricingMutationGuard & { previewToken: string };

export type FulfillmentPricingPreview = {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  isSfCollect: boolean;
  expectedOrderRevision: number;
  expectedEditVersion: number;
  expectedWorkOrderVersion: number;
  expectedPriceRevision: number;
  previewToken: string;
  oldTotal: string;
  newTotal: string | null;
  delta: string | null;
  processingAmount: string;
  preservedChargesAmount: string;
  canConfirm: boolean;
  issues: string[];
  shipments: Array<{
    shipmentId: string;
    sequence: number;
    destinationProvince: string | null;
    weightKg: string | null;
    currentShippingFee: string | null;
    shippingFee: string | null;
    reason: string | null;
    requiresManual: boolean;
  }>;
};

export type FulfillmentPricingResult = {
  orderId: string;
  status: OrderStatus;
  confirmedFee: string;
  revision: number;
  priceRevision: number;
  idempotentReplay: boolean;
};

const PENDING_SOURCE = 'SF_COLLECT_CHANGED_PENDING';
const CONFIRMED_SOURCE = 'FULFILLMENT_SHIPPING_CONFIRMED';
const CONFIRMED_ACTION = 'FULFILLMENT_PRICING_CONFIRMED';
const PENDING_ACTION = 'SF_COLLECT_FULFILLMENT_CHANGED';
const include = {
  items: { orderBy: { sequence: 'asc' as const } },
  packagingGroups: { include: {lines: true}, orderBy: { sequence: 'asc' as const } },
  customerCharges: { include: { category: { select: { code: true } } } },
  shipments: {
    orderBy: { sequence: 'asc' as const },
    include: { lines: { select: { orderItemId: true, quantity: true } } },
  },
  _count: {
    select: { changeRequests: { where: { status: 'PENDING' as const } } },
  },
} satisfies Prisma.OrderInclude;
type FulfillmentOrder = Prisma.OrderGetPayload<{ include: typeof include }>;
type Charge = FulfillmentOrder['customerCharges'][number];
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function money(value: unknown, label: string, allowNegative = false): string {
  try {
    if (value === null || value === undefined) throw new Error();
    const amount = new Decimal(String(value));
    if (!amount.isFinite() || (!allowNegative && amount.isNegative()) || amount.abs().gt('9999999999.99')) throw new Error();
    return amount.toFixed(2);
  } catch {
    throw new FulfillmentPricingError(`${label}缺少有效金额，请人工核查审计记录`);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function assertAdmin(actor: Actor): void {
  if (actor.role !== Role.ADMIN) throw new FulfillmentPricingError('只有管理员可以预览和确认履约费用');
}

function assertGuard(input: FulfillmentPricingMutationGuard | undefined): asserts input is FulfillmentPricingMutationGuard {
  if (!input ||
    !Number.isSafeInteger(input.expectedOrderRevision) || input.expectedOrderRevision < 0 ||
    !Number.isSafeInteger(input.expectedEditVersion) || input.expectedEditVersion < 0 ||
    !Number.isSafeInteger(input.expectedWorkOrderVersion) || input.expectedWorkOrderVersion < 1 ||
    !Number.isSafeInteger(input.expectedPriceRevision) || input.expectedPriceRevision < 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
    throw new FulfillmentPricingError('履约更正缺少有效订单版本和请求标识，请刷新后重试');
  }
}

function assertVersions(order: FulfillmentOrder, input: FulfillmentPricingMutationGuard): void {
  if (order.revision !== input.expectedOrderRevision || order.editVersion !== input.expectedEditVersion ||
    order.workOrderVersion !== input.expectedWorkOrderVersion || order.priceRevision !== input.expectedPriceRevision) {
    throw new FulfillmentPricingError('工单、地址或价格版本已变化，请刷新后重新预览');
  }
}

function normalizedInput(input: PreviewFulfillmentPricingCommand): Required<PreviewFulfillmentPricingCommand> {
  if (!text(input.orderId) || typeof input.isSfCollect !== 'boolean') throw new FulfillmentPricingError('履约更正参数非法');
  if ((input.shipments?.length ?? 0) > 100) throw new FulfillmentPricingError('履约更正地址过多');
  const shipments = (input.shipments ?? []).map((row) => {
    if (!text(row.shipmentId)) throw new FulfillmentPricingError('履约更正缺少发货地址');
    const weightKg = text(row.weightKg);
    if (weightKg !== null) {
      try {
        const weight = new Decimal(weightKg);
        if (!weight.isFinite() || !weight.isPositive() || weight.gt('999999.999') || weight.decimalPlaces() > 3) throw new Error();
      } catch {
        throw new FulfillmentPricingError('计费重量非法');
      }
    }
    const shippingFee = text(row.shippingFee);
    if (shippingFee !== null) {
      money(shippingFee, '快递费');
      if (new Decimal(shippingFee).decimalPlaces() > 2) throw new FulfillmentPricingError('快递费最多保留两位小数');
    }
    const reason = text(row.customerChargeOverrideReason);
    if ((reason?.length ?? 0) > 500) throw new FulfillmentPricingError('快递费说明不能超过500字');
    return {
      shipmentId: row.shipmentId.trim(), destinationProvince: text(row.destinationProvince),
      weightKg: weightKg === null ? null : new Decimal(weightKg).toString(),
      shippingFee: shippingFee === null ? null : money(shippingFee, '快递费'),
      customerChargeOverrideReason: reason,
    };
  }).sort((a, b) => a.shipmentId.localeCompare(b.shipmentId));
  if (new Set(shipments.map((row) => row.shipmentId)).size !== shipments.length) throw new FulfillmentPricingError('履约更正包含重复的发货地址');
  return { orderId: input.orderId.trim(), isSfCollect: input.isSfCollect, shipments };
}

async function readOrder(tx: Prisma.TransactionClient, orderId: string): Promise<FulfillmentOrder> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include });
  if (!order) throw new FulfillmentPricingError('工单不存在');
  const billsLogistics = orderBillsLogistics({ settlementType: order.settlementType, purpose: order.purpose, hasLogisticsRows: hasLogisticsChargeRows(order.customerCharges) });
  if (!billsLogistics || !isFulfillmentPricingStatus(order.status) || order.settledAt !== null || order.settledFee !== null) {
    throw new FulfillmentPricingError('当前工单不允许履约费用更正；已结算或终态工单请走财务处理');
  }
  if (order._count.changeRequests > 0) throw new FulfillmentPricingError('工单仍有待裁决变更申请，不能同时确认履约费用');
  if (order.shipments.length === 0) throw new FulfillmentPricingError('工单缺少发货地址，请人工核查');
  return order;
}

/** Compare amounts and row identities in immutable revisions, not mutable flags alone. */
function preservedFinancialFacts(value: unknown, isSnapshot: boolean): JsonRecord {
  const data = record(value);
  const amounts = isSnapshot ? record(data.order) : data;
  if (!Array.isArray(data.items) || !Array.isArray(data.packagingGroups) || !Array.isArray(data.customerCharges)) {
    throw new FulfillmentPricingError('缺少已审核加工与非物流费用的完整审计快照');
  }
  const sorted = (rows: JsonRecord[]) => rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    processingAmount: money(amounts.processingAmount, '已审核加工费'),
    packagingAmount: money(amounts.packagingAmount, '已审核入袋费'),
    items: sorted(data.items.map((raw) => {
      const item = record(raw);
      if (!text(item.id) || !Number.isSafeInteger(item.quantity)) throw new FulfillmentPricingError('款式审计身份缺失');
      return { id: item.id, quantity: item.quantity, unitPrice: new Decimal(String(item.unitPrice)).toFixed(4), fixedFee: money(item.fixedFee, '已审核固定费'), subtotal: money(item.subtotal, '已审核款价'), pricingSnapshot: item.pricingSnapshot };
    })),
    packagingGroups: sorted(data.packagingGroups.map((raw) => {
      const group = record(raw);
      return { id: group.id, mode: group.mode, actualBagCount: group.actualBagCount, unitPrice: new Decimal(String(group.unitPrice)).toFixed(4), subtotal: money(group.subtotal, '已审核入袋费'), pricingSnapshot: group.pricingSnapshot };
    })),
    // Old SF corrections rewrote the packaging charge's audit envelope while
    // keeping its monetary amount. Identity + amount must still match exactly.
    customerCharges: sorted(data.customerCharges.map(record).filter((charge) =>
      (isSnapshot ? charge.categoryCode : record(charge.category).code) !== 'SHIPPING_FEE',
    ).map((charge) => ({ id: charge.id, shipmentId: charge.shipmentId, businessKey: String(charge.businessKey).toUpperCase(), categoryCode: isSnapshot ? charge.categoryCode : record(charge.category).code, amount: money(charge.amount, '已审核独立收费', true) }))),
  };
}

async function verifiedBaseline(tx: Prisma.TransactionClient, order: FulfillmentOrder) {
  const revisions = await tx.orderPricingRevision.findMany({
    where: { orderId: order.id, revision: { lte: order.priceRevision } },
    orderBy: { revision: 'desc' }, take: 101,
    select: { id: true, orderId: true, revision: true, status: true, source: true, snapshot: true, createdById: true },
  });
  const current = revisions[0];
  if (!current || current.revision !== order.priceRevision || current.status !== order.pricingStatus) throw new FulfillmentPricingError('当前价格版本缺少一致的审计来源，需人工核查');
  const currentSnapshot = record(current.snapshot);
  const currentOrder = record(currentSnapshot.order);
  const shippingAudit = (charges: unknown, snapshot: boolean) => {
    if (!Array.isArray(charges)) throw new FulfillmentPricingError('快递费审计身份缺失');
    return charges.map(record).filter((charge) => (snapshot ? charge.categoryCode : record(charge.category).code) === 'SHIPPING_FEE').map((charge) => ({
      id: charge.id, businessKey: String(charge.businessKey).toUpperCase(), shipmentId: charge.shipmentId,
      amount: charge.amount === null ? null : money(charge.amount, '已记录快递费'), status: charge.status,
      priceBookId: charge.priceBookId, pricingSnapshot: charge.pricingSnapshot,
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  if (money(currentOrder.totalAmount, '当前审计总额') !== money(order.totalAmount, '当前总额') ||
    fingerprint(shippingAudit(currentSnapshot.customerCharges, true)) !== fingerprint(shippingAudit(order.customerCharges, false))) {
    throw new FulfillmentPricingError('当前快递费或总额与不可变审计记录不一致，需人工核查');
  }
  const frozen = fingerprint(preservedFinancialFacts(order, false));
  const pending = [];
  let baseline: typeof current | undefined;
  for (const [index, row] of revisions.entries()) {
    if (index >= 100 || row.revision !== order.priceRevision - index || row.orderId !== order.id || record(record(row.snapshot).order).id !== order.id || fingerprint(preservedFinancialFacts(row.snapshot, true)) !== frozen) {
      throw new FulfillmentPricingError('已审核加工或非物流金额与审计来源不一致，不能自动恢复');
    }
    if (row.status === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION) {
      if (row.source !== PENDING_SOURCE) throw new FulfillmentPricingError('待核价来源并非单纯顺丰到付更正，需人工核查');
      pending.push(row);
      continue;
    }
    baseline = row;
    break;
  }
  if (!baseline) throw new FulfillmentPricingError('找不到更正前已审核费用的完整审计来源');
  const baselineOrder = record(record(baseline.snapshot).order);
  const baselineFee = money(baselineOrder.confirmedFee, '更正前已确认费用');
  const baselineCharges = record(baseline.snapshot).customerCharges as JsonRecord[];
  const baselineTotal = baselineCharges.reduce((sum, charge) => sum.plus(money(charge.amount, '更正前收费', true)), new Decimal(String(baselineOrder.processingAmount))).toFixed(2);
  if (baselineFee !== baselineTotal || baselineFee !== money(baselineOrder.totalAmount, '更正前总额')) throw new FulfillmentPricingError('更正前已确认费用无法与审计分项对账');
  if (pending.length > 0) {
    if (order.confirmedFee !== null) throw new FulfillmentPricingError('待核价工单确认费与审计状态冲突');
    const logs = await tx.orderLog.findMany({ where: { orderId: order.id, action: { in: ['UPDATE', PENDING_ACTION] } }, orderBy: { createdAt: 'desc' }, take: 500, select: { changedFields: true } });
    for (const row of pending) {
      const evidence = logs.some((log) => {
        const fields = record(log.changedFields);
        const revisionChange = record(fields.priceRevision);
        const modeChange = record(fields.isSfCollect);
        return revisionChange.before === row.revision - 1 && revisionChange.after === row.revision &&
          typeof modeChange.before === 'boolean' && typeof modeChange.after === 'boolean' && modeChange.before !== modeChange.after;
      });
      if (!evidence) throw new FulfillmentPricingError('缺少对应顺丰到付更正日志，不能猜测恢复');
    }
  } else if (order.confirmedFee === null || money(order.confirmedFee, '确认费') !== money(order.totalAmount, '工单总额')) {
    throw new FulfillmentPricingError('当前工单缺少一致的已确认费用');
  }
  return { id: baseline.id, frozen, recovered: pending.length > 0,
    shippingEvidence: baselineCharges.filter((charge) => charge.categoryCode === 'SHIPPING_FEE'),
  };
}

function shippingCharges(order: FulfillmentOrder): Map<string, Charge> {
  const shipping = order.customerCharges.filter((charge) => charge.category.code === 'SHIPPING_FEE');
  if (shipping.length !== order.shipments.length) throw new FulfillmentPricingError('快递收费身份不完整，需人工核查');
  const byShipment = new Map<string, Charge>();
  for (const shipment of order.shipments) {
    const key = `SHIPMENT:${shipment.sequence}:SHIPPING_FEE`;
    const matching = shipping.filter((charge) => charge.orderId === order.id && charge.shipmentId === shipment.id && charge.businessKey.toUpperCase() === key);
    if (matching.length !== 1) throw new FulfillmentPricingError('快递收费不属于对应工单或发货地址');
    byShipment.set(shipment.id, matching[0]!);
  }
  return byShipment;
}

type PlannedShipping = {
  previous: Charge;
  shipmentId: string;
  sequence: number;
  destinationProvince: string | null;
  weightKg: string | null;
  amount: string | null;
  suggestedAmount: string | null;
  reason: string | null;
  sourceRuleId: string | null;
  pricingSnapshot: Prisma.InputJsonValue | null;
  prepaidEvidence: JsonRecord | null;
  issue: string | null;
};

async function buildPlan(tx: Prisma.TransactionClient, order: FulfillmentOrder, input: Required<PreviewFulfillmentPricingCommand>, now: Date) {
  if (order.purpose === 'PROOF') throw new FulfillmentPricingError('打样按整单总价收费，请在整单核价中修改费用');
  const baseline = await verifiedBaseline(tx, order);
  const byShipment = shippingCharges(order);
  const corrections = new Map(input.shipments.map((row) => [row.shipmentId, row]));
  if (input.shipments.some((row) => !byShipment.has(row.shipmentId))) throw new FulfillmentPricingError('更正地址不属于该工单');
  if (input.isSfCollect) {
    const costs = await tx.orderCostEntry.aggregate({ where: { orderId: order.id, category: OrderCostCategory.SHIPPING }, _sum: { amount: true } });
    if (!new Decimal(costs._sum.amount?.toString() ?? 0).isZero()) throw new FulfillmentPricingError('工单已有物流成本流水，需保持非到付并由财务核对');
  }
  const plans: PlannedShipping[] = [];
  for (const shipment of order.shipments) {
    const previous = byShipment.get(shipment.id)!;
    const correction = corrections.get(shipment.id);
    const plan: PlannedShipping = {
      previous, shipmentId: shipment.id, sequence: shipment.sequence,
      destinationProvince: correction?.destinationProvince ?? shipment.destinationProvince,
      weightKg: correction?.weightKg ?? shipment.weightKg?.toString() ?? null,
      amount: input.isSfCollect ? '0.00' : correction?.shippingFee ?? null,
      suggestedAmount: input.isSfCollect ? '0.00' : null,
      reason: correction?.customerChargeOverrideReason ?? null,
      sourceRuleId: input.isSfCollect ? null : previous.sourceRuleId,
      pricingSnapshot: null, prepaidEvidence: null, issue: null,
    };
    const carried = record(record(previous.pricingSnapshot).preservedPrepaidShipping);
    const baselineRow = baseline.shippingEvidence.find((charge) => charge.id === previous.id &&
      charge.shipmentId === previous.shipmentId && String(charge.businessKey).toUpperCase() === previous.businessKey.toUpperCase());
    const previousIsConfirmedPrepaid = !order.isSfCollect && order.pricingStatus !== OrderPricingStatus.PENDING_ADMIN_CONFIRMATION && previous.status !== OrderCustomerChargeStatus.WAIVED && previous.amount !== null;
    if (previousIsConfirmedPrepaid) {
      plan.prepaidEvidence = {
        id: previous.id, orderId: order.id, shipmentId: previous.shipmentId, businessKey: previous.businessKey,
        priceBookId: previous.priceBookId, sourceRuleId: previous.sourceRuleId,
        amount: money(previous.amount, '原已审核快递费'), suggestedAmount: previous.suggestedAmount?.toFixed(2) ?? null,
        overrideReason: previous.overrideReason, pricingSnapshot: previous.pricingSnapshot,
        destinationProvince: shipment.destinationProvince, billableWeightKg: shipment.weightKg?.toString() ?? null,
      };
    } else if (Object.keys(carried).length > 0) {
      if (carried.id !== previous.id || carried.orderId !== order.id || carried.shipmentId !== previous.shipmentId ||
        String(carried.businessKey).toUpperCase() !== previous.businessKey.toUpperCase() || carried.priceBookId !== previous.priceBookId) {
        throw new FulfillmentPricingError('原非到付运费的审计身份不一致，请人工核查');
      }
      plan.prepaidEvidence = carried;
    } else if (baselineRow && baselineRow.status !== OrderCustomerChargeStatus.WAIVED && baselineRow.amount !== null) {
      const baselineSnapshot = record(baselineRow.pricingSnapshot);
      const facts = Object.keys(record(baselineSnapshot.fulfillmentPricingConfirmation)).length > 0
        ? record(baselineSnapshot.fulfillmentPricingConfirmation) : record(record(baselineSnapshot.quote).basis);
      plan.prepaidEvidence = { ...baselineRow, orderId: order.id,
        destinationProvince: facts.destinationProvince ?? facts.province ?? null,
        billableWeightKg: facts.billableWeightKg ?? null,
      };
    }
    const actual = record(record(previous.pricingSnapshot).actual);
    const preserveRecordedShipping = !input.isSfCollect && !order.isSfCollect && !correction &&
      previous.amount !== null && previous.status !== OrderCustomerChargeStatus.PENDING_AMOUNT &&
      previous.status !== OrderCustomerChargeStatus.WAIVED &&
      actual.requiresAdminConfirmation === false && actual.provisional === false;
    if (input.isSfCollect) {
      if (correction?.shippingFee && !new Decimal(correction.shippingFee).isZero()) throw new FulfillmentPricingError('顺丰到付快递费必须为0');
    } else if (plan.amount !== null) {
      if (!plan.reason) plan.issue = `地址 ${shipment.sequence} 的人工快递费需要填写依据`;
    } else if ((order.isSfCollect || (baseline.recovered && !preserveRecordedShipping)) && plan.prepaidEvidence) {
      const evidence = plan.prepaidEvidence;
      const weight = text(evidence.billableWeightKg);
      if (text(evidence.destinationProvince) !== plan.destinationProvince || weight === null || plan.weightKg === null || !new Decimal(weight).eq(plan.weightKg)) {
        plan.issue = `地址 ${shipment.sequence} 原已审核运费的省份或重量依据不足/已变化，请填写实际快递费及依据`;
      } else {
        plan.amount = money(evidence.amount, '原已审核快递费');
        plan.suggestedAmount = evidence.suggestedAmount === null ? null : money(evidence.suggestedAmount, '原建议快递费');
        plan.reason = text(evidence.overrideReason) ?? '恢复更正前已审核快递费';
        plan.sourceRuleId = text(evidence.sourceRuleId);
        plan.pricingSnapshot = record(evidence.pricingSnapshot) as Prisma.InputJsonObject;
      }
    } else if (preserveRecordedShipping) {
      // Recovery reuses the actual fee recorded by the proven SF correction;
      // it must not silently replace a carrier/manual amount with a formula.
      plan.amount = money(previous.amount, '已记录快递费');
      plan.reason = previous.overrideReason;
      plan.suggestedAmount = previous.suggestedAmount?.toFixed(2) ?? null;
      plan.pricingSnapshot = previous.pricingSnapshot as Prisma.InputJsonValue;
    } else if (!previous.priceBookId) {
      plan.issue = `地址 ${shipment.sequence} 缺少原物流价目簿，请填写实际快递费及依据`;
    } else {
      try {
        // The resolver receives the original book ID, never the currently
        // published processing price. Its packing result is deliberately not
        // persisted: the approved packaging material fee is immutable here.
        const itemById = new Map(order.items.map((item) => [item.id, item]));
        const quote = await resolveExternalOrderChargesForFinalization(tx, {
          isSfCollect: false,
          shipments: [{
            shipmentKey: String(shipment.sequence), province: plan.destinationProvince,
            billableWeightKg: plan.weightKg,
            requiresActualWeight: order.packagingGroups.some((group) => packagingBoxType(group.mode) && group.lines.some((line) => shipment.lines.some((allocation) => allocation.orderItemId === line.orderItemId && allocation.quantity > 0))),
            itemQuantity: shipment.lines.reduce((sum, line) => sum + line.quantity, 0),
            weightItems: shipment.lines.flatMap((line) => {
              const item = itemById.get(line.orderItemId);
              return item ? [{ itemKey: item.id, quantity: line.quantity, paperWeightGsm: item.paperWeightGsm, paperType: item.paperType, productStructure: item.productStructure }] : [];
            }),
            shippingFee: null, packingMaterialFee: '0.00', overrideReason: '履约更正沿用已审核耗材费，仅计算快递费',
          }],
        }, previous.priceBookId, now, { allowPending: true });
        if (quote.priceBook.id !== previous.priceBookId) throw new FulfillmentPricingError('物流计价依据与原工单不一致');
        const result = quote.charges.filter((row) => row.categoryCode === 'SHIPPING_FEE' && row.businessKey.toUpperCase() === previous.businessKey.toUpperCase());
        const line = result[0];
        if (result.length !== 1 || !line || line.categoryId !== previous.categoryId) throw new FulfillmentPricingError('物流计价结果与收费身份不一致');
        const quotedActual = record(record(line.pricingSnapshot).actual);
        plan.suggestedAmount = line.suggestedAmount;
        plan.pricingSnapshot = line.pricingSnapshot;
        plan.sourceRuleId = line.sourceRuleId;
        if (quotedActual.requiresAdminConfirmation === true || quotedActual.provisional === true || line.suggestedAmount === null) {
          plan.issue = `地址 ${shipment.sequence} 快递费仍待确认，请补齐计费事实或实际金额与依据`;
        } else {
          plan.amount = money(line.amount, '快递费');
        }
      } catch (error) {
        if (error instanceof OrderCustomerChargeError) plan.issue = `地址 ${shipment.sequence} 原物流依据无法计算：${error.message}；请填写实际快递费及依据`;
        else throw error;
      }
    }
    plans.push(plan);
  }
  const preservedChargesAmount = order.customerCharges.filter((charge) => charge.category.code !== 'SHIPPING_FEE').reduce((sum, charge) => sum.plus(money(charge.amount, '已审核独立收费', true)), new Decimal(0)).toFixed(2);
  const complete = plans.every((plan) => plan.issue === null && plan.amount !== null);
  const total = new Decimal(order.processingAmount.toString()).plus(preservedChargesAmount).plus(plans.reduce((sum, plan) => sum.plus(plan.amount ?? 0), new Decimal(0)));
  money(total, '工单总额');
  const preview: FulfillmentPricingPreview = {
    orderId: order.id, orderNo: order.orderNo, status: order.status, isSfCollect: input.isSfCollect,
    expectedOrderRevision: order.revision, expectedEditVersion: order.editVersion,
    expectedWorkOrderVersion: order.workOrderVersion, expectedPriceRevision: order.priceRevision,
    previewToken: '', oldTotal: money(order.totalAmount, '工单总额'),
    newTotal: complete ? total.toFixed(2) : null,
    delta: complete ? total.minus(order.totalAmount.toString()).toFixed(2) : null,
    processingAmount: money(order.processingAmount, '加工费'), preservedChargesAmount,
    canConfirm: complete, issues: plans.flatMap((plan) => plan.issue ? [plan.issue] : []),
    shipments: plans.map((plan) => ({ shipmentId: plan.shipmentId, sequence: plan.sequence, destinationProvince: plan.destinationProvince,
      weightKg: plan.weightKg, currentShippingFee: plan.previous.amount === null ? null : money(plan.previous.amount, '快递费'),
      shippingFee: plan.amount, reason: plan.reason, requiresManual: plan.issue !== null })),
  };
  preview.previewToken = `fulfillment-pricing-v1:${fingerprint({ input, baseline, preview, evidence: plans.map((plan) => ({ priceBookId: plan.previous.priceBookId, sourceRuleId: plan.sourceRuleId, suggestedAmount: plan.suggestedAmount })) })}`;
  return { preview, plans, baseline, provisionalTotal: total.toFixed(2) };
}

type Plan = Awaited<ReturnType<typeof buildPlan>>;

function requestFingerprint(input: Required<PreviewFulfillmentPricingCommand>, guard: FulfillmentPricingMutationGuard, token: string | null, actor: Actor): string {
  return fingerprint({ input, guard: {
    expectedOrderRevision: guard.expectedOrderRevision, expectedEditVersion: guard.expectedEditVersion,
    expectedWorkOrderVersion: guard.expectedWorkOrderVersion, expectedPriceRevision: guard.expectedPriceRevision,
    idempotencyKey: guard.idempotencyKey,
  }, token, actorId: actor.id });
}

async function replay(tx: Prisma.TransactionClient, orderId: string, key: string, action: string, requestHash: string) {
  const previous = await tx.orderLog.findFirst({ where: { orderId, action, changedFields: { path: ['fulfillmentRequest', 'idempotencyKey'], equals: key } }, select: { changedFields: true } });
  if (!previous) return null;
  const request = record(record(previous.changedFields).fulfillmentRequest);
  if (request.fingerprint !== requestHash) throw new FulfillmentPricingError('同一履约请求标识已用于不同内容，请重新预览');
  return record(request.result);
}

async function persistPlan(tx: Prisma.TransactionClient, order: FulfillmentOrder, input: Required<PreviewFulfillmentPricingCommand>, actor: Actor, now: Date, plan: Plan, confirmed: boolean, guard: FulfillmentPricingMutationGuard, requestHash: string) {
  for (const row of plan.plans) {
    const status = input.isSfCollect ? OrderCustomerChargeStatus.WAIVED
      : !confirmed && (row.issue || row.amount === null) ? OrderCustomerChargeStatus.PENDING_AMOUNT
      : order.status === OrderStatus.SHIPPED && confirmed ? OrderCustomerChargeStatus.FINAL : OrderCustomerChargeStatus.ESTIMATED;
    const amount = row.amount;
    const reason = row.reason ?? (input.isSfCollect ? '顺丰到付，快递费免收' : confirmed ? '管理员确认原物流价目簿计算的快递费' : '顺丰到付更正，快递费待管理员确认');
    const pricingSnapshot = confirmed && amount !== null && !input.isSfCollect
      ? buildTrustedAdminChargePricingSnapshot({
          previous: row.pricingSnapshot ?? row.previous.pricingSnapshot,
          now, actorId: actor.id, previousPriceRevision: order.priceRevision,
          charge: { ...row.previous, categoryCode: row.previous.category.code, status, sourceRuleId: row.sourceRuleId,
            quantity: row.weightKg, unit: 'kg', suggestedAmount: row.suggestedAmount, amount, overrideReason: reason },
        })
      : {
          source: input.isSfCollect ? 'FULFILLMENT_SF_WAIVER' : 'FULFILLMENT_SHIPPING_PENDING',
          previousSnapshot: row.previous.pricingSnapshot,
          priceBookId: row.previous.priceBookId,
          actual: { amount, provisional: !confirmed, requiresAdminConfirmation: !confirmed, overrideReason: reason },
          correctedAt: now.toISOString(), actorId: actor.id,
        };
    // 寄样首重默认（DECISIONS 2026-09-30）：手填运费时新快照沿用旧快照，会把默认标记
    // 一并带过来；重量已更正就必须去掉，仍是默认首重才保留。
    const snapshot = reconcileSampleWeightBasis(row.previous.pricingSnapshot, {
      ...pricingSnapshot,
      ...(row.prepaidEvidence ? { preservedPrepaidShipping: row.prepaidEvidence } : {}),
      ...(confirmed ? { fulfillmentPricingConfirmation: {
        orderId: order.id, priceRevision: order.priceRevision + 1,
        destinationProvince: row.destinationProvince, billableWeightKg: row.weightKg,
      } } : {}),
    } as Record<string, unknown>, input.isSfCollect ? null : row.weightKg);
    await tx.orderCustomerCharge.update({
      where: { id: row.previous.id },
      data: { status, amount, suggestedAmount: row.suggestedAmount, sourceRuleId: row.sourceRuleId,
        quantity: row.weightKg, unit: 'kg', overrideReason: reason,
        pricingSnapshot: snapshot as Prisma.InputJsonObject,
        finalizedById: status === OrderCustomerChargeStatus.FINAL || status === OrderCustomerChargeStatus.WAIVED ? actor.id : null,
        finalizedAt: status === OrderCustomerChargeStatus.FINAL || status === OrderCustomerChargeStatus.WAIVED ? now : null },
    });
    await tx.orderShipment.update({ where: { id: row.shipmentId }, data: {
      carrierCode: input.isSfCollect ? 'SF' : 'ZTO',
      ...(row.destinationProvince !== null ? { destinationProvince: row.destinationProvince } : {}),
      ...(row.weightKg !== null ? { weightKg: row.weightKg } : {}),
    }, select: { id: true } });
  }
  const amount = confirmed ? plan.preview.newTotal! : plan.provisionalTotal;
  await tx.order.update({ where: { id: order.id }, data: {
    isSfCollect: input.isSfCollect, totalAmount: amount, confirmedFee: confirmed ? amount : null,
  }, select: { id: true } });
  const pricing = await appendOrderPricingRevisionInTx(tx, {
    orderId: order.id, status: confirmed ? OrderPricingStatus.ADMIN_CONFIRMED : OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
    source: confirmed ? CONFIRMED_SOURCE : PENDING_SOURCE,
    actorId: actor.id, now, expectedPriceRevision: order.priceRevision, incrementOrderRevision: true,
    orderFeeSnapshot: { quotedFee: confirmed ? order.quotedFee : amount, confirmedFee: confirmed ? amount : null, settledFee: null },
    remark: confirmed ? '管理员明确确认履约快递费；沿用已审核加工和非物流收费' : '顺丰到付更正，等待管理员复核物流费用',
    metadata: { fulfillment: { baselinePricingRevisionId: plan.baseline.id, preservedFinancialFingerprint: plan.baseline.frozen, isSfCollect: input.isSfCollect, recovered: plan.baseline.recovered, previousQuotedPricingRevisionId: order.quotedPricingRevisionId, previousQuotedFee: order.quotedFee?.toFixed(2) ?? null } },
  });
  if (!confirmed) {
    // Keep the quote tuple valid at every SQL statement, including on legacy
    // orders without a previous quote reference.
    await tx.order.update({ where: { id: order.id }, data: {
      quotedFee: amount,
      quotedFeeCompleteness: plan.preview.canConfirm ? OrderQuotedFeeCompleteness.COMPLETE : OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
      quotedPricingRevisionId: pricing.pricingRevisionId,
    }, select: { id: true } });
  }
  const result = { orderId: order.id, status: order.status, confirmedFee: confirmed ? amount : null, revision: pricing.orderRevision, priceRevision: pricing.priceRevision };
  await tx.orderLog.create({ data: {
    orderId: order.id, operatorId: actor.id, action: confirmed ? CONFIRMED_ACTION : PENDING_ACTION,
    changedFields: {
      isSfCollect: { before: order.isSfCollect, after: input.isSfCollect },
      totalAmount: { before: money(order.totalAmount, '工单总额'), after: amount },
      confirmedFee: { before: order.confirmedFee?.toFixed(2) ?? null, after: confirmed ? amount : null },
      priceRevision: { before: order.priceRevision, after: pricing.priceRevision },
      revision: { before: order.revision, after: pricing.orderRevision },
      fulfillmentRequest: { idempotencyKey: guard.idempotencyKey, fingerprint: requestHash, result },
      shipmentChargeCorrections: { before: null, after: plan.preview.shipments },
    },
    remark: confirmed ? '履约费用已明确确认' : '履约费用待管理员确认',
  } });
  return result;
}

export async function previewFulfillmentPricing(input: PreviewFulfillmentPricingCommand, actor: Actor): Promise<FulfillmentPricingPreview> {
  assertAdmin(actor);
  const normalized = normalizedInput(input);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(normalized.orderId)}))`;
    const order = await readOrder(tx, normalized.orderId);
    return (await buildPlan(tx, order, normalized, await databaseClockNow(tx))).preview;
  });
}

export async function finalizeFulfillmentPricing(input: FinalizeFulfillmentPricingCommand, actor: Actor): Promise<FulfillmentPricingResult> {
  assertAdmin(actor);
  assertGuard(input);
  if (!/^fulfillment-pricing-v1:[a-f0-9]{64}$/.test(input.previewToken)) throw new FulfillmentPricingError('履约预览凭据非法，请重新预览');
  const normalized = normalizedInput(input);
  const hash = requestFingerprint(normalized, input, input.previewToken, actor);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(normalized.orderId)}))`;
    const previous = await replay(tx, normalized.orderId, input.idempotencyKey, CONFIRMED_ACTION, hash);
    if (previous) return { orderId: normalized.orderId, status: previous.status as OrderStatus, confirmedFee: String(previous.confirmedFee), revision: Number(previous.revision), priceRevision: Number(previous.priceRevision), idempotentReplay: true };
    const order = await readOrder(tx, normalized.orderId);
    assertVersions(order, input);
    const now = await databaseClockNow(tx);
    const plan = await buildPlan(tx, order, normalized, now);
    if (plan.preview.previewToken !== input.previewToken) throw new FulfillmentPricingError('履约费用或计价依据已变化，请重新预览并确认');
    if (!plan.preview.canConfirm) throw new FulfillmentPricingError(plan.preview.issues.join('；') || '物流费用尚未补齐');
    const result = await persistPlan(tx, order, normalized, actor, now, plan, true, input, hash);
    return { ...result, confirmedFee: result.confirmedFee!, idempotentReplay: false };
  });
}

/** Called only after the ordinary toggle has acquired the canonical order lock. */
export async function recordFulfillmentSfCollectChangeInTx(tx: Prisma.TransactionClient, input: PreviewFulfillmentPricingCommand & FulfillmentPricingMutationGuard, actor: Actor) {
  assertGuard(input);
  if (actor.role !== Role.ADMIN && actor.role !== Role.SALES) throw new FulfillmentPricingError('无权修改履约方式');
  // Ordinary switches never confirm prices. Browser-supplied administrator
  // corrections belong to the explicit preview/confirmation workflow instead.
  const normalized = normalizedInput({ orderId: input.orderId, isSfCollect: input.isSfCollect, shipments: [] });
  const hash = requestFingerprint(normalized, input, null, actor);
  const previous = await replay(tx, normalized.orderId, input.idempotencyKey, PENDING_ACTION, hash);
  if (previous) return { id: normalized.orderId, status: previous.status as OrderStatus, changed: false, changedFields: [] as string[] };
  const order = await readOrder(tx, normalized.orderId);
  if (actor.role !== Role.ADMIN && (order.submitterId !== actor.id || order.status === OrderStatus.SHIPPED)) throw new FulfillmentPricingError('已发货更正只能由管理员处理，其他工单只能修改自己提交的工单');
  assertVersions(order, input);
  if (order.isSfCollect === normalized.isSfCollect) return { id: order.id, status: order.status, changed: false, changedFields: [] as string[] };
  const now = await databaseClockNow(tx);
  const plan = await buildPlan(tx, order, normalized, now);
  await persistPlan(tx, order, normalized, actor, now, plan, false, input, hash);
  return { id: order.id, status: order.status, changed: true, changedFields: ['isSfCollect', 'totalAmount'] };
}

export function hasFulfillmentPricingConfirmation(value: unknown): boolean {
  return Object.keys(record(record(value).fulfillmentPricingConfirmation)).length > 0;
}

/** Shipment finalization must not reprice the freight an administrator just approved. */
export async function finalizeConfirmedFulfillmentChargesForShipmentInTx(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    actorId: string;
    now: Date;
    shipments: ReadonlyArray<{
      shipmentId: string;
      destinationProvince: string | null;
      weightKg: string | null;
      shippingFee?: string | null;
      packingMaterialFee?: string | null;
    }>;
  },
): Promise<void> {
  const order = await readOrder(tx, input.orderId);
  await verifiedBaseline(tx, order);
  if (order.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION) throw new FulfillmentPricingError('履约费用仍待管理员确认，不能发货');
  const shipping = shippingCharges(order);
  const requested = new Map(input.shipments.map((shipment) => [shipment.shipmentId, shipment]));
  if (requested.size !== input.shipments.length || requested.size !== order.shipments.length || order.shipments.some((shipment) => !requested.has(shipment.id))) throw new FulfillmentPricingError('发货地址与已确认履约费用不一致');
  const updates: Array<{ id: string; status: OrderCustomerChargeStatus; snapshot: unknown }> = [];
  for (const shipment of order.shipments) {
    const charge = shipping.get(shipment.id)!;
    const marker = record(record(charge.pricingSnapshot).fulfillmentPricingConfirmation);
    const waiver = order.isSfCollect && charge.status === OrderCustomerChargeStatus.WAIVED && charge.amount?.isZero();
    const trusted = !order.isSfCollect && isTrustedAdminChargePricingSnapshot(charge.pricingSnapshot, charge);
    if (marker.orderId !== order.id || !Number.isSafeInteger(marker.priceRevision) || Number(marker.priceRevision) > order.priceRevision || (!waiver && !trusted)) throw new FulfillmentPricingError('已确认快递费身份或审计快照失效，请重新复核履约费用');
    const shipmentRequest = requested.get(shipment.id)!;
    if (!order.isSfCollect && (
      text(marker.destinationProvince) !== text(shipmentRequest.destinationProvince) ||
      text(marker.billableWeightKg) === null || shipmentRequest.weightKg === null ||
      !new Decimal(String(marker.billableWeightKg)).eq(shipmentRequest.weightKg)
    )) throw new FulfillmentPricingError('最终计费重量或省份与已确认履约依据不同，请先重新预览并确认履约费用');
    const packing = order.customerCharges.filter((row) => row.category.code === 'PACKING_MATERIAL' && row.shipmentId === shipment.id && row.businessKey.toUpperCase() === `SHIPMENT:${shipment.sequence}:PACKING_MATERIAL`);
    if (packing.length !== 1) throw new FulfillmentPricingError('已审核包装材料费身份不完整');
    for (const [row, submitted] of [[charge, requested.get(shipment.id)!.shippingFee], [packing[0]!, requested.get(shipment.id)!.packingMaterialFee]] as const) {
      if (row.status === OrderCustomerChargeStatus.PENDING_AMOUNT || row.amount === null) throw new FulfillmentPricingError('发货费用仍有待定项目');
      if (submitted != null && money(submitted, '发货费用') !== money(row.amount, '已审核费用')) throw new FulfillmentPricingError('发货金额与已审核履约费用不同，请先通过履约费用入口预览并确认');
      const status = row.status === OrderCustomerChargeStatus.WAIVED ? row.status : OrderCustomerChargeStatus.FINAL;
      const rebuilt = isTrustedAdminChargePricingSnapshot(row.pricingSnapshot, row)
        ? buildTrustedAdminChargePricingSnapshot({ previous: row.pricingSnapshot, actorId: input.actorId, now: input.now, previousPriceRevision: order.priceRevision,
            charge: { ...row, categoryCode: row.category.code, status, amount: row.amount } })
        : row.pricingSnapshot;
      // 定稿也按统一规则维护寄样首重默认标记（DECISIONS 2026-09-30）。
      const snapshot = order.purpose === 'SAMPLE_SHIPMENT' && row === charge && rebuilt !== null && typeof rebuilt === 'object' && !Array.isArray(rebuilt)
        ? reconcileSampleWeightBasis(row.pricingSnapshot, rebuilt as Record<string, unknown>, order.isSfCollect ? null : shipmentRequest.weightKg)
        : rebuilt;
      updates.push({ id: row.id, status, snapshot });
    }
  }
  for (const { id, status, snapshot } of updates) {
    await tx.orderCustomerCharge.update({ where: { id }, data: { status, finalizedById: input.actorId, finalizedAt: input.now,
      ...(snapshot !== null ? { pricingSnapshot: snapshot as Prisma.InputJsonObject } : {}),
    } });
  }
}
