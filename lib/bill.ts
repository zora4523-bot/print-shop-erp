import Decimal from 'decimal.js';
import {
  BillStatus,
  OrderStatus,
  Role,
} from '../generated/prisma/enums';
import { db } from './db';
import { parseShanghaiMonth } from './attendance';
import { accumulateCsSales } from './salary/cs';
import {
  transitionBill,
  InvalidBillTransitionError,
} from './bill/status-machine';

// 销售应收账单 MVP (SPEC §3.1 / §4.1 / §9.1)
//
// 生成规则：按 Shanghai 日历月汇总，每位销售 / 客服一条 Bill，item
// 列表是他们在该月 `finishedAt` 的 Order。月度自动生成对应上月。
//
// 付款规则：累加式 paidAmount；当累计 = totalAmount 切 FULLY_PAID。
// mark-paid 流程对 CUSTOMER_SERVICE 提交的账单会调用
// `accumulateCsSales` 给对应客服周期累计业绩。
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

// Advisory-lock namespace: 并发付款 / 生成 / 发单到同一条 Bill 都
// 要序列化，防 paidAmount 叠加 race。
function billLockKey(billId: string): string {
  return `print-shop-erp:bill:${billId}`;
}

// Generate 路径在 Bill 还没创建之前就需要锁——用 (salesUser, period)
// 做 key，防两次并发生成同一张账单时双写 item 或同时 create。
// Codex round 52 / P1。
function billGenerateLockKey(salesUserId: string, period: string): string {
  return `print-shop-erp:bill-gen:${salesUserId}:${period}`;
}

// ─────────────────────────────────────────────────────────────────────
// 生成：月初扫描上月 FINISHED 订单 → 每位销售 / 客服一条账单
// ─────────────────────────────────────────────────────────────────────

export type BillGenerationResult = {
  period: string;
  generated: Array<{
    billId: string;
    salesUserId: string;
    totalAmount: string;
    orderCount: number;
    isNew: boolean; // upsert: 首次生成 vs 已存在只补 items
  }>;
  errors: Array<{ salesUserId: string; message: string }>;
};

// 核心：扫上月 FINISHED 订单按 submitterId 分组，每组 upsert 一条
// DRAFT Bill。重跑该月（中途又有订单 FINISHED）会把新订单加到同一条
// Bill 的 items 里，paidAmount 和 status 不动。
export async function generateBillsForPeriod(
  period: string,
  _actor: { id: string; role: Role },
): Promise<BillGenerationResult> {
  void _actor;
  const { start, end } = parseShanghaiMonth(period);

  // 查当月所有 FINISHED 订单
  const orders = await db.order.findMany({
    where: {
      status: OrderStatus.FINISHED,
      finishedAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      submitterId: true,
      totalAmount: true,
    },
  });

  // 按 submitterId 分组
  const bySubmitter = new Map<string, typeof orders>();
  for (const o of orders) {
    const arr = bySubmitter.get(o.submitterId) ?? [];
    arr.push(o);
    bySubmitter.set(o.submitterId, arr);
  }

  const generated: BillGenerationResult['generated'] = [];
  const errors: BillGenerationResult['errors'] = [];

  for (const [submitterId, submitterOrders] of bySubmitter) {
    try {
      const result = await generateBillForSubmitter(
        period,
        submitterId,
        submitterOrders,
      );
      generated.push(result);
    } catch (err) {
      errors.push({
        salesUserId: submitterId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { period, generated, errors };
}

async function generateBillForSubmitter(
  period: string,
  submitterId: string,
  orders: Array<{ id: string; totalAmount: unknown }>,
): Promise<BillGenerationResult['generated'][number]> {
  return db.$transaction(async (tx) => {
    // Serialize two concurrent generate runs on the same (sales, period)
    // 对。Without this, both runs could read existing.items, both decide
    // an orderId is missing, and both createMany a duplicate. The
    // @@unique([billId, orderId]) index is the DB-level last-line
    // guard; this lock turns the error into clean serialization
    // (Codex round 52 / P1).
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${billGenerateLockKey(
      submitterId,
      period,
    )}))`;

    // Finance-of-record: 该月账单一旦进入 ISSUED / PAID / PARTIAL_PAID
    // 就不再自动追加 items（owner 手动补单或新建月份账单）。自动
    // 生成只覆盖 DRAFT 或首次创建。
    const existing = await tx.bill.findUnique({
      where: { salesUserId_period: { salesUserId: submitterId, period } },
      select: {
        id: true,
        status: true,
        items: { select: { orderId: true } },
      },
    });

    const totalAmount = orders
      .reduce<Decimal>(
        (acc, o) => acc.plus(new Decimal(o.totalAmount as Decimal.Value)),
        new Decimal(0),
      )
      .toFixed(2);

    if (existing) {
      if (existing.status !== BillStatus.DRAFT) {
        throw new BillError(
          `${period} 账单已 ${existing.status}，新完工订单请单独追加或开新账单`,
        );
      }
      // DRAFT: 追加尚未包含的 orderIds 作为 BillItems，重算 totalAmount
      const knownIds = new Set(existing.items.map((it) => it.orderId));
      const toAdd = orders.filter((o) => !knownIds.has(o.id));
      if (toAdd.length > 0) {
        await tx.billItem.createMany({
          data: toAdd.map((o) => ({
            billId: existing.id,
            orderId: o.id,
            orderAmount: new Decimal(o.totalAmount as Decimal.Value).toFixed(2),
          })),
        });
      }
      const updated = await tx.bill.update({
        where: { id: existing.id },
        data: { totalAmount },
        select: { id: true },
      });
      return {
        billId: updated.id,
        salesUserId: submitterId,
        totalAmount,
        orderCount: existing.items.length + toAdd.length,
        isNew: false,
      };
    }

    // 首次创建
    const created = await tx.bill.create({
      data: {
        salesUserId: submitterId,
        period,
        totalAmount,
        paidAmount: '0.00',
        status: BillStatus.DRAFT,
        items: {
          create: orders.map((o) => ({
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
      orderCount: orders.length,
      isNew: true,
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
  void _actor;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${billLockKey(billId)}))`;

    const bill = await tx.bill.findUnique({
      where: { id: billId },
      select: { id: true, status: true },
    });
    if (!bill) throw new BillError('账单不存在');
    transitionBill(bill.status, BillStatus.ISSUED);

    const updated = await tx.bill.update({
      where: { id: billId },
      data: { status: BillStatus.ISSUED, issuedAt: now },
      select: { id: true, status: true },
    });
    return updated;
  });
}

// ─────────────────────────────────────────────────────────────────────
// 记账：recordPayment 累加 paidAmount、触发状态转换、wire CS 累计
// ─────────────────────────────────────────────────────────────────────

export type RecordPaymentResult = {
  billId: string;
  previousPaidAmount: string;
  newPaidAmount: string;
  totalAmount: string;
  status: BillStatus;
  csAccumulated: boolean; // 是否触发了客服业绩累计
};

// Owner records a payment of `amount` against the bill. Amount must
// be > 0 and new paidAmount must not exceed totalAmount. When the
// bill's salesUserId is CUSTOMER_SERVICE, `accumulateCsSales` gets
// called with `amount` (not newTotal — delta semantics).
export async function recordPayment(
  billId: string,
  amount: string | number | Decimal,
  _actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<RecordPaymentResult> {
  void _actor;
  const deltaDec = new Decimal(amount as Decimal.Value);
  if (!deltaDec.isFinite() || deltaDec.lte(0)) {
    throw new BillError('付款金额必须大于 0');
  }

  return db.$transaction(async (tx) => {
    // Serialize concurrent payments on the same bill so paidAmount
    // 累加不丢 update。
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${billLockKey(billId)}))`;

    const bill = await tx.bill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        status: true,
        salesUserId: true,
        totalAmount: true,
        paidAmount: true,
        paidAt: true,
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

    const prev = new Decimal(bill.paidAmount as unknown as Decimal.Value);
    const total = new Decimal(bill.totalAmount as unknown as Decimal.Value);
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
        paidAt: targetStatus === BillStatus.FULLY_PAID ? now : bill.paidAt ?? null,
      },
    });

    // CS 业绩累计：仅当 salesUser 是 CUSTOMER_SERVICE 才触发。
    // SALES 的账单不累计（SALES 不走客服周期 / 提成系统）。
    //
    // Pass our tx into accumulateCsSales so the CS-period write
    // shares atomicity with the bill update (Codex round 52 / P1).
    // Prisma 的 $transaction 不是真嵌套；不传 tx 会开独立事务，bill
    // 外层 rollback 时 CS 已经 commit 了。传 tx 后两者同生共死。
    let csAccumulated = false;
    if (bill.salesUser.role === Role.CUSTOMER_SERVICE) {
      const r = await accumulateCsSales(
        bill.salesUserId,
        deltaDec.toFixed(2),
        now,
        tx as unknown as Parameters<typeof accumulateCsSales>[3],
      );
      csAccumulated = r !== null;
    }

    return {
      billId,
      previousPaidAmount: prev.toFixed(2),
      newPaidAmount: next.toFixed(2),
      totalAmount: total.toFixed(2),
      status: targetStatus,
      csAccumulated,
    };
  });
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
    parseShanghaiMonth(filter.period);
  }
  return db.bill.findMany({
    where: {
      ...(filter.salesUserId ? { salesUserId: filter.salesUserId } : {}),
      ...(filter.period ? { period: filter.period } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: [{ period: 'desc' }, { salesUserId: 'asc' }],
    select: {
      id: true,
      salesUserId: true,
      period: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      issuedAt: true,
      paidAt: true,
      salesUser: { select: { displayName: true, role: true } },
    },
  });
}

export async function getBillDetail(id: string) {
  return db.bill.findUnique({
    where: { id },
    select: {
      id: true,
      salesUserId: true,
      period: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      issuedAt: true,
      paidAt: true,
      remark: true,
      createdAt: true,
      updatedAt: true,
      salesUser: { select: { id: true, displayName: true, role: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          orderId: true,
          orderAmount: true,
          order: {
            select: {
              orderNo: true,
              customerRef: true,
              finishedAt: true,
              status: true,
            },
          },
        },
      },
    },
  });
}

export { InvalidBillTransitionError };
