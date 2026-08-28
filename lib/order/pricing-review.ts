import Decimal from "decimal.js";
import {
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderPackagingMode,
  OrderSettlementType,
  OrderStatus,
  Role,
} from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import { db } from "../db";
import { orderCascadeLockKey } from "./locks";
import { ORDER_PRICING_STATUS } from "./pricing-status";
import { appendOrderPricingRevisionInTx } from "./pricing-revision";
import { quoteOrderItems } from "../price/quote-service";
import {
  OrderCustomerChargeError,
  quoteExternalOrderChargesInTransaction,
  resolveExternalOrderChargesForCreation,
} from "../price/order-charge-service";
import { deriveExternalOrderChargeShipments } from "../price/external-order-charge-facts";
import { quoteOrderPackagingGroups } from "../price/order-packaging-quote";

const DECIMAL_10_4_MAX = new Decimal("999999.9999");
const DECIMAL_12_2_MAX = new Decimal("9999999999.99");

export class OrderPricingReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderPricingReviewError";
  }
}

export type FinalizeOrderPricingCommand = {
  orderId: string;
  expectedOrderRevision: number;
  expectedPriceRevision: number;
  items: Array<{
    itemId: string;
    unitPrice?: string | null;
    fixedFee?: string | null;
    reason?: string | null;
  }>;
  packagingGroups: Array<{
    packagingGroupId: string;
    expectedMode: OrderPackagingMode;
    expectedActualBagCount: number;
    unitPrice?: string | null;
    reason?: string | null;
  }>;
  shipments: Array<{
    shipmentId: string;
    expectedDestinationProvince: string | null;
    expectedBillableWeightKg: string | null;
    shippingFee: string;
    packingMaterialFee: string;
    reason?: string | null;
  }>;
  remark?: string | null;
};

export type OrderPricingReviewPreview = {
  orderId: string;
  orderNo: string;
  orderRevision: number;
  priceRevision: number;
  currentProcessingAmount: string;
  currentPackagingAmount: string;
  currentTotalAmount: string;
  processingPriceBook: {
    id: string;
    code: string;
    name: string;
    version: number;
    sourceName: string | null;
    sourceSha256: string | null;
  } | null;
  logisticsPriceBook: {
    id: string;
    code: string;
    name: string;
    version: number;
    sourceName: string;
    sourceSha256: string;
  };
  items: Array<{
    itemId: string;
    sequence: number;
    name: string;
    quantity: number;
    complete: boolean;
    errors: string[];
    currentUnitPrice: string;
    currentFixedFee: string;
    currentSubtotal: string;
    suggestedUnitPrice: string | null;
    suggestedFixedFee: string | null;
    suggestedSubtotal: string | null;
    currentReason: string | null;
  }>;
  packagingGroups: Array<{
    packagingGroupId: string;
    sequence: number;
    name: string | null;
    mode: OrderPackagingMode;
    actualBagCount: number;
    complete: boolean;
    errors: string[];
    currentUnitPrice: string;
    currentSubtotal: string;
    suggestedUnitPrice: string | null;
    suggestedSubtotal: string | null;
    currentReason: string | null;
  }>;
  shipments: Array<{
    shipmentId: string;
    sequence: number;
    destinationProvince: string | null;
    billableWeightKg: string | null;
    itemQuantity: number;
    shipping: {
      complete: boolean;
      waived: boolean;
      advisory: boolean;
      suggestedAmount: string | null;
      errors: string[];
      currentAmount: string | null;
    };
    packaging: {
      complete: boolean;
      waived: boolean;
      advisory: boolean;
      suggestedAmount: string | null;
      errors: string[];
      currentAmount: string | null;
    };
    currentReason: string | null;
  }>;
};

type MoneyLike = { toString(): string } | string | number;

type PricingOrder = {
  id: string;
  orderNo: string;
  status: string;
  settlementType: string;
  isSfCollect: boolean;
  revision: number;
  pricingStatus: string;
  priceRevision: number;
  processingAmount: MoneyLike;
  packagingAmount: MoneyLike;
  totalAmount: MoneyLike;
  items: Array<{
    id: string;
    sequence: number;
    name: string;
    productId: string | null;
    pricingRoute: import('@/generated/prisma/client').OrderItemPricingRoute;
    productStructure: import('@/generated/prisma/client').OrderProductStructure;
    artworkVersion: string | null;
    plateGroupId: string | null;
    pricingGroup: string | null;
    manualQuoteReason: string | null;
    specification: string | null;
    actualWidthMm: MoneyLike | null;
    actualHeightMm: MoneyLike | null;
    paperType: string | null;
    paperWeightGsm: number | null;
    quantity: number;
    crafts: string[];
    foilColors: string[];
    frontFoilColors: string[];
    backFoilColors: string[];
    foilTechnique: import('@/generated/prisma/client').OrderFoilTechnique;
    hasLocalFoil: boolean | null;
    lamination: import('@/generated/prisma/client').OrderLamination;
    printColors: string[];
    isDoubleSided: boolean;
    isDoubleColor: boolean;
    unitPrice: MoneyLike;
    fixedFee: MoneyLike;
    subtotal: MoneyLike;
    suggestedSubtotal: MoneyLike | null;
    pricingSnapshot: unknown;
    priceOverrideReason: string | null;
  }>;
  packagingGroups: Array<{
    id: string;
    sequence: number;
    name: string | null;
    mode: OrderPackagingMode;
    actualBagCount: number;
    unitPrice: MoneyLike;
    subtotal: MoneyLike;
    suggestedSubtotal: MoneyLike | null;
    pricingSnapshot: unknown;
    priceOverrideReason: string | null;
  }>;
  shipments: Array<{
    id: string;
    sequence: number;
    destinationProvince: string | null;
    weightKg: MoneyLike | null;
    status: string;
    lines: Array<{ orderItemId: string; quantity: number }>;
  }>;
  customerCharges: Array<{
    id: string;
    shipmentId: string | null;
    businessKey: string;
    description: string;
    quantity: MoneyLike | null;
    unit: string | null;
    suggestedAmount: MoneyLike | null;
    amount: MoneyLike;
    pricingSnapshot: unknown;
    overrideReason: string | null;
    status: string;
    priceBookId: string | null;
    sourceRuleId: string | null;
    category: { code: string; name: string };
  }>;
};

const pricingOrderSelect = {
  id: true,
  orderNo: true,
  status: true,
  settlementType: true,
  isSfCollect: true,
  revision: true,
  pricingStatus: true,
  priceRevision: true,
  processingAmount: true,
  packagingAmount: true,
  totalAmount: true,
  items: {
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      name: true,
      productId: true,
      pricingRoute: true,
      productStructure: true,
      artworkVersion: true,
      plateGroupId: true,
      pricingGroup: true,
      manualQuoteReason: true,
      specification: true,
      actualWidthMm: true,
      actualHeightMm: true,
      paperType: true,
      paperWeightGsm: true,
      quantity: true,
      crafts: true,
      foilColors: true,
      frontFoilColors: true,
      backFoilColors: true,
      foilTechnique: true,
      hasLocalFoil: true,
      lamination: true,
      printColors: true,
      isDoubleSided: true,
      isDoubleColor: true,
      unitPrice: true,
      fixedFee: true,
      subtotal: true,
      suggestedSubtotal: true,
      pricingSnapshot: true,
      priceOverrideReason: true,
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
      pricingSnapshot: true,
      priceOverrideReason: true,
    },
  },
  shipments: {
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      destinationProvince: true,
      weightKg: true,
      status: true,
      lines: { select: { orderItemId: true, quantity: true } },
    },
  },
  customerCharges: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      shipmentId: true,
      businessKey: true,
      description: true,
      quantity: true,
      unit: true,
      suggestedAmount: true,
      amount: true,
      pricingSnapshot: true,
      overrideReason: true,
      status: true,
      priceBookId: true,
      sourceRuleId: true,
      category: { select: { code: true, name: true } },
    },
  },
} as const;

function assertAdmin(actor: { id: string; role: Role }): void {
  if (actor.role !== Role.ADMIN) {
    throw new OrderPricingReviewError(
      "只有管理员可以确认或重算外部销售工单价格",
    );
  }
}

function assertReviewable(order: PricingOrder): void {
  if (order.settlementType !== OrderSettlementType.EXTERNAL_SALES) {
    throw new OrderPricingReviewError("只有外部销售工单需要进行对客价格终审");
  }
  if (
    order.status === OrderStatus.FINISHED ||
    order.status === OrderStatus.CANCELLED
  ) {
    throw new OrderPricingReviewError(
      "工单已完成结算或已取消，不能再重算对客价格",
    );
  }
}

function money(value: MoneyLike | null | undefined, scale = 2): string | null {
  if (value === null || value === undefined) return null;
  return new Decimal(value.toString()).toFixed(scale);
}

function parseManualMoney(
  value: string | null | undefined,
  label: string,
  max: Decimal,
  decimalPlaces: number,
): Decimal {
  if (value === null || value === undefined || value.trim() === "") {
    throw new OrderPricingReviewError(`${label}必须由管理员填写`);
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new OrderPricingReviewError(`${label}格式非法`);
  }
  if (
    !parsed.isFinite() ||
    parsed.isNegative() ||
    parsed.decimalPlaces() > decimalPlaces ||
    parsed.gt(max)
  ) {
    throw new OrderPricingReviewError(`${label}超出系统允许范围`);
  }
  return parsed;
}

function itemQuoteInput(order: PricingOrder) {
  return order.items.map((item) => ({
    productId: item.productId,
    pricingRoute: item.pricingRoute,
    productStructure: item.productStructure,
    artworkVersion: item.artworkVersion,
    plateGroupId: item.plateGroupId,
    pricingGroup: item.pricingGroup,
    manualQuoteReason: item.manualQuoteReason,
    specification: item.specification,
    actualWidthMm:
      item.actualWidthMm === null ? null : Number(money(item.actualWidthMm, 2)),
    actualHeightMm:
      item.actualHeightMm === null ? null : Number(money(item.actualHeightMm, 2)),
    paperType: item.paperType,
    paperWeightGsm: item.paperWeightGsm,
    quantity: item.quantity,
    crafts: item.crafts,
    foilColors: item.foilColors,
    frontFoilColors: item.frontFoilColors,
    backFoilColors: item.backFoilColors,
    foilTechnique: item.foilTechnique,
    hasLocalFoil: item.hasLocalFoil,
    lamination: item.lamination,
    printColors: item.printColors,
    isDoubleSided: item.isDoubleSided,
    isDoubleColor: item.isDoubleColor,
  }));
}

function shipmentFacts(order: PricingOrder) {
  return deriveExternalOrderChargeShipments({
    isSfCollect: order.isSfCollect,
    items: order.items.map((item) => ({
      itemKey: item.id,
      quantity: item.quantity,
      paperWeightGsm: item.paperWeightGsm,
      paperType: item.paperType,
      productStructure: item.productStructure,
    })),
    shipments: order.shipments.map((shipment) => ({
      shipmentKey: String(shipment.sequence),
      province: shipment.destinationProvince,
      // Persisted fulfilment weight is a trusted actual fact and therefore
      // takes precedence over the item-based estimate in the shared helper.
      billableWeightKg: money(shipment.weightKg, 3),
      itemQuantities: order.items.map((item) =>
        shipment.lines.reduce(
          (sum, line) =>
            line.orderItemId === item.id ? sum + line.quantity : sum,
          0,
        ),
      ),
    })),
  });
}

function quotedBillableWeightKg(
  basis: Record<string, string | number | boolean | null>,
): string | null {
  const value = basis.billableWeightKg;
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.gt(0) ? parsed.toFixed(3) : null;
  } catch {
    return null;
  }
}

function packagingGroupFacts(order: PricingOrder) {
  return order.packagingGroups.map((group) => ({
    groupKey: group.id,
    mode: group.mode,
    actualBagCount: group.actualBagCount,
  }));
}

async function quoteHistoricalOrderItems(
  order: PricingOrder,
  now: Date,
  tx: Prisma.TransactionClient,
): Promise<Awaited<ReturnType<typeof quoteOrderItems>>> {
  try {
    return await quoteOrderItems(
      itemQuoteInput(order),
      OrderSettlementType.EXTERNAL_SALES,
      now,
      tx,
      {
        orderItemCount: order.items.length,
        allowInactiveCatalogFacts: true,
      },
    );
  } catch (error) {
    const detail =
      error instanceof Error && error.message.trim()
        ? `：${error.message.trim()}`
        : "";
    throw new OrderPricingReviewError(
      `历史工单加工费重算失败${detail}。请检查该工单引用的产品、工艺目录和当前生效价目配置后重试`,
    );
  }
}

function processingBookFromQuotes(
  quotes: Awaited<ReturnType<typeof quoteOrderItems>>,
): OrderPricingReviewPreview["processingPriceBook"] {
  const books = new Map<
    string,
    NonNullable<OrderPricingReviewPreview["processingPriceBook"]>
  >();
  for (const quote of quotes) {
    const book = quote.snapshot.priceBook;
    if (book) books.set(book.id, book);
  }
  if (books.size > 1) {
    throw new OrderPricingReviewError(
      "加工费报价未使用同一个价目簿快照，请刷新后重试",
    );
  }
  return books.values().next().value ?? null;
}

async function readPricingOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<PricingOrder | null> {
  const model = tx.order as unknown as {
    findUnique(args: unknown): Promise<PricingOrder | null>;
  };
  return model.findUnique({
    where: { id: orderId },
    select: pricingOrderSelect,
  });
}

export async function previewOrderPricingReview(
  orderId: string,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<OrderPricingReviewPreview> {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const order = await readPricingOrder(tx, orderId);
    if (!order) throw new OrderPricingReviewError("工单不存在");
    assertReviewable(order);

    const quotes = await quoteHistoricalOrderItems(order, now, tx);
    const processingPriceBook = processingBookFromQuotes(quotes);
    const packaging = await quoteOrderPackagingGroups(
      packagingGroupFacts(order),
      OrderSettlementType.EXTERNAL_SALES,
      now,
      tx,
      { snapshotLockHeld: true },
    );
    if (
      packaging.priceBook &&
      processingPriceBook &&
      packaging.priceBook.id !== processingPriceBook.id
    ) {
      throw new OrderPricingReviewError(
        "款式与包装组未使用同一个加工费价目版本，请刷新后重试",
      );
    }
    const facts = shipmentFacts(order);
    let logistics: Awaited<
      ReturnType<typeof quoteExternalOrderChargesInTransaction>
    >;
    try {
      logistics = await quoteExternalOrderChargesInTransaction(
        tx,
        { isSfCollect: order.isSfCollect, shipments: facts },
        now,
        { snapshotLockHeld: true },
      );
    } catch (error) {
      if (error instanceof OrderCustomerChargeError) {
        throw new OrderPricingReviewError(error.message);
      }
      throw error;
    }

    const currentChargeByKey = new Map(
      order.customerCharges.map((charge) => [
        String(charge.businessKey),
        charge,
      ]),
    );
    const shipmentBySequence = new Map(
      order.shipments.map((shipment) => [String(shipment.sequence), shipment]),
    );

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      orderRevision: order.revision,
      priceRevision: order.priceRevision,
      currentProcessingAmount: money(order.processingAmount)!,
      currentPackagingAmount: money(order.packagingAmount)!,
      currentTotalAmount: money(order.totalAmount)!,
      processingPriceBook,
      logisticsPriceBook: logistics.priceBook,
      items: order.items.map((item, index) => {
        const quote = quotes[index]!;
        return {
          itemId: item.id,
          sequence: item.sequence,
          name: item.name,
          quantity: item.quantity,
          complete: quote.complete,
          errors: quote.errors,
          currentUnitPrice: money(item.unitPrice, 4)!,
          currentFixedFee: money(item.fixedFee)!,
          currentSubtotal: money(item.subtotal)!,
          suggestedUnitPrice: quote.suggestedUnitPrice,
          suggestedFixedFee: quote.suggestedFixedFee,
          suggestedSubtotal: quote.suggestedSubtotal,
          currentReason: item.priceOverrideReason,
        };
      }),
      packagingGroups: order.packagingGroups.map((group, index) => {
        const quote = packaging.groups[index];
        if (!quote || quote.groupKey !== group.id) {
          throw new OrderPricingReviewError(
            `包装组 ${group.sequence} 报价结果与工单不一致`,
          );
        }
        return {
          packagingGroupId: group.id,
          sequence: group.sequence,
          name: group.name,
          mode: group.mode,
          actualBagCount: group.actualBagCount,
          complete: quote.complete,
          errors: quote.errors,
          currentUnitPrice: money(group.unitPrice, 4)!,
          currentSubtotal: money(group.subtotal)!,
          suggestedUnitPrice: quote.suggestedUnitPrice,
          suggestedSubtotal: quote.suggestedSubtotal,
          currentReason: group.priceOverrideReason,
        };
      }),
      shipments: logistics.quote.shipments.map((quotedShipment) => {
        const shipment = shipmentBySequence.get(quotedShipment.shipmentKey);
        if (!shipment) {
          throw new OrderPricingReviewError("物流报价与工单发货地址不一致");
        }
        const fact = facts.find(
          (candidate) => candidate.shipmentKey === quotedShipment.shipmentKey,
        )!;
        const shipping = currentChargeByKey.get(
          `SHIPMENT:${quotedShipment.shipmentKey}:SHIPPING_FEE`,
        );
        const packaging = currentChargeByKey.get(
          `SHIPMENT:${quotedShipment.shipmentKey}:PACKING_MATERIAL`,
        );
        return {
          shipmentId: shipment.id,
          sequence: shipment.sequence,
          destinationProvince: fact.province,
          billableWeightKg: quotedBillableWeightKg(
            quotedShipment.shipping.basis,
          ),
          itemQuantity: fact.itemQuantity,
          shipping: {
            complete: quotedShipment.shipping.complete,
            waived: quotedShipment.shipping.waived,
            advisory: quotedShipment.shipping.advisory,
            suggestedAmount: quotedShipment.shipping.amount,
            errors: quotedShipment.shipping.errors,
            currentAmount: money(shipping?.amount),
          },
          packaging: {
            complete: quotedShipment.packaging.complete,
            waived: quotedShipment.packaging.waived,
            advisory: quotedShipment.packaging.advisory,
            suggestedAmount: quotedShipment.packaging.amount,
            errors: quotedShipment.packaging.errors,
            currentAmount: money(packaging?.amount),
          },
          currentReason:
            packaging?.overrideReason ?? shipping?.overrideReason ?? null,
        };
      }),
    };
  });
}

export async function finalizeOrderPricing(
  input: FinalizeOrderPricingCommand,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{
  orderId: string;
  priceRevision: number;
  packagingAmount: string;
  processingAmount: string;
  totalAmount: string;
  processingPriceBookVersion: number;
  logisticsPriceBookVersion: number;
}> {
  assertAdmin(actor);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.orderId,
    )}))`;

    const order = await readPricingOrder(tx, input.orderId);
    if (!order) throw new OrderPricingReviewError("工单不存在");
    assertReviewable(order);
    if (order.priceRevision !== input.expectedPriceRevision) {
      throw new OrderPricingReviewError(
        "工单价格已被其他人更新，请刷新后重新核对",
      );
    }
    if (order.revision !== input.expectedOrderRevision) {
      throw new OrderPricingReviewError(
        "工单款式、数量或发货信息已变更，请刷新并按最新事实重新核价",
      );
    }

    const manualByItemId = new Map<
      string,
      FinalizeOrderPricingCommand["items"][number]
    >();
    for (const submitted of input.items) {
      if (manualByItemId.has(submitted.itemId)) {
        throw new OrderPricingReviewError("同一款式不能重复提交终价");
      }
      manualByItemId.set(submitted.itemId, submitted);
    }
    if (
      [...manualByItemId.keys()].some(
        (itemId) => !order.items.some((item) => item.id === itemId),
      )
    ) {
      throw new OrderPricingReviewError("终价明细包含不属于该工单的款式");
    }

    const submittedByPackagingGroupId = new Map<
      string,
      FinalizeOrderPricingCommand["packagingGroups"][number]
    >();
    for (const submitted of input.packagingGroups) {
      if (submittedByPackagingGroupId.has(submitted.packagingGroupId)) {
        throw new OrderPricingReviewError("同一包装组不能重复提交终价");
      }
      submittedByPackagingGroupId.set(submitted.packagingGroupId, submitted);
    }
    if (
      submittedByPackagingGroupId.size !== order.packagingGroups.length ||
      order.packagingGroups.some(
        (group) => !submittedByPackagingGroupId.has(group.id),
      )
    ) {
      throw new OrderPricingReviewError("请完整确认每一个包装组的入袋费");
    }
    for (const group of order.packagingGroups) {
      const submitted = submittedByPackagingGroupId.get(group.id)!;
      if (
        submitted.expectedMode !== group.mode ||
        submitted.expectedActualBagCount !== group.actualBagCount
      ) {
        throw new OrderPricingReviewError(
          `包装组 ${group.sequence} 的模式或实际袋数已变更，请刷新后重新核价`,
        );
      }
    }

    const quotes = await quoteHistoricalOrderItems(order, now, tx);
    const processingPriceBook = processingBookFromQuotes(quotes);
    if (!processingPriceBook || processingPriceBook.version < 1) {
      throw new OrderPricingReviewError(
        "当前没有生效的外部销售加工费价目簿，不能确认终价",
      );
    }
    const packagingQuote = await quoteOrderPackagingGroups(
      packagingGroupFacts(order),
      OrderSettlementType.EXTERNAL_SALES,
      now,
      tx,
      { snapshotLockHeld: true },
    );
    if (
      packagingQuote.priceBook &&
      packagingQuote.priceBook.id !== processingPriceBook.id
    ) {
      throw new OrderPricingReviewError(
        "款式与包装组未使用同一个加工费价目版本，请刷新后重试",
      );
    }

    const repricedItems = order.items.map((item, index) => {
      const quote = quotes[index]!;
      let unitPrice: Decimal;
      let fixedFee: Decimal;
      let reason: string | null = null;
      if (quote.complete) {
        if (
          quote.suggestedUnitPrice === null ||
          quote.suggestedFixedFee === null ||
          quote.suggestedSubtotal === null
        ) {
          throw new OrderPricingReviewError(
            `款式“${item.name}”的自动报价快照不完整`,
          );
        }
        unitPrice = new Decimal(quote.suggestedUnitPrice);
        fixedFee = new Decimal(quote.suggestedFixedFee);
      } else {
        const manual = manualByItemId.get(item.id);
        unitPrice = parseManualMoney(
          manual?.unitPrice,
          `款式“${item.name}”的客户单价`,
          DECIMAL_10_4_MAX,
          4,
        );
        fixedFee = parseManualMoney(
          manual?.fixedFee,
          `款式“${item.name}”的一次性费用`,
          DECIMAL_12_2_MAX,
          2,
        );
        reason = manual?.reason?.trim() ?? "";
        if (!reason) {
          throw new OrderPricingReviewError(
            `款式“${item.name}”无法自动报价，请填写管理员定价依据`,
          );
        }
      }
      const subtotal = unitPrice
        .times(item.quantity)
        .plus(fixedFee)
        .toDecimalPlaces(2);
      if (subtotal.gt(DECIMAL_12_2_MAX)) {
        throw new OrderPricingReviewError(
          `款式“${item.name}”的小计超出系统允许范围`,
        );
      }
      return {
        item,
        quote,
        unitPrice: unitPrice.toFixed(4),
        fixedFee: fixedFee.toFixed(2),
        subtotal: subtotal.toFixed(2),
        reason,
        snapshot: {
          ...quote.snapshot,
          source: "ADMIN_FULL_REPRICE",
          quotedAt: now.toISOString(),
          previousPriceRevision: order.priceRevision,
          actual: {
            unitPrice: unitPrice.toFixed(4),
            fixedFee: fixedFee.toFixed(2),
            subtotal: subtotal.toFixed(2),
            overrideReason: reason,
            provisional: false,
            automatic: quote.complete,
          },
        } as Prisma.InputJsonObject,
      };
    });

    const repricedPackagingGroups = order.packagingGroups.map((group, index) => {
      const quote = packagingQuote.groups[index];
      if (!quote || quote.groupKey !== group.id) {
        throw new OrderPricingReviewError(
          `包装组 ${group.sequence} 报价结果与工单不一致`,
        );
      }
      let unitPrice: Decimal;
      let reason: string | null = null;
      if (quote.complete) {
        if (
          quote.suggestedUnitPrice === null ||
          quote.suggestedSubtotal === null
        ) {
          throw new OrderPricingReviewError(
            `包装组 ${group.sequence} 的自动报价快照不完整`,
          );
        }
        unitPrice = new Decimal(quote.suggestedUnitPrice);
      } else {
        const manual = submittedByPackagingGroupId.get(group.id);
        unitPrice = parseManualMoney(
          manual?.unitPrice,
          `包装组 ${group.sequence} 的每袋入袋费`,
          DECIMAL_10_4_MAX,
          4,
        );
        reason = manual?.reason?.trim() ?? "";
        if (!reason) {
          throw new OrderPricingReviewError(
            `包装组 ${group.sequence} 无法自动报价，请填写管理员定价依据`,
          );
        }
      }
      const subtotal = unitPrice
        .times(group.actualBagCount)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (subtotal.gt(DECIMAL_12_2_MAX)) {
        throw new OrderPricingReviewError(
          `包装组 ${group.sequence} 的入袋费小计超出系统允许范围`,
        );
      }
      return {
        group,
        quote,
        unitPrice: unitPrice.toFixed(4),
        subtotal: subtotal.toFixed(2),
        reason,
        snapshot: {
          ...quote.snapshot,
          source: "ADMIN_FULL_REPRICE",
          quotedAt: now.toISOString(),
          previousPriceRevision: order.priceRevision,
          actual: {
            unitPrice: unitPrice.toFixed(4),
            subtotal: subtotal.toFixed(2),
            overrideReason: reason,
            provisional: false,
            automatic: quote.complete,
          },
        } as Prisma.InputJsonObject,
      };
    });

    const submittedByShipmentId = new Map<
      string,
      FinalizeOrderPricingCommand["shipments"][number]
    >();
    for (const submitted of input.shipments) {
      if (submittedByShipmentId.has(submitted.shipmentId)) {
        throw new OrderPricingReviewError("同一发货地址不能重复提交收费");
      }
      submittedByShipmentId.set(submitted.shipmentId, submitted);
    }
    if (
      submittedByShipmentId.size !== order.shipments.length ||
      order.shipments.some(
        (shipment) => !submittedByShipmentId.has(shipment.id),
      )
    ) {
      throw new OrderPricingReviewError(
        "请完整确认每一个发货地址的快递费和打包耗材费",
      );
    }
    const currentShipmentFacts = shipmentFacts(order);
    let latestLogisticsQuote: Awaited<
      ReturnType<typeof quoteExternalOrderChargesInTransaction>
    >;
    let logistics: Awaited<
      ReturnType<typeof resolveExternalOrderChargesForCreation>
    >;
    try {
      latestLogisticsQuote = await quoteExternalOrderChargesInTransaction(
        tx,
        { isSfCollect: order.isSfCollect, shipments: currentShipmentFacts },
        now,
        { snapshotLockHeld: true },
      );
      const quoteByShipmentKey = new Map(
        latestLogisticsQuote.quote.shipments.map((shipment) => [
          shipment.shipmentKey,
          shipment,
        ]),
      );
      for (const shipment of order.shipments) {
        const submitted = submittedByShipmentId.get(shipment.id)!;
        const quoted = quoteByShipmentKey.get(String(shipment.sequence));
        if (!quoted) {
          throw new OrderPricingReviewError("物流报价与工单发货地址不一致");
        }
        const currentWeight = quotedBillableWeightKg(quoted.shipping.basis);
        if (
          submitted.expectedDestinationProvince !==
            shipment.destinationProvince ||
          submitted.expectedBillableWeightKg !== currentWeight
        ) {
          throw new OrderPricingReviewError(
            `地址 ${shipment.sequence} 的计费省份或重量已变更，请刷新后按最新事实重新核价`,
          );
        }
      }
      logistics = await resolveExternalOrderChargesForCreation(
        tx,
        {
          isSfCollect: order.isSfCollect,
          shipments: order.shipments.map((shipment) => {
            const submitted = submittedByShipmentId.get(shipment.id)!;
            const fact = currentShipmentFacts.find(
              (candidate) =>
                candidate.shipmentKey === String(shipment.sequence),
            )!;
            const quoted = quoteByShipmentKey.get(String(shipment.sequence));
            if (!quoted) {
              throw new OrderPricingReviewError("物流报价与工单发货地址不一致");
            }
            return {
              ...fact,
              shippingFee:
                quoted.shipping.complete && !quoted.shipping.advisory
                  ? quoted.shipping.amount
                  : submitted.shippingFee,
              packingMaterialFee:
                quoted.packaging.complete && !quoted.packaging.advisory
                  ? quoted.packaging.amount
                  : submitted.packingMaterialFee,
              overrideReason: submitted.reason?.trim() || null,
            };
          }),
        },
        now,
        { snapshotLockHeld: true },
      );
    } catch (error) {
      if (error instanceof OrderCustomerChargeError) {
        throw new OrderPricingReviewError(error.message);
      }
      throw error;
    }

    const itemProcessingAmount = repricedItems
      .reduce((sum, item) => sum.plus(item.subtotal), new Decimal(0))
      .toFixed(2);
    const packagingAmount = repricedPackagingGroups
      .reduce((sum, group) => sum.plus(group.subtotal), new Decimal(0))
      .toFixed(2);
    const processingAmount = new Decimal(itemProcessingAmount)
      .plus(packagingAmount)
      .toFixed(2);
    const otherCustomerCharges = order.customerCharges
      .filter(
        (charge) =>
          !["SHIPPING_FEE", "PACKING_MATERIAL"].includes(
            String(charge.category.code),
          ),
      )
      .reduce(
        (sum, charge) => sum.plus(charge.amount.toString()),
        new Decimal(0),
      );
    const totalAmount = new Decimal(processingAmount)
      .plus(logistics.totalAmount)
      .plus(otherCustomerCharges)
      .toFixed(2);
    if (new Decimal(totalAmount).gt(DECIMAL_12_2_MAX)) {
      throw new OrderPricingReviewError("工单总额超出系统允许范围");
    }

    for (const repriced of repricedItems) {
      await tx.orderItem.update({
        where: { id: repriced.item.id },
        data: {
          unitPrice: repriced.unitPrice,
          fixedFee: repriced.fixedFee,
          subtotal: repriced.subtotal,
          suggestedSubtotal: repriced.quote.suggestedSubtotal,
          priceOverrideReason: repriced.reason,
          pricingSnapshot: repriced.snapshot,
        },
      });
    }
    for (const repriced of repricedPackagingGroups) {
      await tx.orderPackagingGroup.update({
        where: { id: repriced.group.id },
        data: {
          unitPrice: repriced.unitPrice,
          subtotal: repriced.subtotal,
          suggestedSubtotal: repriced.quote.suggestedSubtotal,
          priceOverrideReason: repriced.reason,
          pricingSnapshot: repriced.snapshot,
        },
      });
    }

    const shipmentIdByKey = new Map(
      order.shipments.map((shipment) => [
        String(shipment.sequence),
        shipment.id,
      ]),
    );
    const existingByBusinessKey = new Map(
      order.customerCharges.map((charge) => [
        String(charge.businessKey),
        charge,
      ]),
    );
    for (const charge of logistics.charges) {
      const shipmentId = shipmentIdByKey.get(charge.shipmentKey);
      if (!shipmentId) {
        throw new OrderPricingReviewError("物流收费与工单发货地址不一致");
      }
      const previous = existingByBusinessKey.get(charge.businessKey);
      const snapshot = {
        ...charge.pricingSnapshot,
        source: "ADMIN_FULL_REPRICE",
        previousPriceRevision: order.priceRevision,
        actual: {
          amount: charge.amount,
          overrideReason: charge.overrideReason,
          provisional: false,
          requiresAdminConfirmation: false,
        },
      } as Prisma.InputJsonObject;
      const isShipped = order.status === OrderStatus.SHIPPED;
      const persistedStatus =
        charge.status === OrderCustomerChargeStatus.WAIVED
          ? OrderCustomerChargeStatus.WAIVED
          : isShipped
            ? OrderCustomerChargeStatus.FINAL
            : charge.status;
      const shouldFinalize =
        isShipped || persistedStatus === OrderCustomerChargeStatus.WAIVED;
      const data = {
        shipmentId,
        categoryId: charge.categoryId,
        priceBookId: charge.priceBookId,
        sourceRuleId: charge.sourceRuleId,
        status: persistedStatus,
        description: charge.description,
        quantity: charge.quantity,
        unit: charge.unit,
        unitPrice: null,
        suggestedAmount: charge.suggestedAmount,
        amount: charge.amount,
        pricingSnapshot: snapshot,
        overrideReason: charge.overrideReason,
        finalizedById: shouldFinalize ? actor.id : null,
        finalizedAt: shouldFinalize ? now : null,
      };
      if (previous) {
        await tx.orderCustomerCharge.update({
          where: { id: previous.id },
          data,
          select: { id: true },
        });
      } else {
        await tx.orderCustomerCharge.create({
          data: {
            orderId: order.id,
            businessKey: charge.businessKey,
            createdById: actor.id,
            ...data,
          },
          select: { id: true },
        });
      }
    }

    const orderModel = tx.order as unknown as {
      update(args: unknown): Promise<{ id: string }>;
    };
    await orderModel.update({
      where: { id: order.id },
      data: {
        packagingAmount,
        processingAmount,
        totalAmount,
      },
      select: { id: true },
    });
    await tx.orderChangeRequest.updateMany({
      where: {
        orderId: order.id,
        status: OrderChangeRequestStatus.PENDING,
      },
      data: {
        status: OrderChangeRequestStatus.STALE,
        reviewedById: actor.id,
        reviewedAt: now,
        reviewRemark: "工单终价已整单重算，原修改请求基线已过期",
      },
    });

    const revision = await appendOrderPricingRevisionInTx(tx, {
      orderId: order.id,
      status: ORDER_PRICING_STATUS.ADMIN_CONFIRMED,
      source: "ADMIN_FULL_REPRICE",
      actorId: actor.id,
      now,
      expectedPriceRevision: order.priceRevision,
      incrementOrderRevision: true,
      remark: input.remark,
      metadata: {
        priceBooks: {
          processing: processingPriceBook,
          logistics: logistics.priceBook,
        },
        packagingAmount,
        logisticsAmount: logistics.totalAmount,
        otherCustomerChargeAmount: otherCustomerCharges.toFixed(2),
      },
    });
    const nextPriceRevision = revision.priceRevision;
    const nextOrderRevision = revision.orderRevision;
    await tx.orderLog.create({
      data: {
        orderId: order.id,
        operatorId: actor.id,
        action: "PRICING_ADMIN_CONFIRMED",
        changedFields: {
          pricingStatus: {
            before: order.pricingStatus,
            after: ORDER_PRICING_STATUS.ADMIN_CONFIRMED,
          },
          priceRevision: {
            before: order.priceRevision,
            after: nextPriceRevision,
          },
          revision: { before: order.revision, after: nextOrderRevision },
          processingAmount: {
            before: money(order.processingAmount),
            after: processingAmount,
          },
          packagingAmount: {
            before: money(order.packagingAmount),
            after: packagingAmount,
          },
          totalAmount: {
            before: money(order.totalAmount),
            after: totalAmount,
          },
          priceBooks: {
            before: null,
            after: {
              processing: {
                id: processingPriceBook.id,
                version: processingPriceBook.version,
              },
              logistics: {
                id: logistics.priceBook.id,
                version: logistics.priceBook.version,
              },
            },
          },
        },
        remark:
          input.remark?.trim() || "管理员按最新有效价目簿整单重算并确认终价",
      },
    });

    return {
      orderId: order.id,
      priceRevision: nextPriceRevision,
      packagingAmount,
      processingAmount,
      totalAmount,
      processingPriceBookVersion: processingPriceBook.version,
      logisticsPriceBookVersion: logistics.priceBook.version,
    };
  });
}
