import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import { AgentMonthlyBillStatus, Role } from '../../generated/prisma/enums';
import { databaseClockNow } from '../background-jobs/clock';
import { db } from '../db';
import {
  lockSettlementCutoffExclusive,
  lockSettlementCutoffShared,
} from '../finance/settlement-cutoff-lock';
import {
  AgentMonthlyBillingError,
  AgentMonthlyBillNotFoundError,
  InvalidAgentMonthlyBillTransitionError,
} from './errors';
import {
  allocateOutstandingCreditsInTx,
  synchronizeDraftBillInTx,
} from './generation';
import {
  lockAgentBill,
  lockAgentBillRequest,
  lockAgentPeriod,
} from './locks';
import type { AgentMonthlyBillActor } from './types';

type Tx = Prisma.TransactionClient;

const MONEY_MAX = new Decimal('9999999999.99');

function assertAdmin(actor: AgentMonthlyBillActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new AgentMonthlyBillingError('只有管理员可以操作代理商月度账单');
  }
}

function normalizeIdempotencyKey(value: string): string {
  const key = value.trim();
  if (key.length < 1 || key.length > 128) {
    throw new AgentMonthlyBillingError('请求标识不合法');
  }
  return key;
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
  label: string,
): string | null {
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > maxLength) {
    throw new AgentMonthlyBillingError(`${label}过长`);
  }
  return normalized;
}

function positiveMoney(value: string): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new AgentMonthlyBillingError('调整金额不合法');
  }
  if (
    !parsed.isFinite() ||
    parsed.lte(0) ||
    parsed.decimalPlaces() > 2 ||
    parsed.gt(MONEY_MAX)
  ) {
    throw new AgentMonthlyBillingError('调整金额必须是大于 0 且最多两位小数的金额');
  }
  return parsed;
}

async function billIdentity(tx: Tx, billId: string) {
  const bill = await tx.agentMonthlyBill.findUnique({
    where: { id: billId },
    select: { id: true, agentUserId: true, period: true },
  });
  if (!bill) throw new AgentMonthlyBillNotFoundError();
  return bill;
}

export type ConfirmAgentMonthlyBillResult = {
  billId: string;
  status: AgentMonthlyBillStatus;
  totalAmount: string;
  confirmedAt: Date;
  paidAt: Date | null;
};

/**
 * Refreshes and freezes one bill under the global exclusive settlement gate.
 * A zero total is atomically confirmed, receipted for 0, and moved to PAID.
 */
export async function confirmAgentMonthlyBill(
  billId: string,
  actor: AgentMonthlyBillActor,
  idempotencyKey: string,
): Promise<ConfirmAgentMonthlyBillResult> {
  assertAdmin(actor);
  const requestKey = normalizeIdempotencyKey(idempotencyKey);
  return db.$transaction(async (tx) => {
    // Required global order: cutoff -> agent-period -> bill -> request.
    await lockSettlementCutoffExclusive(tx);
    const identity = await billIdentity(tx, billId);
    await lockAgentPeriod(tx, identity.agentUserId, identity.period);
    await lockAgentBill(tx, billId);
    await lockAgentBillRequest(tx, 'confirm', requestKey);

    const current = await tx.agentMonthlyBill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        agentUserId: true,
        period: true,
        status: true,
        totalAmount: true,
        confirmedAt: true,
        paidAt: true,
      },
    });
    if (!current) throw new AgentMonthlyBillNotFoundError();
    if (current.status !== AgentMonthlyBillStatus.DRAFT) {
      if (!current.confirmedAt) {
        throw new AgentMonthlyBillingError('账单确认或结清时间缺失，请联系管理员核对账单');
      }
      return {
        billId: current.id,
        status: current.status,
        totalAmount: new Decimal(current.totalAmount).toFixed(2),
        confirmedAt: current.confirmedAt,
        paidAt: current.paidAt,
      };
    }

    const synchronized = await synchronizeDraftBillInTx(tx, {
      billId,
      agentUserId: current.agentUserId,
      period: current.period,
    });
    const total = new Decimal(synchronized.totalAmount);
    if (total.isNegative()) {
      throw new InvalidAgentMonthlyBillTransitionError(
        '账单净额为负，不能确认；剩余信用额应继续滚入下一开放月份',
      );
    }
    const confirmedAt = await databaseClockNow(tx);
    await tx.agentMonthlyBill.update({
      where: { id: billId },
      data: {
        status: AgentMonthlyBillStatus.CONFIRMED,
        confirmedById: actor.id,
        confirmedAt,
      },
      select: { id: true },
    });

    if (total.isZero()) {
      await tx.agentMonthlyBillReceipt.create({
        data: {
          billId,
          amount: '0.00',
          receivedAt: confirmedAt,
          paymentMethod: '零元自动结清',
          referenceNo: null,
          idempotencyKey: `auto-zero:${billId}`,
          recordedById: actor.id,
        },
        select: { id: true },
      });
      await tx.agentMonthlyBill.update({
        where: { id: billId },
        data: {
          status: AgentMonthlyBillStatus.PAID,
          paidById: actor.id,
          paidAt: confirmedAt,
        },
        select: { id: true },
      });
      return {
        billId,
        status: AgentMonthlyBillStatus.PAID,
        totalAmount: '0.00',
        confirmedAt,
        paidAt: confirmedAt,
      };
    }

    return {
      billId,
      status: AgentMonthlyBillStatus.CONFIRMED,
      totalAmount: total.toFixed(2),
      confirmedAt,
      paidAt: null,
    };
  });
}

export type MarkAgentMonthlyBillPaidInput = {
  billId: string;
  idempotencyKey: string;
  paymentMethod?: string | null;
  referenceNo?: string | null;
};

export async function markAgentMonthlyBillPaid(
  input: MarkAgentMonthlyBillPaidInput,
  actor: AgentMonthlyBillActor,
): Promise<{
  billId: string;
  status: typeof AgentMonthlyBillStatus.PAID;
  amount: string;
  receivedAt: Date;
}> {
  assertAdmin(actor);
  const requestKey = normalizeIdempotencyKey(input.idempotencyKey);
  const paymentMethod = normalizeOptionalText(
    input.paymentMethod,
    100,
    '收款方式',
  );
  const referenceNo = normalizeOptionalText(input.referenceNo, 100, '流水号');

  return db.$transaction(async (tx) => {
    await lockSettlementCutoffShared(tx);
    const identity = await billIdentity(tx, input.billId);
    await lockAgentPeriod(tx, identity.agentUserId, identity.period);
    await lockAgentBill(tx, input.billId);
    await lockAgentBillRequest(tx, 'receipt', requestKey);

    const bill = await tx.agentMonthlyBill.findUnique({
      where: { id: input.billId },
      select: {
        status: true,
        totalAmount: true,
        receipt: {
          select: { amount: true, receivedAt: true },
        },
      },
    });
    if (!bill) throw new AgentMonthlyBillNotFoundError();
    if (bill.status === AgentMonthlyBillStatus.PAID && bill.receipt) {
      return {
        billId: input.billId,
        status: AgentMonthlyBillStatus.PAID,
        amount: new Decimal(bill.receipt.amount).toFixed(2),
        receivedAt: bill.receipt.receivedAt,
      };
    }
    if (bill.status !== AgentMonthlyBillStatus.CONFIRMED) {
      throw new InvalidAgentMonthlyBillTransitionError('只有已确认账单可以标记已收');
    }
    const amount = new Decimal(bill.totalAmount).toFixed(2);
    const receivedAt = await databaseClockNow(tx);
    await tx.agentMonthlyBillReceipt.create({
      data: {
        billId: input.billId,
        amount,
        receivedAt,
        paymentMethod,
        referenceNo,
        idempotencyKey: requestKey,
        recordedById: actor.id,
      },
      select: { id: true },
    });
    await tx.agentMonthlyBill.update({
      where: { id: input.billId },
      data: {
        status: AgentMonthlyBillStatus.PAID,
        paidById: actor.id,
        paidAt: receivedAt,
      },
      select: { id: true },
    });
    return {
      billId: input.billId,
      status: AgentMonthlyBillStatus.PAID,
      amount,
      receivedAt,
    };
  });
}

/** 抵扣（多收了，冲减应收，负数入账）或补收（少收了，追加应收，正数入账）；业主 2026-10-01 增加补收。 */
type AgentMonthlyBillAdjustmentDirection = 'CREDIT' | 'SURCHARGE';

export type CreateAgentMonthlyBillCreditInput = {
  expectedBillId: string;
  sourceItemId: string;
  direction: AgentMonthlyBillAdjustmentDirection;
  /** 正数金额；方向由 direction 决定。 */
  amount: string;
  reason: string;
  idempotencyKey: string;
};

async function allocateCreditsAcrossOpenDrafts(
  agentUserId: string,
  afterPeriod: string,
): Promise<string[]> {
  return db.$transaction(async (tx) => {
    await lockSettlementCutoffShared(tx);
    const drafts = await tx.agentMonthlyBill.findMany({
      where: {
        agentUserId,
        period: { gt: afterPeriod },
        status: AgentMonthlyBillStatus.DRAFT,
      },
      select: { id: true, period: true },
      orderBy: [{ period: 'asc' }, { id: 'asc' }],
    });
    for (const period of Array.from(new Set(drafts.map((bill) => bill.period)))) {
      await lockAgentPeriod(tx, agentUserId, period);
    }
    for (const bill of drafts) await lockAgentBill(tx, bill.id);
    if (drafts.length > 0) {
      // Reflow every still-mutable future allocation oldest-first. Frozen
      // bills are absent from `drafts`, so historical facts never move.
      await tx.agentMonthlyBillAdjustment.deleteMany({
        where: { billId: { in: drafts.map((bill) => bill.id) } },
      });
    }
    for (const bill of drafts) {
      await allocateOutstandingCreditsInTx(tx, {
        billId: bill.id,
        agentUserId,
        period: bill.period,
      });
    }
    return drafts.map((bill) => bill.id);
  });
}

/**
 * Persists the correction as an immutable root fact first. Allocation is a
 * separate transaction, so absence/failure of a future DRAFT never loses the
 * approved credit.
 */
export async function createAgentMonthlyBillCredit(
  input: CreateAgentMonthlyBillCreditInput,
  actor: AgentMonthlyBillActor,
): Promise<{
  creditId: string;
  requestedAmount: string;
  allocatedBillIds: string[];
}> {
  assertAdmin(actor);
  const amount = positiveMoney(input.amount);
  const signed = input.direction === 'SURCHARGE' ? amount : amount.negated();
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new AgentMonthlyBillingError('调整原因必须为 1-500 字');
  }
  const requestKey = normalizeIdempotencyKey(input.idempotencyKey);

  const root = await db.$transaction(async (tx) => {
    await lockSettlementCutoffShared(tx);
    const source = await tx.agentMonthlyBillItem.findUnique({
      where: { id: input.sourceItemId },
      select: {
        id: true,
        billId: true,
        bill: {
          select: { agentUserId: true, period: true },
        },
      },
    });
    if (!source) throw new AgentMonthlyBillingError('来源工单不存在，请返回账单重新选择');
    if (source.billId !== input.expectedBillId) {
      throw new AgentMonthlyBillingError('来源工单不属于当前账单，请返回账单重新选择');
    }
    await lockAgentPeriod(tx, source.bill.agentUserId, source.bill.period);
    await lockAgentBill(tx, source.billId);
    await lockAgentBillRequest(tx, 'credit', requestKey);

    const replay = await tx.agentMonthlyBillCredit.findUnique({
      where: { idempotencyKey: requestKey },
      select: {
        id: true,
        sourceItemId: true,
        requestedAmount: true,
        reason: true,
      },
    });
    if (replay) {
      if (
        replay.sourceItemId !== input.sourceItemId ||
        !new Decimal(replay.requestedAmount).eq(signed) ||
        replay.reason !== reason
      ) {
        throw new AgentMonthlyBillingError('本次提交已失效，请刷新后重新录入');
      }
      return {
        creditId: replay.id,
        requestedAmount: new Decimal(replay.requestedAmount).toFixed(2),
        agentUserId: source.bill.agentUserId,
        sourcePeriod: source.bill.period,
      };
    }

    const freshSource = await tx.agentMonthlyBillItem.findUnique({
      where: { id: input.sourceItemId },
      select: {
        settledFeeSnapshot: true,
        bill: { select: { status: true } },
        credits: { select: { requestedAmount: true } },
      },
    });
    if (
      !freshSource ||
      (freshSource.bill.status !== AgentMonthlyBillStatus.CONFIRMED &&
        freshSource.bill.status !== AgentMonthlyBillStatus.PAID)
    ) {
      throw new InvalidAgentMonthlyBillTransitionError(
        '只能对已确认账单中的工单录入抵扣或补收',
      );
    }
    // 与触发器 validate_agent_monthly_bill_credit 同一规则：结算金额加全部抵扣 / 补收后不能为负。
    const netAfter = freshSource.credits.reduce(
      (sum, credit) => sum.plus(credit.requestedAmount),
      new Decimal(freshSource.settledFeeSnapshot).plus(signed),
    );
    if (netAfter.isNegative()) {
      throw new AgentMonthlyBillingError('累计抵扣不能超过来源工单的结算金额（含已补收）');
    }
    if (input.direction === 'SURCHARGE') {
      // 补收一经写入不可改：先确认它和最早的草稿账单合计都在金额字段的存储范围内，
      // 否则根记录留下却永远分摊不出去。
      const earliestDraft = await tx.agentMonthlyBill.findFirst({
        where: {
          agentUserId: source.bill.agentUserId,
          status: AgentMonthlyBillStatus.DRAFT,
          period: { gt: source.bill.period },
        },
        orderBy: [{ period: 'asc' }, { id: 'asc' }],
        select: { totalAmount: true, adjustmentAmount: true },
      });
      const draftTotalAfter = earliestDraft
        ? Decimal.max(
            new Decimal(earliestDraft.totalAmount.toString()),
            new Decimal(earliestDraft.adjustmentAmount.toString()),
          ).plus(signed)
        : signed;
      if (netAfter.gt(MONEY_MAX) || draftTotalAfter.gt(MONEY_MAX)) {
        throw new AgentMonthlyBillingError('补收金额过大，超出账单金额上限，请核对后重新录入');
      }
    }

    const created = await tx.agentMonthlyBillCredit.create({
      data: {
        sourceItemId: input.sourceItemId,
        requestedAmount: signed.toFixed(2),
        reason,
        idempotencyKey: requestKey,
        createdById: actor.id,
      },
      select: { id: true, requestedAmount: true },
    });
    return {
      creditId: created.id,
      requestedAmount: new Decimal(created.requestedAmount).toFixed(2),
      agentUserId: source.bill.agentUserId,
      sourcePeriod: source.bill.period,
    };
  });

  const allocatedBillIds = await allocateCreditsAcrossOpenDrafts(
    root.agentUserId,
    root.sourcePeriod,
  );
  return {
    creditId: root.creditId,
    requestedAmount: root.requestedAmount,
    allocatedBillIds,
  };
}
