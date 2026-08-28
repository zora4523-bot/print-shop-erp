import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrderItemQuoteDisposition,
  OrderPackagingMode,
  OrderSettlementType,
  OrderStatus,
  Role,
} from "../../../generated/prisma/enums";
import type { FinalizeOrderPricingCommand } from "../pricing-review";

const {
  dbMock,
  appendPricingRevisionMock,
  quoteItemsSpy,
  quotePackagingSpy,
  quoteChargesSpy,
  resolveChargesSpy,
  activateOperationsMock,
} = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderItem: { update: vi.fn() },
    orderPackagingGroup: { update: vi.fn() },
    orderCustomerCharge: { update: vi.fn(), create: vi.fn() },
    customerChargeCategory: { findUnique: vi.fn() },
    orderChangeRequest: { updateMany: vi.fn() },
    orderLog: { create: vi.fn() },
  };
  return {
    dbMock: {
      ...tx,
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
    appendPricingRevisionMock: vi.fn(),
    quoteItemsSpy: vi.fn(),
    quotePackagingSpy: vi.fn(),
    quoteChargesSpy: vi.fn(),
    resolveChargesSpy: vi.fn(),
    activateOperationsMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/order/pricing-revision", () => ({
  appendOrderPricingRevisionInTx: appendPricingRevisionMock,
}));
vi.mock("@/lib/production/operation-materialization-service", () => ({
  activateProductionOperationsInTx: activateOperationsMock,
}));
// These mocks are deliberately present as tripwires. The review service must
// neither import nor call any calculator after the snapshot-only cutover.
vi.mock("@/lib/price/quote-service", () => ({
  quoteOrderItems: quoteItemsSpy,
}));
vi.mock("@/lib/price/order-packaging-quote", () => ({
  quoteOrderPackagingGroups: quotePackagingSpy,
}));
vi.mock("@/lib/price/order-charge-service", () => ({
  quoteExternalOrderChargesInTransaction: quoteChargesSpy,
  resolveExternalOrderChargesForCreation: resolveChargesSpy,
}));

import {
  finalizeOrderPricing,
  OrderPricingReviewError,
  previewOrderPricingReview,
} from "../pricing-review";

const admin = { id: "admin-1", role: Role.ADMIN };
const sales = { id: "sales-1", role: Role.SALES };
const now = new Date("2026-08-28T02:00:00.000Z");
const processingEvidence = {
  id: "processing-v3",
  code: "PROCESSING_EXTERNAL",
  version: 3,
  sourceSha256: "a".repeat(64),
};
const logisticsEvidence = {
  id: "logistics-v2",
  code: "LOGISTICS_EXTERNAL",
  name: "外销物流费",
  version: 2,
  sourceName: "物流费.xlsx",
  sourceSha256: "b".repeat(64),
};

function pricingOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNo: "GD-260828-001",
    status: OrderStatus.IN_PRODUCTION,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    revision: 8,
    pricingStatus: "PENDING_ADMIN_CONFIRMATION",
    priceRevision: 3,
    processingAmount: "112.00",
    packagingAmount: "2.00",
    totalAmount: "119.00",
    quotedFee: "119.00",
    confirmedFee: null,
    settledFee: "99.00",
    items: [
      {
        id: "item-auto",
        sequence: 1,
        name: "快照自动价款",
        manualQuoteReason: null,
        quantity: 1_000,
        quoteDisposition: OrderItemQuoteDisposition.PRICED,
        unitPrice: "0.1000",
        fixedFee: "10.00",
        subtotal: "110.00",
        suggestedSubtotal: "110.00",
        pricingSnapshot: {
          schemaVersion: 2,
          engineVersion: "CREATE_ORDER_PURE_V1",
          priceVersion: { processing: processingEvidence },
          status: "QUOTED",
          complete: true,
          suggestedUnitPrice: "0.1000",
          suggestedFixedFee: "10.00",
          suggestedSubtotal: "110.00",
          actual: {
            unitPrice: "0.1000",
            fixedFee: "10.00",
            subtotal: "110.00",
            provisional: false,
          },
        },
        priceOverrideReason: null,
      },
      {
        id: "item-manual",
        sequence: 2,
        name: "配置外纸张",
        manualQuoteReason: "客户自带特殊纸，转人工核价",
        quantity: 100,
        quoteDisposition: OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
        unitPrice: "0.0000",
        fixedFee: "0.00",
        subtotal: "0.00",
        suggestedSubtotal: null,
        pricingSnapshot: {
          schemaVersion: 2,
          engineVersion: "CREATE_ORDER_PURE_V1",
          priceVersion: { processing: processingEvidence },
          status: "MANUAL_PRICING_REQUIRED",
          manualReasons: [
            { code: "CUSTOM_PAPER", message: "配置外纸张需人工核价" },
          ],
          actual: { amount: null, provisional: true },
        },
        priceOverrideReason: null,
      },
    ],
    packagingGroups: [
      {
        id: "group-auto",
        sequence: 1,
        name: "单款装",
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 20,
        unitPrice: "0.1000",
        subtotal: "2.00",
        suggestedSubtotal: "2.00",
        pricingSnapshot: {
          version: 1,
          complete: true,
          priceBook: {
            ...processingEvidence,
            name: "外销加工费",
            sourceName: "加工费.xlsx",
          },
          suggestedUnitPrice: "0.1000",
          suggestedSubtotal: "2.00",
        },
        priceOverrideReason: null,
      },
      {
        id: "group-manual",
        sequence: 2,
        name: "特殊混装",
        mode: OrderPackagingMode.MIXED_STYLE,
        actualBagCount: 15,
        unitPrice: "0.0000",
        subtotal: "0.00",
        suggestedSubtotal: null,
        pricingSnapshot: {
          schemaVersion: 2,
          priceVersion: { processing: processingEvidence },
          status: "PENDING_AMOUNT",
          errors: ["混装袋数待人工确认"],
          actual: { amount: null, provisional: true },
        },
        priceOverrideReason: null,
      },
    ],
    orderCharges: [],
    shipments: [
      {
        id: "shipment-1",
        sequence: 1,
        destinationProvince: "广东",
        weightKg: "2.000",
        lines: [
          { orderItemId: "item-auto", quantity: 1_000 },
          { orderItemId: "item-manual", quantity: 100 },
        ],
      },
    ],
    customerCharges: [
      {
        id: "shipping-auto",
        shipmentId: "shipment-1",
        businessKey: "SHIPMENT:1:SHIPPING_FEE",
        description: "顺丰到付",
        quantity: "2.000",
        unit: "kg",
        suggestedAmount: "0.00",
        amount: "0.00",
        pricingSnapshot: {
          version: 1,
          priceBook: logisticsEvidence,
          quote: {
            amount: "0.00",
            basis: { billableWeightKg: "2.000" },
            errors: [],
          },
          actual: { amount: "0.00", provisional: false },
        },
        overrideReason: null,
        status: "WAIVED",
        priceBookId: "logistics-v2",
        sourceRuleId: "sf-waiver",
        category: { code: "SHIPPING_FEE", name: "快递费" },
      },
      {
        id: "packing-manual",
        shipmentId: "shipment-1",
        businessKey: "SHIPMENT:1:PACKING_MATERIAL",
        description: "打包耗材",
        quantity: "1",
        unit: "票",
        suggestedAmount: null,
        amount: null,
        pricingSnapshot: {
          version: 1,
          priceBook: logisticsEvidence,
          quote: { errors: ["特殊纸箱待人工确认"] },
          actual: {
            amount: null,
            provisional: true,
            requiresAdminConfirmation: true,
          },
        },
        overrideReason: null,
        status: "PENDING_AMOUNT",
        priceBookId: "logistics-v2",
        sourceRuleId: null,
        category: { code: "PACKING_MATERIAL", name: "打包耗材费" },
      },
      {
        id: "other-charge",
        shipmentId: null,
        businessKey: "ORDER:OTHER",
        description: "其他费用",
        quantity: null,
        unit: null,
        suggestedAmount: null,
        amount: "7.00",
        pricingSnapshot: null,
        overrideReason: "已确认的附加费",
        status: "FINAL",
        priceBookId: null,
        sourceRuleId: null,
        category: { code: "OTHER", name: "其他费用" },
      },
    ],
    ...overrides,
  };
}

function command(
  overrides: Partial<FinalizeOrderPricingCommand> = {},
): FinalizeOrderPricingCommand {
  return {
    orderId: "order-1",
    expectedOrderRevision: 8,
    expectedPriceRevision: 3,
    items: [
      {
        itemId: "item-manual",
        unitPrice: "0.2000",
        fixedFee: "5.00",
        reason: "工厂核对特殊纸后确认",
      },
    ],
    packagingGroups: [
      {
        packagingGroupId: "group-auto",
        expectedMode: OrderPackagingMode.SINGLE_STYLE,
        expectedActualBagCount: 20,
        unitPrice: "99.0000",
        reason: "浏览器伪造值应被忽略",
      },
      {
        packagingGroupId: "group-manual",
        expectedMode: OrderPackagingMode.MIXED_STYLE,
        expectedActualBagCount: 15,
        unitPrice: "0.2000",
        reason: "工厂确认特殊混装",
      },
    ],
    orderCharges: [],
    shipments: [
      {
        shipmentId: "shipment-1",
        expectedDestinationProvince: "广东",
        expectedBillableWeightKg: "2",
        shippingFee: "99.00",
        packingMaterialFee: "8.00",
        reason: "工厂确认特殊纸箱",
      },
    ],
    remark: "工厂核价确认",
    ...overrides,
  };
}

function expectNoCalculatorCalls() {
  expect(quoteItemsSpy).not.toHaveBeenCalled();
  expect(quotePackagingSpy).not.toHaveBeenCalled();
  expect(quoteChargesSpy).not.toHaveBeenCalled();
  expect(resolveChargesSpy).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.$executeRaw.mockResolvedValue(undefined);
  dbMock.order.findUnique.mockResolvedValue(pricingOrder());
  dbMock.order.update.mockResolvedValue({ id: "order-1" });
  dbMock.orderItem.update.mockResolvedValue({ id: "item" });
  dbMock.orderPackagingGroup.update.mockResolvedValue({ id: "group" });
  dbMock.orderCustomerCharge.update.mockResolvedValue({ id: "charge" });
  dbMock.orderCustomerCharge.create.mockResolvedValue({ id: "new-charge" });
  dbMock.customerChargeCategory.findUnique.mockImplementation(
    async ({ where }: { where: { code: string } }) => ({
      id: `${where.code.toLowerCase()}-category`,
      name: where.code === "SHIPPING_FEE" ? "快递费" : "打包耗材费",
    }),
  );
  dbMock.orderChangeRequest.updateMany.mockResolvedValue({ count: 0 });
  dbMock.orderLog.create.mockResolvedValue({ id: "log-1" });
  dbMock.$transaction.mockImplementation(
    async (callback: (client: typeof dbMock) => unknown) => callback(dbMock),
  );
  appendPricingRevisionMock.mockResolvedValue({
    priceRevision: 4,
    orderRevision: 9,
    snapshot: {},
  });
  activateOperationsMock.mockResolvedValue({
    orderId: "order-1",
    orderStatus: OrderStatus.SCHEDULING,
    operationIds: ["operation-1"],
    operationsCreated: 1,
    idempotentReplay: false,
  });
});

describe("snapshot-only order pricing review", () => {
  it("has no quote engine or price-rule dependency and never calls calculator tripwires", async () => {
    const source = readFileSync(
      new URL("../pricing-review.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "quoteOrderItems",
      "quoteOrderPackagingGroups",
      "quoteExternalOrderChargesInTransaction",
      "resolveExternalOrderChargesForCreation",
      "CustomerPriceRule",
      "customerPriceRule",
    ]) {
      expect(source).not.toContain(forbidden);
    }

    await previewOrderPricingReview("order-1", admin, now);
    await finalizeOrderPricing(command(), admin, now);

    expectNoCalculatorCalls();
  });

  it("reads pure and legacy snapshots, exposes manual context, and preserves explicit zero", async () => {
    const preview = await previewOrderPricingReview("order-1", admin, now);

    expect(preview.processingPriceBook).toMatchObject({
      id: "processing-v3",
      version: 3,
    });
    expect(preview.logisticsPriceBook).toMatchObject({
      id: "logistics-v2",
      version: 2,
    });
    expect(preview.items).toEqual([
      expect.objectContaining({
        itemId: "item-auto",
        complete: true,
        currentSubtotal: "110.00",
        suggestedSubtotal: "110.00",
      }),
      expect.objectContaining({
        itemId: "item-manual",
        complete: false,
        manualQuoteReason: "客户自带特殊纸，转人工核价",
        errors: expect.arrayContaining(["配置外纸张需人工核价"]),
      }),
    ]);
    expect(preview.packagingGroups).toEqual([
      expect.objectContaining({
        packagingGroupId: "group-auto",
        complete: true,
        currentSubtotal: "2.00",
      }),
      expect.objectContaining({
        packagingGroupId: "group-manual",
        complete: false,
      }),
    ]);
    expect(preview.orderCharges).toEqual([]);
    expect(preview.shipments[0]).toMatchObject({
      billableWeightKg: "2.000",
      itemQuantity: 1_100,
      shipping: {
        complete: true,
        waived: true,
        advisory: false,
        suggestedAmount: "0.00",
        currentAmount: "0.00",
        errors: [],
      },
      packaging: {
        complete: false,
        advisory: true,
        currentAmount: null,
      },
    });
    expectNoCalculatorCalls();
  });

  it("treats snapshot-less legacy persisted amounts as complete without recomputing", async () => {
    const order = pricingOrder();
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      items: order.items.map((item) => ({
        ...item,
        manualQuoteReason: null,
        quoteDisposition: null,
        pricingSnapshot: null,
        unitPrice: "0.0000",
        fixedFee: "0.00",
        subtotal: "0.00",
      })),
      packagingGroups: order.packagingGroups.map((group) => ({
        ...group,
        pricingSnapshot: null,
      })),
      customerCharges: order.customerCharges.map((charge) => ({
        ...charge,
        status: "ESTIMATED",
        pricingSnapshot: null,
        amount: charge.amount ?? "0.00",
      })),
    });

    const preview = await previewOrderPricingReview("order-1", admin, now);

    expect(preview.items.every((item) => item.complete)).toBe(true);
    expect(preview.items[0]).toMatchObject({
      currentUnitPrice: "0.0000",
      currentSubtotal: "0.00",
      suggestedSubtotal: "110.00",
    });
    expect(preview.packagingGroups.every((group) => group.complete)).toBe(true);
    expectNoCalculatorCalls();
  });

  it.each([
    OrderSettlementType.EXTERNAL_SALES,
    OrderSettlementType.INTERNAL_SALES,
    OrderSettlementType.FACTORY_DIRECT,
  ])("allows snapshot confirmation for chargeable %s orders", async (settlementType) => {
    dbMock.order.findUnique.mockResolvedValue(pricingOrder({ settlementType }));

    await expect(
      previewOrderPricingReview("order-1", admin, now),
    ).resolves.toMatchObject({ orderId: "order-1" });
    await expect(finalizeOrderPricing(command(), admin, now)).resolves.toMatchObject({
      confirmedFee: "155.00",
    });
  });

  it("confirms an order-level pending plate fee and activates operations in the same transaction", async () => {
    const order = pricingOrder({ status: OrderStatus.SUBMITTED });
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      customerCharges: [
        ...order.customerCharges,
        {
          id: "plate-pending",
          shipmentId: null,
          businessKey: "ORDER:PLATE_MAKING_FEE:PENDING",
          description: "制版费",
          quantity: null,
          unit: null,
          suggestedAmount: null,
          amount: null,
          pricingSnapshot: {
            schemaVersion: 2,
            status: "PENDING_AMOUNT",
            pendingReasons: ["制版费待工厂确认"],
            actual: {
              amount: null,
              provisional: true,
              requiresAdminConfirmation: true,
            },
          },
          overrideReason: null,
          status: "PENDING_AMOUNT",
          priceBookId: null,
          sourceRuleId: null,
          category: { code: "PLATE_MAKING_FEE", name: "制版费" },
        },
      ],
    });

    const preview = await previewOrderPricingReview("order-1", admin, now);
    expect(preview.orderCharges).toEqual([
      expect.objectContaining({
        chargeId: "plate-pending",
        businessKey: "ORDER:PLATE_MAKING_FEE:PENDING",
        categoryCode: "PLATE_MAKING_FEE",
        complete: false,
      }),
    ]);

    const result = await finalizeOrderPricing(
      command({
        orderCharges: [
          {
            chargeId: "plate-pending",
            expectedBusinessKey: "ORDER:PLATE_MAKING_FEE:PENDING",
            amount: "30.00",
            reason: "工厂确认制版成本",
          },
        ],
      }),
      admin,
      now,
    );

    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: "plate-pending" },
      data: expect.objectContaining({
        amount: "30.00",
        status: "ESTIMATED",
        overrideReason: "工厂确认制版成本",
        pricingSnapshot: expect.objectContaining({
          source: "ADMIN_SNAPSHOT_CONFIRMATION",
          status: "ADMIN_CONFIRMED",
        }),
      }),
      select: { id: true },
    });
    expect(result.confirmedFee).toBe("185.00");
    expect(activateOperationsMock).toHaveBeenCalledWith(
      dbMock,
      "order-1",
      admin,
      now,
    );
  });

  it("fails closed when a pending order-level charge is omitted or its business key changed", async () => {
    const order = pricingOrder();
    const plate = {
      ...order.customerCharges[2]!,
      id: "plate-pending",
      businessKey: "ORDER:PLATE_MAKING_FEE:PENDING",
      description: "制版费",
      amount: null,
      overrideReason: null,
      status: "PENDING_AMOUNT",
      pricingSnapshot: {
        status: "PENDING_AMOUNT",
        actual: { amount: null, provisional: true },
      },
      category: { code: "PLATE_MAKING_FEE", name: "制版费" },
    };
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      customerCharges: [...order.customerCharges, plate],
    });

    await expect(finalizeOrderPricing(command(), admin, now)).rejects.toThrow(
      /完整确认每一项订单级待核价费用/,
    );
    await expect(
      finalizeOrderPricing(
        command({
          orderCharges: [
            {
              chargeId: plate.id,
              expectedBusinessKey: "ORDER:CHANGED",
              amount: "0",
              reason: "确认免收",
            },
          ],
        }),
        admin,
        now,
      ),
    ).rejects.toThrow(/已变更/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
  });

  it.each(["preview", "finalize"])(
    "keeps NO_CHARGE orders out of %s",
    async (operation) => {
      dbMock.order.findUnique.mockResolvedValue(
        pricingOrder({ settlementType: OrderSettlementType.NO_CHARGE }),
      );
      const run =
        operation === "preview"
          ? previewOrderPricingReview("order-1", admin, now)
          : finalizeOrderPricing(command(), admin, now);
      await expect(run).rejects.toThrow(/免费工单/);
      expectNoCalculatorCalls();
    },
  );

  it("checks ADMIN permission before reading the order", async () => {
    await expect(
      previewOrderPricingReview("order-1", sales, now),
    ).rejects.toBeInstanceOf(OrderPricingReviewError);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects terminal orders without touching snapshots", async () => {
    dbMock.order.findUnique.mockResolvedValue(
      pricingOrder({ status: OrderStatus.FINISHED }),
    );
    await expect(
      previewOrderPricingReview("order-1", admin, now),
    ).rejects.toThrow(/不能再确认终价/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ expectedPriceRevision: 2 }, /价格已被其他人更新/],
    [{ expectedOrderRevision: 7 }, /款式、数量或发货信息已变更/],
  ])("rejects stale revisions before any write", async (patch, message) => {
    await expect(
      finalizeOrderPricing(command(patch), admin, now),
    ).rejects.toThrow(message);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it("keeps every automatic snapshot/value unchanged and confirms only pending rows", async () => {
    const autoItemSnapshot = pricingOrder().items[0]!.pricingSnapshot;
    const autoGroupSnapshot = pricingOrder().packagingGroups[0]!.pricingSnapshot;
    const autoChargeSnapshot = pricingOrder().customerCharges[0]!.pricingSnapshot;

    const result = await finalizeOrderPricing(command(), admin, now);

    expect(dbMock.orderItem.update).toHaveBeenCalledTimes(1);
    expect(dbMock.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item-manual" } }),
    );
    expect(dbMock.orderPackagingGroup.update).toHaveBeenCalledTimes(1);
    expect(dbMock.orderPackagingGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "group-manual" } }),
    );
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledTimes(1);
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "packing-manual" } }),
    );
    expect(dbMock.orderItem.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "item-auto" },
        data: expect.objectContaining({ pricingSnapshot: autoItemSnapshot }),
      }),
    );
    expect(dbMock.orderPackagingGroup.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "group-auto" },
        data: expect.objectContaining({ pricingSnapshot: autoGroupSnapshot }),
      }),
    );
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "shipping-auto" },
        data: expect.objectContaining({ pricingSnapshot: autoChargeSnapshot }),
      }),
    );
    expect(result).toMatchObject({
      packagingAmount: "5.00",
      processingAmount: "140.00",
      totalAmount: "155.00",
      confirmedFee: "155.00",
    });
  });

  it("persists manual confirmation snapshots and mandatory reasons", async () => {
    await finalizeOrderPricing(command(), admin, now);

    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: "item-manual" },
      data: expect.objectContaining({
        unitPrice: "0.2000",
        fixedFee: "5.00",
        subtotal: "25.00",
        priceOverrideReason: "工厂核对特殊纸后确认",
        pricingSnapshot: expect.objectContaining({
          source: "ADMIN_SNAPSHOT_CONFIRMATION",
          status: "ADMIN_CONFIRMED",
          manualQuoteReason: "客户自带特殊纸，转人工核价",
          actual: expect.objectContaining({
            subtotal: "25.00",
            provisional: false,
          }),
          confirmation: {
            actorId: "admin-1",
            confirmedAt: now.toISOString(),
            reason: "工厂核对特殊纸后确认",
          },
        }),
      }),
    });
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: "packing-manual" },
      data: expect.objectContaining({
        amount: "8.00",
        overrideReason: "工厂确认特殊纸箱",
        pricingSnapshot: expect.objectContaining({
          source: "ADMIN_SNAPSHOT_CONFIRMATION",
          status: "ADMIN_CONFIRMED",
        }),
      }),
      select: { id: true },
    });
  });

  it.each([
    ["item", { items: [{ itemId: "item-manual", unitPrice: "0", fixedFee: "0" }] }],
    [
      "packaging",
      {
        packagingGroups: command().packagingGroups.map((group) =>
          group.packagingGroupId === "group-manual"
            ? { ...group, reason: null }
            : group,
        ),
      },
    ],
    [
      "charge",
      {
        shipments: command().shipments.map((shipment) => ({
          ...shipment,
          reason: null,
        })),
      },
    ],
  ])("requires a reason for a pending %s row", async (_label, patch) => {
    await expect(
      finalizeOrderPricing(
        command(patch as Partial<FinalizeOrderPricingCommand>),
        admin,
        now,
      ),
    ).rejects.toThrow(/定价依据/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
  });

  it("accepts an explicit zero manual price and does not confuse it with missing", async () => {
    const zeroCommand = command({
      items: [
        {
          itemId: "item-manual",
          unitPrice: "0",
          fixedFee: "0",
          reason: "确认赠送加工",
        },
      ],
      packagingGroups: command().packagingGroups.map((group) =>
        group.packagingGroupId === "group-manual"
          ? { ...group, unitPrice: "0", reason: "确认免收入袋费" }
          : group,
      ),
      shipments: command().shipments.map((shipment) => ({
        ...shipment,
        packingMaterialFee: "0",
        reason: "确认免收特殊纸箱费",
      })),
    });

    const result = await finalizeOrderPricing(zeroCommand, admin, now);

    expect(dbMock.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitPrice: "0.0000",
          fixedFee: "0.00",
          subtotal: "0.00",
        }),
      }),
    );
    expect(result.totalAmount).toBe("119.00");
  });

  it("rejects browser attempts to alter an automatic item", async () => {
    await expect(
      finalizeOrderPricing(
        command({
          items: [
            ...command().items,
            {
              itemId: "item-auto",
              unitPrice: "9.9999",
              fixedFee: "999.00",
              reason: "伪造改价",
            },
          ],
        }),
        admin,
        now,
      ),
    ).rejects.toThrow(/不接受人工改价/);
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
  });

  it("writes confirmedFee and aggregates without touching quotedFee or settledFee", async () => {
    await finalizeOrderPricing(command(), admin, now);

    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        packagingAmount: "5.00",
        processingAmount: "140.00",
        totalAmount: "155.00",
        confirmedFee: "155.00",
      },
      select: { id: true },
    });
    const aggregateUpdate = dbMock.order.update.mock.calls[0]![0].data;
    expect(aggregateUpdate).not.toHaveProperty("quotedFee");
    expect(aggregateUpdate).not.toHaveProperty("settledFee");
    expect(appendPricingRevisionMock).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({
        status: "ADMIN_CONFIRMED",
        source: "ADMIN_SNAPSHOT_CONFIRMATION",
        expectedPriceRevision: 3,
        incrementOrderRevision: true,
      }),
    );
  });

  it("creates a missing manual charge by category code without reading price rules", async () => {
    const order = pricingOrder();
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      customerCharges: order.customerCharges.filter(
        (charge) => charge.category.code !== "PACKING_MATERIAL",
      ),
    });

    await finalizeOrderPricing(command(), admin, now);

    expect(dbMock.customerChargeCategory.findUnique).toHaveBeenCalledWith({
      where: { code: "PACKING_MATERIAL" },
      select: { id: true, name: true },
    });
    expect(dbMock.orderCustomerCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessKey: "SHIPMENT:1:PACKING_MATERIAL",
        categoryId: "packing_material-category",
        priceBookId: null,
        sourceRuleId: null,
        amount: "8.00",
      }),
      select: { id: true },
    });
    expectNoCalculatorCalls();
  });

  it("propagates revision failure so the database transaction rolls back", async () => {
    appendPricingRevisionMock.mockRejectedValueOnce(
      new Error("optimistic revision conflict"),
    );

    await expect(
      finalizeOrderPricing(command(), admin, now),
    ).rejects.toThrow("optimistic revision conflict");
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });
});
