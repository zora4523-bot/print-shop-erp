import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
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
  submitterId: true,
  status: true,
  customerRef: true,
  workOrderVersion: true,
  settledFee: true,
  settledAt: true,
} as const;

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
    throw new AgentMonthlyBillingError('账单金额事实缺失或格式不合法');
  }
  try {
    const parsed = new Decimal(String(value));
    if (!parsed.isFinite()) throw new Error('non-finite');
    return parsed;
  } catch {
    throw new AgentMonthlyBillingError('账单金额事实缺失或格式不合法');
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
): Promise<EligibleOrder[]> {
  return tx.order.findMany({
    where: candidateWhere(agentUserId, period),
    select: ELIGIBLE_ORDER_SELECT,
    orderBy: [{ settledAt: 'asc' }, { id: 'asc' }],
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
      `工单 ${foreignMember.orderId} 已归入其他 v2 月度账单`,
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
      throw new AgentMonthlyBillingError('月度账单候选工单缺少结算事实');
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
        settledAtSnapshot: order.settledAt,
      },
      update: {
        orderNoSnapshot: order.orderNo,
        workOrderVersionSnapshot: order.workOrderVersion,
        orderStatusSnapshot: order.status,
        customerRefSnapshot: order.customerRef,
        settledFeeSnapshot: money(order.settledFee),
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
      `已冻结账单后发现未入账工单 ${unbilled.orderNo}，已停止而非静默遗漏`,
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
    const [candidates, existingBills] = await Promise.all([
      readEligibleOrders(tx, undefined, period),
      tx.agentMonthlyBill.findMany({
        where: { period },
        select: { id: true, agentUserId: true },
      }),
    ]);
    const agentIds = Array.from(
      new Set([
        ...candidates.map((order) => order.submitterId),
        ...existingBills.map((bill) => bill.agentUserId),
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

    for (const agentUserId of agentIds) {
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

    return { period, generated };
  });
}
