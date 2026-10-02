import Decimal from 'decimal.js';
import { createBillSettlementDetail } from './settlement-detail';
import { Prisma } from '../../generated/prisma/client';
import {
  AgentMonthlyBillStatus,
  OrderBillingMode,
  OrderSettlementType,
  OrderStatus,
  Role,
} from '../../generated/prisma/enums';
import { db } from '../db';
import {
  assertExecutionFence,
  type ExecutionFence,
} from '../execution-fence';
import { lockSettlementCutoffExclusive } from '../finance/settlement-cutoff-lock';
import { AgentMonthlyBillingError, AgentMonthlyBillFrozenError } from './errors';
import {
  lockAgentBill,
  lockAgentBillCredit,
  lockAgentPeriod,
} from './locks';
import {
  agentBillPeriodRange,
  assertClosedAgentBillPeriod,
} from './period';
import type {
  AgentMonthlyBillActor,
  AgentMonthlyBillGenerationResult,
  AgentMonthlyBillGenerationRow,
} from './types';

type Tx = Prisma.TransactionClient;

const ELIGIBLE_ORDER_SELECT = {
  id: true,
  orderNo: true,
  customName: true,
  submitterId: true,
  status: true,
  // 客户名称/简称已停用、不再展示（业主 2026-09-27），但确认触发器要求成员
  // customerRefSnapshot 与 Order.customerRef 一致，这里必须照旧读取并写入快照。
  customerRef: true,
  workOrderVersion: true,
  settledFee: true,
  processingAmount: true,
  totalAmount: true,
  customerCharges: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { amount: true, description: true, status: true } },
  settledAt: true,
} satisfies Prisma.OrderSelect;

type EligibleOrder = Prisma.OrderGetPayload<{
  select: typeof ELIGIBLE_ORDER_SELECT;
}>;

function decimal(value: unknown): Decimal {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'object')
  ) {
    throw new AgentMonthlyBillingError('账单金额缺失或异常，请联系管理员核对结算金额');
  }
  try {
    const parsed = new Decimal(String(value));
    if (!parsed.isFinite()) throw new Error('non-finite');
    return parsed;
  } catch {
    throw new AgentMonthlyBillingError('账单金额缺失或异常，请联系管理员核对结算金额');
  }
}

function money(value: unknown): string {
  return decimal(value).toFixed(2);
}

function assertAdmin(actor: AgentMonthlyBillActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new AgentMonthlyBillingError('只有管理员可以操作代理商月度账单');
  }
}

function candidateWhere(
  agentUserId: string | undefined,
  period: string,
): Prisma.OrderWhereInput {
  const { start, end } = agentBillPeriodRange(period);
  return {
    ...(agentUserId ? { submitterId: agentUserId } : {}),
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    billingMode: OrderBillingMode.CHARGE,
    status: { in: [OrderStatus.SETTLED, OrderStatus.CANCELLED] },
    settledFee: { not: null },
    settledAt: { gte: start, lt: end },
  };
}

async function readEligibleOrders(
  tx: Tx,
  agentUserId: string | undefined,
  period: string,
  onInvalid?: (error: AgentMonthlyBillGenerationResult['errors'][number]) => void,
): Promise<EligibleOrder[]> {
  const orders = await tx.order.findMany({
    where: candidateWhere(agentUserId, period),
    select: ELIGIBLE_ORDER_SELECT,
    orderBy: [{ settledAt: 'asc' }, { id: 'asc' }],
  });
  return orders.filter((order) => {
    try {
      // Cancellation freezes its own agreed amount; unpriced original charges
      // are no longer the basis of that settlement.
      if (order.status === OrderStatus.CANCELLED) { decimal(order.settledFee); return true; }
      const total = decimal(order.totalAmount);
      const charges = order.customerCharges.filter(charge => charge.status !== 'WAIVED').reduce((sum, charge) => sum.plus(decimal(charge.amount)), new Decimal(0));
      if (!decimal(order.processingAmount).plus(charges).eq(total)) {
        throw new AgentMonthlyBillingError('工单总额与加工费及对客收费明细不一致');
      }
      if (!decimal(order.settledFee).eq(total)) {
        throw new AgentMonthlyBillingError('结算金额与工单总额不一致');
      }
      return true;
    } catch (error) {
      if (!(error instanceof AgentMonthlyBillingError)) throw error;
      const message = `工单 ${order.orderNo}：${error.message}`;
      if (!onInvalid) throw new AgentMonthlyBillingError(message);
      onInvalid({ agentUserId: order.submitterId, message });
      return false;
    }
  });
}

async function recalculateDraftTotals(
  tx: Tx,
  billId: string,
): Promise<{
  memberSubtotal: string;
  adjustmentAmount: string;
  totalAmount: string;
}> {
  const [members, adjustments] = await Promise.all([
    tx.agentMonthlyBillItem.aggregate({
      where: { billId },
      _sum: { settledFeeSnapshot: true },
    }),
    tx.agentMonthlyBillAdjustment.aggregate({
      where: { billId },
      _sum: { amount: true },
    }),
  ]);
  const memberSubtotal = decimal(
    members._sum.settledFeeSnapshot ?? '0',
  );
  const adjustmentAmount = decimal(adjustments._sum.amount ?? '0');
  const totalAmount = memberSubtotal.plus(adjustmentAmount);
  await tx.agentMonthlyBill.update({
    where: { id: billId },
    data: {
      memberSubtotal: memberSubtotal.toFixed(2),
      adjustmentAmount: adjustmentAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
    },
    select: { id: true },
  });
  return {
    memberSubtotal: memberSubtotal.toFixed(2),
    adjustmentAmount: adjustmentAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
  };
}

/**
 * Rebuild the target DRAFT bill's allocations from immutable credit facts.
 * Credits are consumed oldest-first, never below a zero bill total. Any
 * residual stays derived/unallocated and is available to a later open month.
 */
export async function allocateOutstandingCreditsInTx(
  tx: Tx,
  input: {
    billId: string;
    agentUserId: string;
    period: string;
  },
): Promise<{
  memberSubtotal: string;
  adjustmentAmount: string;
  totalAmount: string;
}> {
  const bill = await tx.agentMonthlyBill.findUnique({
    where: { id: input.billId },
    select: { status: true },
  });
  if (!bill) throw new AgentMonthlyBillingError('月度账单不存在');
  if (bill.status !== AgentMonthlyBillStatus.DRAFT) {
    throw new AgentMonthlyBillFrozenError();
  }

  const credits = await tx.agentMonthlyBillCredit.findMany({
    where: {
      sourceItem: {
        bill: {
          agentUserId: input.agentUserId,
          period: { lt: input.period },
        },
      },
    },
    select: {
      id: true,
      requestedAmount: true,
      createdAt: true,
      allocations: {
        select: { billId: true, amount: true },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  for (const credit of [...credits].sort((a, b) => a.id.localeCompare(b.id))) {
    await lockAgentBillCredit(tx, credit.id);
  }

  // DRAFT allocations are projections of immutable credits, so rebuilding is
  // safe and prevents repeated generation from double-consuming a credit.
  await tx.agentMonthlyBillAdjustment.deleteMany({
    where: { billId: input.billId },
  });

  const memberAggregate = await tx.agentMonthlyBillItem.aggregate({
    where: { billId: input.billId },
    _sum: { settledFeeSnapshot: true },
  });
  let remainingCapacity = decimal(
    memberAggregate._sum.settledFeeSnapshot ?? '0',
  );

  for (const credit of credits) {
    if (remainingCapacity.lte(0)) break;
    const allocatedElsewhere = credit.allocations
      .filter((allocation) => allocation.billId !== input.billId)
      .reduce(
        (sum, allocation) => sum.plus(decimal(allocation.amount).abs()),
        new Decimal(0),
      );
    const unallocated = decimal(credit.requestedAmount)
      .abs()
      .minus(allocatedElsewhere);
    if (unallocated.lte(0)) continue;

    const allocated = Decimal.min(unallocated, remainingCapacity);
    await tx.agentMonthlyBillAdjustment.create({
      data: {
        billId: input.billId,
        creditId: credit.id,
        amount: allocated.negated().toFixed(2),
      },
      select: { id: true },
    });
    remainingCapacity = remainingCapacity.minus(allocated);
  }

  return recalculateDraftTotals(tx, input.billId);
}

/** Refreshes a mutable bill from current authoritative settlement facts. */
export async function synchronizeDraftBillInTx(
  tx: Tx,
  input: {
    billId: string;
    agentUserId: string;
    period: string;
  },
): Promise<{
  orderCount: number;
  memberSubtotal: string;
  adjustmentAmount: string;
  totalAmount: string;
}> {
  const bill = await tx.agentMonthlyBill.findUnique({
    where: { id: input.billId },
    select: { status: true },
  });
  if (!bill) throw new AgentMonthlyBillingError('月度账单不存在');
  if (bill.status !== AgentMonthlyBillStatus.DRAFT) {
    throw new AgentMonthlyBillFrozenError();
  }

  const candidates = await readEligibleOrders(tx, input.agentUserId, input.period);
  const candidateIds = candidates.map((row) => row.id);
  const existing = await tx.agentMonthlyBillItem.findMany({
    where: {
      OR: [
        { billId: input.billId },
        ...(candidateIds.length > 0 ? [{ orderId: { in: candidateIds } }] : []),
      ],
    },
    select: { id: true, billId: true, orderId: true },
  });
  const foreignMember = existing.find(
    (item) => candidateIds.includes(item.orderId) && item.billId !== input.billId,
  );
  if (foreignMember) {
    throw new AgentMonthlyBillingError(
      `工单 ${candidates.find((order) => order.id === foreignMember.orderId)?.orderNo ?? '资料缺失'} 已列入其他账单，请核对该工单的账单归属`,
    );
  }

  const candidateIdSet = new Set(candidateIds);
  const staleIds = existing
    .filter(
      (item) => item.billId === input.billId && !candidateIdSet.has(item.orderId),
    )
    .map((item) => item.id);
  if (staleIds.length > 0) {
    await tx.agentMonthlyBillItem.deleteMany({ where: { id: { in: staleIds } } });
  }

  for (const order of candidates) {
    if (order.settledFee === null || order.settledAt === null) {
      throw new AgentMonthlyBillingError('待入账工单缺少结算金额或时间，请在未出账工单中核对');
    }
    await tx.agentMonthlyBillItem.upsert({
      where: { orderId: order.id },
      create: {
        billId: input.billId,
        orderId: order.id,
        orderNoSnapshot: order.orderNo,
        workOrderVersionSnapshot: order.workOrderVersion,
        orderStatusSnapshot: order.status,
        customerRefSnapshot: order.customerRef,
        settledFeeSnapshot: money(order.settledFee),
        settlementDetailSnapshot: createBillSettlementDetail(order) ?? Prisma.DbNull,
        settledAtSnapshot: order.settledAt,
      },
      update: {
        orderNoSnapshot: order.orderNo,
        workOrderVersionSnapshot: order.workOrderVersion,
        orderStatusSnapshot: order.status,
        customerRefSnapshot: order.customerRef,
        settledFeeSnapshot: money(order.settledFee),
        settlementDetailSnapshot: createBillSettlementDetail(order) ?? Prisma.DbNull,
        settledAtSnapshot: order.settledAt,
      },
      select: { id: true },
    });
  }

  const totals = await allocateOutstandingCreditsInTx(tx, input);
  return { orderCount: candidates.length, ...totals };
}

async function frozenBillResult(
  tx: Tx,
  bill: {
    id: string;
    agentUserId: string;
    period: string;
    status: AgentMonthlyBillStatus;
    memberSubtotal: unknown;
    adjustmentAmount: unknown;
    totalAmount: unknown;
  },
): Promise<AgentMonthlyBillGenerationRow> {
  const candidates = await readEligibleOrders(tx, bill.agentUserId, bill.period);
  const attached = await tx.agentMonthlyBillItem.findMany({
    where: { billId: bill.id },
    select: { orderId: true },
  });
  const attachedIds = new Set(attached.map((item) => item.orderId));
  const unbilled = candidates.find((order) => !attachedIds.has(order.id));
  if (unbilled) {
    throw new AgentMonthlyBillFrozenError(
      `本月账单已确认，工单 ${unbilled.orderNo} 尚未入账，请联系管理员核对该工单`,
    );
  }
  return {
    billId: bill.id,
    agentUserId: bill.agentUserId,
    period: bill.period,
    status: bill.status,
    orderCount: attached.length,
    memberSubtotal: money(bill.memberSubtotal),
    adjustmentAmount: money(bill.adjustmentAmount),
    totalAmount: money(bill.totalAmount),
    created: false,
  };
}

/**
 * Creates or refreshes one unique DRAFT per agent and Shanghai settlement
 * month. The exclusive cut-off is the transaction's first database operation.
 */
export async function generateAgentMonthlyBillsForPeriod(
  period: string,
  actor: AgentMonthlyBillActor,
  options: { now?: Date; fence?: ExecutionFence } = {},
): Promise<AgentMonthlyBillGenerationResult> {
  assertAdmin(actor);
  assertClosedAgentBillPeriod(period, options.now);
  await assertExecutionFence(options.fence);

  return db.$transaction(async (tx) => {
    await lockSettlementCutoffExclusive(tx);
    const errors: AgentMonthlyBillGenerationResult['errors'] = [];
    const [candidates, existingBills] = await Promise.all([
      readEligibleOrders(tx, undefined, period, (error) => errors.push(error)),
      tx.agentMonthlyBill.findMany({
        where: { period },
        select: { id: true, agentUserId: true },
      }),
    ]);
    const agentIds = Array.from(
      new Set([
        ...candidates.map((order) => order.submitterId),
        ...existingBills.map((bill) => bill.agentUserId),
        ...errors.map((error) => error.agentUserId),
      ]),
    ).sort();

    for (const agentUserId of agentIds) {
      await lockAgentPeriod(tx, agentUserId, period);
    }
    const users = await tx.user.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, username: true, displayName: true },
    });
    const userById = new Map(users.map((user) => [user.id, user] as const));
    const generated: AgentMonthlyBillGenerationRow[] = [];

    const rejectedAgents = new Set(errors.map((error) => error.agentUserId));
    for (const agentUserId of agentIds) {
      // Refuse the entire agent/month; filtering one corrupt order must never
      // silently remove an existing draft member or publish a partial bill.
      if (rejectedAgents.has(agentUserId)) continue;
      await assertExecutionFence(options.fence);
      let bill = await tx.agentMonthlyBill.findUnique({
        where: { agentUserId_period: { agentUserId, period } },
        select: {
          id: true,
          agentUserId: true,
          period: true,
          status: true,
          memberSubtotal: true,
          adjustmentAmount: true,
          totalAmount: true,
        },
      });
      let created = false;
      if (!bill) {
        const user = userById.get(agentUserId);
        if (!user) {
          throw new AgentMonthlyBillingError(`代理商账号 ${agentUserId} 不存在`);
        }
        bill = await tx.agentMonthlyBill.create({
          data: {
            agentUserId,
            period,
            agentUsernameSnapshot: user.username,
            agentDisplayNameSnapshot: user.displayName,
            memberSubtotal: '0.00',
            adjustmentAmount: '0.00',
            totalAmount: '0.00',
          },
          select: {
            id: true,
            agentUserId: true,
            period: true,
            status: true,
            memberSubtotal: true,
            adjustmentAmount: true,
            totalAmount: true,
          },
        });
        created = true;
      }
      await lockAgentBill(tx, bill.id);

      if (bill.status !== AgentMonthlyBillStatus.DRAFT) {
        generated.push(await frozenBillResult(tx, bill));
        continue;
      }
      const synchronized = await synchronizeDraftBillInTx(tx, {
        billId: bill.id,
        agentUserId,
        period,
      });
      generated.push({
        billId: bill.id,
        agentUserId,
        period,
        status: AgentMonthlyBillStatus.DRAFT,
        orderCount: synchronized.orderCount,
        memberSubtotal: synchronized.memberSubtotal,
        adjustmentAmount: synchronized.adjustmentAmount,
        totalAmount: synchronized.totalAmount,
        created,
      });
    }

    return { period, generated, errors };
  });
}
