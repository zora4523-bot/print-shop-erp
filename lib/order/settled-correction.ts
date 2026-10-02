import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  AgentMonthlyBillStatus,
  OrderBillingMode,
  OrderCustomerChargeStatus,
  OrderSettlementType,
  OrderStatus,
  Role,
  type Prisma,
} from '@/generated/prisma/client';
import { db } from '@/lib/db';
import type { CorrectSettledOrderInput } from '@/lib/auth/schemas';
import { allocateOutstandingCreditsInTx } from '@/lib/agent-monthly-billing/generation';
import { lockAgentBill, lockAgentPeriod } from '@/lib/agent-monthly-billing/locks';
import { createBillSettlementDetail } from '@/lib/agent-monthly-billing/settlement-detail';
import { databaseClockNow } from '@/lib/background-jobs/clock';
import { lockSettlementCutoffShared } from '@/lib/finance/settlement-cutoff-lock';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { appendOrderPricingRevisionInTx } from '@/lib/order/pricing-revision';
import { ORDER_PRICING_STATUS } from '@/lib/order/pricing-status';

/**
 * 已结算工单的结算更正（业主 2026-10-01）。
 *
 * 发货即结算后，月账单确认前发现金额不对，以一条「结算更正」调整行入账：正数补收、
 * 负数少收。原有收费明细、结算时间和状态都不动，工单仍按原结算月份进入账单；同一
 * 事务里同步已结算金额与草稿账单中这张单的快照。月账单一经确认，结算事实即冻结
 * （数据库触发器 Order_protect_billed_settlement 兜底），只能在账单里录抵扣或补收。
 */
const SETTLED_ORDER_CORRECTION_SOURCE = 'SETTLED_ORDER_CORRECTION';
const SETTLED_ORDER_CORRECTION_DESCRIPTION = '结算更正';
const BUSINESS_KEY_PREFIX = 'SETTLEMENT_CORRECTION:';
const MAX_AMOUNT = new Decimal('9999999999.99');

export class SettledOrderCorrectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettledOrderCorrectionError';
  }
}

type Actor = { id: string; role: Role };
type Tx = Prisma.TransactionClient;

type SettledOrderCorrectionAvailability =
  | { allowed: true; settledFee: string; minimumSettledFee: string; inDraftBill: boolean }
  | { allowed: false; reason: string };

type CorrectableOrderFacts = {
  status: OrderStatus;
  settlementType: OrderSettlementType;
  billingMode: OrderBillingMode;
  settledFee: Prisma.Decimal | null;
  settledAt: Date | null;
};

function blockedReason(
  order: CorrectableOrderFacts,
  billStatus: AgentMonthlyBillStatus | null,
): string | null {
  if (order.status !== OrderStatus.SETTLED) return '只有已结算的工单可以做结算更正';
  if (
    order.settlementType !== OrderSettlementType.EXTERNAL_SALES ||
    order.billingMode !== OrderBillingMode.CHARGE
  ) {
    return '免收费工单没有应收，无需结算更正';
  }
  if (order.settledFee === null || order.settledAt === null) {
    return '工单缺少结算金额或结算时间，请联系技术人员核对';
  }
  if (billStatus !== null && billStatus !== AgentMonthlyBillStatus.DRAFT) {
    return '本单所在月账单已确认，请在账单里录入抵扣或补收';
  }
  return null;
}

/** 详情页据此决定是否显示「结算更正」入口；写入时会在锁内重新判断。 */
export async function readSettledOrderCorrectionAvailability(
  orderId: string,
): Promise<SettledOrderCorrectionAvailability> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      settlementType: true,
      billingMode: true,
      settledFee: true,
      settledAt: true,
      processingAmount: true,
      agentMonthlyBillItem: { select: { bill: { select: { status: true } } } },
    },
  });
  if (!order) return { allowed: false, reason: '工单不存在' };
  const billStatus = order.agentMonthlyBillItem?.bill.status ?? null;
  const reason = blockedReason(order, billStatus);
  if (reason) return { allowed: false, reason };
  return {
    allowed: true,
    settledFee: order.settledFee!.toFixed(2),
    // Order_receivable_amounts_valid：对客收费合计不能为负，结算金额最低到加工费。
    minimumSettledFee: order.processingAmount.toFixed(2),
    inDraftBill: billStatus === AgentMonthlyBillStatus.DRAFT,
  };
}

type SettledOrderCorrectionResult = {
  chargeId: string;
  settledFee: string;
  priceRevision: number;
  revision: number;
  draftBillId: string | null;
  idempotentReplay: boolean;
};

export async function correctSettledOrder(
  input: CorrectSettledOrderInput,
  actor: Actor,
): Promise<SettledOrderCorrectionResult> {
  if (actor.role !== Role.ADMIN) throw new SettledOrderCorrectionError('只有管理员可以做结算更正');
  const amount = new Decimal(input.amount);
  if (!amount.isFinite() || amount.isZero() || amount.decimalPlaces() > 2) {
    throw new SettledOrderCorrectionError('更正金额必须是非零金额，最多两位小数');
  }
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new SettledOrderCorrectionError('更正原因必须为 1-500 字');
  }
  const businessKey = `${BUSINESS_KEY_PREFIX}${input.idempotencyKey}`;

  return db.$transaction(async (tx) => {
    // 与结算写入同序：先取结算截止共享锁（与账单生成 / 确认的独占锁互斥），再锁工单。
    await lockSettlementCutoffShared(tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(input.orderId)}))`;

    const replay = await tx.orderCustomerCharge.findUnique({
      where: { orderId_businessKey: { orderId: input.orderId, businessKey } },
      select: { id: true, amount: true, overrideReason: true },
    });
    if (replay) {
      if (!replay.amount?.equals(amount) || replay.overrideReason !== reason) {
        throw new SettledOrderCorrectionError('本次提交已失效，请刷新后重新填写');
      }
      const current = await tx.order.findUniqueOrThrow({
        where: { id: input.orderId },
        select: { settledFee: true, priceRevision: true, revision: true },
      });
      const item = await tx.agentMonthlyBillItem.findUnique({
        where: { orderId: input.orderId },
        select: { billId: true, bill: { select: { status: true } } },
      });
      return {
        chargeId: replay.id,
        settledFee: current.settledFee!.toFixed(2),
        priceRevision: current.priceRevision,
        revision: current.revision,
        draftBillId: item?.bill.status === AgentMonthlyBillStatus.DRAFT ? item.billId : null,
        idempotentReplay: true,
      };
    }

    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        orderNo: true,
        status: true,
        settlementType: true,
        billingMode: true,
        submitterId: true,
        revision: true,
        priceRevision: true,
        processingAmount: true,
        totalAmount: true,
        confirmedFee: true,
        settledFee: true,
        settledAt: true,
      },
    });
    if (!order) throw new SettledOrderCorrectionError('工单不存在');
    const billItem = await tx.agentMonthlyBillItem.findUnique({
      where: { orderId: order.id },
      select: {
        id: true,
        billId: true,
        bill: { select: { status: true, agentUserId: true, period: true } },
      },
    });
    const blocked = blockedReason(order, billItem?.bill.status ?? null);
    if (blocked) throw new SettledOrderCorrectionError(blocked);
    if (order.revision !== input.expectedRevision) {
      throw new SettledOrderCorrectionError('工单已更新，请刷新后重试');
    }
    if (billItem) {
      await lockAgentPeriod(tx, billItem.bill.agentUserId, billItem.bill.period);
      await lockAgentBill(tx, billItem.billId);
    }

    const settledBefore = new Decimal(order.settledFee!.toString());
    const settledAfter = settledBefore.plus(amount);
    const totalAfter = new Decimal(order.totalAmount.toString()).plus(amount);
    const confirmedAfter = new Decimal((order.confirmedFee ?? order.settledFee!).toString()).plus(amount);
    if (settledAfter.isNegative() || totalAfter.isNegative() || confirmedAfter.isNegative()) {
      throw new SettledOrderCorrectionError(
        `更正后结算金额不能小于 0（当前 ${settledBefore.toFixed(2)} 元）`,
      );
    }
    // 数据库约束 Order_receivable_amounts_valid 要求加工费不超过总额，即对客收费合计不能为负。
    // 加工费在工厂核价时已确认，这里只更正收费部分；加工费有误时在月账单确认后录抵扣。
    const processing = new Decimal(order.processingAmount.toString());
    if (totalAfter.lt(processing)) {
      throw new SettledOrderCorrectionError(
        `结算金额最低只能更正到加工费 ${processing.toFixed(2)} 元；加工费有误请在月账单确认后录入抵扣`,
      );
    }
    if (settledAfter.gt(MAX_AMOUNT) || totalAfter.gt(MAX_AMOUNT)) {
      throw new SettledOrderCorrectionError('更正后金额超出系统允许范围');
    }

    const category = await tx.customerChargeCategory.findUnique({
      where: { code: 'APPROVED_ADJUSTMENT' },
      select: { id: true, isActive: true },
    });
    if (!category?.isActive) {
      throw new SettledOrderCorrectionError('收费类别「经审批调整金额」尚未启用，请先在收费字典中启用');
    }

    const now = await databaseClockNow(tx);
    const chargeId = randomUUID();
    const settledFeeText = settledAfter.toFixed(2);
    await tx.orderCustomerCharge.create({
      data: {
        id: chargeId,
        orderId: order.id,
        categoryId: category.id,
        businessKey,
        status: OrderCustomerChargeStatus.FINAL,
        // 说明会出现在销售详情与账单明细中，只写中性名称；原因留在内部字段。
        description: SETTLED_ORDER_CORRECTION_DESCRIPTION,
        amount: amount.toFixed(2),
        isAdjustment: true,
        pricingSnapshot: {
          version: 1,
          source: SETTLED_ORDER_CORRECTION_SOURCE,
          correctedAt: now.toISOString(),
          actorId: actor.id,
          settledFee: { before: settledBefore.toFixed(2), after: settledFeeText },
        },
        overrideReason: reason,
        approvalReference: reason,
        createdById: actor.id,
        finalizedById: actor.id,
        finalizedAt: now,
      },
      select: { id: true },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        totalAmount: totalAfter.toFixed(2),
        confirmedFee: confirmedAfter.toFixed(2),
        settledFee: settledFeeText,
      },
      select: { id: true },
    });
    const revision = await appendOrderPricingRevisionInTx(tx, {
      orderId: order.id,
      status: ORDER_PRICING_STATUS.ADMIN_CONFIRMED,
      source: SETTLED_ORDER_CORRECTION_SOURCE,
      actorId: actor.id,
      now,
      expectedPriceRevision: order.priceRevision,
      incrementOrderRevision: true,
      remark: reason,
      metadata: {
        settledOrderCorrection: {
          chargeId,
          amount: amount.toFixed(2),
          settledFeeBefore: settledBefore.toFixed(2),
          settledFeeAfter: settledFeeText,
        },
      },
    });
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        operatorId: actor.id,
        action: 'ORDER_SETTLEMENT_CORRECTED',
        changedFields: {
          settledFee: { before: settledBefore.toFixed(2), after: settledFeeText },
          totalAmount: { before: order.totalAmount.toString(), after: totalAfter.toFixed(2) },
          confirmedFee: {
            before: order.confirmedFee?.toString() ?? null,
            after: confirmedAfter.toFixed(2),
          },
          priceRevision: { before: order.priceRevision, after: revision.priceRevision },
        },
        remark: `结算更正 ${amount.isPositive() ? '+' : ''}${amount.toFixed(2)} 元：${reason}`,
      },
    });

    let draftBillId: string | null = null;
    if (billItem) {
      draftBillId = billItem.billId;
      await refreshDraftBillMember(tx, order.id, billItem.id);
      await allocateOutstandingCreditsInTx(tx, {
        billId: billItem.billId,
        agentUserId: billItem.bill.agentUserId,
        period: billItem.bill.period,
      });
    }

    return {
      chargeId,
      settledFee: settledFeeText,
      priceRevision: revision.priceRevision,
      revision: revision.orderRevision,
      draftBillId,
      idempotentReplay: false,
    };
  });
}

/**
 * 只刷新这张单在草稿账单里的快照。不调用整张账单的同步：那会重新校验同一销售同月
 * 的全部工单，其他工单的问题不应挡住这一笔更正。
 */
async function refreshDraftBillMember(tx: Tx, orderId: string, itemId: string): Promise<void> {
  const fresh = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      settledFee: true,
      customName: true,
      processingAmount: true,
      // 与 generation.ts 的 ELIGIBLE_ORDER_SELECT 同序，快照与整张账单同步时一致。
      customerCharges: {
        select: { description: true, amount: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
  await tx.agentMonthlyBillItem.update({
    where: { id: itemId },
    data: {
      settledFeeSnapshot: fresh.settledFee!.toFixed(2),
      settlementDetailSnapshot: createBillSettlementDetail(fresh),
    },
    select: { id: true },
  });
}
