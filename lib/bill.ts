import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import {
  BillStatus,
  OrderCostCategory,
  OrderBillingMode,
  OrderCustomerChargeStatus,
  OrderPricingStatus,
  OrderSettlementType,
  OrderStatus,
  Role,
} from '../generated/prisma/enums';
import { db } from './db';
import {
  assertExecutionFence,
  type ExecutionFence,
} from './execution-fence';
import { parseShanghaiMonthInstantRange } from './attendance';
import { orderCascadeLockKey } from './order/locks';
import {
  transitionBill,
  InvalidBillTransitionError,
} from './bill/status-machine';
import { generateAgentMonthlyBillsForPeriod } from './agent-monthly-billing/generation';

// 外部销售对客应收账单（加工费 + 快递/耗材等对客收费）
//
// 生成规则：按 Shanghai 日历月汇总，每位外部销售先有一张
// sequence=1 月账单。已发账单不变，后续同月迟到工单进入下一序号的
// 补充账单。item 列表是其在该月 `finishedAt` 的收费工单。
//
// 付款规则：累加式 paidAmount；当累计 = totalAmount 切 FULLY_PAID。
// 内部员工提成与外部销售应收是两套结算账本，Bill 只记后者。
//
// Finance-of-record bedrock: FULLY_PAID 是终态，不允许倒退 / 覆盖。
// 写入路径全部 tx + per-bill advisory lock 防并发付款 race（和
// HourlyWorkerPayroll 的 round-48 模式一致）。

export class BillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillError';
  }
}

export const LEGACY_BILL_READ_ONLY_MESSAGE =
  '旧账单已切换为永久只读归档，请使用代理商月度账单';

function rejectLegacyBillWrite(): never {
  throw new BillError(LEGACY_BILL_READ_ONLY_MESSAGE);
}

// Advisory-lock namespace: 并发付款 / 生成 / 发单到同一条 Bill 都
// 要序列化，防 paidAmount 叠加 race。
function billLockKey(billId: string): string {
  return `print-shop-erp:bill:${billId}`;
}

// Generate 路径在 Bill 还没创建之前就需要锁——用 (salesUser, period)
// 做 key，防两次并发生成同一张账单时双写 item 或同时 create。
function billGenerateLockKey(salesUserId: string, period: string): string {
  return `print-shop-erp:bill-gen:${salesUserId}:${period}`;
}

function financeRequestLockKey(kind: 'payment' | 'cost', key: string): string {
  return `print-shop-erp:${kind}-request:${key}`;
}

const DECIMAL_12_2_MAX = new Decimal('9999999999.99');
const DECIMAL_12_3_MAX = new Decimal('999999999.999');
const DECIMAL_12_4_MAX = new Decimal('99999999.9999');

function parseFinanceDecimal(value: Decimal.Value, label: string): Decimal {
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error('non-finite');
    return parsed;
  } catch {
    throw new BillError(`${label}格式不合法`);
  }
}

function assertStoredDecimal(
  value: Decimal,
  options: {
    label: string;
    decimalPlaces: number;
    max: Decimal;
    nonNegative?: boolean;
  },
): void {
  if (options.nonNegative && value.lt(0)) {
    throw new BillError(`${options.label}必须是非负数`);
  }
  if (value.decimalPlaces() > options.decimalPlaces) {
    throw new BillError(
      `${options.label}小数最多 ${options.decimalPlaces} 位，不能静默舍入`,
    );
  }
  if (value.abs().gt(options.max)) {
    throw new BillError(
      `${options.label}超过可保存上限 ${options.max.toFixed(options.decimalPlaces)}`,
    );
  }
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function optionalDecimalEquals(
  stored: Decimal.Value | null,
  requested: Decimal | null,
): boolean {
  if (stored === null || requested === null) {
    return stored === null && requested === null;
  }
  return new Decimal(stored).eq(requested);
}

function assertBillAmountFits(value: Decimal): void {
  if (!value.isFinite()) {
    throw new BillError('账单总额格式不合法');
  }
  if (value.lt(0)) {
    throw new BillError(
      '账单总额不能为负数；系统暂不支持退款或贷项，请先由财务线下核对',
    );
  }
  if (value.decimalPlaces() > 2) {
    throw new BillError('账单总额小数最多 2 位');
  }
  if (value.gt(DECIMAL_12_2_MAX)) {
    throw new BillError('账单总额超过可保存上限 9,999,999,999.99 元');
  }
}

type BillableOrderFacts = {
  id: string;
  orderNo: string;
  submitterId: string;
  status: OrderStatus;
  billingMode: OrderBillingMode;
  settlementType: OrderSettlementType;
  pricingStatus: OrderPricingStatus;
  finishedAt: Date | null;
  processingAmount: unknown;
  totalAmount: unknown;
  quotedFee: unknown | null;
  confirmedFee: unknown | null;
  settledFee: unknown | null;
  customerCharges: Array<{
    status: OrderCustomerChargeStatus;
    amount: unknown | null;
  }>;
};

const BILLABLE_ORDER_SELECT = {
  id: true,
  orderNo: true,
  submitterId: true,
  status: true,
  billingMode: true,
  settlementType: true,
  pricingStatus: true,
  finishedAt: true,
  processingAmount: true,
  totalAmount: true,
  quotedFee: true,
  confirmedFee: true,
  settledFee: true,
  customerCharges: {
    select: { status: true, amount: true },
  },
} as const;

const CONFIRMED_BILL_PRICING_STATUSES = new Set<OrderPricingStatus>([
  OrderPricingStatus.ADMIN_CONFIRMED,
  OrderPricingStatus.AUTO_CONFIRMED,
  OrderPricingStatus.LEGACY_CONFIRMED,
]);

function safeBillDecimal(value: unknown): Decimal | null {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    !(
      value !== null &&
      typeof value === 'object' &&
      'toString' in value &&
      typeof value.toString === 'function'
    )
  ) {
    return null;
  }
  try {
    const parsed = new Decimal(value.toString());
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function billableOrderIssue(order: BillableOrderFacts): string | null {
  if (
    order.status !== OrderStatus.FINISHED ||
    order.billingMode !== OrderBillingMode.CHARGE ||
    order.settlementType !== OrderSettlementType.EXTERNAL_SALES ||
    order.finishedAt === null
  ) {
    return '工单不是已完工的外部销售收费单';
  }
  if (!CONFIRMED_BILL_PRICING_STATUSES.has(order.pricingStatus)) {
    return '对客终价尚未确认';
  }

  const incompleteCharge = order.customerCharges.find(
    (charge) =>
      charge.amount === null ||
      (charge.status !== OrderCustomerChargeStatus.FINAL &&
        charge.status !== OrderCustomerChargeStatus.WAIVED),
  );
  if (incompleteCharge) return '存在未终审或缺少金额的对客收费明细';

  // Cutover history deliberately kept its old aggregate and may have no
  // structured charges. Do not invent/reconcile historical prices, but reject
  // any incomplete charge rows that do exist (checked above).
  if (order.pricingStatus === OrderPricingStatus.LEGACY_CONFIRMED) return null;
  if (order.customerCharges.length === 0) return '缺少对客收费明细';

  const processingAmount = safeBillDecimal(order.processingAmount);
  const totalAmount = safeBillDecimal(order.totalAmount);
  if (!processingAmount || !totalAmount) return '工单金额格式异常';
  const chargeTotal = order.customerCharges.reduce(
    (sum, charge) => sum.plus(safeBillDecimal(charge.amount) ?? Number.NaN),
    new Decimal(0),
  );
  if (!chargeTotal.isFinite()) return '对客收费金额格式异常';
  if (!processingAmount.plus(chargeTotal).eq(totalAmount)) {
    return '工单总额与加工费及对客收费明细不一致';
  }

  const canonicalFee =
    safeBillDecimal(order.settledFee) ??
    safeBillDecimal(order.confirmedFee) ??
    safeBillDecimal(order.quotedFee);
  if (!canonicalFee) return '缺少对客金额快照';
  if (!canonicalFee.eq(totalAmount)) return '对客金额快照与工单总额不一致';
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// 生成：月初扫描上月外部销售的 FINISHED 收费工单 → 每人一条账单
// ─────────────────────────────────────────────────────────────────────

export type BillGenerationResult = {
  period: string;
  generated: Array<{
    billId: string;
    salesUserId: string;
    totalAmount: string;
    orderCount: number;
    isNew: boolean; // upsert: 首次生成 vs 已存在只补 items
    sequence: number;
    isSupplemental: boolean;
  }>;
  errors: Array<{ salesUserId: string; message: string }>;
};

// Bill groups commit independently. If a later group hits an infrastructure
// or programming failure, retain the committed prefix for counts-only
// observability and rethrow so the durable job retries instead of reporting a
// false success.
export class BillGenerationUnexpectedError extends Error {
  readonly partialResult: BillGenerationResult;

  constructor(
    message: string,
    partialResult: BillGenerationResult,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = 'BillGenerationUnexpectedError';
    this.partialResult = partialResult;
  }
}

// 核心：扫上月外部销售 FINISHED 收费工单，按 submitterId 分组。有草稿时
// 只追加未入账工单；只有不可变的已发账单时，为迟到工单创建补充草稿。
export async function generateBillsForPeriod(
  period: string,
  _actor: { id: string; role: Role },
  fence?: ExecutionFence,
): Promise<BillGenerationResult> {
  // Stable cron/action entrypoint cutover: every caller writes the v2 ledger.
  // Keeping this public name avoids changing the durable job wire contract;
  // the legacy Bill tables below are now reachable only through read models.
  const result = await generateAgentMonthlyBillsForPeriod(period, _actor, {
    fence,
  });
  return {
    period: result.period,
    generated: result.generated.map((bill) => ({
      billId: bill.billId,
      salesUserId: bill.agentUserId,
      totalAmount: bill.totalAmount,
      orderCount: bill.orderCount,
      isNew: bill.created,
      sequence: 1,
      isSupplemental: false,
    })),
    errors: [],
  };

  /* c8 ignore start -- preserved historical implementation for archive archaeology */
  const { start, end } = parseShanghaiMonthInstantRange(period);

  const generated: BillGenerationResult['generated'] = [];
  const errors: BillGenerationResult['errors'] = [];

  // 只用工单创建时锁定的 settlementType 识别外部销售应收。
  // Role 只负责权限，不参与资金方向判定，避免账号调岗导致历史结算漂移。
  let candidates: BillableOrderFacts[];
  try {
    candidates = await db.order.findMany({
      where: {
        status: OrderStatus.FINISHED,
        billingMode: OrderBillingMode.CHARGE,
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        finishedAt: { gte: start, lt: end },
      },
      select: BILLABLE_ORDER_SELECT,
    });
  } catch (cause) {
    throw new BillGenerationUnexpectedError(
      '账单批量扫描失败',
      { period, generated, errors },
      cause,
    );
  }

  const orders: BillableOrderFacts[] = [];
  const ineligibleBySubmitter = new Map<string, string[]>();
  for (const order of candidates) {
    const issue = billableOrderIssue(order);
    if (!issue) {
      orders.push(order);
      continue;
    }
    const messages = ineligibleBySubmitter.get(order.submitterId) ?? [];
    messages.push(`${order.orderNo || order.id}：${issue}`);
    ineligibleBySubmitter.set(order.submitterId, messages);
  }
  for (const [salesUserId, messages] of ineligibleBySubmitter) {
    errors.push({
      salesUserId,
      message: `未纳入账单（fail closed）：${messages.join('；')}`,
    });
  }

  // 按 submitterId 分组
  const bySubmitter = new Map<string, typeof orders>();
  for (const o of orders) {
    const arr = bySubmitter.get(o.submitterId) ?? [];
    arr.push(o);
    bySubmitter.set(o.submitterId, arr);
  }

  for (const [submitterId, submitterOrders] of bySubmitter) {
    try {
      await assertExecutionFence(fence);
      const result = await generateBillForSubmitter(
        period,
        submitterId,
        submitterOrders,
        fence,
      );
      generated.push(result);
    } catch (err) {
      if (err instanceof BillError) {
        errors.push({
          salesUserId: submitterId,
          message: (err as BillError).message,
        });
        continue;
      }
      throw new BillGenerationUnexpectedError(
        `外部销售 ${submitterId} 的 ${period} 月对客应收账单生成发生系统错误`,
        { period, generated, errors },
        err,
      );
    }
  }

  return { period, generated, errors };
  /* c8 ignore stop */
}

async function generateBillForSubmitter(
  period: string,
  submitterId: string,
  orders: BillableOrderFacts[],
  fence?: ExecutionFence,
): Promise<BillGenerationResult['generated'][number]> {
  return db.$transaction(async (tx) => {
    // Serialize two concurrent generate runs on the same (sales, period)
    // 对。Without this, both runs could read existing.items, both decide
    // an orderId is missing, and both createMany a duplicate. The global
    // @@unique([orderId]) index is the DB-level last-line
    // guard; this lock turns the error into clean serialization
    // .
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${billGenerateLockKey(
      submitterId,
      period,
    )}))`;

    const billSelect = {
      id: true,
      sequence: true,
      status: true,
      openingAmount: true,
      totalAmount: true,
      items: { select: { orderId: true, orderAmount: true } },
    } as const;
    let monthBills = await tx.bill.findMany({
      where: { salesUserId: submitterId, period },
      orderBy: { sequence: 'asc' },
      select: billSelect,
    });

    // Join every concrete bill lock in deterministic order, then re-read. The
    // logical monthly lock prevents create/issue races; concrete locks also
    // preserve the established lock order with payment operations.
    for (const bill of [...monthBills].sort((a, b) => a.id.localeCompare(b.id))) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${billLockKey(
        bill.id,
      )}))`;
    }
    if (monthBills.length > 0) {
      monthBills = await tx.bill.findMany({
        where: { salesUserId: submitterId, period },
        orderBy: { sequence: 'asc' },
        select: billSelect,
      });
    }

    const attachedItems =
      orders.length === 0
        ? []
        : await tx.billItem.findMany({
            where: { orderId: { in: orders.map((order) => order.id) } },
            select: {
              orderId: true,
              billId: true,
              bill: { select: { salesUserId: true, period: true } },
            },
          });
    const misplacedItem = attachedItems.find(
      (item) =>
        item.bill.salesUserId !== submitterId || item.bill.period !== period,
    );
    if (misplacedItem) {
      throw new BillError(
        `工单 ${misplacedItem.orderId} 已归入 ${misplacedItem.bill.period} / ${misplacedItem.bill.salesUserId} 的账单，不能静默跳过`,
      );
    }
    const attachedOrderIds = new Set(attachedItems.map((item) => item.orderId));
    const unbilledOrders = orders.filter(
      (order) => !attachedOrderIds.has(order.id),
    );
    const drafts = monthBills.filter((bill) => bill.status === BillStatus.DRAFT);
    if (drafts.length > 1) {
      throw new BillError(`${period} 存在多张补充账单草稿，请先进行财务核对`);
    }

    const existingDraft = drafts[0] ?? null;
    if (existingDraft) {
      const toAdd = unbilledOrders;
      // DRAFT is still a mutable proposal. If an already-attached eligible
      // order received a newly confirmed final price, refresh its frozen item
      // amount during the explicit generate/rerun path. Once the statement is
      // ISSUED this branch is unreachable and its BillItem remains immutable.
      const currentEligibleById = new Map(
        orders.map((order) => [order.id, order] as const),
      );
      const refreshedItems = existingDraft.items.map((item) => {
        const currentOrder = currentEligibleById.get(item.orderId);
        if (!currentOrder) return item;
        return {
          ...item,
          orderAmount: new Decimal(
            currentOrder.totalAmount as Decimal.Value,
          ).toFixed(2),
        };
      });
      const previousAmountByOrderId = new Map(
        existingDraft.items.map((item) => [item.orderId, item.orderAmount]),
      );
      const changedItems = refreshedItems.filter((item) => {
        const previousAmount = previousAmountByOrderId.get(item.orderId);
        return (
          previousAmount !== undefined &&
          !new Decimal(previousAmount).eq(item.orderAmount)
        );
      });
      const persistedItemTotal = refreshedItems.reduce(
        (sum, item) => sum.plus(item.orderAmount),
        new Decimal(0),
      );
      const appendedItemTotal = toAdd.reduce(
        (sum, order) => sum.plus(order.totalAmount as Decimal.Value),
        new Decimal(0),
      );
      const total = new Decimal(existingDraft.openingAmount)
        .plus(persistedItemTotal)
        .plus(appendedItemTotal);
      assertBillAmountFits(total);
      const totalAmount = total.toFixed(2);
      await assertExecutionFence(fence);
      for (const item of changedItems) {
        await tx.billItem.update({
          where: {
            billId_orderId: {
              billId: existingDraft.id,
              orderId: item.orderId,
            },
          },
          data: { orderAmount: item.orderAmount },
          select: { id: true },
        });
      }
      if (toAdd.length > 0) {
        await tx.billItem.createMany({
          data: toAdd.map((o) => ({
            billId: existingDraft.id,
            orderId: o.id,
            orderAmount: new Decimal(o.totalAmount as Decimal.Value).toFixed(2),
          })),
        });
      }
      const updated = await tx.bill.update({
        where: { id: existingDraft.id },
        data: { totalAmount },
        select: { id: true },
      });
      return {
        billId: updated.id,
        salesUserId: submitterId,
        totalAmount,
        orderCount: existingDraft.items.length + toAdd.length,
        isNew: false,
        sequence: existingDraft.sequence,
        isSupplemental: existingDraft.sequence > 1,
      };
    }

    // An idempotent rerun after every eligible order has already been attached
    // returns the latest immutable statement without creating an empty
    // supplemental bill.
    if (unbilledOrders.length === 0) {
      const latest = monthBills.at(-1);
      if (!latest) {
        throw new BillError('工单已归入其他账期的账单，不能重复归集');
      }
      return {
        billId: latest.id,
        salesUserId: submitterId,
        totalAmount: new Decimal(latest.totalAmount).toFixed(2),
        orderCount: latest.items.length,
        isNew: false,
        sequence: latest.sequence,
        isSupplemental: latest.sequence > 1,
      };
    }

    // No mutable draft remains. Preserve all issued statements and create the
    // next explicit sequence containing only globally unbilled late orders.
    const sequence = (monthBills.at(-1)?.sequence ?? 0) + 1;
    const totalAmount = unbilledOrders
      .reduce<Decimal>(
        (acc, order) =>
          acc.plus(new Decimal(order.totalAmount as Decimal.Value)),
        new Decimal(0),
      )
      .toFixed(2);
    assertBillAmountFits(new Decimal(totalAmount));
    await assertExecutionFence(fence);
    const created = await tx.bill.create({
      data: {
        salesUserId: submitterId,
        period,
        sequence,
        openingAmount: '0.00',
        totalAmount,
        paidAmount: '0.00',
        status: BillStatus.DRAFT,
        items: {
          create: unbilledOrders.map((o) => ({
            orderId: o.id,
            orderAmount: new Decimal(o.totalAmount as Decimal.Value).toFixed(2),
          })),
        },
      },
      select: { id: true },
    });
    return {
      billId: created.id,
      salesUserId: submitterId,
      totalAmount,
      orderCount: unbilledOrders.length,
      isNew: true,
      sequence,
      isSupplemental: sequence > 1,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// 发单：DRAFT → ISSUED
// ─────────────────────────────────────────────────────────────────────

export async function issueBill(
  billId: string,
  _actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{ id: string; status: BillStatus }> {
  rejectLegacyBillWrite();
  /* c8 ignore start -- preserved historical implementation for archive archaeology */
  if (_actor.role !== Role.ADMIN) {
    throw new BillError('只有管理员可以发布账单');
  }
  if (Number.isNaN(now.getTime())) {
    throw new BillError('发单时间不合法');
  }
  return db.$transaction(async (tx) => {
    const identity = await tx.bill.findUnique({
      where: { id: billId },
      select: { salesUserId: true, period: true },
    });
    if (!identity) throw new BillError('账单不存在');
    // Match generation's lock order: logical monthly bill first, concrete bill
    // second. Only the locked re-read below drives the transition.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${billGenerateLockKey(
      identity.salesUserId,
      identity.period,
    )}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${billLockKey(billId)}))`;

    const bill = await tx.bill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        salesUserId: true,
        period: true,
        status: true,
        openingAmount: true,
        totalAmount: true,
        items: {
          select: {
            orderAmount: true,
            order: { select: BILLABLE_ORDER_SELECT },
          },
        },
      },
    });
    if (!bill) throw new BillError('账单不存在');
    transitionBill(bill.status, BillStatus.ISSUED);
    const totalAmount = parseFinanceDecimal(
      bill.totalAmount as Decimal.Value,
      '账单总额',
    );
    assertBillAmountFits(totalAmount);
    if (totalAmount.isZero()) {
      throw new BillError('空账单不能发单');
    }
    const openingAmount = parseFinanceDecimal(
      bill.openingAmount as Decimal.Value,
      '账单期初金额',
    );
    assertStoredDecimal(openingAmount, {
      label: '账单期初金额',
      decimalPlaces: 2,
      max: DECIMAL_12_2_MAX,
    });
    let frozenItemTotal = new Decimal(0);
    const periodRange = parseShanghaiMonthInstantRange(bill.period);
    for (const item of bill.items) {
      const orderIssue = billableOrderIssue(item.order);
      const inBillPeriod =
        item.order.finishedAt !== null &&
        item.order.finishedAt >= periodRange.start &&
        item.order.finishedAt < periodRange.end;
      if (
        orderIssue ||
        item.order.submitterId !== bill.salesUserId ||
        !inBillPeriod
      ) {
        throw new BillError(
          `账单包含不可出账工单 ${item.order.orderNo || item.order.id}：${
            orderIssue ??
            (item.order.submitterId !== bill.salesUserId
              ? '工单不属于该销售'
              : '工单完工时间不在账期内')
          }`,
        );
      }
      const frozenOrderAmount = parseFinanceDecimal(
        item.orderAmount as Decimal.Value,
        `工单 ${item.order.orderNo || item.order.id} 的账单金额`,
      );
      const currentOrderAmount = safeBillDecimal(item.order.totalAmount);
      if (!currentOrderAmount || !frozenOrderAmount.eq(currentOrderAmount)) {
        throw new BillError(
          `账单工单 ${item.order.orderNo || item.order.id} 的冻结金额与当前终价不一致，不能发单`,
        );
      }
      frozenItemTotal = frozenItemTotal.plus(frozenOrderAmount);
    }
    if (!openingAmount.plus(frozenItemTotal).eq(totalAmount)) {
      throw new BillError(
        '账单总额与期初金额及工单明细合计不一致，不能发单',
      );
    }

    const updated = await tx.bill.update({
      where: { id: billId },
      data: { status: BillStatus.ISSUED, issuedAt: now },
      select: { id: true, status: true },
    });
    return updated;
  });
  /* c8 ignore stop */
}

// ─────────────────────────────────────────────────────────────────────
// 记账：recordPayment 追加付款流水、累加 paidAmount 并触发状态转换
// ─────────────────────────────────────────────────────────────────────

export type RecordPaymentResult = {
  billId: string;
  previousPaidAmount: string;
  newPaidAmount: string;
  totalAmount: string;
  status: BillStatus;
  csAccumulated: false; // 兼容旧 action 响应；外部销售收款不触发员工提成流水
};

// Owner records a payment of `amount` against the bill. Amount must
// be > 0 and new paidAmount must not exceed totalAmount. When the
export async function recordPayment(
  billId: string,
  amount: string | number | Decimal,
  _actor: { id: string; role: Role },
  now: Date = new Date(),
  details?: {
    idempotencyKey?: string;
    paymentMethod?: string | null;
    referenceNo?: string | null;
    remark?: string | null;
  },
): Promise<RecordPaymentResult> {
  rejectLegacyBillWrite();
  /* c8 ignore start -- preserved historical implementation for archive archaeology */
  if (_actor.role !== Role.ADMIN) {
    throw new BillError('只有管理员可以记录付款');
  }
  const deltaDec = parseFinanceDecimal(amount as Decimal.Value, '付款金额');
  if (deltaDec.lte(0)) {
    throw new BillError('付款金额必须大于 0');
  }
  assertStoredDecimal(deltaDec, {
    label: '付款金额',
    decimalPlaces: 2,
    max: DECIMAL_12_2_MAX,
  });
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new BillError('付款时间不合法');
  }

  const idempotencyKey = details?.idempotencyKey?.trim() || randomUUID();
  const paymentMethod = normalizeOptionalText(details?.paymentMethod);
  const referenceNo = normalizeOptionalText(details?.referenceNo);
  const remark = normalizeOptionalText(details?.remark);
  return db.$transaction(async (tx) => {
    // A stable browser request key makes a network retry return the original
    // result instead of applying the same money movement twice. Take this lock
    // before the bill lock on every path to keep lock ordering deterministic.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${financeRequestLockKey(
      'payment',
      idempotencyKey,
    )}))`;

    const replay = await tx.billPayment.findUnique({
      where: { idempotencyKey },
      select: {
        billId: true,
        amount: true,
        paidAt: true,
        paymentMethod: true,
        referenceNo: true,
        remark: true,
        recordedById: true,
        bill: {
          select: { paidAmount: true, totalAmount: true, status: true },
        },
      },
    });
    if (replay) {
      if (
        replay.billId !== billId ||
        replay.recordedById !== _actor.id ||
        !new Decimal(replay.amount as Decimal.Value).eq(deltaDec) ||
        replay.paidAt.getTime() !== now.getTime() ||
        replay.paymentMethod !== paymentMethod ||
        replay.referenceNo !== referenceNo ||
        replay.remark !== remark
      ) {
        throw new BillError('付款请求标识已被其他付款使用，请刷新后重试');
      }
      return {
        billId,
        previousPaidAmount: new Decimal(
          replay.bill.paidAmount as Decimal.Value,
        ).toFixed(2),
        newPaidAmount: new Decimal(
          replay.bill.paidAmount as Decimal.Value,
        ).toFixed(2),
        totalAmount: new Decimal(
          replay.bill.totalAmount as Decimal.Value,
        ).toFixed(2),
        status: replay.bill.status,
        csAccumulated: false,
      };
    }

    // Serialize concurrent payments on the same bill so paidAmount
    // 累加不丢 update。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${billLockKey(billId)}))`;

    const bill = await tx.bill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        status: true,
        salesUserId: true,
        totalAmount: true,
        paidAmount: true,
        paidAt: true,
        payments: {
          orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: { paidAt: true },
        },
        salesUser: { select: { role: true } },
      },
    });
    if (!bill) throw new BillError('账单不存在');

    // Only ISSUED / PARTIAL_PAID accept new payments. DRAFT must issue
    // first; FULLY_PAID is terminal.
    if (
      bill.status !== BillStatus.ISSUED &&
      bill.status !== BillStatus.PARTIAL_PAID
    ) {
      throw new BillError(
        `账单状态 ${bill.status} 不接受付款（需先发单 / 不能重复结清）`,
      );
    }

    const prev = parseFinanceDecimal(
      bill.paidAmount as unknown as Decimal.Value,
      '账单已收金额',
    );
    const total = parseFinanceDecimal(
      bill.totalAmount as unknown as Decimal.Value,
      '账单总额',
    );
    assertStoredDecimal(prev, {
      label: '账单已收金额',
      decimalPlaces: 2,
      max: DECIMAL_12_2_MAX,
      nonNegative: true,
    });
    assertBillAmountFits(total);
    if (total.isZero() || prev.gt(total)) {
      throw new BillError('账单金额状态异常，请先对账');
    }
    const next = prev.plus(deltaDec);
    if (next.gt(total)) {
      throw new BillError(
        `付款金额超出未结清余额（已付 ${prev.toFixed(2)}，本次 ${deltaDec.toFixed(2)}，总额 ${total.toFixed(2)}）`,
      );
    }

    // 状态机：next === total → FULLY_PAID；else → PARTIAL_PAID
    const targetStatus = next.eq(total)
      ? BillStatus.FULLY_PAID
      : BillStatus.PARTIAL_PAID;
    const latestPaymentAt = bill.payments[0]?.paidAt;
    const settledAt =
      latestPaymentAt && latestPaymentAt.getTime() > now.getTime()
        ? latestPaymentAt
        : now;
    // Skip the machine check when we're staying on PARTIAL_PAID (a
    // second partial payment before hitting total). The machine
    // itself rejects self-transitions because that's usually a bug,
    // but "continuing partial payment" is a legitimate no-transition
    // case — paidAmount still advances.
    if (targetStatus !== bill.status) {
      transitionBill(bill.status, targetStatus);
    }

    await tx.bill.update({
      where: { id: billId },
      data: {
        paidAmount: next.toFixed(2),
        status: targetStatus,
        paidAt:
          targetStatus === BillStatus.FULLY_PAID
            ? settledAt
            : bill.paidAt ?? null,
      },
    });
    await tx.billPayment.create({
      data: {
        idempotencyKey,
        billId,
        amount: deltaDec.toFixed(2),
        paidAt: now,
        paymentMethod,
        referenceNo,
        remark,
        recordedById: _actor.id,
      },
    });

    return {
      billId,
      previousPaidAmount: prev.toFixed(2),
      newPaidAmount: next.toFixed(2),
      totalAmount: total.toFixed(2),
      status: targetStatus,
      csAccumulated: false,
    };
  });
  /* c8 ignore stop */
}

// ─────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────

export async function listBills(filter: {
  salesUserId?: string;
  period?: string;
  status?: BillStatus;
} = {}) {
  if (filter.period !== undefined) {
    parseShanghaiMonthInstantRange(filter.period);
  }
  return db.bill.findMany({
    where: {
      ...(filter.salesUserId ? { salesUserId: filter.salesUserId } : {}),
      ...(filter.period ? { period: filter.period } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: [
      { period: 'desc' },
      { salesUserId: 'asc' },
      { sequence: 'asc' },
    ],
    select: {
      id: true,
      salesUserId: true,
      period: true,
      sequence: true,
      openingAmount: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      issuedAt: true,
      paidAt: true,
      salesUser: { select: { displayName: true, role: true } },
    },
  });
}

/**
 * Full finance-of-record view. Callers must enforce `bill:view:all` before
 * invoking this read because it intentionally includes internal production,
 * outsource, rework and manual-cost evidence.
 */
export async function getAdminBillDetail(id: string) {
  return db.bill.findUnique({
    where: { id },
    select: {
      id: true,
      salesUserId: true,
      period: true,
      sequence: true,
      openingAmount: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      issuedAt: true,
      paidAt: true,
      remark: true,
      createdAt: true,
      updatedAt: true,
      salesUser: {
        select: {
          id: true,
          displayName: true,
          role: true,
        },
      },
      payments: {
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
        include: {
          recordedBy: { select: { displayName: true } },
        },
      },
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          orderId: true,
          orderAmount: true,
          order: {
            select: {
              id: true,
              orderNo: true,
              settlementType: true,
              customerRef: true,
              processingAmount: true,
              finishedAt: true,
              status: true,
              csSalesEntries: {
                orderBy: { createdAt: 'asc' },
                select: {
                  amount: true,
                  salaryPeriod: {
                    select: {
                      commissions: {
                        select: { tierRate: true },
                      },
                    },
                  },
                },
              },
              shipments: {
                orderBy: { sequence: 'asc' },
                select: { sequence: true, weightKg: true },
              },
              customerCharges: {
                orderBy: { createdAt: 'asc' },
                select: {
                  amount: true,
                  status: true,
                  category: { select: { code: true, name: true } },
                  shipment: { select: { sequence: true } },
                },
              },
              costEntries: {
                orderBy: { createdAt: 'asc' },
                include: {
                  createdBy: { select: { displayName: true } },
                },
              },
              items: {
                select: {
                  tasks: {
                    where: { status: 'COMPLETED' },
                    select: { pieceworkAmount: true },
                  },
                },
              },
              productionOperations: {
                select: {
                  reports: {
                    orderBy: [{ reportedAt: 'asc' }, { id: 'asc' }],
                    select: { amount: true },
                  },
                },
              },
              outsourceOrders: {
                where: { status: { not: 'CANCELLED' } },
                select: { amount: true },
              },
              reworkOrders: {
                select: {
                  id: true,
                  orderNo: true,
                  items: {
                    select: {
                      tasks: {
                        where: { status: 'COMPLETED' },
                        select: { pieceworkAmount: true },
                      },
                    },
                  },
                  productionOperations: {
                    select: {
                      reports: {
                        orderBy: [{ reportedAt: 'asc' }, { id: 'asc' }],
                        select: { amount: true },
                      },
                    },
                  },
                  outsourceOrders: {
                    where: { status: { not: 'CANCELLED' } },
                    select: { amount: true },
                  },
                  costEntries: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                      id: true,
                      category: true,
                      description: true,
                      quantity: true,
                      unit: true,
                      unitPrice: true,
                      amount: true,
                      remark: true,
                      createdAt: true,
                      createdBy: { select: { displayName: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

/**
 * Least-privilege external-sales view.
 *
 * Ownership is part of the database predicate (not a post-query check), and
 * the projection deliberately excludes every internal cost/commission source
 * and the employee who recorded a payment. Bill items are independently
 * constrained to the same external salesperson so a historically-corrupted
 * BillItem cannot disclose another account's order.
 */
export async function getSalesBillDetail(id: string, salesUserId: string) {
  return db.bill.findUnique({
    where: { id, salesUserId },
    select: {
      id: true,
      salesUserId: true,
      period: true,
      sequence: true,
      openingAmount: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      issuedAt: true,
      paidAt: true,
      remark: true,
      payments: {
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          amount: true,
          paidAt: true,
          paymentMethod: true,
          referenceNo: true,
          remark: true,
          idempotencyKey: true,
        },
      },
      items: {
        where: {
          order: {
            submitterId: salesUserId,
            settlementType: OrderSettlementType.EXTERNAL_SALES,
          },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          orderId: true,
          orderAmount: true,
          order: {
            select: {
              id: true,
              orderNo: true,
              customerRef: true,
              processingAmount: true,
              finishedAt: true,
              status: true,
              customerCharges: {
                orderBy: { createdAt: 'asc' },
                select: {
                  amount: true,
                  status: true,
                  category: { select: { code: true, name: true } },
                  shipment: { select: { sequence: true } },
                },
              },
              items: {
                orderBy: { sequence: 'asc' },
                select: {
                  id: true,
                  sequence: true,
                  name: true,
                  pricingSnapshot: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function addOrderCostEntry(
  input: {
    idempotencyKey?: string;
    orderId: string;
    category: OrderCostCategory;
    description: string;
    quantity?: string | null;
    unit?: string | null;
    unitPrice?: string | null;
    amount: string;
    remark?: string | null;
  },
  actor: { id: string; role: Role },
) {
  if (actor.role !== Role.ADMIN) {
    throw new BillError('只有管理员可以补录成本');
  }
  const amount = parseFinanceDecimal(input.amount, '成本金额');
  assertStoredDecimal(amount, {
    label: '成本金额',
    decimalPlaces: 2,
    max: DECIMAL_12_2_MAX,
  });
  if (amount.isZero()) {
    throw new BillError('成本金额不能为 0');
  }
  if (
    input.category === OrderCostCategory.PIECEWORK ||
    input.category === OrderCostCategory.OUTSOURCE
  ) {
    throw new BillError('计件和外协成本由生产流水自动汇总，不能手工重复录入');
  }
  if (input.category !== OrderCostCategory.ADJUSTMENT && amount.isNegative()) {
    throw new BillError('普通成本必须大于 0；负数冲正请使用成本调整');
  }

  const quantityText = normalizeOptionalText(input.quantity);
  const unitPriceText = normalizeOptionalText(input.unitPrice);
  const quantity = quantityText
    ? parseFinanceDecimal(quantityText, '成本数量')
    : null;
  const unitPrice = unitPriceText
    ? parseFinanceDecimal(unitPriceText, '成本单价')
    : null;
  if (quantity) {
    assertStoredDecimal(quantity, {
      label: '成本数量',
      decimalPlaces: 3,
      max: DECIMAL_12_3_MAX,
      nonNegative: true,
    });
  }
  if (unitPrice) {
    assertStoredDecimal(unitPrice, {
      label: '成本单价',
      decimalPlaces: 4,
      max: DECIMAL_12_4_MAX,
      nonNegative: true,
    });
  }
  if (quantity && unitPrice && !quantity.times(unitPrice).toDecimalPlaces(2).eq(amount)) {
    throw new BillError('成本金额必须等于数量 × 单价（按两位小数四舍五入）');
  }

  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
  const description = input.description.trim();
  const unit = normalizeOptionalText(input.unit);
  const remark = normalizeOptionalText(input.remark);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${financeRequestLockKey(
      'cost',
      idempotencyKey,
    )}))`;
    // Keep cost writes in the same per-order critical section as fulfillment
    // flag changes. The request lock must stay first so retries of one request
    // serialize before they join the shared order lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.orderId,
    )}))`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, isSfCollect: true },
    });
    if (!order) throw new BillError('工单不存在');

    const replay = await tx.orderCostEntry.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        orderId: true,
        amount: true,
        category: true,
        description: true,
        quantity: true,
        unit: true,
        unitPrice: true,
        remark: true,
        createdById: true,
      },
    });
    if (replay) {
      if (
        replay.orderId !== input.orderId ||
        replay.createdById !== actor.id ||
        replay.category !== input.category ||
        !new Decimal(replay.amount as Decimal.Value).eq(amount) ||
        replay.description !== description ||
        !optionalDecimalEquals(
          replay.quantity as Decimal.Value | null,
          quantity,
        ) ||
        replay.unit !== unit ||
        !optionalDecimalEquals(
          replay.unitPrice as Decimal.Value | null,
          unitPrice,
        ) ||
        replay.remark !== remark
      ) {
        throw new BillError('成本请求标识已被其他记录使用，请刷新后重试');
      }
      return replay;
    }
    if (
      order.isSfCollect &&
      input.category === OrderCostCategory.SHIPPING
    ) {
      throw new BillError('顺丰到付工单由内部自行预约，不能录入物流费');
    }

    return tx.orderCostEntry.create({
      data: {
        idempotencyKey,
        orderId: input.orderId,
        category: input.category,
        description,
        quantity: quantity?.toFixed(3) ?? null,
        unit,
        unitPrice: unitPrice?.toFixed(4) ?? null,
        amount: amount.toFixed(2),
        remark,
        createdById: actor.id,
      },
    });
  });
}

export { InvalidBillTransitionError };
