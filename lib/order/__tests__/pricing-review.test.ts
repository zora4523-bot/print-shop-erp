import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrderBillingMode,
  OrderItemPricingRoute,
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
  activateOperationsMock,
  assertCsOrderSalesLedgerReconciledMock,
  recordCsSalesEntryMock,
  MockCsSalesLedgerError,
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
    activateOperationsMock: vi.fn(),
    assertCsOrderSalesLedgerReconciledMock: vi.fn(),
    recordCsSalesEntryMock: vi.fn(),
    MockCsSalesLedgerError: class extends Error {},
  };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/order/pricing-revision", () => ({
  appendOrderPricingRevisionInTx: appendPricingRevisionMock,
}));
vi.mock("@/lib/production/operation-materialization-service", () => ({
  activateProductionOperationsInTx: activateOperationsMock,
}));
vi.mock("@/lib/salary/cs-sales", () => ({
  assertCsOrderSalesLedgerReconciledInTx:
    assertCsOrderSalesLedgerReconciledMock,
  recordCsSalesEntryInTx: recordCsSalesEntryMock,
  CsSalesLedgerError: MockCsSalesLedgerError,
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
    submitterId: "cs-1",
    status: OrderStatus.SUBMITTED,
    billingMode: OrderBillingMode.CHARGE,
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
        pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        frontFoilColors: ["亮金"],
        backFoilColors: [],
        foilColors: ["亮金"],
        isDoubleSided: false,
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
        pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
        frontFoilColors: ["亮金"],
        backFoilColors: [],
        foilColors: ["亮金"],
        isDoubleSided: false,
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
  assertCsOrderSalesLedgerReconciledMock.mockResolvedValue(undefined);
  recordCsSalesEntryMock.mockResolvedValue(null);
});

describe("snapshot-only order pricing review", () => {
  it("has no quote engine or price-rule dependency", async () => {
    const source = readFileSync(
      new URL("../pricing-review.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "CustomerPriceRule",
      "customerPriceRule",
    ]) {
      expect(source).not.toContain(forbidden);
    }

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
        currentUnitPrice: "",
        currentFixedFee: "",
        currentSubtotal: "",
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
        currentUnitPrice: "",
        currentSubtotal: "",
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
  });

  it("preserves genuine historical manual amounts without the canonical pending envelope", async () => {
    const order = pricingOrder();
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      items: order.items.map((item) =>
        item.id === "item-manual"
          ? {
              ...item,
              unitPrice: "0.2300",
              fixedFee: "12.00",
              subtotal: "35.00",
              pricingSnapshot: {
                status: "MANUAL_PRICING_REQUIRED",
                manualReasons: ["historical manual quote"],
              },
              priceOverrideReason: "历史人工核价依据",
            }
          : item,
      ),
      packagingGroups: order.packagingGroups.map((group) =>
        group.id === "group-manual"
          ? {
              ...group,
              unitPrice: "0.1800",
              subtotal: "2.70",
              pricingSnapshot: {
                status: "PENDING_AMOUNT",
                errors: ["historical manual packaging quote"],
              },
              priceOverrideReason: "历史包装核价依据",
            }
          : group,
      ),
    });

    const preview = await previewOrderPricingReview("order-1", admin, now);

    expect(preview.items[1]).toMatchObject({
      complete: false,
      currentUnitPrice: "0.2300",
      currentFixedFee: "12.00",
      currentSubtotal: "35.00",
      currentReason: "历史人工核价依据",
    });
    expect(preview.packagingGroups[1]).toMatchObject({
      complete: false,
      currentUnitPrice: "0.1800",
      currentSubtotal: "2.70",
      currentReason: "历史包装核价依据",
    });
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
  });

  it.each([OrderStatus.PENDING_FACTORY, OrderStatus.SUBMITTED])(
    "allows shipment charge confirmation while order status is %s",
    async (status) => {
      dbMock.order.findUnique.mockResolvedValue(pricingOrder({ status }));

      await expect(
        previewOrderPricingReview("order-1", admin, now),
      ).resolves.toMatchObject({
        orderId: "order-1",
        shipments: [expect.objectContaining({ shipmentId: "shipment-1" })],
      });
      await expect(
        finalizeOrderPricing(command(), admin, now),
      ).resolves.toMatchObject({ confirmedFee: "155.00" });
    },
  );

  it.each([
    OrderSettlementType.INTERNAL_SALES,
    OrderSettlementType.FACTORY_DIRECT,
  ])(
    "excludes shipment charges from the %s preview, aggregate, and writes",
    async (settlementType) => {
      dbMock.order.findUnique.mockResolvedValue(pricingOrder({ settlementType }));

      await expect(
        previewOrderPricingReview("order-1", admin, now),
      ).resolves.toMatchObject({
        orderId: "order-1",
        logisticsPriceBook: null,
        shipments: [],
      });
      await expect(
        finalizeOrderPricing(command({ shipments: [] }), admin, now),
      ).resolves.toMatchObject({
        processingAmount: "140.00",
        totalAmount: "147.00",
        confirmedFee: "147.00",
        logisticsPriceBookVersion: null,
      });

      expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
      expect(dbMock.orderCustomerCharge.create).not.toHaveBeenCalled();
      expect(dbMock.customerChargeCategory.findUnique).not.toHaveBeenCalled();
      expect(appendPricingRevisionMock).toHaveBeenCalledWith(
        dbMock,
        expect.objectContaining({
          metadata: expect.objectContaining({
            manualCustomerChargeKeys: [],
            customerChargeAmount: "7.00",
          }),
        }),
      );
    },
  );

  it.each([
    ["positive", "119.00", "28.00"],
    ["negative", "200.00", "-53.00"],
  ])(
    "records the %s INTERNAL_SALES final-price delta exactly once",
    async (_direction, previousTotal, expectedDelta) => {
      dbMock.order.findUnique.mockResolvedValue(
        pricingOrder({
          settlementType: OrderSettlementType.INTERNAL_SALES,
          totalAmount: previousTotal,
        }),
      );

      await expect(
        finalizeOrderPricing(command({ shipments: [] }), admin, now),
      ).resolves.toMatchObject({ totalAmount: "147.00" });

      expect(assertCsOrderSalesLedgerReconciledMock).toHaveBeenCalledOnce();
      expect(assertCsOrderSalesLedgerReconciledMock).toHaveBeenCalledWith(
        dbMock,
        "order-1",
        previousTotal,
      );
      expect(recordCsSalesEntryMock).toHaveBeenCalledOnce();
      const ledgerInput = recordCsSalesEntryMock.mock.calls[0]?.[1] as {
        eventKey: string;
        csUserId: string;
        orderId: string;
        orderRevision: number;
        type: string;
        amount: { toFixed(places: number): string };
        occurredAt: Date;
        remark: string;
      };
      expect(ledgerInput).toMatchObject({
        eventKey: "order:order-1:revision:9:change",
        csUserId: "cs-1",
        orderId: "order-1",
        orderRevision: 9,
        type: "ORDER_CHANGED",
        occurredAt: now,
        remark: "管理员确认工单终价",
      });
      expect(ledgerInput.amount.toFixed(2)).toBe(expectedDelta);
    },
  );

  it("does not touch the CS ledger when INTERNAL_SALES final price is unchanged", async () => {
    dbMock.order.findUnique.mockResolvedValue(
      pricingOrder({
        settlementType: OrderSettlementType.INTERNAL_SALES,
        totalAmount: "147.00",
      }),
    );

    await expect(
      finalizeOrderPricing(command({ shipments: [] }), admin, now),
    ).resolves.toMatchObject({ totalAmount: "147.00" });

    expect(assertCsOrderSalesLedgerReconciledMock).not.toHaveBeenCalled();
    expect(recordCsSalesEntryMock).not.toHaveBeenCalled();
  });

  it.each(["reconcile", "record"])(
    "fails before pricing writes when CS ledger %s fails",
    async (failureStage) => {
      dbMock.order.findUnique.mockResolvedValue(
        pricingOrder({ settlementType: OrderSettlementType.INTERNAL_SALES }),
      );
      const failure = new MockCsSalesLedgerError("客服业绩流水无法对平");
      if (failureStage === "reconcile") {
        assertCsOrderSalesLedgerReconciledMock.mockRejectedValueOnce(failure);
      } else {
        recordCsSalesEntryMock.mockRejectedValueOnce(failure);
      }

      await expect(
        finalizeOrderPricing(command({ shipments: [] }), admin, now),
      ).rejects.toThrow(/客服业绩流水无法对平/);

      expect(dbMock.orderItem.update).not.toHaveBeenCalled();
      expect(dbMock.orderPackagingGroup.update).not.toHaveBeenCalled();
      expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
      expect(dbMock.orderCustomerCharge.create).not.toHaveBeenCalled();
      expect(dbMock.order.update).not.toHaveBeenCalled();
      expect(appendPricingRevisionMock).not.toHaveBeenCalled();
      expect(activateOperationsMock).not.toHaveBeenCalled();
      expect(dbMock.orderLog.create).not.toHaveBeenCalled();
      if (failureStage === "reconcile") {
        expect(recordCsSalesEntryMock).not.toHaveBeenCalled();
      }
    },
  );

  it("rejects a negative final total before ledger or pricing writes", async () => {
    const order = pricingOrder({
      settlementType: OrderSettlementType.INTERNAL_SALES,
    });
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      customerCharges: order.customerCharges.map((charge) =>
        charge.id === "other-charge" ? { ...charge, amount: "-200.00" } : charge,
      ),
    });

    await expect(
      finalizeOrderPricing(command({ shipments: [] }), admin, now),
    ).rejects.toThrow(/工单总额不能为负数/);

    expect(assertCsOrderSalesLedgerReconciledMock).not.toHaveBeenCalled();
    expect(recordCsSalesEntryMock).not.toHaveBeenCalled();
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(appendPricingRevisionMock).not.toHaveBeenCalled();
  });

  it.each([
    OrderSettlementType.INTERNAL_SALES,
    OrderSettlementType.FACTORY_DIRECT,
  ])("rejects forged shipment charge input for %s orders", async (settlementType) => {
    dbMock.order.findUnique.mockResolvedValue(pricingOrder({ settlementType }));

    await expect(finalizeOrderPricing(command(), admin, now)).rejects.toThrow(
      /仅适用于外部销售结算工单/,
    );
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(appendPricingRevisionMock).not.toHaveBeenCalled();
  });

  it("still requires one complete shipment-charge input per external-sales shipment", async () => {
    await expect(
      finalizeOrderPricing(command({ shipments: [] }), admin, now),
    ).rejects.toThrow(/完整确认每一个发货地址/);

    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(appendPricingRevisionMock).not.toHaveBeenCalled();
  });

  it("keeps a confirmed snapshot editable when its persisted charge amount is missing", async () => {
    const order = pricingOrder();
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      customerCharges: order.customerCharges.map((charge) =>
        charge.id === "packing-manual"
          ? {
              ...charge,
              status: "FINAL",
              amount: null,
              pricingSnapshot: {
                source: "ADMIN_SNAPSHOT_CONFIRMATION",
                status: "ADMIN_CONFIRMED",
                confirmation: { actorId: "admin-old" },
              },
            }
          : charge,
      ),
    });

    const preview = await previewOrderPricingReview("order-1", admin, now);
    expect(preview.shipments[0]?.packaging).toMatchObject({
      complete: false,
      advisory: true,
      currentAmount: null,
    });

    await expect(finalizeOrderPricing(command(), admin, now)).resolves.toMatchObject({
      confirmedFee: "155.00",
    });
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "packing-manual" },
        data: expect.objectContaining({ amount: "8.00" }),
      }),
    );
  });

  it.each([
    ["a missing amount", null],
    ["a non-zero amount", "1.00"],
  ])("does not treat a WAIVED charge with %s as complete", async (_label, amount) => {
    const order = pricingOrder();
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      customerCharges: order.customerCharges.map((charge) =>
        charge.id === "shipping-auto"
          ? { ...charge, status: "WAIVED", amount, pricingSnapshot: null }
          : charge,
      ),
    });

    const preview = await previewOrderPricingReview("order-1", admin, now);
    expect(preview.shipments[0]?.shipping).toMatchObject({
      complete: false,
      advisory: true,
    });
  });

  it("confirms a factory-direct order-level pending plate fee without shipment charges", async () => {
    const order = pricingOrder({
      status: OrderStatus.SUBMITTED,
      settlementType: OrderSettlementType.FACTORY_DIRECT,
    });
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
            pendingReason: {
              code: "PLATE_AMOUNT_PENDING",
              message: "制烫金版费始终由管理员按实际制版成本确认",
            },
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
    expect(preview.shipments).toEqual([]);
    expect(preview.logisticsPriceBook).toBeNull();
    expect(preview.orderCharges).toEqual([
      expect.objectContaining({
        chargeId: "plate-pending",
        businessKey: "ORDER:PLATE_MAKING_FEE:PENDING",
        categoryCode: "PLATE_MAKING_FEE",
        complete: false,
        errors: ["制烫金版费始终由管理员按实际制版成本确认"],
      }),
    ]);

    const result = await finalizeOrderPricing(
      command({
        shipments: [],
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
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledTimes(1);
    expect(result.confirmedFee).toBe("177.00");
    expect(activateOperationsMock).toHaveBeenCalledWith(
      dbMock,
      "order-1",
      admin,
      now,
    );
  });

  it("does not trust partial administrator markers for items, packaging, or charges", async () => {
    const order = pricingOrder();
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      items: order.items.map((item) =>
        item.id === "item-manual"
          ? {
              ...item,
              pricingSnapshot: {
                source: "ADMIN_SNAPSHOT_CONFIRMATION",
                status: "MANUAL_PRICING_REQUIRED",
                actual: {
                  amount: null,
                  provisional: true,
                  requiresAdminConfirmation: true,
                },
              },
            }
          : item,
      ),
      packagingGroups: order.packagingGroups.map((group) =>
        group.id === "group-manual"
          ? {
              ...group,
              pricingSnapshot: {
                status: "ADMIN_CONFIRMED",
                complete: false,
                actual: { amount: null, requiresAdminConfirmation: true },
              },
            }
          : group,
      ),
      customerCharges: [
        ...order.customerCharges,
        {
          id: "plate-partial-marker",
          shipmentId: null,
          businessKey: "ORDER:PLATE_MAKING_FEE:PENDING",
          description: "制烫金版费",
          quantity: null,
          unit: null,
          suggestedAmount: null,
          amount: "0.00",
          pricingSnapshot: {
            confirmation: { actorId: "admin-old" },
            status: "PENDING_AMOUNT",
            actual: { requiresAdminConfirmation: true },
          },
          overrideReason: null,
          status: "PENDING_AMOUNT",
          priceBookId: null,
          sourceRuleId: null,
          category: { code: "PLATE_MAKING_FEE", name: "制烫金版费" },
        },
      ],
    });

    const preview = await previewOrderPricingReview("order-1", admin, now);
    expect(preview.items.find((item) => item.itemId === "item-manual")?.complete)
      .toBe(false);
    expect(
      preview.packagingGroups.find(
        (group) => group.packagingGroupId === "group-manual",
      )?.complete,
    ).toBe(false);
    expect(preview.orderCharges).toEqual([
      expect.objectContaining({ chargeId: "plate-partial-marker" }),
    ]);
  });

  it("accepts only an internally consistent structured plate breakdown", async () => {
    const order = pricingOrder({
      status: OrderStatus.SUBMITTED,
      settlementType: OrderSettlementType.FACTORY_DIRECT,
    });
    const validDetail = {
      id: "plate-detail-charge",
      shipmentId: null,
      businessKey: "PLATE_DETAIL:plate-1",
      description: "制版：烫金版",
      quantity: "2",
      unit: "项",
      suggestedAmount: null,
      amount: "30.00",
      pricingSnapshot: {
        source: "ORDER_ITEM_PLATE_DETAIL",
        plateDetailId: "plate-1",
        orderItemId: "item-auto",
        actual: { quantity: 2, unitPrice: "15.00", amount: "30.00" },
      },
      overrideReason: "管理员确认制版明细",
      status: "FINAL",
      priceBookId: null,
      sourceRuleId: null,
      category: { code: "PLATE_MAKING_FEE", name: "制烫金版费" },
    };
    const waivedAggregate = {
      ...validDetail,
      id: "plate-aggregate",
      businessKey: "ORDER:PLATE_MAKING_FEE:PENDING",
      description: "制烫金版费",
      quantity: null,
      amount: "0.00",
      pricingSnapshot: { source: "PLATE_DETAIL_BREAKDOWN_SUPERSEDES_AGGREGATE" },
      status: "WAIVED",
    };
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      customerCharges: [...order.customerCharges, waivedAggregate, validDetail],
    });

    await expect(
      previewOrderPricingReview("order-1", admin, now),
    ).resolves.toMatchObject({ orderCharges: [] });

    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      items: order.items.map((item) =>
        item.id === "item-auto"
          ? { ...item, pricingRoute: OrderItemPricingRoute.COLOR_PRINT }
          : item,
      ),
      customerCharges: [...order.customerCharges, waivedAggregate, validDetail],
    });
    await expect(
      previewOrderPricingReview("order-1", admin, now),
    ).rejects.toThrow(/逐款制版明细与订单级制烫金版费不一致/u);
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
    },
  );

  it("checks ADMIN permission before reading the order", async () => {
    await expect(
      previewOrderPricingReview("order-1", sales, now),
    ).rejects.toBeInstanceOf(OrderPricingReviewError);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    OrderStatus.DRAFT,
    OrderStatus.REJECTED,
    OrderStatus.CONFIRMED,
    OrderStatus.ON_HOLD,
    OrderStatus.RELEASED,
    OrderStatus.FOILING,
    OrderStatus.PACKING,
    OrderStatus.SCHEDULING,
    OrderStatus.IN_PRODUCTION,
    OrderStatus.COMPLETED,
    OrderStatus.SHIPPED,
    OrderStatus.SETTLED,
    OrderStatus.FINISHED,
    OrderStatus.CANCELLED,
  ])("rejects pricing review while order status is %s", async (status) => {
    dbMock.order.findUnique.mockResolvedValue(
      pricingOrder({ status }),
    );
    await expect(
      previewOrderPricingReview("order-1", admin, now),
    ).rejects.toThrow(/待工厂确认阶段/);
    await expect(finalizeOrderPricing(command(), admin, now)).rejects.toThrow(
      /待工厂确认阶段/,
    );
    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(appendPricingRevisionMock).not.toHaveBeenCalled();
    expect(activateOperationsMock).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
  });

  it.each([
    "AUTO_CONFIRMED",
    "ADMIN_CONFIRMED",
    "LEGACY_CONFIRMED",
  ])("rejects repeated preview and finalization for %s orders", async (pricingStatus) => {
    dbMock.order.findUnique.mockResolvedValue(pricingOrder({ pricingStatus }));

    await expect(
      previewOrderPricingReview("order-1", admin, now),
    ).rejects.toThrow(/不处于待管理员确认状态/);
    await expect(finalizeOrderPricing(command(), admin, now)).rejects.toThrow(
      /不处于待管理员确认状态/,
    );

    expect(dbMock.orderItem.update).not.toHaveBeenCalled();
    expect(dbMock.orderPackagingGroup.update).not.toHaveBeenCalled();
    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(appendPricingRevisionMock).not.toHaveBeenCalled();
    expect(activateOperationsMock).not.toHaveBeenCalled();
    expect(dbMock.orderLog.create).not.toHaveBeenCalled();
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
  });

  it("creates each missing external-sales shipment charge once and aggregates each amount once", async () => {
    const order = pricingOrder();
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      customerCharges: order.customerCharges.filter(
        (charge) =>
          charge.category.code !== "SHIPPING_FEE" &&
          charge.category.code !== "PACKING_MATERIAL",
      ),
    });

    const result = await finalizeOrderPricing(
      command({
        shipments: command().shipments.map((shipment) => ({
          ...shipment,
          shippingFee: "6.00",
          packingMaterialFee: "8.00",
          reason: "工厂逐票确认物流与耗材",
        })),
      }),
      admin,
      now,
    );

    expect(dbMock.orderCustomerCharge.update).not.toHaveBeenCalled();
    expect(dbMock.orderCustomerCharge.create).toHaveBeenCalledTimes(2);
    expect(
      dbMock.orderCustomerCharge.create.mock.calls.map(
        ([args]) => args.data.businessKey,
      ),
    ).toEqual([
      "SHIPMENT:1:SHIPPING_FEE",
      "SHIPMENT:1:PACKING_MATERIAL",
    ]);
    expect(result.totalAmount).toBe("161.00");
    expect(appendPricingRevisionMock).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({
        metadata: expect.objectContaining({
          manualCustomerChargeKeys: [
            "SHIPMENT:1:SHIPPING_FEE",
            "SHIPMENT:1:PACKING_MATERIAL",
          ],
          customerChargeAmount: "21.00",
        }),
      }),
    );
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
