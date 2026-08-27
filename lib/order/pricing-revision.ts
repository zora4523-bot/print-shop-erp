import type { Prisma } from "../../generated/prisma/client";
import {
  ORDER_PRICING_STATUS,
  type OrderPricingStatusValue,
} from "./pricing-status";

type RevisionTx = Prisma.TransactionClient;

type FreshPricingOrder = {
  id: string;
  orderNo: string;
  settlementType: string;
  revision: number;
  priceRevision: number;
  pricingStatus: string;
  processingAmount: { toString(): string } | string;
  packagingAmount: { toString(): string } | string;
  totalAmount: { toString(): string } | string;
  items: Array<{
    id: string;
    sequence: number;
    name: string;
    lamination: import("../../generated/prisma/client").OrderLamination;
    quantity: number;
    unitPrice: { toString(): string } | string;
    fixedFee: { toString(): string } | string;
    subtotal: { toString(): string } | string;
    suggestedSubtotal: { toString(): string } | string | null;
    priceOverrideReason: string | null;
    pricingSnapshot: unknown;
    plateDetails: Array<{
      id: string;
      sequence: number;
      name: string;
      plateGroupId: string | null;
      specification: string | null;
      quantity: number;
      unitPrice: { toString(): string } | string;
      amount: { toString(): string } | string;
      remark: string | null;
      isActive: boolean;
      removedById: string | null;
      removedAt: Date | null;
    }>;
  }>;
  packagingGroups: Array<{
    id: string;
    sequence: number;
    name: string | null;
    mode: string;
    actualBagCount: number;
    unitPrice: { toString(): string } | string;
    subtotal: { toString(): string } | string;
    suggestedSubtotal: { toString(): string } | string | null;
    priceOverrideReason: string | null;
    pricingSnapshot: unknown;
  }>;
  customerCharges: Array<{
    id: string;
    shipmentId: string | null;
    businessKey: string;
    status: string;
    priceBookId: string | null;
    sourceRuleId: string | null;
    suggestedAmount: { toString(): string } | string | null;
    amount: { toString(): string } | string;
    overrideReason: string | null;
    pricingSnapshot: unknown;
    category: { code: string };
  }>;
};

export type AppendOrderPricingRevisionInput = {
  orderId: string;
  status: OrderPricingStatusValue;
  source: string;
  actorId: string | null;
  now: Date;
  expectedPriceRevision?: number;
  incrementOrderRevision?: boolean;
  remark?: string | null;
  metadata?: Prisma.InputJsonObject;
};

export class OrderPricingRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderPricingRevisionError";
  }
}

function text(value: { toString(): string } | string | null): string | null {
  return value === null ? null : value.toString();
}

/**
 * Append one immutable pricing revision from the amounts currently persisted
 * in the transaction. Callers must already hold the canonical per-order
 * advisory lock; the fresh read deliberately happens after their item/charge
 * writes so the snapshot and the visible Order totals cannot diverge.
 */
export async function appendOrderPricingRevisionInTx(
  tx: RevisionTx,
  input: AppendOrderPricingRevisionInput,
): Promise<{
  priceRevision: number;
  orderRevision: number;
  snapshot: Prisma.InputJsonObject;
}> {
  if (!input.source.trim() || input.source.length > 64) {
    throw new OrderPricingRevisionError("价格修订来源非法");
  }
  const orderModel = tx.order as unknown as {
    findUnique(args: unknown): Promise<FreshPricingOrder | null>;
    update(args: unknown): Promise<{ id: string }>;
  };
  const order = await orderModel.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNo: true,
      settlementType: true,
      revision: true,
      priceRevision: true,
      pricingStatus: true,
      processingAmount: true,
      packagingAmount: true,
      totalAmount: true,
      items: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          name: true,
          lamination: true,
          quantity: true,
          unitPrice: true,
          fixedFee: true,
          subtotal: true,
          suggestedSubtotal: true,
          priceOverrideReason: true,
          pricingSnapshot: true,
          plateDetails: {
            orderBy: { sequence: "asc" },
            select: {
              id: true,
              sequence: true,
              name: true,
              plateGroupId: true,
              specification: true,
              quantity: true,
              unitPrice: true,
              amount: true,
              remark: true,
              isActive: true,
              removedById: true,
              removedAt: true,
            },
          },
        },
      },
      packagingGroups: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          sequence: true,
          name: true,
          mode: true,
          actualBagCount: true,
          unitPrice: true,
          subtotal: true,
          suggestedSubtotal: true,
          priceOverrideReason: true,
          pricingSnapshot: true,
        },
      },
      customerCharges: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          shipmentId: true,
          businessKey: true,
          status: true,
          priceBookId: true,
          sourceRuleId: true,
          suggestedAmount: true,
          amount: true,
          overrideReason: true,
          pricingSnapshot: true,
          category: { select: { code: true } },
        },
      },
    },
  });
  if (!order) throw new OrderPricingRevisionError("工单不存在");
  if (
    input.expectedPriceRevision !== undefined &&
    order.priceRevision !== input.expectedPriceRevision
  ) {
    throw new OrderPricingRevisionError("工单价格修订已变更，请刷新后重试");
  }

  const nextPriceRevision = order.priceRevision + 1;
  const nextOrderRevision =
    order.revision + (input.incrementOrderRevision ? 1 : 0);
  const isAdminConfirmed =
    input.status === ORDER_PRICING_STATUS.ADMIN_CONFIRMED;
  const isPending =
    input.status === ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION;
  const confirmedAt = isPending ? null : input.now;
  const confirmedById = isAdminConfirmed ? input.actorId : null;
  if (isAdminConfirmed && !confirmedById) {
    throw new OrderPricingRevisionError("管理员确认修订缺少操作人");
  }

  const snapshot = {
    version: 2,
    source: input.source,
    pricedAt: input.now.toISOString(),
    previousPriceRevision: order.priceRevision,
    actorId: input.actorId,
    order: {
      id: order.id,
      orderNo: order.orderNo,
      settlementType: order.settlementType,
      orderRevision: nextOrderRevision,
      pricingStatus: input.status,
      priceRevision: nextPriceRevision,
      processingAmount: text(order.processingAmount),
      packagingAmount: text(order.packagingAmount),
      totalAmount: text(order.totalAmount),
    },
    items: order.items.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      name: item.name,
      lamination: item.lamination,
      quantity: item.quantity,
      unitPrice: text(item.unitPrice),
      fixedFee: text(item.fixedFee),
      subtotal: text(item.subtotal),
      suggestedSubtotal: text(item.suggestedSubtotal),
      priceOverrideReason: item.priceOverrideReason,
      pricingSnapshot: item.pricingSnapshot,
      plateDetails: (item.plateDetails ?? []).map((detail) => ({
        id: detail.id,
        sequence: detail.sequence,
        name: detail.name,
        plateGroupId: detail.plateGroupId,
        specification: detail.specification,
        quantity: detail.quantity,
        unitPrice: text(detail.unitPrice),
        amount: text(detail.amount),
        remark: detail.remark,
        isActive: detail.isActive,
        removedById: detail.removedById,
        removedAt: detail.removedAt?.toISOString() ?? null,
      })),
    })),
    packagingGroups: order.packagingGroups.map((group) => ({
      id: group.id,
      sequence: group.sequence,
      name: group.name,
      mode: group.mode,
      actualBagCount: group.actualBagCount,
      unitPrice: text(group.unitPrice),
      subtotal: text(group.subtotal),
      suggestedSubtotal: text(group.suggestedSubtotal),
      priceOverrideReason: group.priceOverrideReason,
      pricingSnapshot: group.pricingSnapshot,
    })),
    customerCharges: order.customerCharges.map((charge) => ({
      id: charge.id,
      shipmentId: charge.shipmentId,
      businessKey: String(charge.businessKey),
      categoryCode: String(charge.category.code),
      status: charge.status,
      priceBookId: charge.priceBookId,
      sourceRuleId: charge.sourceRuleId,
      suggestedAmount: text(charge.suggestedAmount),
      amount: text(charge.amount),
      overrideReason: charge.overrideReason,
      pricingSnapshot: charge.pricingSnapshot,
    })),
    remark: input.remark?.trim() || null,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  } as Prisma.InputJsonObject;

  await orderModel.update({
    where: { id: order.id },
    data: {
      pricingStatus: input.status,
      priceRevision: nextPriceRevision,
      pricingConfirmedAt: confirmedAt,
      pricingConfirmedById: confirmedById,
      ...(input.incrementOrderRevision ? { revision: nextOrderRevision } : {}),
    },
    select: { id: true },
  });
  const revisionModel = tx as unknown as {
    orderPricingRevision: { create(args: unknown): Promise<unknown> };
  };
  await revisionModel.orderPricingRevision.create({
    data: {
      orderId: order.id,
      revision: nextPriceRevision,
      status: input.status,
      source: input.source,
      snapshot,
      createdById: input.actorId,
      createdAt: input.now,
    },
  });

  return {
    priceRevision: nextPriceRevision,
    orderRevision: nextOrderRevision,
    snapshot,
  };
}
