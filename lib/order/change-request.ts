import Decimal from 'decimal.js';
import {
  CsSalesEntryType,
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderSettlementType,
  OrderStatus,
  Prisma,
  Role,
  TaskStatus,
} from '../../generated/prisma/client';
import type {
  CreateOrderChangeRequestInput,
  QuoteOrderItemsInput,
  ReviewOrderChangeRequestInput,
} from '../auth/schemas';
import { db } from '../db';
import {
  OrderCustomerChargeError,
  resolveExternalOrderChargesForFinalization,
} from '../price/order-charge-service';
import { quoteOrderItems } from '../price/quote-service';
import type { QuoteResult } from '../price/quote';
import {
  assertCsOrderSalesLedgerReconciledInTx,
  CsSalesLedgerError,
  recordCsSalesEntryInTx,
} from '../salary/cs-sales';
import { MAX_ORDER_ITEMS_PER_ORDER } from './limits';
import { orderCascadeLockKey } from './locks';

const CHANGEABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.SUBMITTED,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
];
const DECIMAL_12_2_MAX = new Decimal('9999999999.99');

export class OrderChangeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderChangeRequestError';
  }
}

function assertCanRequest(
  actor: { id: string; role: Role },
  order: { submitterId: string; status: OrderStatus },
): void {
  if (
    actor.role !== Role.SALES &&
    actor.role !== Role.CUSTOMER_SERVICE
  ) {
    throw new OrderChangeRequestError('只有销售和客服可以提交工单修改申请');
  }
  if (order.submitterId !== actor.id) {
    throw new OrderChangeRequestError('只能修改自己提交的工单');
  }
  if (!CHANGEABLE_ORDER_STATUSES.includes(order.status)) {
    throw new OrderChangeRequestError('工单已完工，不能再提交修改申请');
  }
}

/**
 * Records a proposal only. The live order remains unchanged until an ADMIN
 * approves it, so every client keeps seeing one authoritative revision.
 */
export async function createOrderChangeRequest(
  input: CreateOrderChangeRequestInput,
  actor: { id: string; role: Role },
) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
        input.orderId,
      )}))`;

      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          orderNo: true,
          submitterId: true,
          status: true,
          revision: true,
          items: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true,
              sequence: true,
              name: true,
              quantity: true,
              specification: true,
              foilColors: true,
            },
          },
          changeRequests: {
            where: { status: OrderChangeRequestStatus.PENDING },
            take: 1,
            select: { id: true },
          },
        },
      });
      if (!order) throw new OrderChangeRequestError('工单不存在');
      assertCanRequest(actor, order);
      if (order.changeRequests.length > 0) {
        throw new OrderChangeRequestError('该工单已有待审核申请，请等待管理员处理');
      }

      assertUniqueUpdateTargets(input.items);
      assertOrderItemLimit(order.items.length, input.items);
      const itemIds = new Set(order.items.map((item) => item.id));
      for (const change of input.items) {
        const referencedId =
          change.operation === 'UPDATE' ? change.itemId : change.templateItemId;
        if (!itemIds.has(referencedId)) {
          throw new OrderChangeRequestError('申请中包含不属于该工单的款式');
        }
      }

      return tx.orderChangeRequest.create({
        data: {
          orderId: order.id,
          requesterId: actor.id,
          baseRevision: order.revision,
          reason: input.reason,
          beforeSnapshot: {
            orderNo: order.orderNo,
            revision: order.revision,
            status: order.status,
            items: order.items,
          },
          proposedChanges: { items: input.items },
        },
        include: {
          requester: { select: { displayName: true } },
          order: { select: { orderNo: true } },
        },
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new OrderChangeRequestError('该工单已有待审核申请，请勿重复提交');
    }
    throw error;
  }
}

type ProposedItemChange = CreateOrderChangeRequestInput['items'][number];

function assertUniqueUpdateTargets(changes: ProposedItemChange[]): void {
  const updatedItemIds = new Set<string>();
  for (const change of changes) {
    if (change.operation !== 'UPDATE') continue;
    if (updatedItemIds.has(change.itemId)) {
      throw new OrderChangeRequestError(
        '同一款式不能重复提交修改',
      );
    }
    updatedItemIds.add(change.itemId);
  }
}

function assertOrderItemLimit(
  existingItemCount: number,
  changes: ProposedItemChange[],
): void {
  const addedItemCount = changes.reduce(
    (count, change) => count + (change.operation === 'ADD' ? 1 : 0),
    0,
  );
  if (existingItemCount + addedItemCount > MAX_ORDER_ITEMS_PER_ORDER) {
    throw new OrderChangeRequestError(
      `单工单款式不超过 ${MAX_ORDER_ITEMS_PER_ORDER} 项（当前 ${existingItemCount} 项，本次新增 ${addedItemCount} 项）`,
    );
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  if (leftSet.size !== new Set(right).size) return false;
  return right.every((value) => leftSet.has(value));
}

function readProposedChanges(value: Prisma.JsonValue): ProposedItemChange[] {
  const parsed = value as { items?: ProposedItemChange[] } | null;
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new OrderChangeRequestError('申请数据已损坏，无法审核');
  }
  assertUniqueUpdateTargets(parsed.items);
  return parsed.items;
}

type CarriedPrice = {
  unitPrice: Prisma.Decimal;
  fixedFee: Prisma.Decimal;
  pricingSnapshot: Prisma.JsonValue | null;
};

function resolveChangeRequestPricing(input: {
  quote: QuoteResult;
  carry: CarriedPrice;
  quantity: number;
  itemName: string;
  requestId: string;
  quotedAt: Date;
  reviewRemark: string | null;
}): {
  unitPrice: string;
  fixedFee: string;
  subtotal: string;
  suggestedSubtotal: string | null;
  pricingSnapshot: Prisma.InputJsonObject;
  priceOverrideReason: string | null;
} {
  const {
    quote,
    carry,
    quantity,
    itemName,
    requestId,
    quotedAt,
    reviewRemark,
  } = input;

  if (quote.complete) {
    if (
      quote.suggestedUnitPrice === null ||
      quote.suggestedFixedFee === null ||
      quote.suggestedSubtotal === null
    ) {
      throw new OrderChangeRequestError(
        `款式“${itemName}”报价结果不完整，无法批准修改`,
      );
    }
    const subtotal = storableOrderSubtotal(
      new Prisma.Decimal(quote.suggestedUnitPrice),
      new Prisma.Decimal(quote.suggestedFixedFee),
      quantity,
      itemName,
    );
    if (!new Decimal(subtotal).equals(quote.suggestedSubtotal)) {
      throw new OrderChangeRequestError(
        `款式“${itemName}”报价分项与小计无法对平，请检查价格规则`,
      );
    }
    return {
      unitPrice: quote.suggestedUnitPrice,
      fixedFee: quote.suggestedFixedFee,
      subtotal,
      suggestedSubtotal: quote.suggestedSubtotal,
      pricingSnapshot: {
        ...quote.snapshot,
        source: 'CHANGE_REQUEST_REQUOTE',
        requestId,
        quotedAt: quotedAt.toISOString(),
        actual: {
          quantity,
          unitPrice: quote.suggestedUnitPrice,
          fixedFee: quote.suggestedFixedFee,
          subtotal,
          overrideReason: null,
        },
      } satisfies Prisma.InputJsonObject,
      priceOverrideReason: null,
    };
  }

  if (!reviewRemark) {
    const details = quote.errors.join('；');
    throw new OrderChangeRequestError(
      `款式“${itemName}”无法按当前规则报价${details ? `：${details}` : ''}；如确认沿用原成交价，请填写审核备注`,
    );
  }

  const unitPrice = carry.unitPrice.toString();
  const fixedFee = carry.fixedFee.toString();
  const subtotal = storableOrderSubtotal(
    carry.unitPrice,
    carry.fixedFee,
    quantity,
    itemName,
  );
  return {
    unitPrice,
    fixedFee,
    subtotal,
    suggestedSubtotal: null,
    pricingSnapshot: {
      ...quote.snapshot,
      source: 'CHANGE_REQUEST_PRICE_CARRY_FORWARD',
      requestId,
      quotedAt: quotedAt.toISOString(),
      previousSnapshot: (carry.pricingSnapshot ?? {}) as Prisma.InputJsonValue,
      actual: {
        quantity,
        unitPrice,
        fixedFee,
        subtotal,
        overrideReason: reviewRemark,
      },
    } satisfies Prisma.InputJsonObject,
    priceOverrideReason: reviewRemark,
  };
}

function storableOrderSubtotal(
  unitPrice: Prisma.Decimal,
  fixedFee: Prisma.Decimal | undefined,
  quantity: number,
  itemName: string,
): string {
  const subtotal = new Decimal(unitPrice)
    .times(quantity)
    .plus(fixedFee ?? 0)
    .toDecimalPlaces(2);
  if (!subtotal.isFinite() || subtotal.isNegative() || subtotal.gt(DECIMAL_12_2_MAX)) {
    throw new OrderChangeRequestError(
      `款式“${itemName}”金额超过可保存上限 9,999,999,999.99 元`,
    );
  }
  return subtotal.toFixed(2);
}

function orderTotal(items: Array<{ subtotal: Prisma.Decimal }>): string {
  const total = items.reduce(
    (sum, item) => sum.plus(item.subtotal),
    new Decimal(0),
  );
  if (!total.isFinite() || total.isNegative() || total.gt(DECIMAL_12_2_MAX)) {
    throw new OrderChangeRequestError(
      '工单总额超过可保存上限 9,999,999,999.99 元',
    );
  }
  return total.toFixed(2);
}

const LOGISTICS_REPRICE_REASON_PLACEHOLDER =
  '工单修改收费重算：等待审核原因校验';

type LogisticsProjectionShipment = {
  id: string;
  sequence: number;
  destinationProvince: string | null;
  quotedWeightKg: Prisma.Decimal | null;
  weightKg: Prisma.Decimal | null;
};

type LogisticsProjectionItem = {
  id: string;
  quantity: number;
  shipmentLines: Array<{
    quantity: number;
    shipment: { id: string; sequence: number };
  }>;
};

type LogisticsProjectionCharge = {
  id: string;
  shipmentId: string | null;
  businessKey: string;
  priceBookId: string | null;
  amount: Prisma.Decimal;
  overrideReason: string | null;
  category: { code: string };
};

function projectShipmentItemQuantities(input: {
  shipments: LogisticsProjectionShipment[];
  items: LogisticsProjectionItem[];
  changes: ProposedItemChange[];
  primaryShipmentId: string;
}): Map<string, number> {
  const totals = new Map(
    input.shipments.map((shipment) => [shipment.id, 0]),
  );
  const itemById = new Map(input.items.map((item) => [item.id, item]));

  for (const item of input.items) {
    for (const line of item.shipmentLines) {
      const current = totals.get(line.shipment.id);
      if (current === undefined) {
        throw new OrderChangeRequestError(
          '工单的款式分货记录与收货地址不一致',
        );
      }
      totals.set(line.shipment.id, current + line.quantity);
    }
  }

  for (const change of input.changes) {
    if (change.operation === 'ADD') {
      totals.set(
        input.primaryShipmentId,
        (totals.get(input.primaryShipmentId) ?? 0) + change.quantity,
      );
      continue;
    }
    if (change.quantity === undefined) continue;
    const item = itemById.get(change.itemId);
    if (!item) throw new OrderChangeRequestError('原款式已不存在，请重新申请');
    totals.set(
      input.primaryShipmentId,
      (totals.get(input.primaryShipmentId) ?? 0) +
        change.quantity -
        item.quantity,
    );
  }

  for (const [shipmentId, quantity] of totals) {
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new OrderChangeRequestError(
        `收货地址 ${shipmentId} 的分货数量非法，无法刷新物流收费`,
      );
    }
  }
  return totals;
}

function refreshedChargeSnapshot(
  snapshot: Prisma.InputJsonObject,
  input: {
    requestId: string;
    reviewedAt: Date;
    amount: string;
    overrideReason: string | null;
  },
): Prisma.InputJsonObject {
  const rawActual = snapshot.actual;
  const actual =
    rawActual && typeof rawActual === 'object' && !Array.isArray(rawActual)
      ? rawActual
      : {};
  return {
    ...snapshot,
    actual: {
      ...actual,
      amount: input.amount,
      overrideReason: input.overrideReason,
    },
    changeRequestRefresh: {
      requestId: input.requestId,
      reviewedAt: input.reviewedAt.toISOString(),
    },
  } satisfies Prisma.InputJsonObject;
}

async function refreshExternalLogisticsChargesAfterQuantityChange(input: {
  client: Prisma.TransactionClient;
  requestId: string;
  reviewedAt: Date;
  reviewRemark: string | null;
  isSfCollect: boolean;
  shipments: LogisticsProjectionShipment[];
  items: LogisticsProjectionItem[];
  changes: ProposedItemChange[];
  primaryShipmentId: string;
  customerCharges: LogisticsProjectionCharge[];
}): Promise<void> {
  const standardCharges = input.customerCharges.filter((charge) =>
    ['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(
      String(charge.category.code),
    ),
  );
  if (standardCharges.length !== input.shipments.length * 2) {
    throw new OrderChangeRequestError(
      '外部销售工单的快递/耗材收费明细不完整，无法批准数量修改',
    );
  }
  const priceBookIds = [
    ...new Set(
      standardCharges.flatMap((charge) =>
        charge.priceBookId ? [charge.priceBookId] : [],
      ),
    ),
  ];
  if (priceBookIds.length !== 1) {
    throw new OrderChangeRequestError(
      '快递/耗材收费未绑定唯一冻结价目簿，无法批准数量修改',
    );
  }

  const chargeByShipmentAndCategory = new Map(
    standardCharges.map((charge) => [
      `${charge.shipmentId}:${String(charge.category.code)}`,
      charge,
    ]),
  );
  const itemQuantityByShipmentId = projectShipmentItemQuantities({
    shipments: input.shipments,
    items: input.items,
    changes: input.changes,
    primaryShipmentId: input.primaryShipmentId,
  });

  let refreshed: Awaited<
    ReturnType<typeof resolveExternalOrderChargesForFinalization>
  >;
  try {
    refreshed = await resolveExternalOrderChargesForFinalization(
      input.client,
      {
        isSfCollect: input.isSfCollect,
        shipments: input.shipments.map((shipment) => {
          const shipping = chargeByShipmentAndCategory.get(
            `${shipment.id}:SHIPPING_FEE`,
          );
          const packaging = chargeByShipmentAndCategory.get(
            `${shipment.id}:PACKING_MATERIAL`,
          );
          if (!shipping || !packaging) {
            throw new OrderChangeRequestError(
              `收货地址 ${shipment.sequence} 缺少快递费或打包耗材费明细`,
            );
          }
          return {
            shipmentKey: String(shipment.sequence),
            province: shipment.destinationProvince,
            billableWeightKg:
              shipment.weightKg?.toString() ??
              shipment.quotedWeightKg?.toString() ??
              null,
            itemQuantity: itemQuantityByShipmentId.get(shipment.id) ?? 0,
            shippingFee: shipping.amount.toString(),
            packingMaterialFee: packaging.amount.toString(),
            // The resolver validates incomplete/different quotes. Use a
            // temporary value here, then enforce each charge's own historical
            // reason below so one line can never borrow the other's reason.
            overrideReason:
              input.reviewRemark ??
              shipping.overrideReason?.trim() ??
              packaging.overrideReason?.trim() ??
              LOGISTICS_REPRICE_REASON_PLACEHOLDER,
          };
        }),
      },
      priceBookIds[0]!,
      input.reviewedAt,
    );
  } catch (error) {
    if (error instanceof OrderCustomerChargeError) {
      throw new OrderChangeRequestError(error.message);
    }
    throw error;
  }

  const existingByBusinessKey = new Map(
    standardCharges.map((charge) => [String(charge.businessKey), charge]),
  );
  const updatePlans = refreshed.charges.map((charge) => {
    const existing = existingByBusinessKey.get(charge.businessKey);
    if (!existing) {
      throw new OrderChangeRequestError(
        `找不到收费明细 ${charge.businessKey}，无法刷新物流收费`,
      );
    }
    const actualAmount = new Decimal(existing.amount);
    const differsFromSuggestion =
      charge.suggestedAmount === null ||
      !actualAmount.equals(charge.suggestedAmount);
    const historicalReason = existing.overrideReason?.trim() || null;
    const auditReason =
      historicalReason ??
      (differsFromSuggestion ? input.reviewRemark : null);
    if (differsFromSuggestion && !auditReason) {
      throw new OrderChangeRequestError(
        `${charge.description}的已确认金额 ${actualAmount.toFixed(2)} 元与修改后建议金额${
          charge.suggestedAmount === null
            ? '无法自动报价'
            : ` ${charge.suggestedAmount} 元`
        }不同，请填写审核备注作为审计原因`,
      );
    }
    return {
      charge,
      existing,
      actualAmount: actualAmount.toFixed(2),
      auditReason,
    };
  });

  for (const plan of updatePlans) {
    await input.client.orderCustomerCharge.update({
      where: { id: plan.existing.id },
      data: {
        categoryId: plan.charge.categoryId,
        sourceRuleId: plan.charge.sourceRuleId,
        description: plan.charge.description,
        quantity: plan.charge.quantity,
        unit: plan.charge.unit,
        suggestedAmount: plan.charge.suggestedAmount,
        pricingSnapshot: refreshedChargeSnapshot(
          plan.charge.pricingSnapshot,
          {
            requestId: input.requestId,
            reviewedAt: input.reviewedAt,
            amount: plan.actualAmount,
            overrideReason: plan.auditReason,
          },
        ),
        overrideReason: plan.auditReason,
      },
    });
  }
}

type PricingProjectionItem = {
  id: string;
  name: string;
  productId: string | null;
  specification: string | null;
  paperType: string | null;
  quantity: number;
  crafts: string[];
  foilColors: string[];
  isDoubleSided: boolean;
  isDoubleColor: boolean;
  unitPrice: Prisma.Decimal;
  fixedFee: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  pricingSnapshot: Prisma.JsonValue | null;
};

type ChangeQuoteContext = {
  changeIndex: number;
  operation: 'UPDATE' | 'ADD';
  sourceItemId: string;
  itemName: string;
  quantity: number;
  oldSubtotal: string | null;
  carry: CarriedPrice;
  quote: QuoteResult;
};

async function quotePricingAffectingChanges(input: {
  changes: ProposedItemChange[];
  itemById: ReadonlyMap<string, PricingProjectionItem>;
  settlementType: OrderSettlementType;
  quotedAt: Date;
  client: Prisma.TransactionClient;
}): Promise<ChangeQuoteContext[]> {
  const quoteInputs: QuoteOrderItemsInput['items'] = [];
  const contexts: Array<Omit<ChangeQuoteContext, 'quote'>> = [];

  for (const [changeIndex, change] of input.changes.entries()) {
    if (change.operation === 'UPDATE') {
      const item = input.itemById.get(change.itemId);
      if (!item) throw new OrderChangeRequestError('原款式已不存在，请重新申请');

      const quantity = change.quantity ?? item.quantity;
      const specification =
        change.specification !== undefined
          ? change.specification
          : item.specification;
      const foilColors = change.foilColors ?? item.foilColors;
      const needsRequote =
        quantity !== item.quantity ||
        specification !== item.specification ||
        !sameStringSet(foilColors, item.foilColors);
      if (!needsRequote) continue;

      quoteInputs.push({
        productId: item.productId,
        specification,
        paperType: item.paperType,
        quantity,
        crafts: item.crafts,
        foilColors,
        isDoubleSided: item.isDoubleSided,
        isDoubleColor: item.isDoubleColor,
      });
      contexts.push({
        changeIndex,
        operation: change.operation,
        sourceItemId: item.id,
        carry: {
          unitPrice: item.unitPrice,
          fixedFee: item.fixedFee,
          pricingSnapshot: item.pricingSnapshot,
        },
        quantity,
        itemName: change.name ?? item.name,
        oldSubtotal: new Decimal(item.subtotal).toFixed(2),
      });
      continue;
    }

    const template = input.itemById.get(change.templateItemId);
    if (!template) throw new OrderChangeRequestError('参考款式已不存在，请重新申请');
    const foilColors = change.foilColors ?? template.foilColors;
    quoteInputs.push({
      productId: template.productId,
      specification: change.specification ?? template.specification,
      paperType: template.paperType,
      quantity: change.quantity,
      crafts: template.crafts,
      foilColors,
      isDoubleSided: template.isDoubleSided,
      isDoubleColor: template.isDoubleColor,
    });
    contexts.push({
      changeIndex,
      operation: change.operation,
      sourceItemId: template.id,
      carry: {
        unitPrice: template.unitPrice,
        fixedFee: template.fixedFee,
        pricingSnapshot: template.pricingSnapshot,
      },
      quantity: change.quantity,
      itemName: change.name,
      oldSubtotal: null,
    });
  }

  if (quoteInputs.length === 0) return [];
  const quotes = await quoteOrderItems(
    quoteInputs,
    input.settlementType,
    input.quotedAt,
    input.client,
    {
      orderItemCount:
        input.itemById.size +
        input.changes.filter((change) => change.operation === 'ADD').length,
    },
  );
  if (quotes.length !== contexts.length) {
    throw new OrderChangeRequestError('工单报价结果数量不一致，无法处理修改申请');
  }
  return contexts.map((context, index) => {
    const quote = quotes[index];
    if (!quote) {
      throw new OrderChangeRequestError('工单报价结果缺失，无法处理修改申请');
    }
    return { ...context, quote };
  });
}

type QuantityGuardItem = {
  name: string;
  tasks: Array<{ status: TaskStatus }>;
  shipmentLines: Array<{
    quantity: number;
    shipment: { sequence: number };
  }>;
};

function assertQuantityChangeAllowed(
  item: QuantityGuardItem,
  nextQuantity: number,
): number {
  const hasStartedTask = item.tasks.some(
    (task) =>
      task.status === TaskStatus.IN_PROGRESS ||
      task.status === TaskStatus.COMPLETED,
  );
  if (hasStartedTask) {
    throw new OrderChangeRequestError(
      `款式“${item.name}”已有开工或完工记录，不能再修改数量`,
    );
  }
  const extraShipmentQty = item.shipmentLines
    .filter((line) => line.shipment.sequence > 1)
    .reduce((sum, line) => sum + line.quantity, 0);
  if (nextQuantity < extraShipmentQty) {
    throw new OrderChangeRequestError(
      `款式“${item.name}”的新数量不能少于多地址已分配数量 ${extraShipmentQty}`,
    );
  }
  return extraShipmentQty;
}

export type OrderChangePricingPreviewItem = {
  changeIndex: number;
  operation: 'UPDATE' | 'ADD';
  sourceItemId: string;
  previousName: string | null;
  name: string;
  quantity: number;
  priceImpact: 'UNCHANGED' | 'QUOTED' | 'INCOMPLETE';
  oldSubtotal: string | null;
  newSubtotal: string | null;
  suggestedUnitPrice: string | null;
  suggestedFixedFee: string | null;
  errors: string[];
};

export type OrderChangePricingPreview = {
  requestId: string;
  orderId: string;
  baseRevision: number;
  quotedAt: string;
  complete: boolean;
  requiresReviewRemark: boolean;
  oldTotal: string;
  newTotal: string | null;
  delta: string | null;
  items: OrderChangePricingPreviewItem[];
};

/**
 * Read-only approval preview. It deliberately uses the same merged business
 * facts and quote service as approval, but its amounts are informational:
 * approval always repeats the quote under the order lock in its own write
 * transaction and never accepts prices from this result.
 */
export async function previewOrderChangeRequestPricing(
  requestId: string,
  actor: { id: string; role: Role },
): Promise<OrderChangePricingPreview> {
  if (actor.role !== Role.ADMIN) {
    throw new OrderChangeRequestError('只有管理员可以预览工单修改计价');
  }

  const locator = await db.orderChangeRequest.findUnique({
    where: { id: requestId },
    select: { orderId: true },
  });
  if (!locator) throw new OrderChangeRequestError('修改申请不存在');

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;
    const request = await tx.orderChangeRequest.findUnique({
      where: { id: requestId },
      include: {
        order: {
          include: {
            items: {
              orderBy: { sequence: 'asc' },
              include: {
                tasks: true,
                shipmentLines: {
                  include: {
                    shipment: { select: { id: true, sequence: true } },
                  },
                },
              },
            },
            shipments: {
              orderBy: { sequence: 'asc' },
              select: { id: true, sequence: true },
            },
          },
        },
      },
    });
    if (!request) throw new OrderChangeRequestError('修改申请不存在');
    if (request.status !== OrderChangeRequestStatus.PENDING) {
      throw new OrderChangeRequestError('该申请已经处理，无需再预览计价');
    }
    if (request.baseRevision !== request.order.revision) {
      throw new OrderChangeRequestError(
        `工单已从第 ${request.baseRevision} 版更新到第 ${request.order.revision} 版，请重新提交申请`,
      );
    }
    if (!CHANGEABLE_ORDER_STATUSES.includes(request.order.status)) {
      throw new OrderChangeRequestError('工单已完工，不能批准修改');
    }

    const changes = readProposedChanges(request.proposedChanges);
    const itemById = new Map(request.order.items.map((item) => [item.id, item]));
    if (!request.order.shipments.some((shipment) => shipment.sequence === 1)) {
      throw new OrderChangeRequestError('工单缺少主收货地址，不能安全更新数量');
    }
    for (const change of changes) {
      if (change.operation !== 'UPDATE' || change.quantity === undefined) {
        continue;
      }
      const item = itemById.get(change.itemId);
      if (!item) throw new OrderChangeRequestError('原款式已不存在，请重新申请');
      if (change.quantity !== item.quantity) {
        assertQuantityChangeAllowed(item, change.quantity);
      }
    }

    const quotedAt = new Date();
    const quoteContexts = await quotePricingAffectingChanges({
      changes,
      itemById,
      settlementType: request.order.settlementType,
      quotedAt,
      client: tx,
    });
    const contextByChangeIndex = new Map(
      quoteContexts.map((context) => [context.changeIndex, context]),
    );
    // Start from the full receivable so external shipping/packing charges stay
    // intact while item subtotals are replaced below.
    let projectedTotal = new Decimal(request.order.totalAmount);
    let complete = true;
    const items: OrderChangePricingPreviewItem[] = changes.map(
      (change, changeIndex) => {
        const context = contextByChangeIndex.get(changeIndex);
        if (change.operation === 'UPDATE') {
          const item = itemById.get(change.itemId);
          if (!item) {
            throw new OrderChangeRequestError('原款式已不存在，请重新申请');
          }
          if (!context) {
            const subtotal = new Decimal(item.subtotal).toFixed(2);
            return {
              changeIndex,
              operation: change.operation,
              sourceItemId: item.id,
              previousName: item.name,
              name: change.name ?? item.name,
              quantity: change.quantity ?? item.quantity,
              priceImpact: 'UNCHANGED',
              oldSubtotal: subtotal,
              newSubtotal: subtotal,
              suggestedUnitPrice: null,
              suggestedFixedFee: null,
              errors: [],
            };
          }
          if (!context.quote.complete) {
            complete = false;
            return {
              changeIndex,
              operation: change.operation,
              sourceItemId: item.id,
              previousName: item.name,
              name: context.itemName,
              quantity: context.quantity,
              priceImpact: 'INCOMPLETE',
              oldSubtotal: context.oldSubtotal,
              newSubtotal: null,
              suggestedUnitPrice: null,
              suggestedFixedFee: null,
              errors: context.quote.errors,
            };
          }
          const pricing = resolveChangeRequestPricing({
            quote: context.quote,
            carry: context.carry,
            quantity: context.quantity,
            itemName: context.itemName,
            requestId: request.id,
            quotedAt,
            reviewRemark: null,
          });
          projectedTotal = projectedTotal
            .minus(item.subtotal)
            .plus(pricing.subtotal);
          return {
            changeIndex,
            operation: change.operation,
            sourceItemId: item.id,
            previousName: item.name,
            name: context.itemName,
            quantity: context.quantity,
            priceImpact: 'QUOTED',
            oldSubtotal: context.oldSubtotal,
            newSubtotal: pricing.subtotal,
            suggestedUnitPrice: pricing.unitPrice,
            suggestedFixedFee: pricing.fixedFee,
            errors: [],
          };
        }

        const template = itemById.get(change.templateItemId);
        if (!template || !context) {
          throw new OrderChangeRequestError('参考款式已不存在，请重新申请');
        }
        if (!context.quote.complete) {
          complete = false;
          return {
            changeIndex,
            operation: change.operation,
            sourceItemId: template.id,
            previousName: template.name,
            name: context.itemName,
            quantity: context.quantity,
            priceImpact: 'INCOMPLETE',
            oldSubtotal: null,
            newSubtotal: null,
            suggestedUnitPrice: null,
            suggestedFixedFee: null,
            errors: context.quote.errors,
          };
        }
        const pricing = resolveChangeRequestPricing({
          quote: context.quote,
          carry: context.carry,
          quantity: context.quantity,
          itemName: context.itemName,
          requestId: request.id,
          quotedAt,
          reviewRemark: null,
        });
        projectedTotal = projectedTotal.plus(pricing.subtotal);
        return {
          changeIndex,
          operation: change.operation,
          sourceItemId: template.id,
          previousName: template.name,
          name: context.itemName,
          quantity: context.quantity,
          priceImpact: 'QUOTED',
          oldSubtotal: null,
          newSubtotal: pricing.subtotal,
          suggestedUnitPrice: pricing.unitPrice,
          suggestedFixedFee: pricing.fixedFee,
          errors: [],
        };
      },
    );

    let newTotal: string | null = null;
    let delta: string | null = null;
    if (complete) {
      if (
        !projectedTotal.isFinite() ||
        projectedTotal.isNegative() ||
        projectedTotal.gt(DECIMAL_12_2_MAX)
      ) {
        throw new OrderChangeRequestError(
          '工单总额超过可保存上限 9,999,999,999.99 元',
        );
      }
      newTotal = projectedTotal.toFixed(2);
      delta = projectedTotal.minus(request.order.totalAmount).toFixed(2);
    }

    return {
      requestId: request.id,
      orderId: request.orderId,
      baseRevision: request.baseRevision,
      quotedAt: quotedAt.toISOString(),
      complete,
      requiresReviewRemark: !complete,
      oldTotal: new Decimal(request.order.totalAmount).toFixed(2),
      newTotal,
      delta,
      items,
    };
  });
}

/**
 * Applies an approved proposal under the same per-order advisory lock used by
 * production/status writers. A revision mismatch is persisted as STALE rather
 * than throwing (throwing would roll the status update back).
 */
export async function reviewOrderChangeRequest(
  input: ReviewOrderChangeRequestInput,
  actor: { id: string; role: Role },
) {
  if (actor.role !== Role.ADMIN) {
    throw new OrderChangeRequestError('只有管理员可以审核工单修改申请');
  }

  const locator = await db.orderChangeRequest.findUnique({
    where: { id: input.requestId },
    select: { orderId: true },
  });
  if (!locator) throw new OrderChangeRequestError('修改申请不存在');

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;

    const request = await tx.orderChangeRequest.findUnique({
      where: { id: input.requestId },
      include: {
        requester: { select: { id: true, displayName: true, role: true } },
        order: {
          include: {
            items: {
              orderBy: { sequence: 'asc' },
              include: {
                tasks: true,
                shipmentLines: {
                  include: {
                    shipment: { select: { id: true, sequence: true } },
                  },
                },
              },
            },
            outsourceOrders: {
              where: { status: { not: 'CANCELLED' } },
              select: { id: true, orderItemIds: true },
            },
            shipments: {
              orderBy: { sequence: 'asc' },
              select: {
                id: true,
                sequence: true,
                destinationProvince: true,
                quotedWeightKg: true,
                weightKg: true,
              },
            },
            customerCharges: {
              select: {
                id: true,
                shipmentId: true,
                businessKey: true,
                priceBookId: true,
                amount: true,
                overrideReason: true,
                category: { select: { code: true } },
              },
            },
          },
        },
      },
    });
    if (!request) throw new OrderChangeRequestError('修改申请不存在');
    if (request.status !== OrderChangeRequestStatus.PENDING) {
      throw new OrderChangeRequestError('该申请已经处理，不能重复审核');
    }

    const reviewedAt = new Date();
    const reviewRemark = input.reviewRemark?.trim() || null;
    if (input.decision === 'REJECT') {
      return tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.REJECTED,
          reviewedById: actor.id,
          reviewRemark,
          reviewedAt,
        },
      });
    }

    if (request.baseRevision !== request.order.revision) {
      return tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.STALE,
          reviewedById: actor.id,
          reviewRemark:
            reviewRemark ??
            `工单已从第 ${request.baseRevision} 版更新到第 ${request.order.revision} 版，请重新提交申请`,
          reviewedAt,
        },
      });
    }
    if (!CHANGEABLE_ORDER_STATUSES.includes(request.order.status)) {
      throw new OrderChangeRequestError('工单已完工，不能批准修改');
    }

    const changes = readProposedChanges(request.proposedChanges);
    // Re-check the live item count under the per-order lock. This is the
    // authoritative guard for legacy pending requests and any state change
    // that occurred after the proposal was recorded.
    assertOrderItemLimit(request.order.items.length, changes);
    const itemById = new Map(request.order.items.map((item) => [item.id, item]));
    const primaryShipment = request.order.shipments.find(
      (shipment) => shipment.sequence === 1,
    );
    if (!primaryShipment) {
      throw new OrderChangeRequestError('工单缺少主收货地址，不能安全更新数量');
    }

    const quoteContexts = await quotePricingAffectingChanges({
      changes,
      itemById,
      settlementType: request.order.settlementType,
      quotedAt: reviewedAt,
      client: tx,
    });
    const pricingByChangeIndex = new Map<
      number,
      ReturnType<typeof resolveChangeRequestPricing>
    >();
    quoteContexts.forEach((context) => {
      pricingByChangeIndex.set(
        context.changeIndex,
        resolveChangeRequestPricing({
          quote: context.quote,
          carry: context.carry,
          quantity: context.quantity,
          itemName: context.itemName,
          requestId: request.id,
          quotedAt: reviewedAt,
          reviewRemark,
        }),
      );
    });

    let nextSequence =
      Math.max(0, ...request.order.items.map((item) => item.sequence)) + 1;
    for (const [changeIndex, change] of changes.entries()) {
      if (change.operation === 'UPDATE') {
        const item = itemById.get(change.itemId);
        if (!item) throw new OrderChangeRequestError('原款式已不存在，请重新申请');

        if (change.quantity !== undefined && change.quantity !== item.quantity) {
          const extraShipmentQty = assertQuantityChangeAllowed(
            item,
            change.quantity,
          );
          await tx.orderShipmentLine.upsert({
            where: {
              shipmentId_orderItemId: {
                shipmentId: primaryShipment.id,
                orderItemId: item.id,
              },
            },
            create: {
              shipmentId: primaryShipment.id,
              orderItemId: item.id,
              quantity: change.quantity - extraShipmentQty,
            },
            update: { quantity: change.quantity - extraShipmentQty },
          });
          await tx.productionTask.updateMany({
            where: {
              orderItemId: item.id,
              status: TaskStatus.PENDING,
            },
            data: { plannedQty: change.quantity },
          });
        }

        const pricing = pricingByChangeIndex.get(changeIndex);
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            name: change.name,
            quantity: change.quantity,
            specification: change.specification,
            foilColors: change.foilColors,
            ...(pricing ?? {}),
          },
        });
        continue;
      }

      const template = itemById.get(change.templateItemId);
      if (!template) throw new OrderChangeRequestError('参考款式已不存在，请重新申请');
      const pricing = pricingByChangeIndex.get(changeIndex);
      if (!pricing) {
        throw new OrderChangeRequestError('新增款式缺少报价结果，无法批准修改');
      }
      const created = await tx.orderItem.create({
        data: {
          orderId: request.order.id,
          sequence: nextSequence,
          name: change.name,
          productId: template.productId,
          specification: change.specification ?? template.specification,
          paperType: template.paperType,
          quantity: change.quantity,
          crafts: template.crafts,
          foilColors: change.foilColors ?? template.foilColors,
          isDoubleSided: template.isDoubleSided,
          isDoubleColor: template.isDoubleColor,
          ...pricing,
          remark: template.remark,
        },
        select: { id: true },
      });
      nextSequence += 1;
      await tx.orderShipmentLine.create({
        data: {
          shipmentId: primaryShipment.id,
          orderItemId: created.id,
          quantity: change.quantity,
        },
      });
      if (template.tasks.length > 0) {
        await tx.productionTask.createMany({
          data: template.tasks.map((task) => ({
            orderItemId: created.id,
            craftId: task.craftId,
            workerId: task.workerId,
            workerType: task.workerType,
            machineType: task.machineType,
            status: TaskStatus.PENDING,
            plannedQty: change.quantity,
          })),
        });
      }
      for (const outsource of request.order.outsourceOrders) {
        if (!outsource.orderItemIds.includes(template.id)) continue;
        await tx.outsourceOrder.update({
          where: { id: outsource.id },
          data: { orderItemIds: { push: created.id } },
        });
      }
    }

    const shipmentQuantityChanged = changes.some((change) => {
      if (change.operation === 'ADD') return true;
      if (change.quantity === undefined) return false;
      return itemById.get(change.itemId)?.quantity !== change.quantity;
    });
    if (
      request.order.settlementType === OrderSettlementType.EXTERNAL_SALES &&
      shipmentQuantityChanged
    ) {
      await refreshExternalLogisticsChargesAfterQuantityChange({
        client: tx,
        requestId: request.id,
        reviewedAt,
        reviewRemark,
        isSfCollect: request.order.isSfCollect,
        shipments: request.order.shipments,
        items: request.order.items,
        changes,
        primaryShipmentId: primaryShipment.id,
        customerCharges: request.order.customerCharges,
      });
    }

    const refreshedItems = await tx.orderItem.findMany({
      where: { orderId: request.order.id },
      select: { subtotal: true },
    });
    const nextRevision = request.order.revision + 1;
    const nextProcessingAmount = orderTotal(refreshedItems);
    const customerChargeTotal = await tx.orderCustomerCharge.aggregate({
      where: { orderId: request.order.id },
      _sum: { amount: true },
    });
    const nextTotal = new Decimal(nextProcessingAmount)
      .plus(customerChargeTotal._sum.amount ?? 0)
      .toFixed(2);
    const salesDelta = new Decimal(nextTotal).minus(request.order.totalAmount);
    await tx.order.update({
      where: { id: request.order.id },
      data: {
        revision: nextRevision,
        processingAmount: nextProcessingAmount,
        totalAmount: nextTotal,
      },
    });
    const reviewed = await tx.orderChangeRequest.update({
      where: { id: request.id },
      data: {
        status: OrderChangeRequestStatus.APPROVED,
        reviewedById: actor.id,
        reviewRemark,
        reviewedAt,
      },
    });
    await tx.orderLog.create({
      data: {
        orderId: request.order.id,
        operatorId: actor.id,
        action: 'CHANGE_REQUEST_APPROVED',
        changedFields: {
          revision: { before: request.baseRevision, after: nextRevision },
          processingAmount: {
            before: String(request.order.processingAmount),
            after: nextProcessingAmount,
          },
          totalAmount: {
            before: String(request.order.totalAmount),
            after: nextTotal,
          },
          requestId: request.id,
        },
        remark: reviewRemark ?? request.reason,
      },
    });

    if (
      request.order.settlementType === OrderSettlementType.INTERNAL_SALES &&
      request.order.billingMode === OrderBillingMode.CHARGE &&
      request.order.status !== OrderStatus.DRAFT
    ) {
      try {
        await assertCsOrderSalesLedgerReconciledInTx(
          tx,
          request.order.id,
          request.order.totalAmount,
        );
        await recordCsSalesEntryInTx(tx, {
          eventKey: `order:${request.order.id}:revision:${nextRevision}:change`,
          csUserId: request.order.submitterId,
          orderId: request.order.id,
          orderRevision: nextRevision,
          type: CsSalesEntryType.ORDER_CHANGED,
          amount: salesDelta,
          occurredAt: reviewedAt,
          remark: `工单修改申请 ${request.id} 审核通过`,
        });
      } catch (error) {
        if (error instanceof CsSalesLedgerError) {
          throw new OrderChangeRequestError(error.message);
        }
        throw error;
      }
    }
    return reviewed;
  });
}

export async function listOrderChangeRequests(input?: {
  status?: OrderChangeRequestStatus;
  limit?: number;
}) {
  return db.orderChangeRequest.findMany({
    where: input?.status ? { status: input.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: input?.limit ?? 100,
    include: {
      requester: { select: { displayName: true, role: true } },
      reviewedBy: { select: { displayName: true } },
      order: {
        select: {
          id: true,
          orderNo: true,
          customName: true,
          status: true,
          revision: true,
        },
      },
    },
  });
}
