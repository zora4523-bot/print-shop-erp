import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrderPackagingMode,
  OrderStatus,
  Role,
} from "../../../generated/prisma/enums";
import type { FinalizeOrderPricingCommand } from "../pricing-review";

const {
  dbMock,
  quoteOrderItemsMock,
  quotePackagingMock,
  quoteLogisticsMock,
  resolveChargesMock,
  appendPricingRevisionMock,
} = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderItem: { update: vi.fn() },
    orderPackagingGroup: { update: vi.fn() },
    orderCustomerCharge: { update: vi.fn(), create: vi.fn() },
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
    quoteOrderItemsMock: vi.fn(),
    quotePackagingMock: vi.fn(),
    quoteLogisticsMock: vi.fn(),
    resolveChargesMock: vi.fn(),
    appendPricingRevisionMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/price/quote-service", () => ({
  quoteOrderItems: quoteOrderItemsMock,
}));
vi.mock("@/lib/price/order-packaging-quote", () => ({
  quoteOrderPackagingGroups: quotePackagingMock,
}));
vi.mock("@/lib/price/order-charge-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/price/order-charge-service")>();
  return {
    ...actual,
    quoteExternalOrderChargesInTransaction: quoteLogisticsMock,
    resolveExternalOrderChargesForCreation: resolveChargesMock,
  };
});
vi.mock("@/lib/order/pricing-revision", () => ({
  appendOrderPricingRevisionInTx: appendPricingRevisionMock,
}));

import {
  finalizeOrderPricing,
  OrderPricingReviewError,
  previewOrderPricingReview,
} from "../pricing-review";

const admin = { id: "admin-1", role: Role.ADMIN };
const sales = { id: "sales-1", role: Role.SALES };
const now = new Date("2026-08-26T02:00:00.000Z");
const processingBook = {
  id: "processing-v3",
  code: "PROCESSING_EXTERNAL",
  name: "外销加工费",
  version: 3,
  sourceName: "加工费.xlsx",
  sourceSha256: "a".repeat(64),
};
const logisticsBook = {
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
    orderNo: "GD-260826-001",
    status: OrderStatus.IN_PRODUCTION,
    settlementType: "EXTERNAL_SALES",
    isSfCollect: false,
    revision: 8,
    pricingStatus: "PENDING_ADMIN_CONFIRMATION",
    priceRevision: 3,
    processingAmount: "130.00",
    packagingAmount: "0.00",
    totalAmount: "145.00",
    items: [
      {
        id: "item-auto",
        sequence: 1,
        name: "自动价款",
        productId: "product-1",
        specification: "大号",
        paperType: "触感纸",
        quantity: 1_000,
        crafts: ["craft-1"],
        foilColors: ["金"],
        frontFoilColors: [],
        backFoilColors: [],
        isDoubleSided: true,
        isDoubleColor: false,
        unitPrice: "0.0900",
        fixedFee: "0.00",
        subtotal: "90.00",
        suggestedSubtotal: "90.00",
        pricingSnapshot: {},
        priceOverrideReason: null,
      },
      {
        id: "item-manual",
        sequence: 2,
        name: "人工价款",
        productId: "product-2",
        specification: "特殊",
        paperType: "特种纸",
        quantity: 100,
        crafts: [],
        foilColors: [],
        frontFoilColors: [],
        backFoilColors: [],
        isDoubleSided: false,
        isDoubleColor: false,
        unitPrice: "0.1000",
        fixedFee: "0.00",
        subtotal: "10.00",
        suggestedSubtotal: null,
        pricingSnapshot: {},
        priceOverrideReason: null,
      },
    ],
    packagingGroups: [],
    shipments: [
      {
        id: "shipment-1",
        sequence: 1,
        destinationProvince: "广东",
        quotedWeightKg: "12.5",
        weightKg: "2",
        status: "PENDING",
        lines: [{ quantity: 1_100 }],
      },
    ],
    customerCharges: [
      {
        id: "shipping-old",
        shipmentId: "shipment-1",
        businessKey: "SHIPMENT:1:SHIPPING_FEE",
        description: "旧快递费",
        quantity: "2",
        unit: "kg",
        suggestedAmount: "2.80",
        amount: "2.80",
        pricingSnapshot: {},
        overrideReason: null,
        status: "ESTIMATED",
        priceBookId: "logistics-v1",
        sourceRuleId: "old-shipping",
        category: { code: "SHIPPING_FEE", name: "快递费" },
      },
      {
        id: "packing-old",
        shipmentId: "shipment-1",
        businessKey: "SHIPMENT:1:PACKING_MATERIAL",
        description: "旧耗材费",
        quantity: "1",
        unit: "票",
        suggestedAmount: null,
        amount: "5.00",
        pricingSnapshot: {},
        overrideReason: "旧人工价",
        status: "ESTIMATED",
        priceBookId: "logistics-v1",
        sourceRuleId: "old-packing",
        category: { code: "PACKING_MATERIAL", name: "打包耗材" },
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
        pricingSnapshot: {},
        overrideReason: "人工费用",
        status: "FINAL",
        priceBookId: null,
        sourceRuleId: null,
        category: { code: "OTHER", name: "其他" },
      },
    ],
    ...overrides,
  };
}

function pricingOrderWithExplicitThreePassFoil() {
  const order = pricingOrder();
  return {
    ...order,
    items: order.items.map((item, index) =>
      index === 0
        ? {
            ...item,
            foilColors: ["哑金", "红金"],
            frontFoilColors: ["哑金", "红金"],
            backFoilColors: ["哑金"],
            // Deliberately stale retired columns: explicit side arrays remain
            // the authoritative three-pass production facts.
            isDoubleSided: false,
            isDoubleColor: false,
          }
        : item,
    ),
  };
}

function processingQuotes() {
  return [
    {
      complete: true,
      errors: [],
      suggestedUnitPrice: "0.1000",
      suggestedFixedFee: "10.00",
      suggestedSubtotal: "110.00",
      snapshot: { version: 1, priceBook: processingBook },
    },
    {
      complete: false,
      errors: ["当前规则无精确匹配"],
      suggestedUnitPrice: null,
      suggestedFixedFee: null,
      suggestedSubtotal: null,
      snapshot: { version: 1, priceBook: processingBook },
    },
  ];
}

function packagingQuote(options: {
  groupId: string;
  complete: boolean;
  unitPrice?: string;
  subtotal?: string;
}) {
  const suggestedUnitPrice = options.complete
    ? (options.unitPrice ?? "0.1000")
    : null;
  const suggestedSubtotal = options.complete
    ? (options.subtotal ?? "2.00")
    : null;
  return {
    priceBook: processingBook,
    groups: [
      {
        groupKey: options.groupId,
        complete: options.complete,
        errors: options.complete ? [] : ["当前加工费价目未覆盖该包装模式"],
        suggestedUnitPrice,
        suggestedSubtotal,
        snapshot: {
          version: 1,
          target: "PACKAGING_GROUP",
          priceBook: processingBook,
          complete: options.complete,
        },
      },
    ],
    suggestedTotal: suggestedSubtotal,
    requiresAdminConfirmation: !options.complete,
    errors: options.complete ? [] : ["包装组：当前规则未覆盖"],
  };
}

function logisticsQuote(overrides: Record<string, unknown> = {}) {
  return {
    priceBook: logisticsBook,
    quote: {
      shipments: [
        {
          shipmentKey: "1",
          shipping: {
            complete: true,
            waived: false,
            advisory: false,
            amount: "4.30",
            errors: [],
          },
          packaging: {
            complete: false,
            waived: false,
            advisory: true,
            amount: null,
            errors: ["需管理员确认包材"],
          },
        },
      ],
    },
    ...overrides,
  };
}

function resolvedCharges() {
  return {
    priceBook: logisticsBook,
    totalAmount: "12.30",
    requiresAdminConfirmation: false,
    charges: [
      {
        shipmentKey: "1",
        businessKey: "SHIPMENT:1:SHIPPING_FEE",
        categoryCode: "SHIPPING_FEE",
        categoryId: "shipping-category",
        priceBookId: logisticsBook.id,
        sourceRuleId: "shipping-latest",
        status: "ESTIMATED",
        description: "中通快递费",
        quantity: "2.000",
        unit: "kg",
        suggestedAmount: "4.30",
        amount: "4.30",
        pricingSnapshot: {},
        overrideReason: null,
      },
      {
        shipmentKey: "1",
        businessKey: "SHIPMENT:1:PACKING_MATERIAL",
        categoryCode: "PACKING_MATERIAL",
        categoryId: "packing-category",
        priceBookId: logisticsBook.id,
        sourceRuleId: "packing-reference",
        status: "ESTIMATED",
        description: "打包耗材",
        quantity: "1",
        unit: "票",
        suggestedAmount: null,
        amount: "8.00",
        pricingSnapshot: {},
        overrideReason: "核对实际包材",
      },
    ],
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
      { itemId: "item-auto", unitPrice: "9.9999", fixedFee: "999.00" },
      {
        itemId: "item-manual",
        unitPrice: "0.2000",
        fixedFee: "5.00",
        reason: "特殊材料经管理员核价",
      },
    ],
    packagingGroups: [],
    shipments: [
      {
        shipmentId: "shipment-1",
        expectedDestinationProvince: "广东",
        expectedBillableWeightKg: "2.000",
        shippingFee: "99.00",
        packingMaterialFee: "8.00",
        reason: "核对实际包材",
      },
    ],
    remark: "终价确认",
    ...overrides,
  };
}

beforeEach(() => {
  for (const value of Object.values(dbMock)) {
    if (typeof value === "function" && "mockReset" in value) {
      value.mockReset();
    } else if (typeof value === "object" && value !== null) {
      for (const method of Object.values(value)) {
        if (typeof method === "function" && "mockReset" in method) {
          method.mockReset();
        }
      }
    }
  }
  dbMock.$executeRaw.mockResolvedValue(undefined);
  dbMock.order.findUnique.mockResolvedValue(pricingOrder());
  dbMock.order.update.mockResolvedValue({ id: "order-1" });
  dbMock.orderItem.update.mockResolvedValue({ id: "item" });
  dbMock.orderPackagingGroup.update.mockResolvedValue({ id: "packaging-group" });
  dbMock.orderCustomerCharge.update.mockResolvedValue({ id: "charge" });
  dbMock.orderCustomerCharge.create.mockResolvedValue({ id: "charge-new" });
  dbMock.orderChangeRequest.updateMany.mockResolvedValue({ count: 0 });
  dbMock.orderLog.create.mockResolvedValue({ id: "log-1" });
  dbMock.$transaction.mockImplementation(
    async (callback: (client: typeof dbMock) => unknown) => callback(dbMock),
  );
  quoteOrderItemsMock.mockReset().mockResolvedValue(processingQuotes());
  quotePackagingMock.mockReset().mockResolvedValue({
    priceBook: null,
    groups: [],
    suggestedTotal: "0.00",
    requiresAdminConfirmation: false,
    errors: [],
  });
  quoteLogisticsMock.mockReset().mockResolvedValue(logisticsQuote());
  resolveChargesMock.mockReset().mockResolvedValue(resolvedCharges());
  appendPricingRevisionMock.mockReset().mockResolvedValue({
    priceRevision: 4,
    orderRevision: 9,
    snapshot: {},
  });
});

describe("order pricing review", () => {
  it("checks ADMIN permission before reading the order", async () => {
    await expect(
      previewOrderPricingReview("order-1", sales, now),
    ).rejects.toThrow(/只有管理员/);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("enables inactive catalog facts only for the authorized historical preview", async () => {
    await previewOrderPricingReview("order-1", admin, now);

    expect(quoteOrderItemsMock).toHaveBeenCalledWith(
      expect.any(Array),
      "EXTERNAL_SALES",
      now,
      dbMock,
      {
        orderItemCount: 2,
        allowInactiveCatalogFacts: true,
      },
    );
  });

  it.each([
    ["preview", () => previewOrderPricingReview("order-1", admin, now)],
    ["ADMIN_FULL_REPRICE", () => finalizeOrderPricing(command(), admin, now)],
  ])(
    "passes the explicit foil sides to %s instead of rebuilding them from retired aggregate fields",
    async (_label, run) => {
      dbMock.order.findUnique.mockResolvedValue(
        pricingOrderWithExplicitThreePassFoil(),
      );

      await run();

      expect(dbMock.order.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            items: expect.objectContaining({
              select: expect.objectContaining({
                frontFoilColors: true,
                backFoilColors: true,
              }),
            }),
          }),
        }),
      );
      expect(quoteOrderItemsMock).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            foilColors: ["哑金", "红金"],
            frontFoilColors: ["哑金", "红金"],
            backFoilColors: ["哑金"],
            isDoubleSided: false,
            isDoubleColor: false,
          }),
          expect.objectContaining({
            frontFoilColors: [],
            backFoilColors: [],
          }),
        ],
        "EXTERNAL_SALES",
        now,
        dbMock,
        {
          orderItemCount: 2,
          allowInactiveCatalogFacts: true,
        },
      );
    },
  );

  it("preserves the explicit three-pass foil facts in an ADMIN_FULL_REPRICE snapshot", async () => {
    dbMock.order.findUnique.mockResolvedValue(
      pricingOrderWithExplicitThreePassFoil(),
    );
    const [automatic, manual] = processingQuotes();
    quoteOrderItemsMock.mockResolvedValue([
      {
        ...automatic,
        snapshot: {
          ...automatic?.snapshot,
          input: {
            frontFoilColors: ["哑金", "红金"],
            backFoilColors: ["哑金"],
            foilPassCount: 3,
          },
        },
      },
      manual,
    ]);

    await finalizeOrderPricing(command(), admin, now);

    expect(dbMock.orderItem.update).toHaveBeenCalledWith({
      where: { id: "item-auto" },
      data: expect.objectContaining({
        pricingSnapshot: expect.objectContaining({
          source: "ADMIN_FULL_REPRICE",
          input: {
            frontFoilColors: ["哑金", "红金"],
            backFoilColors: ["哑金"],
            foilPassCount: 3,
          },
        }),
      }),
    });
  });

  it("keeps legacy orders without explicit sides on the aggregate fallback path", async () => {
    await previewOrderPricingReview("order-1", admin, now);

    expect(quoteOrderItemsMock.mock.calls[0]?.[0]?.[0]).toMatchObject({
      foilColors: ["金"],
      frontFoilColors: [],
      backFoilColors: [],
      isDoubleSided: true,
    });
  });

  it("does not treat a legacy quoted weight as a carrier-confirmed fact", async () => {
    const order = pricingOrder();
    dbMock.order.findUnique.mockResolvedValue({
      ...order,
      shipments: order.shipments.map((shipment) => ({
        ...shipment,
        quotedWeightKg: "12.5",
        weightKg: null,
      })),
    });

    await previewOrderPricingReview("order-1", admin, now);

    expect(quoteLogisticsMock).toHaveBeenCalledWith(
      dbMock,
      {
        isSfCollect: false,
        shipments: [
          expect.objectContaining({
            shipmentKey: "1",
            billableWeightKg: null,
          }),
        ],
      },
      now,
      { snapshotLockHeld: true },
    );
  });

  it.each([
    [
      "preview",
      () => previewOrderPricingReview("order-1", admin, now),
    ],
    ["finalize", () => finalizeOrderPricing(command(), admin, now)],
  ])("maps a generic %s quote failure to an actionable review error", async (_label, run) => {
    quoteOrderItemsMock.mockRejectedValueOnce(
      new Error("历史工单引用的工艺字典不存在"),
    );

    const error = await run().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrderPricingReviewError);
    expect(error).toMatchObject({
      message: expect.stringMatching(
        /历史工单加工费重算失败.*检查.*产品、工艺目录.*价目配置/,
      ),
    });
    expect(quoteLogisticsMock).not.toHaveBeenCalled();
  });

  it("rejects terminal orders", async () => {
    dbMock.order.findUnique.mockResolvedValue(
      pricingOrder({ status: OrderStatus.FINISHED }),
    );
    await expect(
      previewOrderPricingReview("order-1", admin, now),
    ).rejects.toThrow(/不能再重算/);
    expect(quoteOrderItemsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["price", { expectedPriceRevision: 2 }, /价格已被其他人更新/],
    ["order", { expectedOrderRevision: 7 }, /款式、数量或发货信息已变更/],
  ])(
    "rejects stale %s revision before quoting",
    async (_label, patch, error) => {
      await expect(
        finalizeOrderPricing(command(patch), admin, now),
      ).rejects.toThrow(error);
      expect(quoteOrderItemsMock).not.toHaveBeenCalled();
    },
  );

  it("requires a reason for every processing item without an exact automatic match", async () => {
    const submitted = command();
    submitted.items[1]!.reason = null as unknown as string;
    await expect(finalizeOrderPricing(submitted, admin, now)).rejects.toThrow(
      /无法自动报价.*定价依据/,
    );
    expect(resolveChargesMock).not.toHaveBeenCalled();
  });

  it("requires one exact logistics ticket for every shipment", async () => {
    await expect(
      finalizeOrderPricing(command({ shipments: [] }), admin, now),
    ).rejects.toThrow(/完整确认每一个发货地址/);
    expect(resolveChargesMock).not.toHaveBeenCalled();
  });

  it("forces the latest structured per-bag rule for every packaging group", async () => {
    const group = {
      id: "packaging-single",
      sequence: 1,
      name: "单款装",
      mode: OrderPackagingMode.SINGLE_STYLE,
      actualBagCount: 20,
      unitPrice: "9.0000",
      subtotal: "180.00",
      suggestedSubtotal: null,
      pricingSnapshot: {},
      priceOverrideReason: "旧人工价",
    };
    dbMock.order.findUnique.mockResolvedValue(
      pricingOrder({ packagingAmount: "180.00", packagingGroups: [group] }),
    );
    quotePackagingMock.mockResolvedValue(
      packagingQuote({ groupId: group.id, complete: true }),
    );

    const result = await finalizeOrderPricing(
      command({
        packagingGroups: [
          {
            packagingGroupId: group.id,
            expectedMode: group.mode,
            expectedActualBagCount: group.actualBagCount,
            unitPrice: "99.0000",
            reason: "该值不应覆盖自动价",
          },
        ],
      }),
      admin,
      now,
    );

    expect(quotePackagingMock).toHaveBeenCalledWith(
      [
        {
          groupKey: group.id,
          mode: OrderPackagingMode.SINGLE_STYLE,
          actualBagCount: 20,
        },
      ],
      "EXTERNAL_SALES",
      now,
      dbMock,
      { snapshotLockHeld: true },
    );
    expect(dbMock.orderPackagingGroup.update).toHaveBeenCalledWith({
      where: { id: group.id },
      data: expect.objectContaining({
        unitPrice: "0.1000",
        subtotal: "2.00",
        suggestedSubtotal: "2.00",
        priceOverrideReason: null,
      }),
    });
    expect(result).toMatchObject({
      packagingAmount: "2.00",
      processingAmount: "137.00",
      totalAmount: "156.30",
    });
  });

  it("requires and persists an administrator reason when a packaging rule is incomplete", async () => {
    const group = {
      id: "packaging-mixed",
      sequence: 1,
      name: "混装",
      mode: OrderPackagingMode.MIXED_STYLE,
      actualBagCount: 15,
      unitPrice: "0.0000",
      subtotal: "0.00",
      suggestedSubtotal: null,
      pricingSnapshot: {},
      priceOverrideReason: null,
    };
    dbMock.order.findUnique.mockResolvedValue(
      pricingOrder({ packagingAmount: "0.00", packagingGroups: [group] }),
    );
    quotePackagingMock.mockResolvedValue(
      packagingQuote({ groupId: group.id, complete: false }),
    );
    const submitted = command({
      packagingGroups: [
        {
          packagingGroupId: group.id,
          expectedMode: group.mode,
          expectedActualBagCount: group.actualBagCount,
          unitPrice: "0.2000",
          reason: "管理员按特殊混装工艺确认",
        },
      ],
    });

    await finalizeOrderPricing(submitted, admin, now);

    expect(dbMock.orderPackagingGroup.update).toHaveBeenCalledWith({
      where: { id: group.id },
      data: expect.objectContaining({
        unitPrice: "0.2000",
        subtotal: "3.00",
        suggestedSubtotal: null,
        priceOverrideReason: "管理员按特殊混装工艺确认",
      }),
    });

    submitted.packagingGroups[0]!.reason = null;
    await expect(finalizeOrderPricing(submitted, admin, now)).rejects.toThrow(
      /包装组 1 无法自动报价.*定价依据/,
    );
  });

  it("forces latest complete suggestions, accepts only advisory manual values, and totals the whole order", async () => {
    dbMock.order.findUnique.mockResolvedValue(
      pricingOrder({ status: OrderStatus.SHIPPED }),
    );

    const result = await finalizeOrderPricing(command(), admin, now);

    expect(resolveChargesMock.mock.calls[0]![1].shipments[0]).toMatchObject({
      province: "广东",
      billableWeightKg: "2.000",
      shippingFee: "4.30",
      packingMaterialFee: "8.00",
      overrideReason: "核对实际包材",
    });
    expect(dbMock.orderItem.update.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            where: { id: "item-auto" },
            data: expect.objectContaining({
              unitPrice: "0.1000",
              fixedFee: "10.00",
              subtotal: "110.00",
              priceOverrideReason: null,
            }),
          }),
        ],
        [
          expect.objectContaining({
            where: { id: "item-manual" },
            data: expect.objectContaining({
              unitPrice: "0.2000",
              fixedFee: "5.00",
              subtotal: "25.00",
              priceOverrideReason: "特殊材料经管理员核价",
            }),
          }),
        ],
      ]),
    );
    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "shipping-old" },
        data: expect.objectContaining({
          status: "FINAL",
          finalizedById: "admin-1",
          finalizedAt: now,
        }),
      }),
    );
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        packagingAmount: "0.00",
        processingAmount: "135.00",
        totalAmount: "154.30",
      },
      select: { id: true },
    });
    expect(appendPricingRevisionMock).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({
        status: "ADMIN_CONFIRMED",
        source: "ADMIN_FULL_REPRICE",
        expectedPriceRevision: 3,
        incrementOrderRevision: true,
        metadata: expect.objectContaining({
          priceBooks: {
            processing: processingBook,
            logistics: logisticsBook,
          },
        }),
      }),
    );
    expect(result).toMatchObject({
      priceRevision: 4,
      packagingAmount: "0.00",
      processingAmount: "135.00",
      totalAmount: "154.30",
      processingPriceBookVersion: 3,
      logisticsPriceBookVersion: 2,
    });
  });

  it("persists an unshipped SF-collect waiver with its finalizer", async () => {
    dbMock.order.findUnique.mockResolvedValue(
      pricingOrder({
        status: OrderStatus.DRAFT,
        isSfCollect: true,
        items: [pricingOrder().items[0]],
      }),
    );
    quoteOrderItemsMock.mockResolvedValue([processingQuotes()[0]]);
    quoteLogisticsMock.mockResolvedValue(
      logisticsQuote({
        quote: {
          shipments: [
            {
              shipmentKey: "1",
              shipping: {
                complete: true,
                waived: true,
                advisory: false,
                amount: "0.00",
                errors: [],
              },
              packaging: {
                complete: true,
                waived: false,
                advisory: false,
                amount: "0.00",
                errors: [],
              },
            },
          ],
        },
      }),
    );
    resolveChargesMock.mockResolvedValue({
      ...resolvedCharges(),
      totalAmount: "0.00",
      charges: [
        {
          ...resolvedCharges().charges[0],
          status: "WAIVED",
          suggestedAmount: "0.00",
          amount: "0.00",
        },
        {
          ...resolvedCharges().charges[1],
          status: "ESTIMATED",
          suggestedAmount: "0.00",
          amount: "0.00",
          overrideReason: null,
        },
      ],
    });

    await finalizeOrderPricing(
      command({
        items: [{ itemId: "item-auto" }],
        shipments: [
          {
            shipmentId: "shipment-1",
            expectedDestinationProvince: "广东",
            expectedBillableWeightKg: "2.000",
            shippingFee: "0.00",
            packingMaterialFee: "0.00",
          },
        ],
      }),
      admin,
      now,
    );

    expect(dbMock.orderCustomerCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "shipping-old" },
        data: expect.objectContaining({
          status: "WAIVED",
          finalizedById: "admin-1",
          finalizedAt: now,
        }),
      }),
    );
  });

  it("reports its domain error type for callers to map safely", async () => {
    await expect(
      previewOrderPricingReview("order-1", sales, now),
    ).rejects.toBeInstanceOf(OrderPricingReviewError);
  });
});
