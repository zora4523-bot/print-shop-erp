import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  OrderCustomerChargeStatus,
  OrderItemPricingRoute,
  OrderSettlementType,
  OrderStatus,
  Role,
  type Prisma,
} from '@/generated/prisma/client';
import { db } from '@/lib/db';
import type {
  DeleteOrderManualChargeInput,
  DeleteOrderPlateDetailInput,
  SaveOrderManualChargeInput,
  SaveOrderPlateDetailInput,
} from '@/lib/auth/schemas';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { appendOrderPricingRevisionInTx } from '@/lib/order/pricing-revision';
import { itemAllowsIndependentPlateDetail } from '@/lib/order/plate-charge-integrity';
import {
  ORDER_PRICING_STATUS,
  type OrderPricingStatusValue,
} from '@/lib/order/pricing-status';

const MAX_AMOUNT = new Decimal('9999999999.99');
const MANUAL_CATEGORY_CODES = [
  'SAMPLE_FEE',
  'OTHER_PACKAGING_FEE',
  'APPROVED_ADJUSTMENT',
] as const;
const PLATE_CATEGORY_CODE = 'PLATE_MAKING_FEE';
const PENDING_PLATE_BUSINESS_KEY = 'ORDER:PLATE_MAKING_FEE:PENDING';

export type OrderManualChargeCategoryCode =
  (typeof MANUAL_CATEGORY_CODES)[number];

type CommercialActor = { id: string; role: Role };

type MutableCommercialOrder = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  settlementType: OrderSettlementType;
  pricingStatus: OrderPricingStatusValue;
  priceRevision: number;
  revision: number;
  processingAmount: { toString(): string };
  totalAmount: { toString(): string };
  quotedFee: { toString(): string } | null;
  quotedPricingRevisionId: string | null;
  confirmedFee: { toString(): string } | null;
  settledFee: { toString(): string } | null;
};

export class OrderCommercialDetailsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderCommercialDetailsError';
  }
}

function assertAdmin(actor: CommercialActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new OrderCommercialDetailsError('仅管理员可以维护对客附加费用和制版明细');
  }
}

function isManualCategoryCode(
  value: string,
): value is OrderManualChargeCategoryCode {
  return (MANUAL_CATEGORY_CODES as readonly string[]).includes(value);
}

function checkedMoney(value: string, label: string, allowNegative: boolean) {
  let amount: Decimal;
  try {
    amount = new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  } catch {
    throw new OrderCommercialDetailsError(`${label}格式错误`);
  }
  if (!amount.isFinite() || amount.abs().gt(MAX_AMOUNT)) {
    throw new OrderCommercialDetailsError(`${label}超出系统允许范围`);
  }
  if (!allowNegative && amount.isNegative()) {
    throw new OrderCommercialDetailsError(`${label}不能为负数`);
  }
  return amount;
}

async function lockAndReadOrder(
  tx: Prisma.TransactionClient,
  input: { orderId: string; expectedPriceRevision: number },
): Promise<MutableCommercialOrder> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
    input.orderId,
  )}))`;
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      settlementType: true,
      purpose: true,
      pricingStatus: true,
      priceRevision: true,
      revision: true,
      processingAmount: true,
      totalAmount: true,
      quotedFee: true,
      quotedPricingRevisionId: true,
      confirmedFee: true,
      settledFee: true,
    },
  });
  if (!order) throw new OrderCommercialDetailsError('工单不存在');
  if (order.purpose === 'PROOF') throw new OrderCommercialDetailsError('打样请通过整单核价修改总价');
  if (order.purpose === 'SAMPLE_SHIPMENT') throw new OrderCommercialDetailsError('寄样品仅收取快递费和包装费');
  if (order.settlementType !== OrderSettlementType.EXTERNAL_SALES) {
    throw new OrderCommercialDetailsError('只有外部销售工单可以维护对客附加费用');
  }
  if (
    order.status === OrderStatus.CANCELLED ||
    order.status === OrderStatus.FINISHED ||
    order.status === OrderStatus.SETTLED
  ) {
    throw new OrderCommercialDetailsError('已作废、已结算或已归档工单不能修改价格明细');
  }
  if (order.priceRevision !== input.expectedPriceRevision) {
    throw new OrderCommercialDetailsError('工单价格已更新，请刷新后重试');
  }
  return order as MutableCommercialOrder;
}

function assertPlateDetailMaintenanceAllowed(
  order: MutableCommercialOrder,
): void {
  if (
    order.pricingStatus ===
    ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION
  ) {
    throw new OrderCommercialDetailsError(
      '价格待管理员确认时，请在工单价格复核中直接填写制烫金版费；终价确认后才能维护逐款制版明细',
    );
  }
}

async function requireCategory(
  tx: Prisma.TransactionClient,
  code: string,
): Promise<string> {
  const category = await tx.customerChargeCategory.findUnique({
    where: { code },
    select: { id: true, isActive: true },
  });
  if (!category?.isActive) {
    throw new OrderCommercialDetailsError(`收费类别 ${code} 尚未启用`);
  }
  return category.id;
}

function nextPricingStatus(
  current: OrderPricingStatusValue,
): OrderPricingStatusValue {
  return current === ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION
    ? current
    : ORDER_PRICING_STATUS.ADMIN_CONFIRMED;
}

async function finishCommercialMutation(
  tx: Prisma.TransactionClient,
  input: {
    order: MutableCommercialOrder;
    actor: CommercialActor;
    now: Date;
    source: string;
    entityId: string;
    action: string;
    remark: string;
  },
): Promise<{ priceRevision: number; totalAmount: string }> {
  const aggregate = await tx.orderCustomerCharge.aggregate({
    where: { orderId: input.order.id },
    _sum: { amount: true },
  });
  const totalAmount = new Decimal(input.order.processingAmount.toString())
    .plus(aggregate._sum.amount?.toString() ?? '0')
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (totalAmount.isNegative() || totalAmount.gt(MAX_AMOUNT)) {
    throw new OrderCommercialDetailsError('附加费用调整后工单总额超出系统允许范围');
  }
  const pricingStatus = nextPricingStatus(input.order.pricingStatus);
  const isPending =
    pricingStatus === ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION;
  const quotedFee = isPending
    ? totalAmount.toFixed(2)
    : (input.order.quotedFee?.toString() ?? null);
  const confirmedFee =
    pricingStatus === ORDER_PRICING_STATUS.ADMIN_CONFIRMED
      ? totalAmount.toFixed(2)
      : null;
  await tx.order.update({
    where: { id: input.order.id },
    data: {
      totalAmount: totalAmount.toFixed(2),
      ...(isPending ? { quotedFee } : {}),
      confirmedFee,
      settledFee: null,
    },
    select: { id: true },
  });
  const revision = await appendOrderPricingRevisionInTx(tx, {
    orderId: input.order.id,
    status: pricingStatus,
    source: input.source,
    actorId: input.actor.id,
    now: input.now,
    expectedPriceRevision: input.order.priceRevision,
    incrementOrderRevision: true,
    remark: input.remark,
    orderFeeSnapshot: {
      quotedFee,
      confirmedFee,
      settledFee: null,
    },
    metadata: {
      commercialDetailMutation: {
        action: input.action,
        entityId: input.entityId,
      },
    },
  });
  if (isPending) {
    await tx.order.update({
      where: { id: input.order.id },
      data: { quotedPricingRevisionId: revision.pricingRevisionId },
      select: { id: true },
    });
  }
  await tx.orderLog.create({
    data: {
      orderId: input.order.id,
      operatorId: input.actor.id,
      action: input.action,
      changedFields: {
        priceRevision: {
          before: input.order.priceRevision,
          after: revision.priceRevision,
        },
        totalAmount: {
          before: input.order.totalAmount.toString(),
          after: totalAmount.toFixed(2),
        },
        quotedFee: {
          before: input.order.quotedFee?.toString() ?? null,
          after: quotedFee,
        },
        quotedPricingRevisionId: {
          before: input.order.quotedPricingRevisionId,
          after: isPending
            ? revision.pricingRevisionId
            : input.order.quotedPricingRevisionId,
        },
        confirmedFee: {
          before: input.order.confirmedFee?.toString() ?? null,
          after: confirmedFee,
        },
        settledFee: {
          before: input.order.settledFee?.toString() ?? null,
          after: null,
        },
      },
      remark: input.remark,
    },
  });
  return {
    priceRevision: revision.priceRevision,
    totalAmount: totalAmount.toFixed(2),
  };
}

export async function saveOrderManualCharge(
  input: SaveOrderManualChargeInput,
  actor: CommercialActor,
  now = new Date(),
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const order = await lockAndReadOrder(tx, input);
    const categoryId = await requireCategory(tx, input.categoryCode);
    const isAdjustment = input.categoryCode === 'APPROVED_ADJUSTMENT';
    const amount = checkedMoney(input.amount, '收费金额', isAdjustment);
    if (isAdjustment && !input.approvalReference?.trim()) {
      throw new OrderCommercialDetailsError('经审批调整必须填写审批信息');
    }

    let chargeId = input.chargeId;
    if (chargeId) {
      const existing = await tx.orderCustomerCharge.findFirst({
        where: { id: chargeId, orderId: order.id },
        select: {
          id: true,
          shipmentId: true,
          priceBookId: true,
          sourceRuleId: true,
          category: { select: { code: true } },
        },
      });
      if (
        !existing ||
        existing.shipmentId ||
        existing.priceBookId ||
        existing.sourceRuleId ||
        !isManualCategoryCode(String(existing.category.code))
      ) {
        throw new OrderCommercialDetailsError('只能修改人工录入的订单级附加费用');
      }
      await tx.orderCustomerCharge.update({
        where: { id: chargeId },
        data: {
          categoryId,
          status: OrderCustomerChargeStatus.FINAL,
          description: input.description,
          suggestedAmount: null,
          amount: amount.toFixed(2),
          isAdjustment,
          pricingSnapshot: {
            version: 1,
            source: 'ADMIN_MANUAL_CHARGE',
            categoryCode: input.categoryCode,
            pricedAt: now.toISOString(),
            actual: { amount: amount.toFixed(2) },
          },
          overrideReason: input.reason,
          approvalReference: isAdjustment ? input.approvalReference : null,
          finalizedById: actor.id,
          finalizedAt: now,
        },
        select: { id: true },
      });
    } else {
      chargeId = randomUUID();
      await tx.orderCustomerCharge.create({
        data: {
          id: chargeId,
          orderId: order.id,
          categoryId,
          businessKey: `MANUAL:${chargeId}`,
          status: OrderCustomerChargeStatus.FINAL,
          description: input.description,
          amount: amount.toFixed(2),
          isAdjustment,
          pricingSnapshot: {
            version: 1,
            source: 'ADMIN_MANUAL_CHARGE',
            categoryCode: input.categoryCode,
            pricedAt: now.toISOString(),
            actual: { amount: amount.toFixed(2) },
          },
          overrideReason: input.reason,
          approvalReference: isAdjustment ? input.approvalReference : null,
          createdById: actor.id,
          finalizedById: actor.id,
          finalizedAt: now,
        },
        select: { id: true },
      });
    }

    return {
      chargeId,
      ...(await finishCommercialMutation(tx, {
        order,
        actor,
        now,
        source: 'ADMIN_MANUAL_CHARGE',
        entityId: chargeId,
        action: input.chargeId
          ? 'ORDER_MANUAL_CHARGE_UPDATED'
          : 'ORDER_MANUAL_CHARGE_CREATED',
        remark: `${input.description}：${input.reason}`,
      })),
    };
  });
}

export async function deleteOrderManualCharge(
  input: DeleteOrderManualChargeInput,
  actor: CommercialActor,
  now = new Date(),
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const order = await lockAndReadOrder(tx, input);
    const existing = await tx.orderCustomerCharge.findFirst({
      where: { id: input.chargeId, orderId: order.id },
      select: {
        id: true,
        amount: true,
        shipmentId: true,
        priceBookId: true,
        sourceRuleId: true,
        category: { select: { code: true } },
      },
    });
    if (
      !existing ||
      existing.shipmentId ||
      existing.priceBookId ||
      existing.sourceRuleId ||
      !isManualCategoryCode(String(existing.category.code))
    ) {
      throw new OrderCommercialDetailsError('只能移除人工录入的订单级附加费用');
    }
    await tx.orderCustomerCharge.update({
      where: { id: existing.id },
      data: {
        status: OrderCustomerChargeStatus.WAIVED,
        amount: '0.00',
        pricingSnapshot: {
          version: 1,
          source: 'ADMIN_MANUAL_CHARGE_REMOVED',
          removedAt: now.toISOString(),
          previousAmount: existing.amount?.toString() ?? null,
        },
        overrideReason: input.reason,
        finalizedById: actor.id,
        finalizedAt: now,
      },
      select: { id: true },
    });
    return {
      chargeId: existing.id,
      ...(await finishCommercialMutation(tx, {
        order,
        actor,
        now,
        source: 'ADMIN_MANUAL_CHARGE_REMOVED',
        entityId: existing.id,
        action: 'ORDER_MANUAL_CHARGE_REMOVED',
        remark: input.reason,
      })),
    };
  });
}

export async function saveOrderPlateDetail(
  input: SaveOrderPlateDetailInput,
  actor: CommercialActor,
  now = new Date(),
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const order = await lockAndReadOrder(tx, input);
    assertPlateDetailMaintenanceAllowed(order);
    const item = await tx.orderItem.findFirst({
      where: { id: input.orderItemId, orderId: order.id },
      select: {
        id: true,
        name: true,
        pricingRoute: true,
        frontFoilColors: true,
        backFoilColors: true,
        foilColors: true,
        isDoubleSided: true,
      },
    });
    if (!item) throw new OrderCommercialDetailsError('款式不存在或不属于该工单');
    if (!itemAllowsIndependentPlateDetail(item)) {
      throw new OrderCommercialDetailsError(
        item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT
          ? '彩印烫金按含版费整款价核对，不能另行添加独立制版费'
          : '该款式没有烫金事实，不能添加制版费明细',
      );
    }
    const unitPrice = checkedMoney(input.unitPrice, '制版单价', false);
    const amount = unitPrice
      .times(input.quantity)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (amount.gt(MAX_AMOUNT)) {
      throw new OrderCommercialDetailsError('制版费金额超出系统允许范围');
    }
    const categoryId = await requireCategory(tx, PLATE_CATEGORY_CODE);

    let plateDetailId = input.plateDetailId;
    if (plateDetailId) {
      const existing = await tx.orderItemPlateDetail.findFirst({
        where: {
          id: plateDetailId,
          orderItemId: item.id,
          isActive: true,
        },
        select: { id: true },
      });
      if (!existing) {
        throw new OrderCommercialDetailsError('制版明细不存在或已移除');
      }
      await tx.orderItemPlateDetail.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          plateGroupId: input.plateGroupId,
          specification: input.specification,
          quantity: input.quantity,
          unitPrice: unitPrice.toFixed(2),
          amount: amount.toFixed(2),
          remark: input.remark,
        },
        select: { id: true },
      });
    } else {
      const sequence =
        (
          await tx.orderItemPlateDetail.aggregate({
            where: { orderItemId: item.id },
            _max: { sequence: true },
          })
        )._max.sequence ?? 0;
      plateDetailId = randomUUID();
      await tx.orderItemPlateDetail.create({
        data: {
          id: plateDetailId,
          orderItemId: item.id,
          sequence: sequence + 1,
          name: input.name,
          plateGroupId: input.plateGroupId,
          specification: input.specification,
          quantity: input.quantity,
          unitPrice: unitPrice.toFixed(2),
          amount: amount.toFixed(2),
          remark: input.remark,
          createdById: actor.id,
        },
        select: { id: true },
      });
    }

    const chargeData = {
      categoryId,
      status: OrderCustomerChargeStatus.FINAL,
      description: `制版：${input.name}`,
      quantity: input.quantity,
      unit: '项',
      unitPrice: unitPrice.toFixed(2),
      suggestedAmount: null,
      amount: amount.toFixed(2),
      isAdjustment: false,
      pricingSnapshot: {
        version: 1,
        source: 'ORDER_ITEM_PLATE_DETAIL',
        plateDetailId,
        orderItemId: item.id,
        itemName: item.name,
        plateGroupId: input.plateGroupId,
        specification: input.specification,
        pricedAt: now.toISOString(),
        actual: {
          quantity: input.quantity,
          unitPrice: unitPrice.toFixed(2),
          amount: amount.toFixed(2),
        },
      },
      overrideReason: input.remark ?? '管理员确认制版明细',
      approvalReference: null,
      finalizedById: actor.id,
      finalizedAt: now,
    } satisfies Prisma.OrderCustomerChargeUncheckedUpdateInput;

    // The create-order engine stores one aggregate pending plate charge so a
    // factory-confirmed amount has a complete exit. Once structured plate
    // rows exist, they become the sole plate-fee breakdown; waive the aggregate
    // row first so later detail maintenance can never charge both totals.
    const aggregatePlateCharge = await tx.orderCustomerCharge.findUnique({
      where: {
        orderId_businessKey: {
          orderId: order.id,
          businessKey: PENDING_PLATE_BUSINESS_KEY,
        },
      },
      select: { id: true, status: true, amount: true, pricingSnapshot: true },
    });
    if (
      aggregatePlateCharge &&
      aggregatePlateCharge.status !== OrderCustomerChargeStatus.WAIVED
    ) {
      await tx.orderCustomerCharge.update({
        where: { id: aggregatePlateCharge.id },
        data: {
          status: OrderCustomerChargeStatus.WAIVED,
          amount: '0.00',
          pricingSnapshot: {
            version: 1,
            source: 'PLATE_DETAIL_BREAKDOWN_SUPERSEDES_AGGREGATE',
            supersededAt: now.toISOString(),
            plateDetailId,
            previousStatus: aggregatePlateCharge.status,
            previousAmount: aggregatePlateCharge.amount?.toString() ?? null,
            ...(aggregatePlateCharge.pricingSnapshot === null
              ? {}
              : { previousSnapshot: aggregatePlateCharge.pricingSnapshot }),
          },
          overrideReason: '已由逐款制版明细替代订单级暂估制版费',
          finalizedById: actor.id,
          finalizedAt: now,
        },
        select: { id: true },
      });
    }
    await tx.orderCustomerCharge.upsert({
      where: {
        orderId_businessKey: {
          orderId: order.id,
          businessKey: `PLATE_DETAIL:${plateDetailId}`,
        },
      },
      update: chargeData,
      create: {
        id: randomUUID(),
        orderId: order.id,
        businessKey: `PLATE_DETAIL:${plateDetailId}`,
        createdById: actor.id,
        ...chargeData,
      },
      select: { id: true },
    });

    return {
      plateDetailId,
      ...(await finishCommercialMutation(tx, {
        order,
        actor,
        now,
        source: 'ORDER_ITEM_PLATE_DETAIL',
        entityId: plateDetailId,
        action: input.plateDetailId
          ? 'ORDER_PLATE_DETAIL_UPDATED'
          : 'ORDER_PLATE_DETAIL_CREATED',
        remark: `${item.name} · ${input.name} · ${amount.toFixed(2)} 元`,
      })),
    };
  });
}

export async function deleteOrderPlateDetail(
  input: DeleteOrderPlateDetailInput,
  actor: CommercialActor,
  now = new Date(),
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const order = await lockAndReadOrder(tx, input);
    assertPlateDetailMaintenanceAllowed(order);
    const detail = await tx.orderItemPlateDetail.findFirst({
      where: {
        id: input.plateDetailId,
        orderItemId: input.orderItemId,
        orderItem: { orderId: order.id },
        isActive: true,
      },
      select: { id: true, name: true, amount: true },
    });
    if (!detail) throw new OrderCommercialDetailsError('制版明细不存在或已移除');
    await tx.orderItemPlateDetail.update({
      where: { id: detail.id },
      data: {
        isActive: false,
        removedById: actor.id,
        removedAt: now,
      },
      select: { id: true },
    });
    await tx.orderCustomerCharge.update({
      where: {
        orderId_businessKey: {
          orderId: order.id,
          businessKey: `PLATE_DETAIL:${detail.id}`,
        },
      },
      data: {
        status: OrderCustomerChargeStatus.WAIVED,
        amount: '0.00',
        pricingSnapshot: {
          version: 1,
          source: 'ORDER_ITEM_PLATE_DETAIL_REMOVED',
          plateDetailId: detail.id,
          removedAt: now.toISOString(),
          previousAmount: detail.amount.toString(),
        },
        overrideReason: input.reason,
        finalizedById: actor.id,
        finalizedAt: now,
      },
      select: { id: true },
    });
    return {
      plateDetailId: detail.id,
      ...(await finishCommercialMutation(tx, {
        order,
        actor,
        now,
        source: 'ORDER_ITEM_PLATE_DETAIL_REMOVED',
        entityId: detail.id,
        action: 'ORDER_PLATE_DETAIL_REMOVED',
        remark: `${detail.name}：${input.reason}`,
      })),
    };
  });
}
