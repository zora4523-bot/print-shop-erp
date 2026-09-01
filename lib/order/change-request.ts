import Decimal from 'decimal.js';
import {
  CsSalesEntryType,
  CustomerPriceBookPurpose,
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderItemPricingRoute,
  OrderPackagingMode,
  OrderQuotedFeeCompleteness,
  OrderSettlementType,
  OrderStatus,
  Prisma,
  Role,
  TaskStatus,
} from '../../generated/prisma/client';
import type {
  CreateOrderChangeRequestInput,
  ReviewOrderChangeRequestInput,
} from '../auth/schemas';
import {
  orderChangeRequestItemsSchema,
  orderItemPricingFactsSchema,
} from '../auth/schemas';
import { db } from '../db';
import {
  OrderCustomerChargeError,
  resolveExternalOrderChargesForFinalization,
} from '../price/order-charge-service';
import {
  assertCsOrderSalesLedgerReconciledInTx,
  CsSalesLedgerError,
  recordCsSalesEntryInTx,
} from '../salary/cs-sales';
import { MAX_ORDER_ITEMS_PER_ORDER } from './limits';
import { orderCascadeLockKey } from './locks';
import {
  PendingPlateChargeError,
  requireActivePlateCategoryIdInTx,
  upsertPendingPlateChargeInTx,
} from './pending-plate-charge';
import { appendOrderPricingRevisionInTx } from './pricing-revision';
import { ORDER_PRICING_STATUS } from './pricing-status';
import {
  deriveLegacyOrderItemFoilFacts,
  isNewOrderPricingRoute,
} from './pricing-route';
import {
  calculateCreateOrderQuoteFromCatalogInTx,
  type CatalogCreateOrderQuoteCalculation,
} from './create-order-quote-service';
import type { CreateOrderItemQuotePreview } from './create-order-quote-presentation';

const CHANGEABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.SUBMITTED,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
];
const DECIMAL_12_2_MAX = new Decimal('9999999999.99');
const LEGACY_TASK_STATUS_SELECT = {
  status: true,
} as const satisfies Prisma.ProductionTaskSelect;

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
              productId: true,
              pricingRoute: true,
              productStructure: true,
              quantity: true,
              specification: true,
              actualWidthMm: true,
              actualHeightMm: true,
              paperType: true,
              crafts: true,
              frontFoilColors: true,
              backFoilColors: true,
              foilColors: true,
              foilTechnique: true,
              hasLocalFoil: true,
              lamination: true,
              printColors: true,
              isDoubleSided: true,
              tasks: { select: { status: true } },
            },
          },
          changeRequests: {
            where: { status: OrderChangeRequestStatus.PENDING },
            take: 1,
            select: { id: true },
          },
          packagingGroups: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true,
              sequence: true,
              lines: { select: { orderItemId: true } },
            },
          },
          productionOperations: {
            take: 1,
            select: {
              id: true,
              reports: { take: 1, select: { id: true } },
            },
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
      const itemById = new Map(order.items.map((item) => [item.id, item]));
      const normalizedChanges = normalizeProposedChanges(input.items, itemById);
      for (const change of normalizedChanges) {
        const sourceId =
          change.operation === 'UPDATE'
            ? change.itemId
            : change.templateItemId;
        const item = itemById.get(sourceId);
        if (!item) {
          throw new OrderChangeRequestError(
            change.operation === 'UPDATE'
              ? '原款式已不存在，请重新申请'
              : '参考款式已不存在，请重新申请',
          );
        }
        assertSpecificationIdentityUnchanged(item, change);
        assertMergedPricingFactsValid(item, change);
        if (change.operation === 'UPDATE') {
          assertProductionFactsChangeAllowed(item, change);
        }
      }
      assertPackagingChangeRequestSupported({
        changes: normalizedChanges,
        groups: order.packagingGroups ?? [],
      });
      assertNoMaterializedProductionFactChange(
        order.productionOperations ?? [],
        normalizedChanges,
        itemById,
      );

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
          proposedChanges: {
            items: normalizedChanges.map(toStoredProposedChange),
          },
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

type FoilFactSource = {
  frontFoilColors?: string[];
  backFoilColors?: string[];
  foilColors: string[];
  isDoubleSided: boolean;
};

type NormalizedProposedItemChange = ProposedItemChange & {
  frontFoilColors: string[];
  backFoilColors: string[];
  foilColors: string[];
  isDoubleSided: boolean;
  isDoubleColor: boolean;
  foilFactsProvided: boolean;
};

function hasDefinedFoilSides(change: ProposedItemChange): boolean {
  return (
    change.frontFoilColors !== undefined ||
    change.backFoilColors !== undefined
  );
}

function hasDefinedFoilFacts(change: ProposedItemChange): boolean {
  return hasDefinedFoilSides(change) || change.foilColors !== undefined;
}

/**
 * Front/back arrays are the authoritative facts. Aggregate `foilColors` is
 * accepted only for pending requests created by an older client and is
 * projected through the source item's historical sidedness.
 */
function normalizeProposedFoilFacts(
  change: ProposedItemChange,
  source: FoilFactSource,
) {
  if (hasDefinedFoilSides(change)) {
    return deriveLegacyOrderItemFoilFacts({
      frontFoilColors: change.frontFoilColors ?? source.frontFoilColors,
      backFoilColors: change.backFoilColors ?? source.backFoilColors,
    });
  }
  if (change.foilColors !== undefined) {
    return deriveLegacyOrderItemFoilFacts({
      foilColors: change.foilColors,
      isDoubleSided: source.isDoubleSided,
    });
  }
  return deriveLegacyOrderItemFoilFacts(source);
}

function normalizeProposedChanges(
  changes: ProposedItemChange[],
  itemById: ReadonlyMap<string, FoilFactSource>,
): NormalizedProposedItemChange[] {
  return changes.map((change) => {
    const sourceId =
      change.operation === 'UPDATE' ? change.itemId : change.templateItemId;
    const source = itemById.get(sourceId);
    if (!source) {
      throw new OrderChangeRequestError(
        change.operation === 'UPDATE'
          ? '原款式已不存在，请重新申请'
          : '参考款式已不存在，请重新申请',
      );
    }
    return {
      ...change,
      ...normalizeProposedFoilFacts(change, source),
      foilFactsProvided:
        change.operation === 'ADD' || hasDefinedFoilFacts(change),
    };
  });
}

/**
 * Persist only the authoritative per-side facts for a newly submitted
 * request. The retired aggregate columns are derived again at review time.
 * Non-foil updates intentionally omit every foil field so approving a name
 * change cannot rewrite historical sidedness flags.
 */
function toStoredProposedChange(
  change: NormalizedProposedItemChange,
): ProposedItemChange {
  const stored: Partial<NormalizedProposedItemChange> = { ...change };
  delete stored.foilColors;
  delete stored.isDoubleSided;
  delete stored.isDoubleColor;
  delete stored.foilFactsProvided;
  if (!change.foilFactsProvided && change.operation === 'UPDATE') {
    delete stored.frontFoilColors;
    delete stored.backFoilColors;
  }
  return stored as ProposedItemChange;
}

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
  const container = value as { items?: unknown } | null;
  if (!container) {
    throw new OrderChangeRequestError('申请数据已损坏，无法审核');
  }
  const parsed = orderChangeRequestItemsSchema.safeParse(container.items);
  if (!parsed.success) {
    throw new OrderChangeRequestError('申请数据已损坏，无法审核');
  }
  return parsed.data;
}

function resolvePureChangeRequestPricing(input: {
  quote: CreateOrderItemQuotePreview;
  quantity: number;
  itemName: string;
  itemKey: string;
  requestId: string;
  quotedAt: Date;
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
    quantity,
    itemName,
    itemKey,
    requestId,
    quotedAt,
  } = input;

  if (
    !quote.complete ||
    quote.suggestedUnitPrice === null ||
    quote.suggestedFixedFee === null ||
    quote.suggestedSubtotal === null
  ) {
    const details = quote.errors.join('；');
    throw new OrderChangeRequestError(
      `款式“${itemName}”需要人工核价${details ? `：${details}` : ''}；请先在工厂确认环节完成核价，禁止沿用历史价`,
    );
  }
  const unitPrice = quote.suggestedUnitPrice;
  const fixedFee = quote.suggestedFixedFee;
  const subtotal = storableOrderSubtotal(
    new Prisma.Decimal(unitPrice),
    new Prisma.Decimal(fixedFee),
    quantity,
    itemName,
  );
  if (!new Decimal(subtotal).equals(quote.suggestedSubtotal)) {
    throw new OrderChangeRequestError(
      `款式“${itemName}”的纯引擎分项与小计无法对平`,
    );
  }
  return {
    unitPrice,
    fixedFee,
    subtotal,
    suggestedSubtotal: quote.suggestedSubtotal,
    pricingSnapshot: {
      ...quote.snapshot,
      source: 'CHANGE_REQUEST_PURE_REQUOTE',
      itemKey,
      requestId,
      quotedAt: quotedAt.toISOString(),
      actual: {
        quantity,
        unitPrice,
        fixedFee,
        subtotal,
        overrideReason: null,
      },
    } satisfies Prisma.InputJsonObject,
    priceOverrideReason: null,
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

function orderTotal(
  items: Array<{ subtotal: Prisma.Decimal }>,
  packagingAmount: Prisma.Decimal | string | number = 0,
): string {
  const total = items.reduce(
    (sum, item) => sum.plus(item.subtotal),
    new Decimal(packagingAmount),
  );
  if (!total.isFinite() || total.isNegative() || total.gt(DECIMAL_12_2_MAX)) {
    throw new OrderChangeRequestError(
      '工单总额超过可保存上限 9,999,999,999.99 元',
    );
  }
  return total.toFixed(2);
}

type PackagingProjectionGroup = {
  id: string;
  sequence: number;
  name: string | null;
  mode: OrderPackagingMode;
  actualBagCount: number;
  unitPrice: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  pricingSnapshot: Prisma.JsonValue | null;
  priceOverrideReason: string | null;
  lines: Array<{ orderItemId: string; unitsPerBag: number }>;
};

type PackagingMembershipGroup = {
  id: string;
  sequence: number;
  lines: ReadonlyArray<{ orderItemId: string }>;
};

type PackagingRepricePlan = {
  groupId: string;
  actualBagCount: number;
  unitPrice: string;
  subtotal: string;
  suggestedSubtotal: string | null;
  pricingSnapshot: Prisma.InputJsonObject;
  priceOverrideReason: string | null;
  audit: {
    groupId: string;
    sequence: number;
    before: PackagingAuditState;
    after: PackagingAuditState;
  };
};

type PackagingAuditState = {
  actualBagCount: number;
  unitPrice: string;
  subtotal: string;
  pricingSource: string | null;
  priceBookId: string | null;
  ruleId: string | null;
  overrideReason: string | null;
};

type PackagingRepriceResult = {
  total: string;
  plans: PackagingRepricePlan[];
};

function assertNoCrossGroupItemMembership(
  groups: readonly PackagingMembershipGroup[],
): void {
  const ownerByItemId = new Map<
    string,
    { groupId: string; sequence: number }
  >();
  for (const group of groups) {
    for (const line of group.lines) {
      const owner = ownerByItemId.get(line.orderItemId);
      if (owner && owner.groupId !== group.id) {
        throw new OrderChangeRequestError(
          `同一款式同时归属包装组 ${owner.sequence} 和 ${group.sequence}，无法重算入袋费`,
        );
      }
      ownerByItemId.set(line.orderItemId, {
        groupId: group.id,
        sequence: group.sequence,
      });
    }
  }
}

function assertPackagingChangeRequestSupported(input: {
  changes: readonly NormalizedProposedItemChange[];
  groups: readonly PackagingMembershipGroup[];
}): void {
  if (
    input.groups.length > 0 &&
    input.changes.some((change) => change.operation === 'ADD')
  ) {
    throw new OrderChangeRequestError(
      '当前工单已有包装组；新增款式必须同时指定每袋组成，当前修改申请暂不支持',
    );
  }
  assertNoCrossGroupItemMembership(input.groups);
}

function packagingSnapshotBase(
  value: Prisma.JsonValue | null,
): Prisma.InputJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Prisma.InputJsonObject)
    : {};
}

function snapshotString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  return typeof value[key] === 'string' ? value[key] : null;
}

function packagingAuditState(input: {
  actualBagCount: number;
  unitPrice: Prisma.Decimal | string;
  subtotal: Prisma.Decimal | string;
  pricingSnapshot: Prisma.JsonValue | Prisma.InputJsonObject | null;
  overrideReason: string | null;
}): PackagingAuditState {
  const snapshot = packagingSnapshotBase(
    input.pricingSnapshot as Prisma.JsonValue | null,
  );
  const priceBook =
    snapshot.priceBook &&
    typeof snapshot.priceBook === 'object' &&
    !Array.isArray(snapshot.priceBook)
      ? (snapshot.priceBook as Record<string, unknown>)
      : {};
  const rule =
    snapshot.rule &&
    typeof snapshot.rule === 'object' &&
    !Array.isArray(snapshot.rule)
      ? (snapshot.rule as Record<string, unknown>)
      : {};
  return {
    actualBagCount: input.actualBagCount,
    unitPrice: new Decimal(input.unitPrice).toFixed(4),
    subtotal: new Decimal(input.subtotal).toFixed(2),
    pricingSource: snapshotString(snapshot, 'source'),
    priceBookId: snapshotString(priceBook, 'id'),
    ruleId: snapshotString(rule, 'id'),
    overrideReason: input.overrideReason,
  };
}

function packagingRepriceFromPureCalculation(input: {
  calculation: CatalogCreateOrderQuoteCalculation;
  requestId: string;
  reviewedAt: Date;
  storedTotal: Prisma.Decimal | string | number;
  groups: readonly PackagingProjectionGroup[];
}): PackagingRepriceResult {
  if (input.groups.length === 0) {
    if (!new Decimal(input.storedTotal).isZero()) {
      throw new OrderChangeRequestError(
        '工单存在入袋费但缺少包装组事实，无法批准修改',
      );
    }
    return { total: '0.00', plans: [] };
  }
  assertNoCrossGroupItemMembership(input.groups);
  const presentedByKey = new Map(
    input.calculation.processing.packaging.groups.map((group) => [
      group.groupKey,
      group,
    ]),
  );
  const pureByKey = new Map(
    input.calculation.quote.packagingGroups.map((group) => [group.groupKey, group]),
  );
  const plans = input.groups.map((group) => {
    const groupKey = group.id;
    const line = presentedByKey.get(groupKey);
    const pure = pureByKey.get(groupKey);
    const bagCount = pure?.bagCount;
    if (
      !line?.complete ||
      line.suggestedUnitPrice === null ||
      line.suggestedSubtotal === null ||
      bagCount === null ||
      bagCount === undefined ||
      !Number.isSafeInteger(bagCount)
    ) {
      const details = line?.errors.join('；') ?? '';
      throw new OrderChangeRequestError(
        `包装组 ${group.sequence} 需要人工核价${details ? `：${details}` : ''}；请先在工厂确认环节完成核价`,
      );
    }
    const actualBagCount = bagCount;
    const pricingSnapshot = {
      ...line.snapshot,
      source: 'CHANGE_REQUEST_PURE_REQUOTE',
      requestId: input.requestId,
      quotedAt: input.reviewedAt.toISOString(),
      actual: {
        actualBagCount,
        unitPrice: line.suggestedUnitPrice,
        subtotal: line.suggestedSubtotal,
        overrideReason: null,
      },
    } satisfies Prisma.InputJsonObject;
    return {
      groupId: group.id,
      actualBagCount,
      unitPrice: line.suggestedUnitPrice,
      subtotal: line.suggestedSubtotal,
      suggestedSubtotal: line.suggestedSubtotal,
      pricingSnapshot,
      priceOverrideReason: null,
      audit: {
        groupId: group.id,
        sequence: group.sequence,
        before: packagingAuditState({
          actualBagCount: group.actualBagCount,
          unitPrice: group.unitPrice,
          subtotal: group.subtotal,
          pricingSnapshot: group.pricingSnapshot,
          overrideReason: group.priceOverrideReason,
        }),
        after: packagingAuditState({
          actualBagCount,
          unitPrice: line.suggestedUnitPrice,
          subtotal: line.suggestedSubtotal,
          pricingSnapshot,
          overrideReason: null,
        }),
      },
    } satisfies PackagingRepricePlan;
  });
  return {
    total: plans
      .reduce((sum, plan) => sum.plus(plan.subtotal), new Decimal(0))
      .toFixed(2),
    plans,
  };
}

async function applyPackagingRepricePlans(
  client: Prisma.TransactionClient,
  result: PackagingRepriceResult,
): Promise<void> {
  for (const plan of result.plans) {
    await client.orderPackagingGroup.update({
      where: { id: plan.groupId },
      data: {
        actualBagCount: plan.actualBagCount,
        unitPrice: plan.unitPrice,
        subtotal: plan.subtotal,
        suggestedSubtotal: plan.suggestedSubtotal,
        pricingSnapshot: plan.pricingSnapshot,
        priceOverrideReason: plan.priceOverrideReason,
      },
    });
  }
}

type LogisticsProjectionShipment = {
  id: string;
  sequence: number;
  destinationProvince: string | null;
  weightKg: Prisma.Decimal | null;
};

type LogisticsProjectionItem = {
  id: string;
  quantity: number;
  paperWeightGsm: number | null;
  paperType: string | null;
  productStructure: import('../../generated/prisma/client').OrderProductStructure;
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
  amount: Prisma.Decimal | null;
  overrideReason: string | null;
  category: { code: string };
};

function addedItemKey(changeIndex: number): string {
  return `ADD:${changeIndex + 1}`;
}

function projectShipmentFacts(input: {
  shipments: LogisticsProjectionShipment[];
  items: LogisticsProjectionItem[];
  changes: ProposedItemChange[];
  primaryShipmentId: string;
  isSfCollect: boolean;
}) {
  const allocationByItemKey = new Map<
    string,
    Map<string, number>
  >(
    input.items.map((item) => [
      item.id,
      new Map(
        item.shipmentLines.map((line) => [line.shipment.id, line.quantity]),
      ),
    ]),
  );
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const projectedItems = input.items.map((item) => ({
    itemKey: item.id,
    quantity: item.quantity,
    paperWeightGsm: item.paperWeightGsm,
    paperType: item.paperType,
    productStructure: item.productStructure,
  }));

  for (const [changeIndex, change] of input.changes.entries()) {
    if (change.operation === 'ADD') {
      const template = itemById.get(change.templateItemId);
      if (!template) {
        throw new OrderChangeRequestError('参考款式已不存在，无法刷新物流收费');
      }
      const itemKey = addedItemKey(changeIndex);
      projectedItems.push({
        itemKey,
        quantity: change.quantity,
        paperWeightGsm: template.paperWeightGsm,
        paperType: template.paperType,
        productStructure: template.productStructure,
      });
      allocationByItemKey.set(
        itemKey,
        new Map([[input.primaryShipmentId, change.quantity]]),
      );
      continue;
    }
    if (change.quantity === undefined) continue;
    const item = itemById.get(change.itemId);
    if (!item) throw new OrderChangeRequestError('原款式已不存在，请重新申请');
    const allocation = allocationByItemKey.get(item.id)!;
    allocation.set(
      input.primaryShipmentId,
      (allocation.get(input.primaryShipmentId) ?? 0) +
        change.quantity - item.quantity,
    );
    const projected = projectedItems.find(
      (candidate) => candidate.itemKey === item.id,
    )!;
    projected.quantity = change.quantity;
  }

  const knownShipmentIds = new Set(
    input.shipments.map((shipment) => shipment.id),
  );
  for (const allocation of allocationByItemKey.values()) {
    for (const [shipmentId, quantity] of allocation) {
      if (!knownShipmentIds.has(shipmentId)) {
        throw new OrderChangeRequestError(
          '工单的款式分货记录与收货地址不一致',
        );
      }
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        throw new OrderChangeRequestError(
          `收货地址 ${shipmentId} 的分货数量非法，无法刷新物流收费`,
        );
      }
    }
  }

  return input.shipments.map((shipment) => ({
      shipmentKey: String(shipment.sequence),
      province: shipment.destinationProvince,
      browserBillableWeightKg: null,
      trustedFulfilmentWeightKg: shipment.weightKg?.toString() ?? null,
      itemQuantities: Object.fromEntries(
        projectedItems.map((item) => [
          item.itemKey,
          allocationByItemKey.get(item.itemKey)?.get(shipment.id) ?? 0,
        ]),
      ),
    }));
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
  calculation: CatalogCreateOrderQuoteCalculation;
  requestId: string;
  reviewedAt: Date;
  shipments: LogisticsProjectionShipment[];
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
  let refreshed: Awaited<
    ReturnType<typeof resolveExternalOrderChargesForFinalization>
  >;
  try {
    const itemByKey = new Map(
      input.calculation.input.items.map((item) => [item.itemKey, item]),
    );
    refreshed = await resolveExternalOrderChargesForFinalization(
      input.client,
      {
        isSfCollect: input.calculation.input.isSfCollect,
        shipments: input.calculation.input.shipments.map((shipment) => {
          const allocations = Object.entries(shipment.itemQuantities).filter(
            ([, quantity]) => quantity > 0,
          );
          return {
            shipmentKey: shipment.shipmentKey,
            province: shipment.province,
            billableWeightKg: shipment.trustedBillableWeightKg ?? null,
            itemQuantity: allocations.reduce(
              (sum, [, quantity]) => sum + quantity,
              0,
            ),
            weightItems: allocations.flatMap(([itemKey, quantity]) => {
              const item = itemByKey.get(itemKey);
              return item
                ? [{
                    itemKey,
                    quantity,
                    paperWeightGsm: item.paperWeightGsm,
                    paperType: item.paperType,
                    productStructure: item.productStructure,
                  }]
                : [];
            }),
            shippingFee: null,
            packingMaterialFee: null,
            overrideReason: null,
          };
        }),
      },
      input.calculation.quote.priceVersion.logistics.id,
      input.reviewedAt,
    );
  } catch (error) {
    if (error instanceof OrderCustomerChargeError) {
      throw new OrderChangeRequestError(error.message);
    }
    throw error;
  }

  const expectedVersion = input.calculation.quote.priceVersion.logistics;
  if (
    refreshed.priceBook.id !== expectedVersion.id ||
    refreshed.priceBook.version !== expectedVersion.version ||
    refreshed.priceBook.sourceSha256 !== expectedVersion.sourceSha256
  ) {
    throw new OrderChangeRequestError('物流持久化与纯引擎价目簿版本不一致');
  }
  if (
    refreshed.requiresAdminConfirmation ||
    input.calculation.quote.order.amount === null ||
    !new Decimal(refreshed.totalAmount).equals(
      input.calculation.quote.order.knownAmount,
    )
  ) {
    throw new OrderChangeRequestError(
      '快递/耗材金额与纯引擎输出不一致，禁止批准修改',
    );
  }

  const shippingLineByKey = new Map(
    input.calculation.quote.order.lines
      .filter((line) => line.code.startsWith('SHIPPING:'))
      .map((line) => [line.code.slice('SHIPPING:'.length), line]),
  );
  const cartonLine = input.calculation.quote.order.lines.find(
    (line) => line.code === 'CARTON',
  );
  const packingTotal = refreshed.charges
    .filter((charge) => charge.categoryCode === 'PACKING_MATERIAL')
    .reduce((sum, charge) => sum.plus(charge.amount), new Decimal(0));
  if (
    !cartonLine?.amount ||
    !packingTotal.equals(cartonLine.amount) ||
    refreshed.charges.some(
      (charge) =>
        charge.categoryCode === 'SHIPPING_FEE' &&
        !new Decimal(charge.amount).equals(
          shippingLineByKey.get(charge.shipmentKey)?.amount ?? Number.NaN,
        ),
    )
  ) {
    throw new OrderChangeRequestError('物流分项与纯引擎输出不一致');
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
    return {
      charge,
      existing,
    };
  });

  for (const plan of updatePlans) {
    await input.client.orderCustomerCharge.update({
      where: { id: plan.existing.id },
      data: {
        categoryId: plan.charge.categoryId,
        sourceRuleId: plan.charge.sourceRuleId,
        description: plan.charge.description,
        status: plan.charge.status,
        quantity: plan.charge.quantity,
        unit: plan.charge.unit,
        suggestedAmount: plan.charge.suggestedAmount,
        amount: plan.charge.amount,
        pricingSnapshot: refreshedChargeSnapshot(
          plan.charge.pricingSnapshot,
          {
            requestId: input.requestId,
            reviewedAt: input.reviewedAt,
            amount: plan.charge.amount,
            overrideReason: null,
          },
        ),
        overrideReason: null,
        finalizedById: null,
        finalizedAt: null,
      },
    });
  }
}

async function resetPendingPlateChargeAfterPricingChange(input: {
  client: Prisma.TransactionClient;
  orderId: string;
  actorId: string;
  reviewedAt: Date;
  quote: CatalogCreateOrderQuoteCalculation['quote'];
}): Promise<void> {
  try {
    const staleDetails = await input.client.orderItemPlateDetail.findMany({
      where: {
        isActive: true,
        orderItem: { orderId: input.orderId },
      },
      select: { id: true, amount: true },
    });
    for (const detail of staleDetails) {
      await input.client.orderItemPlateDetail.update({
        where: { id: detail.id },
        data: {
          isActive: false,
          removedById: input.actorId,
          removedAt: input.reviewedAt,
        },
        select: { id: true },
      });
      await input.client.orderCustomerCharge.update({
        where: {
          orderId_businessKey: {
            orderId: input.orderId,
            businessKey: `PLATE_DETAIL:${detail.id}`,
          },
        },
        data: {
          status: OrderCustomerChargeStatus.WAIVED,
          amount: '0.00',
          pricingSnapshot: {
            version: 1,
            source: 'CHANGE_REQUEST_INVALIDATED_PLATE_DETAIL',
            plateDetailId: detail.id,
            removedAt: input.reviewedAt.toISOString(),
            previousAmount: detail.amount.toString(),
          },
          overrideReason: '改单重算后需重新确认制版明细',
          finalizedById: input.actorId,
          finalizedAt: input.reviewedAt,
        },
        select: { id: true },
      });
    }
    const categoryId = await requireActivePlateCategoryIdInTx(input.client);
    await upsertPendingPlateChargeInTx({
      tx: input.client,
      orderId: input.orderId,
      actorId: input.actorId,
      categoryId,
      quote: input.quote,
      source: 'CHANGE_REQUEST_PENDING_PLATE',
    });
  } catch (error) {
    if (error instanceof PendingPlateChargeError) {
      throw new OrderChangeRequestError(error.message);
    }
    throw error;
  }
}

async function refreshExternalChargesAfterPricingChange(input: {
  client: Prisma.TransactionClient;
  calculation: CatalogCreateOrderQuoteCalculation;
  requestId: string;
  reviewedAt: Date;
  shipments: LogisticsProjectionShipment[];
  customerCharges: LogisticsProjectionCharge[];
  orderId: string;
  actorId: string;
}): Promise<void> {
  await refreshExternalLogisticsChargesAfterQuantityChange(input);
  await resetPendingPlateChargeAfterPricingChange({
    client: input.client,
    orderId: input.orderId,
    actorId: input.actorId,
    reviewedAt: input.reviewedAt,
    quote: input.calculation.quote,
  });
}

type PricingProjectionItem = {
  id: string;
  fig?: number | null;
  name: string;
  productId: string | null;
  pricingRoute: import('../../generated/prisma/client').OrderItemPricingRoute;
  productStructure: import('../../generated/prisma/client').OrderProductStructure;
  artworkVersion: string | null;
  plateGroupId: string | null;
  pricingGroup: string | null;
  manualQuoteReason: string | null;
  specification: string | null;
  actualWidthMm: Prisma.Decimal | null;
  actualHeightMm: Prisma.Decimal | null;
  paperType: string | null;
  paperWeightGsm: number | null;
  quantity: number;
  crafts: string[];
  frontFoilColors: string[];
  backFoilColors: string[];
  foilColors: string[];
  foilTechnique: import('../../generated/prisma/client').OrderFoilTechnique;
  hasLocalFoil: boolean | null;
  lamination: import('../../generated/prisma/client').OrderLamination;
  printColors: string[];
  isDoubleSided: boolean;
  isDoubleColor: boolean;
  unitPrice: Prisma.Decimal;
  fixedFee: Prisma.Decimal;
  subtotal: Prisma.Decimal;
};

type ProjectedQuoteItem = {
  itemKey: string;
  changeIndex: number | null;
  operation: 'EXISTING' | 'UPDATE' | 'ADD';
  sourceItemId: string;
  itemName: string;
  quantity: number;
  oldSubtotal: string | null;
  facts: Parameters<
    typeof calculateCreateOrderQuoteFromCatalogInTx
  >[1]['facts']['items'][number];
};

function changeAffectsPricing(
  change: NormalizedProposedItemChange,
  item: FoilFactSource & { quantity: number; specification: string | null },
): boolean {
  if (change.operation === 'ADD') return true;
  const foil = deriveLegacyOrderItemFoilFacts(item);
  return (
    (change.quantity !== undefined && change.quantity !== item.quantity) ||
    (change.specification !== undefined &&
      change.specification !== item.specification) ||
    (change.foilFactsProvided &&
      (!sameStringSet(change.frontFoilColors, foil.frontFoilColors) ||
        !sameStringSet(change.backFoilColors, foil.backFoilColors)))
  );
}

function hasPricingFactChanges(
  changes: readonly NormalizedProposedItemChange[],
  itemById: ReadonlyMap<string, PricingProjectionItem>,
): boolean {
  return changes.some((change) => {
    const source = itemById.get(
      change.operation === 'UPDATE' ? change.itemId : change.templateItemId,
    );
    if (!source) throw new OrderChangeRequestError('款式已不存在，请重新申请');
    return changeAffectsPricing(change, source);
  });
}

function projectedQuoteItems(input: {
  changes: NormalizedProposedItemChange[];
  items: readonly PricingProjectionItem[];
}): ProjectedQuoteItem[] {
  const changeByItemId = new Map(
    input.changes.flatMap((change, changeIndex) =>
      change.operation === 'UPDATE'
        ? [[change.itemId, { change, changeIndex }] as const]
        : [],
    ),
  );
  const projected: ProjectedQuoteItem[] = input.items.map((item, index) => {
    const found = changeByItemId.get(item.id);
    const change = found?.change;
    if (!isNewOrderPricingRoute(item.pricingRoute)) {
      throw new OrderChangeRequestError(
        `款式“${item.name}”是历史人工报价路线，整单重算前请先在工厂确认环节完成核价`,
      );
    }
    const foil = change?.foilFactsProvided
      ? change
      : deriveLegacyOrderItemFoilFacts(item);
    const quantity = change?.quantity ?? item.quantity;
    return {
      itemKey: item.id,
      changeIndex: found?.changeIndex ?? null,
      operation: found ? 'UPDATE' : 'EXISTING',
      sourceItemId: item.id,
      itemName: change?.name ?? item.name,
      quantity,
      oldSubtotal: new Decimal(item.subtotal).toFixed(2),
      facts: {
        itemKey: item.id,
        fig: index + 1,
        productId: item.productId,
        pricingRoute: item.pricingRoute,
        productStructure: item.productStructure,
        pricingGroup: item.pricingGroup,
        specification: change?.specification ?? item.specification,
        actualWidthMm: item.actualWidthMm,
        actualHeightMm: item.actualHeightMm,
        paperType: item.paperType,
        paperWeightGsm: item.paperWeightGsm,
        quantity,
        crafts: item.crafts,
        foilColors: foil.foilColors,
        frontFoilColors: foil.frontFoilColors,
        backFoilColors: foil.backFoilColors,
        foilTechnique: item.foilTechnique,
        hasLocalFoil: item.hasLocalFoil,
        lamination: item.lamination,
        manualQuoteReason: item.manualQuoteReason,
      },
    };
  });

  for (const [changeIndex, change] of input.changes.entries()) {
    if (change.operation !== 'ADD') continue;
    const template = input.items.find((item) => item.id === change.templateItemId);
    if (!template) throw new OrderChangeRequestError('参考款式已不存在，请重新申请');
    if (!isNewOrderPricingRoute(template.pricingRoute)) {
      throw new OrderChangeRequestError('历史人工报价款式不能作为新增款式模板');
    }
    const itemKey = addedItemKey(changeIndex);
    projected.push({
      itemKey,
      changeIndex,
      operation: 'ADD',
      sourceItemId: template.id,
      itemName: change.name,
      quantity: change.quantity,
      oldSubtotal: null,
      facts: {
        itemKey,
        fig: projected.length + 1,
        productId: template.productId,
        pricingRoute: template.pricingRoute,
        productStructure: template.productStructure,
        pricingGroup: template.pricingGroup,
        specification: change.specification ?? template.specification,
        actualWidthMm: template.actualWidthMm,
        actualHeightMm: template.actualHeightMm,
        paperType: template.paperType,
        paperWeightGsm: template.paperWeightGsm,
        quantity: change.quantity,
        crafts: template.crafts,
        foilColors: change.foilColors,
        frontFoilColors: change.frontFoilColors,
        backFoilColors: change.backFoilColors,
        foilTechnique: template.foilTechnique,
        hasLocalFoil: template.hasLocalFoil,
        lamination: template.lamination,
        manualQuoteReason: template.manualQuoteReason,
      },
    });
  }
  return projected;
}

async function calculateProjectedOrderQuote(input: {
  client: Prisma.TransactionClient;
  now: Date;
  settlementType: OrderSettlementType;
  isSfCollect: boolean;
  items: readonly PricingProjectionItem[];
  logisticsItems: readonly LogisticsProjectionItem[];
  shipments: LogisticsProjectionShipment[];
  primaryShipmentId: string;
  packagingGroups: readonly PackagingProjectionGroup[];
  changes: NormalizedProposedItemChange[];
}): Promise<{
  calculation: CatalogCreateOrderQuoteCalculation;
  projectedItems: ProjectedQuoteItem[];
}> {
  const projectedItems = projectedQuoteItems({
    changes: input.changes,
    items: input.items,
  });
  const shipmentFacts = projectShipmentFacts({
    shipments: input.shipments,
    items: [...input.logisticsItems],
    changes: input.changes,
    primaryShipmentId: input.primaryShipmentId,
    isSfCollect: input.isSfCollect,
  });
  let calculation: CatalogCreateOrderQuoteCalculation;
  try {
    calculation = await calculateCreateOrderQuoteFromCatalogInTx(input.client, {
      now: input.now,
      facts: {
        items: projectedItems.map((item) => item.facts),
        packagingGroups: input.packagingGroups.map((group) => ({
          groupKey: group.id,
          mode: group.mode,
          items: group.lines.map((line) => ({
            itemKey: line.orderItemId,
            unitsPerBag: line.unitsPerBag,
          })),
        })),
        isSfCollect: input.isSfCollect,
        shipments: shipmentFacts,
      },
      includeOrderCharges:
        input.settlementType === OrderSettlementType.EXTERNAL_SALES,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new OrderChangeRequestError(
        `修改后整单无法自动核价：${error.message}；请先在工厂确认环节完成核价`,
      );
    }
    throw error;
  }
  if (!isChangeRequestQuoteAutomaticallyApplicable(calculation)) {
    const reasons = [
      ...calculation.quote.manualReasons.map((reason) => reason.message),
      ...calculation.quote.pendingReasons
        .filter((reason) => reason.code !== 'PLATE_AMOUNT_PENDING')
        .map((reason) => reason.message),
      ...calculation.quote.errors,
    ];
    throw new OrderChangeRequestError(
      `修改后整单需要人工核价${reasons.length ? `：${reasons.join('；')}` : ''}；请先在工厂确认环节完成核价`,
    );
  }
  return { calculation, projectedItems };
}

/**
 * The pure engine always keeps the order-level plate fee pending until the
 * factory confirms it. A change request may still safely apply every computed
 * item/package/customer-charge amount when that is the sole incompleteness.
 */
export function isChangeRequestQuoteAutomaticallyApplicable(
  calculation: Pick<
    CatalogCreateOrderQuoteCalculation,
    'quote' | 'processing'
  >,
): boolean {
  const hasOnlyPendingPlateFee =
    calculation.quote.pendingLineCodes.length === 1 &&
    calculation.quote.pendingLineCodes[0] === 'PLATE_FEE';
  const aggregateStatusAllowed =
    (calculation.quote.status === 'QUOTED' &&
      calculation.quote.pendingLineCodes.length === 0 &&
      calculation.quote.pendingReasons.length === 0) ||
    (calculation.quote.status === 'PARTIAL' &&
      hasOnlyPendingPlateFee &&
      calculation.quote.pendingReasons.length === 1 &&
      calculation.quote.pendingReasons.every(
        (reason) => reason.code === 'PLATE_AMOUNT_PENDING',
      ));
  return (
    aggregateStatusAllowed &&
    calculation.quote.manualReasons.length === 0 &&
    calculation.quote.errors.length === 0 &&
    calculation.processing.items.every((item) => item.complete) &&
    !calculation.processing.packaging.requiresAdminConfirmation
  );
}

type QuantityGuardItem = {
  name: string;
  tasks: Array<{ status: TaskStatus }>;
  shipmentLines: Array<{
    quantity: number;
    shipment: { sequence: number };
  }>;
};

type ProductionFactGuardItem = FoilFactSource & {
  name: string;
  specification: string | null;
  tasks: Array<{ status: TaskStatus }>;
};

type MaterializedProductionOperation = {
  id: string;
  reports?: Array<{ id: string }>;
};

type PricingFactGuardItem = ProductionFactGuardItem & {
  quantity: number;
  productId: string | null;
  pricingRoute: import('../../generated/prisma/client').OrderItemPricingRoute;
  productStructure: import('../../generated/prisma/client').OrderProductStructure;
  actualWidthMm: Prisma.Decimal | null;
  actualHeightMm: Prisma.Decimal | null;
  paperType: string | null;
  crafts: string[];
  foilTechnique: import('../../generated/prisma/client').OrderFoilTechnique;
  hasLocalFoil: boolean | null;
  lamination: import('../../generated/prisma/client').OrderLamination;
  printColors: string[];
};

/**
 * A specification is part of the selected catalog SKU identity. The current
 * change-request contract cannot atomically select a replacement product,
 * dimensions and product structure, so accepting a standalone text edit
 * would quote a new specification against the old SKU. Fail closed until the
 * request model can carry that complete identity.
 */
function assertSpecificationIdentityUnchanged(
  item: Pick<PricingFactGuardItem, 'name' | 'specification'>,
  change: NormalizedProposedItemChange,
): void {
  if (change.operation === 'ADD' && change.specification == null) return;
  if (
    change.specification !== undefined &&
    change.specification !== item.specification
  ) {
    throw new OrderChangeRequestError(
      `款式“${item.name}”的规格与产品组合、尺寸和产品结构必须一起变更；当前修改申请不支持单独改规格`,
    );
  }
}

function assertMergedPricingFactsValid(
  item: PricingFactGuardItem,
  change: NormalizedProposedItemChange,
): void {
  if (item.pricingRoute === OrderItemPricingRoute.MANUAL_QUOTE) {
    if (change.operation === 'ADD') {
      throw new OrderChangeRequestError(
        `款式“${item.name}”是历史人工报价路线，不能作为新增款式模板`,
      );
    }
    const sourceFoilFacts = deriveLegacyOrderItemFoilFacts(item);
    const quantityChanged =
      change.quantity !== undefined && change.quantity !== item.quantity;
    const foilFactsChanged =
      change.foilFactsProvided &&
      (!sameStringSet(
        change.frontFoilColors,
        sourceFoilFacts.frontFoilColors,
      ) ||
        !sameStringSet(
          change.backFoilColors,
          sourceFoilFacts.backFoilColors,
        ));
    if (quantityChanged || foilFactsChanged) {
      throw new OrderChangeRequestError(
        `款式“${item.name}”是历史人工报价路线，修改申请只允许更新名称；数量或烫金参数需由管理员另行处理`,
      );
    }
    return;
  }
  const parsed = orderItemPricingFactsSchema.safeParse({
    productId: item.productId,
    pricingRoute: item.pricingRoute,
    paperType: item.paperType,
    crafts: item.crafts,
    actualWidthMm: item.actualWidthMm?.toNumber() ?? null,
    actualHeightMm: item.actualHeightMm?.toNumber() ?? null,
    frontFoilColors: change.frontFoilColors,
    backFoilColors: change.backFoilColors,
    // Explicit side arrays are authoritative. Keeping the retired aggregate
    // empty also preserves the valid case of three colors on each side.
    foilColors: [],
    foilTechnique: item.foilTechnique,
    hasLocalFoil: item.hasLocalFoil,
    lamination: item.lamination,
    printColors: item.printColors,
    isDoubleSided: change.isDoubleSided,
  });
  if (parsed.success) return;

  const issue = parsed.error.issues[0];
  throw new OrderChangeRequestError(
    `款式“${item.name}”的计价事实不合法：${issue?.message ?? '请检查计价路线与工艺参数'}`,
  );
}

function hasStartedProductionTask(
  item: Pick<ProductionFactGuardItem, 'tasks'>,
): boolean {
  return item.tasks.some(
    (task) =>
      task.status === TaskStatus.IN_PROGRESS ||
      task.status === TaskStatus.COMPLETED,
  );
}

function assertProductionFactsChangeAllowed(
  item: ProductionFactGuardItem,
  change: NormalizedProposedItemChange,
): void {
  if (!hasStartedProductionTask(item)) return;

  const specificationChanged =
    change.specification !== undefined &&
    change.specification !== item.specification;
  const sourceFoilFacts = deriveLegacyOrderItemFoilFacts(item);
  const foilFactsChanged =
    change.foilFactsProvided &&
    (!sameStringSet(
      change.frontFoilColors,
      sourceFoilFacts.frontFoilColors,
    ) ||
      !sameStringSet(
        change.backFoilColors,
        sourceFoilFacts.backFoilColors,
      ));

  if (specificationChanged || foilFactsChanged) {
    throw new OrderChangeRequestError(
      `款式“${item.name}”已有开工或完工记录，不能再修改规格或烫金参数`,
    );
  }
}

function assertNoMaterializedProductionFactChange(
  operations: readonly MaterializedProductionOperation[],
  changes: readonly NormalizedProposedItemChange[],
  itemById: ReadonlyMap<string, ProductionFactGuardItem & { quantity: number }>,
): void {
  if (operations.length === 0) return;
  const affectsMaterializedFacts = changes.some((change) => {
    if (change.operation === 'ADD') return true;
    const item = itemById.get(change.itemId);
    if (!item) throw new OrderChangeRequestError('原款式已不存在，请重新申请');
    return changeAffectsPricing(change, item);
  });
  if (!affectsMaterializedFacts) return;
  const hasReport = operations.some(
    (operation) => (operation.reports?.length ?? 0) > 0,
  );
  throw new OrderChangeRequestError(
    hasReport
      ? '工单已有新报工记录，不能再修改数量、规格、烫金事实或新增款式'
      : '工单已物化生产工序，不能再修改数量、规格、烫金事实或新增款式',
  );
}

function assertQuantityChangeAllowed(
  item: QuantityGuardItem,
  nextQuantity: number,
): number {
  if (hasStartedProductionTask(item)) {
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
                tasks: { select: LEGACY_TASK_STATUS_SELECT },
                shipmentLines: {
                  include: {
                    shipment: { select: { id: true, sequence: true } },
                  },
                },
              },
            },
            shipments: {
              orderBy: { sequence: 'asc' },
              select: {
                id: true,
                sequence: true,
                destinationProvince: true,
                weightKg: true,
              },
            },
            packagingGroups: {
              orderBy: { sequence: 'asc' },
              include: {
                lines: {
                  select: { orderItemId: true, unitsPerBag: true },
                },
              },
            },
            productionOperations: {
              take: 1,
              select: {
                id: true,
                reports: { take: 1, select: { id: true } },
              },
            },
            customerCharges: {
              select: {
                amount: true,
                category: { select: { code: true } },
              },
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

    const proposedChanges = readProposedChanges(request.proposedChanges);
    const itemById = new Map(request.order.items.map((item) => [item.id, item]));
    const changes = normalizeProposedChanges(proposedChanges, itemById);
    if (!request.order.shipments.some((shipment) => shipment.sequence === 1)) {
      throw new OrderChangeRequestError('工单缺少主收货地址，不能安全更新数量');
    }
    for (const change of changes) {
      const sourceId =
        change.operation === 'UPDATE'
          ? change.itemId
          : change.templateItemId;
      const item = itemById.get(sourceId);
      if (!item) {
        throw new OrderChangeRequestError(
          change.operation === 'UPDATE'
            ? '原款式已不存在，请重新申请'
            : '参考款式已不存在，请重新申请',
        );
      }
      assertSpecificationIdentityUnchanged(item, change);
      assertMergedPricingFactsValid(item, change);
      if (change.operation !== 'UPDATE') continue;
      assertProductionFactsChangeAllowed(item, change);
      if (
        change.quantity !== undefined &&
        change.quantity !== item.quantity
      ) {
        assertQuantityChangeAllowed(item, change.quantity);
      }
    }
    assertPackagingChangeRequestSupported({
      changes,
      groups: request.order.packagingGroups ?? [],
    });
    assertNoMaterializedProductionFactChange(
      request.order.productionOperations ?? [],
      changes,
      itemById,
    );

    const quotedAt = new Date();
    const pricingChanged = hasPricingFactChanges(changes, itemById);
    if (!pricingChanged) {
      const items = changes.map((change, changeIndex) => {
        const source = itemById.get(
          change.operation === 'UPDATE' ? change.itemId : change.templateItemId,
        );
        if (!source) throw new OrderChangeRequestError('款式已不存在，请重新申请');
        const subtotal = new Decimal(source.subtotal).toFixed(2);
        return {
          changeIndex,
          operation: change.operation,
          sourceItemId: source.id,
          previousName: source.name,
          name: change.name ?? source.name,
          quantity: change.operation === 'ADD'
            ? change.quantity
            : (change.quantity ?? source.quantity),
          priceImpact: 'UNCHANGED' as const,
          oldSubtotal: subtotal,
          newSubtotal: subtotal,
          suggestedUnitPrice: null,
          suggestedFixedFee: null,
          errors: [],
        };
      });
      return {
        requestId: request.id,
        orderId: request.orderId,
        baseRevision: request.baseRevision,
        quotedAt: quotedAt.toISOString(),
        complete: true,
        requiresReviewRemark: false,
        oldTotal: new Decimal(request.order.totalAmount).toFixed(2),
        newTotal: new Decimal(request.order.totalAmount).toFixed(2),
        delta: '0.00',
        items,
      };
    }

    const primaryShipment = request.order.shipments.find(
      (shipment) => shipment.sequence === 1,
    )!;
    const projected = await calculateProjectedOrderQuote({
      client: tx,
      now: quotedAt,
      settlementType: request.order.settlementType,
      isSfCollect: request.order.isSfCollect,
      items: request.order.items,
      logisticsItems: request.order.items,
      shipments: request.order.shipments,
      primaryShipmentId: primaryShipment.id,
      packagingGroups: request.order.packagingGroups ?? [],
      changes,
    });
    const quoteByItemKey = new Map(
      projected.calculation.processing.items.map((quote, index) => [
        projected.projectedItems[index]?.itemKey,
        quote,
      ]),
    );
    const projectedByChangeIndex = new Map(
      projected.projectedItems.flatMap((item) =>
        item.changeIndex === null ? [] : [[item.changeIndex, item] as const],
      ),
    );
    const items: OrderChangePricingPreviewItem[] = changes.map(
      (change, changeIndex) => {
        const item = projectedByChangeIndex.get(changeIndex);
        const quote = item ? quoteByItemKey.get(item.itemKey) : null;
        if (!item || !quote) {
          throw new OrderChangeRequestError('纯引擎的款式投影结果缺失');
        }
        const pricing = resolvePureChangeRequestPricing({
          quote,
          quantity: item.quantity,
          itemName: item.itemName,
          itemKey: item.itemKey,
          requestId: request.id,
          quotedAt,
        });
        const source = itemById.get(item.sourceItemId);
        return {
          changeIndex,
          operation: change.operation,
          sourceItemId: item.sourceItemId,
          previousName: source?.name ?? null,
          name: item.itemName,
          quantity: item.quantity,
          priceImpact: 'QUOTED',
          oldSubtotal: item.oldSubtotal,
          newSubtotal: pricing.subtotal,
          suggestedUnitPrice: pricing.unitPrice,
          suggestedFixedFee: pricing.fixedFee,
          errors: [],
        };
      },
    );

    const recalculatedChargeCodes = new Set([
      'SHIPPING_FEE',
      'PACKING_MATERIAL',
      ...(request.order.settlementType === OrderSettlementType.EXTERNAL_SALES
        ? ['PLATE_MAKING_FEE']
        : []),
    ]);
    const currentRecalculatedCharges = request.order.customerCharges
      .filter((charge) =>
        recalculatedChargeCodes.has(String(charge.category.code)),
      )
      .reduce((sum, charge) => sum.plus(charge.amount ?? 0), new Decimal(0));
    const preservedCharges = new Decimal(request.order.totalAmount)
      .minus(request.order.processingAmount)
      .minus(currentRecalculatedCharges);
    const projectedTotal = new Decimal(projected.calculation.quote.knownTotal)
      .plus(preservedCharges);
    if (
      !projectedTotal.isFinite() ||
      projectedTotal.isNegative() ||
      projectedTotal.gt(DECIMAL_12_2_MAX)
    ) {
      throw new OrderChangeRequestError(
        '工单总额超过可保存上限 9,999,999,999.99 元',
      );
    }
    const newTotal = projectedTotal.toFixed(2);

    return {
      requestId: request.id,
      orderId: request.orderId,
      baseRevision: request.baseRevision,
      quotedAt: quotedAt.toISOString(),
      complete: true,
      requiresReviewRemark: false,
      oldTotal: new Decimal(request.order.totalAmount).toFixed(2),
      newTotal,
      delta: projectedTotal.minus(request.order.totalAmount).toFixed(2),
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
                tasks: { select: LEGACY_TASK_STATUS_SELECT },
                shipmentLines: {
                  include: {
                    shipment: { select: { id: true, sequence: true } },
                  },
                },
              },
            },
            shipments: {
              orderBy: { sequence: 'asc' },
              select: {
                id: true,
                sequence: true,
                destinationProvince: true,
                weightKg: true,
              },
            },
            packagingGroups: {
              orderBy: { sequence: 'asc' },
              include: {
                lines: {
                  select: { orderItemId: true, unitsPerBag: true },
                },
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
            productionOperations: {
              take: 1,
              select: {
                id: true,
                reports: { take: 1, select: { id: true } },
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

    const proposedChanges = readProposedChanges(request.proposedChanges);
    // Re-check the live item count under the per-order lock. This is the
    // authoritative guard for legacy pending requests and any state change
    // that occurred after the proposal was recorded.
    assertOrderItemLimit(request.order.items.length, proposedChanges);
    const itemById = new Map(request.order.items.map((item) => [item.id, item]));
    const changes = normalizeProposedChanges(proposedChanges, itemById);
    const primaryShipment = request.order.shipments.find(
      (shipment) => shipment.sequence === 1,
    );
    if (!primaryShipment) {
      throw new OrderChangeRequestError('工单缺少主收货地址，不能安全更新数量');
    }
    for (const change of changes) {
      const sourceId =
        change.operation === 'UPDATE'
          ? change.itemId
          : change.templateItemId;
      const item = itemById.get(sourceId);
      if (!item) {
        throw new OrderChangeRequestError(
          change.operation === 'UPDATE'
            ? '原款式已不存在，请重新申请'
            : '参考款式已不存在，请重新申请',
        );
      }
      assertSpecificationIdentityUnchanged(item, change);
      assertMergedPricingFactsValid(item, change);
      if (change.operation === 'UPDATE') {
        assertProductionFactsChangeAllowed(item, change);
      }
    }
    assertPackagingChangeRequestSupported({
      changes,
      groups: request.order.packagingGroups ?? [],
    });
    assertNoMaterializedProductionFactChange(
      request.order.productionOperations ?? [],
      changes,
      itemById,
    );

    const pricingChanged = hasPricingFactChanges(changes, itemById);
    const projected = pricingChanged
      ? await calculateProjectedOrderQuote({
          client: tx,
          now: reviewedAt,
          settlementType: request.order.settlementType,
          isSfCollect: request.order.isSfCollect,
          items: request.order.items,
          logisticsItems: request.order.items,
          shipments: request.order.shipments,
          primaryShipmentId: primaryShipment.id,
          packagingGroups: request.order.packagingGroups ?? [],
          changes,
        })
      : null;
    const quoteByItemKey = new Map(
      projected?.calculation.processing.items.map((quote, index) => [
        projected.projectedItems[index]?.itemKey,
        quote,
      ]) ?? [],
    );
    const projectedByItemKey = new Map(
      projected?.projectedItems.map((item) => [item.itemKey, item]) ?? [],
    );
    const pricingByItemKey = new Map<
      string,
      ReturnType<typeof resolvePureChangeRequestPricing>
    >();
    for (const item of projected?.projectedItems ?? []) {
      const quote = quoteByItemKey.get(item.itemKey);
      if (!quote) throw new OrderChangeRequestError('纯引擎的款式报价结果缺失');
      pricingByItemKey.set(
        item.itemKey,
        resolvePureChangeRequestPricing({
          quote,
          quantity: item.quantity,
          itemName: item.itemName,
          itemKey: item.itemKey,
          requestId: request.id,
          quotedAt: reviewedAt,
        }),
      );
    }
    const packagingReprice = projected
      ? packagingRepriceFromPureCalculation({
          calculation: projected.calculation,
          requestId: request.id,
          reviewedAt,
          storedTotal: request.order.packagingAmount,
          groups: request.order.packagingGroups ?? [],
        })
      : null;

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
        }

        const pricing = pricingByItemKey.get(item.id);
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            name: change.name,
            quantity: change.quantity,
            specification: change.specification,
            ...(change.foilFactsProvided
              ? {
                  frontFoilColors: change.frontFoilColors,
                  backFoilColors: change.backFoilColors,
                  foilColors: change.foilColors,
                  isDoubleSided: change.isDoubleSided,
                  isDoubleColor: change.isDoubleColor,
                }
              : {}),
            ...(pricing ?? {}),
          },
        });
        continue;
      }

      const template = itemById.get(change.templateItemId);
      if (!template) throw new OrderChangeRequestError('参考款式已不存在，请重新申请');
      const pricing = pricingByItemKey.get(addedItemKey(changeIndex));
      if (!pricing) {
        throw new OrderChangeRequestError('新增款式缺少报价结果，无法批准修改');
      }
      const created = await tx.orderItem.create({
        data: {
          orderId: request.order.id,
          sequence: nextSequence,
          name: change.name,
          productId: template.productId,
          pricingRoute: template.pricingRoute,
          productStructure: template.productStructure,
          artworkVersion: template.artworkVersion,
          plateGroupId: template.plateGroupId,
          pricingGroup: template.pricingGroup,
          manualQuoteReason: template.manualQuoteReason,
          specification: change.specification ?? template.specification,
          actualWidthMm: template.actualWidthMm,
          actualHeightMm: template.actualHeightMm,
          paperType: template.paperType,
          paperWeightGsm: template.paperWeightGsm,
          quantity: change.quantity,
          crafts: template.crafts,
          frontFoilColors: change.frontFoilColors,
          backFoilColors: change.backFoilColors,
          foilColors: change.foilColors,
          foilTechnique: template.foilTechnique,
          hasLocalFoil: template.hasLocalFoil,
          lamination: template.lamination,
          printColors: template.printColors,
          printColorsKnown: true,
          isDoubleSided: change.isDoubleSided,
          isDoubleColor: change.isDoubleColor,
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
      // 已发出/加工中/已回货的外协单都是不可变履约快照。新款式即使
      // 模板款式曾外协，也不能被旧外协单自动“继承”；它保持未覆盖，
      // 直到主管显式新建外协单。完工闸口会用逐款数量快照拦住。
    }

    if (projected) {
      const changedExistingIds = new Set(
        changes.flatMap((change) =>
          change.operation === 'UPDATE' ? [change.itemId] : [],
        ),
      );
      for (const item of request.order.items) {
        if (changedExistingIds.has(item.id)) continue;
        const pricing = pricingByItemKey.get(item.id);
        if (!pricing || !projectedByItemKey.has(item.id)) {
          throw new OrderChangeRequestError('整单重算缺少存量款式结果');
        }
        await tx.orderItem.update({
          where: { id: item.id },
          data: pricing,
        });
      }
    }

    if (packagingReprice) {
      await applyPackagingRepricePlans(tx, packagingReprice);
    }

    if (request.order.settlementType === OrderSettlementType.EXTERNAL_SALES && projected) {
      await refreshExternalChargesAfterPricingChange({
        client: tx,
        calculation: projected.calculation,
        requestId: request.id,
        reviewedAt,
        shipments: request.order.shipments,
        customerCharges: request.order.customerCharges,
        orderId: request.order.id,
        actorId: actor.id,
      });
    }

    const refreshedItems = await tx.orderItem.findMany({
      where: { orderId: request.order.id },
      select: { subtotal: true },
    });
    const nextRevision = request.order.revision + 1;
    const nextPackagingAmount =
      packagingReprice?.total ?? request.order.packagingAmount;
    const nextProcessingAmount = orderTotal(
      refreshedItems,
      nextPackagingAmount,
    );
    if (projected) {
      const pureProcessingAmount = projected.calculation.quote.items
        .reduce(
          (sum, item) => {
            if (item.amount === null) {
              throw new OrderChangeRequestError('纯引擎款式金额待定，禁止批准修改');
            }
            return sum.plus(item.amount);
          },
          new Decimal(0),
        )
        .plus(
          projected.calculation.quote.packagingGroups.reduce(
            (sum, group) => {
              if (group.amount === null) {
                throw new OrderChangeRequestError('纯引擎入袋金额待定，禁止批准修改');
              }
              return sum.plus(group.amount);
            },
            new Decimal(0),
          ),
        );
      if (!pureProcessingAmount.equals(nextProcessingAmount)) {
        throw new OrderChangeRequestError('持久化加工费与纯引擎输出不一致');
      }
    }
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
        ...(packagingReprice && packagingReprice.plans.length > 0
          ? { packagingAmount: nextPackagingAmount }
          : {}),
        processingAmount: nextProcessingAmount,
        totalAmount: nextTotal,
      },
    });
    const pricingRevision =
      request.order.settlementType === OrderSettlementType.EXTERNAL_SALES &&
      projected
        ? await appendOrderPricingRevisionInTx(tx, {
            orderId: request.order.id,
            status: ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
            source: 'CHANGE_REQUEST_APPLIED_PENDING',
            actorId: actor.id,
            now: reviewedAt,
            expectedPriceRevision: request.order.priceRevision,
            incrementOrderRevision: false, remark: reviewRemark ?? request.reason,
            orderFeeSnapshot: { quotedFee: nextTotal, confirmedFee: null, settledFee: null },
            metadata: {
              changeRequestId: request.id,
              engineVersion: 'CREATE_ORDER_PURE_V1',
              priceBooks: projected.calculation.quote.priceVersion,
              quotedFee: nextTotal,
              quotedFeeCompleteness: OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
              pureQuote: {
                status: projected.calculation.quote.status,
                knownTotal: projected.calculation.quote.knownTotal,
                pendingLineCodes: projected.calculation.quote.pendingLineCodes,
              },
            },
          })
        : null;
    if (pricingRevision && projected) {
      const versions = projected.calculation.quote.priceVersion;
      await tx.orderPriceVersionLock.createMany({
        data: [
          {
            pricingRevisionId: pricingRevision.pricingRevisionId,
            purpose: CustomerPriceBookPurpose.PROCESSING,
            priceBookId: versions.processing.id,
            priceBookVersion: versions.processing.version,
            sourceSha256: versions.processing.sourceSha256,
            createdAt: reviewedAt,
          },
          {
            pricingRevisionId: pricingRevision.pricingRevisionId,
            purpose: CustomerPriceBookPurpose.LOGISTICS,
            priceBookId: versions.logistics.id,
            priceBookVersion: versions.logistics.version,
            sourceSha256: versions.logistics.sourceSha256,
            createdAt: reviewedAt,
          },
        ],
      });
      await tx.order.update({
        where: { id: request.order.id },
        data: {
          quotedFee: nextTotal,
          quotedFeeCompleteness: OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
          quotedPricingRevisionId: pricingRevision.pricingRevisionId,
          confirmedFee: null, settledFee: null,
        },
      });
    }
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
          ...(packagingReprice && packagingReprice.plans.length > 0
            ? {
                packagingAmount: {
                  before: String(request.order.packagingAmount),
                  after: nextPackagingAmount,
                },
                packagingGroups: packagingReprice.plans.map(
                  (plan) => plan.audit,
                ),
              }
            : {}),
          ...(pricingRevision
            ? {
                pricingStatus: {
                  before: request.order.pricingStatus,
                  after:
                    ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
                },
                priceRevision: {
                  before: request.order.priceRevision,
                  after: pricingRevision.priceRevision,
                },
              }
            : {}),
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
