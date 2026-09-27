import Decimal from 'decimal.js';
import { OrderStatus, OutsourceStatus, Role } from '../generated/prisma/enums';
import { db } from './db';
import {
  transitionOutsource,
  InvalidOutsourceTransitionError,
} from './outsource/status-machine';
import { outsourceUnavailableReason } from './order/outsource-eligibility';
import { orderCascadeLockKey } from './order/locks';
import { writeAuditLogInTx, type AuditActor } from './audit-log';
import {
  dispatchProductionCompletionNotification,
  maybeCompleteProductionOrder,
  type ProductionCompletionTx,
} from './production-completion';
import type {
  CreateOutsourceInput,
  ConfirmOutsourceAmountInput,
  MarkOutsourceReceivedInput,
  RecordOutsourcePaymentInput,
} from './auth/schemas';
import { readFrozenOutsourceTotal } from './outsource/frozen-total';

export class OutsourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutsourceError';
  }
}

export type CreatedOutsource = { id: string };

const OUTSOURCE_AMOUNT_MAX = new Decimal('9999999999.99');

function storableOutsourceAmount(
  value: Decimal.Value | null | undefined,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    throw new OutsourceError(`${label}格式不合法`);
  }
  if (
    !amount.isFinite() ||
    amount.isNegative() ||
    amount.decimalPlaces() > 2 ||
    amount.gt(OUTSOURCE_AMOUNT_MAX)
  ) {
    throw new OutsourceError(`${label}必须是非负数，最多 10 位整数和 2 位小数`);
  }
  return amount.toFixed(2);
}

function sameOptionalDate(
  actual: Date | null,
  expected: Date | null | undefined,
): boolean {
  return actual?.getTime() === expected?.getTime();
}

function sameStringArray(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function sumOutsourcePayments(
  payments: Array<{ amount: Decimal.Value }>,
): Decimal {
  return payments.reduce((sum, payment) => {
    let amount: Decimal;
    try {
      amount = new Decimal(payment.amount);
    } catch {
      throw new OutsourceError('外协付款流水金额异常，请先对账');
    }
    if (
      !amount.isFinite() ||
      amount.lte(0) ||
      amount.decimalPlaces() > 2 ||
      amount.gt(OUTSOURCE_AMOUNT_MAX)
    ) {
      throw new OutsourceError('外协付款流水金额异常，请先对账');
    }
    return sum.plus(amount);
  }, new Decimal(0));
}

function readStoredOutsourcePayable(value: Decimal.Value): Decimal {
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    throw new OutsourceError('外协应付金额异常，请先对账');
  }
  if (
    !amount.isFinite() ||
    amount.isNegative() ||
    amount.decimalPlaces() > 2 ||
    amount.gt(OUTSOURCE_AMOUNT_MAX)
  ) {
    throw new OutsourceError('外协应付金额异常，请先对账');
  }
  return amount;
}

// Creation joins the shared per-order lock used by schedule/ship/cancel and a
// request-key lock. The locked replay check happens before today's order-state
// gate, so a lost response can still recover the original result after the
// order advances. Actor identity is part of exact-payload equality and the
// first successful write records an audit row in the same transaction.

type OutsourceTxClient = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  order: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{ status: OrderStatus; completedAt: Date | null } | null>;
  };
  orderItem: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; orderId: true; quantity: true };
    }) => Promise<Array<{ id: string; orderId: string; quantity: number }>>;
  };
  outsourceOrder: {
    findUnique: (args: {
      where: { idempotencyKey: string };
      select?: unknown;
    }) => Promise<{
      id: string;
      orderId: string | null;
      orderItemIds: string[];
      supplierName: string;
      supplierContact: string | null;
      craftDescription: string | null;
      specialRequirement: string | null;
      totalQty: number | null;
      expectedDate: Date | null;
      amount: Decimal.Value | null;
      remark: string | null;
      createdById: string | null;
      itemSnapshots: Array<{ orderItemId: string; quantity: number }>;
    } | null>;
    create: (args: { data: unknown; select?: unknown }) => Promise<{ id: string }>;
  };
};

export async function createOutsourceOrder(
  input: CreateOutsourceInput,
  actor: AuditActor,
): Promise<CreatedOutsource> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as OutsourceTxClient;
    // Per-order advisory lock makes the "order is attachable?" check
    // and the outsource INSERT atomic relative to ANY other Order-
    // status writer (ship / cancel / schedule / finish / cascade).
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.orderId,
    )}))`;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource-create:${input.idempotencyKey}`}))`;

    const amount = storableOutsourceAmount(input.amount, '外协金额');
    if (input.orderItemIds.length === 0) {
      throw new OutsourceError('至少选择一个款式');
    }
    const uniqueItemIds = new Set(input.orderItemIds);
    if (uniqueItemIds.size !== input.orderItemIds.length) {
      throw new OutsourceError('不能重复选择同一款式');
    }
    // Item order is not business data. Canonicalize it before persistence and
    // idempotency comparison so a harmless checkbox/order change cannot make
    // an otherwise identical retry conflict.
    const orderItemIds = [...uniqueItemIds].sort();
    const supplierName = input.supplierName.trim();
    if (!supplierName) throw new OutsourceError('请填写外协厂名');
    const supplierContact = normalizeOptionalText(input.supplierContact);
    const craftDescription = normalizeOptionalText(input.craftDescription);
    const specialRequirement = normalizeOptionalText(input.specialRequirement);
    const remark = normalizeOptionalText(input.remark);

    const replay = await txClient.outsourceOrder.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: {
        id: true,
        orderId: true,
        orderItemIds: true,
        supplierName: true,
        supplierContact: true,
        craftDescription: true,
        specialRequirement: true,
        totalQty: true,
        expectedDate: true,
        amount: true,
        remark: true,
        createdById: true,
        itemSnapshots: {
          select: { orderItemId: true, quantity: true },
        },
      },
    });
    if (replay) {
      const exactNonQuantityPayload =
        replay.orderId === input.orderId &&
        replay.createdById === actor.id &&
        sameStringArray([...replay.orderItemIds].sort(), orderItemIds) &&
        replay.supplierName === supplierName &&
        replay.supplierContact === supplierContact &&
        replay.craftDescription === craftDescription &&
        replay.specialRequirement === specialRequirement &&
        sameOptionalDate(replay.expectedDate, input.expectedDate) &&
        (replay.amount === null
          ? amount === null
          : amount !== null && new Decimal(replay.amount).eq(amount)) &&
        replay.remark === remark;
      if (!exactNonQuantityPayload) {
        throw new OutsourceError(
          '外协创建请求标识已被其他内容使用，请刷新后重试',
        );
      }

      // Replay must be decided from the immutable creation ledger, never from
      // today's OrderItem.quantity. Otherwise a successful first request whose
      // response was lost starts failing as soon as the order quantity changes.
      // A non-null legacy total remains sufficient for request equality because
      // the client payload contains only the aggregate. When both sources are
      // absent we cannot prove equality and deliberately fail closed.
      const frozenTotal = readFrozenOutsourceTotal(replay);
      if (!frozenTotal.ok) {
        throw new OutsourceError(frozenTotal.errorMessage);
      }
      const frozenTotalQty = frozenTotal.totalQty;
      if (
        input.totalQty !== null &&
        input.totalQty !== undefined &&
        input.totalQty !== frozenTotalQty
      ) {
        throw new OutsourceError(
          '外协创建请求标识已被其他内容使用，请刷新后重试',
        );
      }
      return { id: replay.id };
    }

    const selectedItems = await txClient.orderItem.findMany({
      where: { id: { in: orderItemIds } },
      select: { id: true, orderId: true, quantity: true },
    });
    const selectedById = new Map(selectedItems.map((item) => [item.id, item]));
    const missingItemIds = orderItemIds.filter((id) => !selectedById.has(id));
    if (missingItemIds.length > 0) {
      throw new OutsourceError('所选款式不存在或已被删除，请刷新后重试');
    }
    if (selectedItems.some((item) => item.orderId !== input.orderId)) {
      throw new OutsourceError('所选款式不属于当前工单');
    }
    const totalQty = selectedItems.reduce((sum, item) => {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new OutsourceError('所选款式数量异常，请先修复工单数据');
      }
      return sum + item.quantity;
    }, 0);
    if (!Number.isSafeInteger(totalQty)) {
      throw new OutsourceError('所选款式合计数量超出可存储范围');
    }
    if (
      input.totalQty !== null &&
      input.totalQty !== undefined &&
      input.totalQty !== totalQty
    ) {
      throw new OutsourceError(
        `外协总数量必须等于所选款式合计 ${totalQty}，请刷新后重试`,
      );
    }

    const order = await txClient.order.findUnique({
      where: { id: input.orderId },
      select: { status: true, completedAt: true },
    });
    if (!order) throw new OutsourceError('工单不存在');
    const unavailableReason = outsourceUnavailableReason(order);
    if (unavailableReason) throw new OutsourceError(unavailableReason);

    const row = await txClient.outsourceOrder.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        orderId: input.orderId,
        createdById: actor.id,
        orderItemIds,
        supplierName,
        supplierContact,
        craftDescription,
        specialRequirement,
        totalQty,
        itemSnapshots: {
          create: orderItemIds.map((orderItemId) => ({
            orderItemId,
            quantity: selectedById.get(orderItemId)!.quantity,
          })),
        },
        expectedDate: input.expectedDate ?? null,
        amount,
        remark,
        status: OutsourceStatus.SENT,
      },
      select: { id: true },
    });
    await writeAuditLogInTx(tx, {
      actor,
      action: 'CREATE',
      entityType: 'OutsourceOrder',
      entityId: row.id,
      after: {
        orderId: input.orderId,
        orderItemIds,
        itemQuantities: orderItemIds.map((orderItemId) => ({
          orderItemId,
          quantity: selectedById.get(orderItemId)!.quantity,
        })),
        supplierName,
        craftDescription,
        totalQty,
        expectedDate: input.expectedDate ?? null,
        amount,
        status: OutsourceStatus.SENT,
      },
      requestMetadata: {
        source: 'foreman-outsource.createOutsourceAction',
        route: '/foreman/outsource/new',
      },
    });
    return row;
  });
}

export type ConfirmedOutsourceAmount = {
  id: string;
  orderId: string | null;
  status: OutsourceStatus;
  amount: string;
};

export async function confirmOutsourceAmount(
  id: string,
  input: ConfirmOutsourceAmountInput,
  actor: AuditActor,
): Promise<ConfirmedOutsourceAmount> {
  const amount = storableOutsourceAmount(input.amount, '外协金额');
  if (amount === null) throw new OutsourceError('请填写外协金额');

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource:${id}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource-amount:${input.idempotencyKey}`}))`;

    const replay = await tx.outsourceAmountChange.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: {
        outsourceOrderId: true,
        newAmount: true,
        reason: true,
        changedById: true,
        outsourceOrder: {
          select: { id: true, orderId: true, status: true },
        },
      },
    });
    if (replay) {
      if (
        replay.outsourceOrderId !== id ||
        replay.changedById !== actor.id ||
        !new Decimal(replay.newAmount).eq(amount) ||
        replay.reason !== input.reason
      ) {
        throw new OutsourceError(
          '外协金额请求标识已被其他内容使用，请刷新后重试',
        );
      }
      return {
        id: replay.outsourceOrder.id,
        orderId: replay.outsourceOrder.orderId,
        status: replay.outsourceOrder.status,
        amount: new Decimal(replay.newAmount).toFixed(2),
      };
    }

    const row = await tx.outsourceOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderId: true,
        status: true,
        amount: true,
        payments: { select: { amount: true } },
      },
    });
    if (!row) throw new OutsourceError('外协单不存在');
    if (row.status === OutsourceStatus.CANCELLED) {
      throw new OutsourceError('已取消的外协单不能确认成本金额');
    }
    const paidAmount = sumOutsourcePayments(row.payments ?? []);
    if (new Decimal(amount).lt(paidAmount)) {
      throw new OutsourceError(
        `外协金额不能低于已付款 ${paidAmount.toFixed(2)} 元`,
      );
    }
    if (row.amount !== null && new Decimal(row.amount).eq(amount)) {
      throw new OutsourceError('外协金额未发生变化');
    }

    const change = await tx.outsourceAmountChange.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        outsourceOrderId: id,
        previousAmount:
          row.amount === null ? null : new Decimal(row.amount).toFixed(2),
        newAmount: amount,
        reason: input.reason,
        changedById: actor.id,
      },
      select: { id: true },
    });
    await tx.outsourceOrder.update({
      where: { id },
      data: { amount },
    });
    await writeAuditLogInTx(tx, {
      actor,
      action: row.amount === null ? 'CONFIRM_AMOUNT' : 'UPDATE_AMOUNT',
      entityType: 'OutsourceOrder',
      entityId: id,
      before: { amount: row.amount === null ? null : String(row.amount) },
      after: { amount, amountChangeId: change.id, reason: input.reason },
      requestMetadata: {
        source: 'foreman-outsource.confirmOutsourceAmountAction',
        route: `/foreman/outsource/${id}`,
      },
    });

    return { id, orderId: row.orderId, status: row.status, amount };
  });
}

export type RecordedOutsourcePayment = {
  paymentId: string;
  outsourceOrderId: string;
  totalAmount: string;
  newPaidAmount: string;
  remainingAmount: string;
  isFullyPaid: boolean;
};

// 外协付款是独立的应付账本：不写 Bill，不写工资。每个浏览器
// request key 和外协单都在同一事务内串行化，防止重试双付与并发超付。
export async function recordOutsourcePayment(
  outsourceOrderId: string,
  input: RecordOutsourcePaymentInput,
  actor: AuditActor,
): Promise<RecordedOutsourcePayment> {
  if (actor.role !== Role.ADMIN) {
    throw new OutsourceError('只有管理员可以记录外协付款');
  }

  const amountText = storableOutsourceAmount(input.amount, '付款金额');
  if (amountText === null || new Decimal(amountText).lte(0)) {
    throw new OutsourceError('付款金额必须大于 0');
  }
  if (!(input.paidAt instanceof Date) || Number.isNaN(input.paidAt.getTime())) {
    throw new OutsourceError('付款时间不合法');
  }

  const idempotencyKey = input.idempotencyKey.trim();
  const method = normalizeOptionalText(input.method);
  const reference = normalizeOptionalText(input.reference);
  const remark = normalizeOptionalText(input.remark);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource-payment-request:${idempotencyKey}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource:${outsourceOrderId}`}))`;

    const replay = await tx.outsourcePayment.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        outsourceOrderId: true,
        amount: true,
        paidAt: true,
        method: true,
        reference: true,
        remark: true,
        recordedById: true,
        outsourceOrder: {
          select: {
            amount: true,
            payments: { select: { amount: true } },
          },
        },
      },
    });
    if (replay) {
      if (
        replay.outsourceOrderId !== outsourceOrderId ||
        replay.recordedById !== actor.id ||
        !new Decimal(replay.amount).eq(amountText) ||
        replay.paidAt.getTime() !== input.paidAt.getTime() ||
        replay.method !== method ||
        replay.reference !== reference ||
        replay.remark !== remark
      ) {
        throw new OutsourceError(
          '外协付款请求标识已被其他付款使用，请刷新后重试',
        );
      }
      if (replay.outsourceOrder.amount === null) {
        throw new OutsourceError('外协应付金额异常，请先对账');
      }
      const totalAmount = readStoredOutsourcePayable(
        replay.outsourceOrder.amount,
      );
      const paidAmount = sumOutsourcePayments(
        replay.outsourceOrder.payments,
      );
      if (paidAmount.gt(totalAmount)) {
        throw new OutsourceError('外协累计已付超过应付金额，请先对账');
      }
      return {
        paymentId: replay.id,
        outsourceOrderId,
        totalAmount: totalAmount.toFixed(2),
        newPaidAmount: paidAmount.toFixed(2),
        remainingAmount: totalAmount.minus(paidAmount).toFixed(2),
        isFullyPaid: paidAmount.eq(totalAmount),
      };
    }

    const row = await tx.outsourceOrder.findUnique({
      where: { id: outsourceOrderId },
      select: {
        id: true,
        status: true,
        amount: true,
        payments: { select: { amount: true } },
      },
    });
    if (!row) throw new OutsourceError('外协单不存在');
    if (row.status !== OutsourceStatus.RECEIVED) {
      throw new OutsourceError('只有已回货的外协单可以记录付款');
    }
    if (row.amount === null) {
      throw new OutsourceError('请先确认外协应付金额');
    }

    const totalAmount = readStoredOutsourcePayable(row.amount);
    const paidAmount = sumOutsourcePayments(row.payments);
    if (paidAmount.gt(totalAmount)) {
      throw new OutsourceError('外协累计已付超过应付金额，请先对账');
    }
    const nextPaidAmount = paidAmount.plus(amountText);
    if (nextPaidAmount.gt(totalAmount)) {
      throw new OutsourceError(
        `付款金额超出未付余额（已付 ${paidAmount.toFixed(2)}，本次 ${amountText}，应付 ${totalAmount.toFixed(2)}）`,
      );
    }

    const payment = await tx.outsourcePayment.create({
      data: {
        idempotencyKey,
        outsourceOrderId,
        amount: amountText,
        paidAt: input.paidAt,
        method,
        reference,
        remark,
        recordedById: actor.id,
      },
      select: { id: true },
    });

    await writeAuditLogInTx(tx, {
      actor,
      action: 'RECORD_PAYMENT',
      entityType: 'OutsourcePayment',
      entityId: payment.id,
      after: {
        paymentId: payment.id,
        outsourceOrderId,
        amount: amountText,
        paidAt: input.paidAt,
        totalAmount: totalAmount.toFixed(2),
        newPaidAmount: nextPaidAmount.toFixed(2),
        remainingAmount: totalAmount.minus(nextPaidAmount).toFixed(2),
      },
      requestMetadata: {
        source: 'foreman-outsource.recordOutsourcePaymentAction',
        route: `/foreman/outsource/${outsourceOrderId}`,
      },
    });

    return {
      paymentId: payment.id,
      outsourceOrderId,
      totalAmount: totalAmount.toFixed(2),
      newPaidAmount: nextPaidAmount.toFixed(2),
      remainingAmount: totalAmount.minus(nextPaidAmount).toFixed(2),
      isFullyPaid: nextPaidAmount.eq(totalAmount),
    };
  });
}

export type OutsourceMutationResult = {
  id: string;
  status: OutsourceStatus;
  orderCompleted?: boolean;
  orderId?: string | null;
  // 收货后工单没转完工、且原因是「还有款式没被任何外协单覆盖」时带出缺口
  // 款式。主管点了「已回货」却没等到完工，必须当场知道差什么；其它阻塞原因
  // （内部任务没做完、还有外协单没收货）在列表页一眼可见，不需要额外提示。
  pendingOutsourceItems?: Array<{
    id: string;
    sequence: number;
    name: string;
  }>;
};

type ReceiveOutsourceTxClient = ProductionCompletionTx & {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  outsourceOrder: ProductionCompletionTx['outsourceOrder'] & {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{
      id: string;
      orderId: string | null;
      status: OutsourceStatus;
    } | null>;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<{ id: string; status: OutsourceStatus }>;
  };
};

// SENT / IN_PROGRESS → RECEIVED. Receiving the final required outsource
// row participates in the same completion gate as the last internal task.
export async function markOutsourceReceived(
  id: string,
  input: MarkOutsourceReceivedInput,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<OutsourceMutationResult> {
  const result = await db.$transaction(async (tx) => {
    const txClient = tx as unknown as ReceiveOutsourceTxClient;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource:${id}`}))`;

    const row = await txClient.outsourceOrder.findUnique({
      where: { id },
      select: { id: true, orderId: true, status: true },
    });
    if (!row) throw new OutsourceError('外协单不存在');

    if (row.orderId) {
      await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
        row.orderId,
      )}))`;
    }

    // Re-read after the locks so a concurrent receive/cancel cannot leave a
    // stale transition decision.
    const fresh = await txClient.outsourceOrder.findUnique({
      where: { id },
      select: { id: true, orderId: true, status: true },
    });
    if (!fresh) throw new OutsourceError('外协单不存在');
    transitionOutsource(fresh.status, OutsourceStatus.RECEIVED);

    const updated = await txClient.outsourceOrder.update({
      where: { id },
      data: {
        status: OutsourceStatus.RECEIVED,
        actualDate: input.actualDate ?? now,
      },
      select: { id: true, status: true },
    });

    const completion = fresh.orderId
      ? await maybeCompleteProductionOrder(
          txClient,
          fresh.orderId,
          actor.id,
          now,
        )
      : null;
    return {
      ...updated,
      orderCompleted: completion?.completed ?? false,
      pendingOutsourceItems:
        completion?.blockedBy === 'OUTSOURCE_COVERAGE'
          ? completion.uncoveredItems
          : [],
      orderId: fresh.orderId,
      completionNotification: completion?.notification,
    };
  });

  await dispatchProductionCompletionNotification(
    result.completionNotification,
  );

  return {
    id: result.id,
    status: result.status,
    orderCompleted: result.orderCompleted,
    orderId: result.orderId,
    // ⚠️ 覆盖缺口必须穿过这层重建 —— 这里才是 markOutsourceReceived 真正
    // 对外的 return，上面事务里那个只是 $transaction 回调的返回值。漏掉
    // 这一行，pendingOutsourceItems 会被原地丢弃、action 层的 notice 恒为
    // undefined，而它是可选字段，tsc 一个字都不报。守门用例见
    // lib/__tests__/outsource.test.ts「回传覆盖缺口」那条。
    pendingOutsourceItems: result.pendingOutsourceItems,
  };
}

export async function cancelOutsourceOrder(
  id: string,
  actor: { id: string; role: Role },
): Promise<OutsourceMutationResult> {
  const result = await db.$transaction(async (tx) => {
    const txClient = tx as unknown as ReceiveOutsourceTxClient;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-shop-erp:outsource:${id}`}))`;
    const row = await txClient.outsourceOrder.findUnique({
      where: { id },
      select: { id: true, orderId: true, status: true },
    });
    if (!row) throw new OutsourceError('外协单不存在');
    if (row.orderId) {
      await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
        row.orderId,
      )}))`;
    }
    const fresh = await txClient.outsourceOrder.findUnique({
      where: { id },
      select: { id: true, orderId: true, status: true },
    });
    if (!fresh) throw new OutsourceError('外协单不存在');
    transitionOutsource(fresh.status, OutsourceStatus.CANCELLED);
    const updated = await txClient.outsourceOrder.update({
      where: { id },
      data: { status: OutsourceStatus.CANCELLED },
      select: { id: true, status: true },
    });
    // 取消路径不带 notice：主管刚点的取消，自己知道少了哪张外协单。
    const completion = fresh.orderId
      ? await maybeCompleteProductionOrder(
          txClient,
          fresh.orderId,
          actor.id,
          new Date(),
        )
      : null;
    return {
      ...updated,
      orderId: fresh.orderId,
      orderCompleted: completion?.completed ?? false,
      completionNotification: completion?.notification,
    };
  });

  await dispatchProductionCompletionNotification(
    result.completionNotification,
  );
  return {
    id: result.id,
    status: result.status,
    orderId: result.orderId,
    orderCompleted: result.orderCompleted,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────

export async function listOutsourceOrders(
  filter: { status?: OutsourceStatus } = {},
) {
  return db.outsourceOrder.findMany({
    where: filter.status ? { status: filter.status } : undefined,
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      status: true,
      supplierName: true,
      craftDescription: true,
      totalQty: true,
      expectedDate: true,
      actualDate: true,
      amount: true,
      createdAt: true,
      order: { select: { id: true, orderNo: true, isUrgent: true } },
    },
  });
}

// Order + items for the "创建外协单" form (checkbox list of items).
// Foreman sees everything, so no scope filter — but the read lives in
// lib/ so the page never touches Prisma directly (CLAUDE.md §3).
export async function getOrderForOutsourceForm(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      completedAt: true,
      items: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          name: true,
          quantity: true,
        },
      },
    },
  });
}

export async function getOutsourceOrderDetail(id: string) {
  return db.outsourceOrder.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      orderItemIds: true,
      itemSnapshots: {
        select: { orderItemId: true, quantity: true },
      },
      supplierName: true,
      supplierContact: true,
      craftDescription: true,
      specialRequirement: true,
      totalQty: true,
      expectedDate: true,
      actualDate: true,
      amount: true,
      status: true,
      remark: true,
      createdAt: true,
      updatedAt: true,
      amountChanges: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          previousAmount: true,
          newAmount: true,
          reason: true,
          createdAt: true,
          changedBy: { select: { displayName: true } },
        },
      },
      payments: {
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          amount: true,
          paidAt: true,
          method: true,
          reference: true,
          remark: true,
          createdAt: true,
          recordedBy: { select: { displayName: true } },
        },
      },
      order: { select: { id: true, orderNo: true, isUrgent: true } },
    },
  });
}

export { InvalidOutsourceTransitionError };
