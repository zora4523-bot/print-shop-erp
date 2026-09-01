import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import {
  appendOrderPricingRevisionInTx,
  OrderPricingRevisionError,
} from "../pricing-revision";
import { ORDER_PRICING_STATUS } from "../pricing-status";

function freshOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNo: "GD-260826-001",
    settlementType: "EXTERNAL_SALES",
    revision: 7,
    priceRevision: 4,
    pricingStatus: "ADMIN_CONFIRMED",
    processingAmount: "140.00",
    packagingAmount: "20.00",
    totalAmount: "145.80",
    quotedFee: "142.00",
    confirmedFee: "143.50",
    settledFee: "145.80",
    items: [
      {
        id: "item-1",
        sequence: 1,
        name: "红包 A",
        quantity: 1_000,
        unitPrice: "0.1200",
        fixedFee: "0.00",
        subtotal: "120.00",
        suggestedSubtotal: "120.00",
        priceOverrideReason: null,
        pricingSnapshot: { source: "LATEST_PROCESSING_BOOK" },
      },
    ],
    packagingGroups: [
      {
        id: "packaging-1",
        sequence: 1,
        name: "单款入袋",
        mode: "SINGLE_STYLE",
        actualBagCount: 100,
        unitPrice: "0.2000",
        subtotal: "20.00",
        suggestedSubtotal: "20.00",
        priceOverrideReason: null,
        pricingSnapshot: {
          source: "LATEST_PROCESSING_BOOK",
          sourceRuleId: "packing-single",
        },
      },
    ],
    customerCharges: [
      {
        id: "charge-1",
        shipmentId: "shipment-1",
        businessKey: "SHIPMENT:1:SHIPPING_FEE",
        status: "ESTIMATED",
        priceBookId: "logistics-v2",
        sourceRuleId: "shipping-gd",
        suggestedAmount: "5.80",
        amount: "5.80",
        overrideReason: null,
        pricingSnapshot: { source: "LATEST_LOGISTICS_BOOK" },
        category: { code: "SHIPPING_FEE" },
      },
    ],
    ...overrides,
  };
}

function txFor(order: ReturnType<typeof freshOrder>) {
  const tx = {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockResolvedValue({ id: order.id }),
    },
    orderPricingRevision: {
      create: vi.fn().mockResolvedValue({ id: "pricing-revision-5" }),
    },
  };
  return tx;
}

describe("appendOrderPricingRevisionInTx", () => {
  it("fresh-reads persisted amounts, increments both revisions, and appends a linked immutable snapshot", async () => {
    const tx = txFor(freshOrder());
    const now = new Date("2026-08-26T01:00:00.000Z");

    const result = await appendOrderPricingRevisionInTx(
      tx as unknown as Prisma.TransactionClient,
      {
        orderId: "order-1",
        status: ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
        source: "SF_COLLECT_CHANGED_PENDING",
        actorId: "admin-1",
        now,
        expectedPriceRevision: 4,
        incrementOrderRevision: true,
        metadata: { isSfCollect: true },
      },
    );

    expect(result).toMatchObject({
      pricingRevisionId: "pricing-revision-5",
      priceRevision: 5,
      orderRevision: 8,
    });
    expect(tx.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          packagingAmount: true,
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
        }),
      }),
    );
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        pricingStatus: "PENDING_ADMIN_CONFIRMATION",
        priceRevision: 5,
        pricingConfirmedAt: null,
        pricingConfirmedById: null,
        revision: 8,
      },
      select: { id: true },
    });
    expect(tx.orderPricingRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: "order-1",
        revision: 5,
        status: "PENDING_ADMIN_CONFIRMATION",
        source: "SF_COLLECT_CHANGED_PENDING",
        createdById: "admin-1",
        createdAt: now,
        snapshot: expect.objectContaining({
          version: 2,
          previousPriceRevision: 4,
          order: expect.objectContaining({
            orderRevision: 8,
            processingAmount: "140.00",
            packagingAmount: "20.00",
            totalAmount: "145.80",
            quotedFee: "142.00",
            confirmedFee: "143.50",
            settledFee: "145.80",
          }),
          items: [expect.objectContaining({ subtotal: "120.00" })],
          packagingGroups: [
            expect.objectContaining({
              id: "packaging-1",
              mode: "SINGLE_STYLE",
              actualBagCount: 100,
              unitPrice: "0.2000",
              subtotal: "20.00",
              suggestedSubtotal: "20.00",
              priceOverrideReason: null,
              pricingSnapshot: {
                source: "LATEST_PROCESSING_BOOK",
                sourceRuleId: "packing-single",
              },
            }),
          ],
          customerCharges: [expect.objectContaining({ amount: "5.80" })],
        }),
      }),
    });
    expect(result.snapshot).not.toHaveProperty("previousSnapshot");
  });

  it("rejects a stale expected price revision before any write", async () => {
    const tx = txFor(freshOrder({ priceRevision: 6 }));

    await expect(
      appendOrderPricingRevisionInTx(
        tx as unknown as Prisma.TransactionClient,
        {
          orderId: "order-1",
          status: ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
          source: "CHANGE_REQUEST_APPLIED_PENDING",
          actorId: "admin-1",
          now: new Date(),
          expectedPriceRevision: 5,
        },
      ),
    ).rejects.toThrow(/价格修订已变更/);
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderPricingRevision.create).not.toHaveBeenCalled();
  });

  it("preserves an unknown customer charge as null in the immutable snapshot", async () => {
    const base = freshOrder();
    const tx = txFor(
      freshOrder({
        customerCharges: [
          {
            ...base.customerCharges[0],
            status: "PENDING_AMOUNT",
            suggestedAmount: null,
            amount: null,
          },
        ],
      }),
    );

    const result = await appendOrderPricingRevisionInTx(
      tx as unknown as Prisma.TransactionClient,
      {
        orderId: "order-1",
        status: ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
        source: "EXTERNAL_SUBMIT_QUOTE",
        actorId: "sales-1",
        now: new Date("2026-08-28T02:00:00.000Z"),
      },
    );

    expect(result.snapshot.customerCharges).toEqual([
      expect.objectContaining({
        status: "PENDING_AMOUNT",
        suggestedAmount: null,
        amount: null,
      }),
    ]);
  });

  it("snapshots a newly produced quote before its revision foreign key can be linked", async () => {
    const tx = txFor(
      freshOrder({
        quotedFee: null,
        confirmedFee: "120.00",
        settledFee: "118.00",
      }),
    );

    const result = await appendOrderPricingRevisionInTx(
      tx as unknown as Prisma.TransactionClient,
      {
        orderId: "order-1",
        status: ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
        source: "EXTERNAL_SUBMIT_QUOTE",
        actorId: "sales-1",
        now: new Date("2026-08-28T02:00:00.000Z"),
        orderFeeSnapshot: {
          quotedFee: "146.30",
          confirmedFee: null,
          settledFee: null,
        },
      },
    );

    expect(result.snapshot.order).toMatchObject({
      quotedFee: "146.30",
      confirmedFee: null,
      settledFee: null,
    });
  });

  it("requires an actor for an administrator-confirmed revision", async () => {
    const tx = txFor(freshOrder());

    await expect(
      appendOrderPricingRevisionInTx(
        tx as unknown as Prisma.TransactionClient,
        {
          orderId: "order-1",
          status: ORDER_PRICING_STATUS.ADMIN_CONFIRMED,
          source: "ADMIN_FULL_REPRICE",
          actorId: null,
          now: new Date(),
        },
      ),
    ).rejects.toBeInstanceOf(OrderPricingRevisionError);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});
