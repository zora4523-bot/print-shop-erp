import Decimal from 'decimal.js';
import {
  CsSalesEntryType,
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderItemPricingRoute,
  OrderPackagingMode,
  OrderSettlementType,
  OrderStatus,
  MachineType,
  Prisma,
  Role,
  TaskStatus,
  WorkerType,
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
import { deriveExternalOrderChargeShipments } from '../price/external-order-charge-facts';
import {
  quoteOrderItems,
  type QuoteOrderItemInput,
} from '../price/quote-service';
import { quoteOrderPackagingGroups } from '../price/order-packaging-quote';
import type { QuoteResult } from '../price/quote';
import {
  assertCsOrderSalesLedgerReconciledInTx,
  CsSalesLedgerError,
  recordCsSalesEntryInTx,
} from '../salary/cs-sales';
import { MAX_ORDER_ITEMS_PER_ORDER } from './limits';
import { orderCascadeLockKey } from './locks';
import { appendOrderPricingRevisionInTx } from './pricing-revision';
import { calculatePackagingBagCount } from './packaging-bag-count';
import { ORDER_PRICING_STATUS } from './pricing-status';
import { deriveLegacyOrderItemFoilFacts } from './pricing-route';

const CHANGEABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.SUBMITTED,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
];
const DECIMAL_12_2_MAX = new Decimal('9999999999.99');
const CHANGE_REQUEST_TASK_SELECT = {
  id: true,
  craftId: true,
  workerId: true,
  workerType: true,
  machineType: true,
  status: true,
  plannedQty: true,
  isSelfClaimable: true,
  selfClaimOpenedAt: true,
  selfClaimedAt: true,
  claimMachineTypes: true,
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

type CarriedPrice = {
  unitPrice: Prisma.Decimal;
  fixedFee: Prisma.Decimal;
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

type PackagingProjectionItem = {
  id: string;
  quantity: number;
};

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

function hasQuantityFactChanges(
  changes: readonly ProposedItemChange[],
  itemById: ReadonlyMap<string, { quantity: number }>,
): boolean {
  return changes.some((change) => {
    if (change.operation === 'ADD') return true;
    return (
      change.quantity !== undefined &&
      change.quantity !== itemById.get(change.itemId)?.quantity
    );
  });
}

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

function projectChangedItemQuantities(input: {
  items: readonly PackagingProjectionItem[];
  changes: readonly ProposedItemChange[];
}): Map<string, number> {
  const quantities = new Map(
    input.items.map((item) => [item.id, item.quantity]),
  );
  for (const change of input.changes) {
    if (change.operation !== 'UPDATE' || change.quantity === undefined) {
      continue;
    }
    if (!quantities.has(change.itemId)) {
      throw new OrderChangeRequestError('原款式已不存在，无法重算包装组');
    }
    quantities.set(change.itemId, change.quantity);
  }
  return quantities;
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

/**
 * Re-derive every packaging-group bag count from item quantities and the
 * persisted per-bag composition. External orders then quote those facts
 * against the price book effective at approval time; no browser count or old
 * order-level packaging amount participates in the result.
 */
async function repricePackagingGroupsAfterQuantityChange(input: {
  client: Prisma.TransactionClient;
  requestId: string;
  reviewedAt: Date;
  settlementType: OrderSettlementType;
  storedTotal: Prisma.Decimal | string | number;
  items: readonly PackagingProjectionItem[];
  changes: readonly ProposedItemChange[];
  groups: readonly PackagingProjectionGroup[];
}): Promise<PackagingRepriceResult> {
  if (input.groups.length === 0) {
    if (!new Decimal(input.storedTotal).isZero()) {
      throw new OrderChangeRequestError(
        '工单存在入袋费但缺少包装组事实，无法批准数量修改',
      );
    }
    return { total: '0.00', plans: [] };
  }
  assertNoCrossGroupItemMembership(input.groups);
  if (input.changes.some((change) => change.operation === 'ADD')) {
    throw new OrderChangeRequestError(
      '当前工单已有包装组；新增款式必须同时指定每袋组成，当前修改申请暂不支持',
    );
  }

  const quantities = projectChangedItemQuantities({
    items: input.items,
    changes: input.changes,
  });
  const derived = input.groups.map((group) => {
    const itemQuantities = group.lines.map((line) => {
      const quantity = quantities.get(line.orderItemId);
      if (quantity === undefined) {
        throw new OrderChangeRequestError(
          `包装组 ${group.sequence} 引用了不存在的款式，无法重算入袋费`,
        );
      }
      return quantity;
    });
    const count = calculatePackagingBagCount({
      mode: group.mode,
      itemQuantities,
      itemUnitsPerBag: group.lines.map((line) => line.unitsPerBag),
    });
    if (!count.complete) {
      throw new OrderChangeRequestError(
        `包装组 ${group.sequence}：${count.errors.join('；')}`,
      );
    }
    return { group, actualBagCount: count.bagCount };
  });

  if (input.settlementType === OrderSettlementType.EXTERNAL_SALES) {
    const quote = await quoteOrderPackagingGroups(
      derived.map(({ group, actualBagCount }) => ({
        groupKey: String(group.sequence),
        mode: group.mode,
        actualBagCount,
      })),
      input.settlementType,
      input.reviewedAt,
      input.client,
      { snapshotLockHeld: true },
    );
    if (quote.requiresAdminConfirmation) {
      throw new OrderChangeRequestError(
        `修改数量后无法按当前规则重算入袋费：${quote.errors.join('；')}`,
      );
    }

    const quoteByGroupKey = new Map(
      quote.groups.map((group) => [group.groupKey, group]),
    );
    const plans = derived.map(({ group, actualBagCount }) => {
      const line = quoteByGroupKey.get(String(group.sequence));
      if (
        !line?.complete ||
        line.suggestedUnitPrice === null ||
        line.suggestedSubtotal === null
      ) {
        throw new OrderChangeRequestError(
          `包装组 ${group.sequence} 的入袋费报价结果不完整`,
        );
      }
      const pricingSnapshot = {
        ...line.snapshot,
        source: 'CHANGE_REQUEST_REQUOTE',
        requestId: input.requestId,
        quotedAt: input.reviewedAt.toISOString(),
        actual: {
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
        .reduce(
          (sum, plan) => sum.plus(plan.subtotal),
          new Decimal(0),
        )
        .toFixed(2),
      plans,
    };
  }

  const plans = derived.map(({ group, actualBagCount }) => {
    const subtotal = new Decimal(group.unitPrice)
      .times(actualBagCount)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (
      !subtotal.isFinite() ||
      subtotal.isNegative() ||
      subtotal.gt(DECIMAL_12_2_MAX)
    ) {
      throw new OrderChangeRequestError(
        `包装组 ${group.sequence} 的入袋费超过可保存上限`,
      );
    }
    const unitPrice = new Decimal(group.unitPrice).toFixed(4);
    const amount = subtotal.toFixed(2);
    const pricingSnapshot = {
      ...packagingSnapshotBase(group.pricingSnapshot),
      source: 'CHANGE_REQUEST_STORED_RATE_RECALC',
      requestId: input.requestId,
      quotedAt: input.reviewedAt.toISOString(),
      input: {
        groupKey: String(group.sequence),
        mode: group.mode,
        actualBagCount,
      },
      actual: {
        unitPrice,
        subtotal: amount,
        overrideReason: group.priceOverrideReason,
      },
    } satisfies Prisma.InputJsonObject;
    return {
      groupId: group.id,
      actualBagCount,
      unitPrice,
      subtotal: amount,
      suggestedSubtotal: null,
      pricingSnapshot,
      priceOverrideReason: group.priceOverrideReason,
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
          unitPrice,
          subtotal: amount,
          pricingSnapshot,
          overrideReason: group.priceOverrideReason,
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

const LOGISTICS_REPRICE_REASON_PLACEHOLDER =
  '工单修改收费重算：等待审核原因校验';

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

function projectShipmentChargeFacts(input: {
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
      const itemKey = `ADD:${changeIndex + 1}`;
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

  return deriveExternalOrderChargeShipments({
    isSfCollect: input.isSfCollect,
    items: projectedItems,
    shipments: input.shipments.map((shipment) => ({
      shipmentKey: String(shipment.sequence),
      province: shipment.destinationProvince,
      billableWeightKg: shipment.weightKg?.toString() ?? null,
      itemQuantities: projectedItems.map(
        (item) =>
          allocationByItemKey.get(item.itemKey)?.get(shipment.id) ?? 0,
      ),
    })),
  });
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
  if (standardCharges.some((charge) => charge.amount === null)) {
    throw new OrderChangeRequestError(
      '快递/耗材收费金额待定，无法批准数量修改',
    );
  }
  const knownStandardCharges = standardCharges.filter(
    (
      charge,
    ): charge is LogisticsProjectionCharge & { amount: Prisma.Decimal } =>
      charge.amount !== null,
  );
  const priceBookIds = [
    ...new Set(
      knownStandardCharges.flatMap((charge) =>
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
    knownStandardCharges.map((charge) => [
      `${charge.shipmentId}:${String(charge.category.code)}`,
      charge,
    ]),
  );
  const projectedShipmentFacts = projectShipmentChargeFacts({
    shipments: input.shipments,
    items: input.items,
    changes: input.changes,
    primaryShipmentId: input.primaryShipmentId,
    isSfCollect: input.isSfCollect,
  });
  const projectedFactBySequence = new Map(
    projectedShipmentFacts.map((fact) => [fact.shipmentKey, fact]),
  );

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
          const fact = projectedFactBySequence.get(String(shipment.sequence));
          if (!fact) {
            throw new OrderChangeRequestError(
              `收货地址 ${shipment.sequence} 缺少可计价的分货事实`,
            );
          }
          return {
            ...fact,
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
    knownStandardCharges.map((charge) => [String(charge.businessKey), charge]),
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
  changes: NormalizedProposedItemChange[];
  itemById: ReadonlyMap<string, PricingProjectionItem>;
  settlementType: OrderSettlementType;
  quotedAt: Date;
  client: Prisma.TransactionClient;
}): Promise<ChangeQuoteContext[]> {
  const quoteInputs: QuoteOrderItemInput[] = [];
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
      const sourceFoilFacts = deriveLegacyOrderItemFoilFacts(item);
      const needsRequote =
        quantity !== item.quantity ||
        specification !== item.specification ||
        !sameStringSet(
          change.frontFoilColors,
          sourceFoilFacts.frontFoilColors,
        ) ||
        !sameStringSet(change.backFoilColors, sourceFoilFacts.backFoilColors);
      if (!needsRequote) continue;

      quoteInputs.push({
        productId: item.productId,
        pricingRoute: item.pricingRoute,
        productStructure: item.productStructure,
        artworkVersion: item.artworkVersion,
        plateGroupId: item.plateGroupId,
        pricingGroup: item.pricingGroup,
        manualQuoteReason: item.manualQuoteReason,
        specification,
        actualWidthMm: item.actualWidthMm?.toNumber() ?? null,
        actualHeightMm: item.actualHeightMm?.toNumber() ?? null,
        paperType: item.paperType,
        paperWeightGsm: item.paperWeightGsm,
        quantity,
        crafts: item.crafts,
        frontFoilColors: change.frontFoilColors,
        backFoilColors: change.backFoilColors,
        foilColors: change.foilColors,
        foilTechnique: item.foilTechnique,
        hasLocalFoil: item.hasLocalFoil,
        lamination: item.lamination,
        printColors: item.printColors,
        isDoubleSided: change.isDoubleSided,
        isDoubleColor: change.isDoubleColor,
      });
      contexts.push({
        changeIndex,
        operation: change.operation,
        sourceItemId: item.id,
        carry: {
          unitPrice: item.unitPrice,
          fixedFee: item.fixedFee,
        },
        quantity,
        itemName: change.name ?? item.name,
        oldSubtotal: new Decimal(item.subtotal).toFixed(2),
      });
      continue;
    }

    const template = input.itemById.get(change.templateItemId);
    if (!template) throw new OrderChangeRequestError('参考款式已不存在，请重新申请');
    quoteInputs.push({
      productId: template.productId,
      pricingRoute: template.pricingRoute,
      productStructure: template.productStructure,
      artworkVersion: template.artworkVersion,
      plateGroupId: template.plateGroupId,
      pricingGroup: template.pricingGroup,
      manualQuoteReason: template.manualQuoteReason,
      specification: change.specification ?? template.specification,
      actualWidthMm: template.actualWidthMm?.toNumber() ?? null,
      actualHeightMm: template.actualHeightMm?.toNumber() ?? null,
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
      isDoubleSided: change.isDoubleSided,
      isDoubleColor: change.isDoubleColor,
    });
    contexts.push({
      changeIndex,
      operation: change.operation,
      sourceItemId: template.id,
      carry: {
        unitPrice: template.unitPrice,
        fixedFee: template.fixedFee,
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
      // Existing work orders are the immutable anchor for legacy product rows
      // created before structured catalog dimensions and paper facts existed.
      // New-order quotes never enable this compatibility path.
      allowInactiveCatalogFacts: true,
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

type ProductionFactGuardItem = FoilFactSource & {
  name: string;
  specification: string | null;
  tasks: Array<{ status: TaskStatus }>;
};

type PricingFactGuardItem = ProductionFactGuardItem & {
  quantity: number;
  productId: string | null;
  pricingRoute: import('../../generated/prisma/client').OrderItemPricingRoute;
  productStructure: import('../../generated/prisma/client').OrderProductStructure;
  actualWidthMm: Prisma.Decimal | null;
  actualHeightMm: Prisma.Decimal | null;
  paperType: string | null;
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
      `款式“${item.name}”的规格与产品 SKU、尺寸和产品结构必须一起变更；当前修改申请不支持单独改规格`,
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

type TaskAllocationSource = {
  id: string;
  craftId: string;
  plannedQty: number;
};

type TaskCopySource = TaskAllocationSource & {
  workerId: string | null;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  isSelfClaimable: boolean;
  claimMachineTypes: MachineType[];
};

function copiedTaskAssignment(
  task: TaskCopySource,
  selfClaimOpenedAt: Date,
): Pick<
  Prisma.ProductionTaskCreateManyInput,
  | 'workerId'
  | 'workerType'
  | 'machineType'
  | 'isSelfClaimable'
  | 'selfClaimOpenedAt'
  | 'selfClaimedAt'
  | 'claimMachineTypes'
> {
  if (task.isSelfClaimable) {
    const validClaimContext =
      task.workerId === null &&
      task.workerType !== null &&
      (task.workerType === WorkerType.MACHINE
        ? task.claimMachineTypes.length > 0
        : task.claimMachineTypes.length === 0);
    if (!validClaimContext) {
      throw new OrderChangeRequestError(
        '参考款式的抢单任务上下文不完整，请先重新派工',
      );
    }
    return {
      workerId: null,
      workerType: task.workerType,
      machineType: null,
      isSelfClaimable: true,
      selfClaimOpenedAt,
      selfClaimedAt: null,
      claimMachineTypes: [...task.claimMachineTypes],
    };
  }

  if (!task.workerId || !task.workerType) {
    throw new OrderChangeRequestError(
      '参考款式存在未派师傅且未开放抢单的任务，请先完成派工',
    );
  }
  return {
    workerId: task.workerId,
    workerType: task.workerType,
    machineType: task.machineType,
    isSelfClaimable: false,
    selfClaimOpenedAt: null,
    selfClaimedAt: null,
    claimMachineTypes: [],
  };
}

type TaskAllocation<T extends TaskAllocationSource> = {
  task: T;
  plannedQty: number;
};

function allocateOneCraft<T extends TaskAllocationSource>(
  tasks: T[],
  totalQuantity: number,
  itemName: string,
): TaskAllocation<T>[] {
  const ordered = [...tasks].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (totalQuantity < ordered.length) {
    throw new OrderChangeRequestError(
      `款式“${itemName}”的新数量 ${totalQuantity} 少于已拆分任务数 ${ordered.length}，请先调整排产`,
    );
  }
  if (
    ordered.some(
      (task) => !Number.isInteger(task.plannedQty) || task.plannedQty <= 0,
    )
  ) {
    throw new OrderChangeRequestError(
      `款式“${itemName}”存在非法的排产数量，请先修复任务`,
    );
  }

  const distributable = totalQuantity - ordered.length;
  const totalWeight = ordered.reduce(
    (sum, task) => sum + BigInt(task.plannedQty),
    BigInt(0),
  );
  const weighted = ordered.map((task) => {
    const numerator = BigInt(distributable) * BigInt(task.plannedQty);
    return {
      task,
      plannedQty: 1 + Number(numerator / totalWeight),
      remainder: numerator % totalWeight,
    };
  });
  const unallocated =
    totalQuantity -
    weighted.reduce((sum, allocation) => sum + allocation.plannedQty, 0);
  const remainderOrder = [...weighted].sort((left, right) => {
    if (left.remainder === right.remainder) {
      return left.task.id.localeCompare(right.task.id);
    }
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; index < unallocated; index += 1) {
    const allocation = remainderOrder[index];
    if (!allocation) {
      throw new OrderChangeRequestError('生产任务数量分配失败');
    }
    allocation.plannedQty += 1;
  }
  return weighted.map(({ task, plannedQty }) => ({ task, plannedQty }));
}

/**
 * Every craft is a complete pass over the style, so split tasks are
 * apportioned inside each craft group rather than across the whole item.
 * Hamilton allocation with a one-piece lower bound keeps every persisted
 * task positive and makes ties stable by task id.
 */
function allocateTasksByCraft<T extends TaskAllocationSource>(
  tasks: T[],
  totalQuantity: number,
  itemName: string,
): TaskAllocation<T>[] {
  const byCraft = new Map<string, T[]>();
  for (const task of tasks) {
    const group = byCraft.get(task.craftId);
    if (group) group.push(task);
    else byCraft.set(task.craftId, [task]);
  }
  return [...byCraft.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, group]) => allocateOneCraft(group, totalQuantity, itemName));
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
                tasks: { select: CHANGE_REQUEST_TASK_SELECT },
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
            packagingGroups: {
              orderBy: { sequence: 'asc' },
              include: {
                lines: {
                  select: { orderItemId: true, unitsPerBag: true },
                },
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
    const quantityFactsChanged = hasQuantityFactChanges(changes, itemById);
    const packagingReprice = quantityFactsChanged
      ? await repricePackagingGroupsAfterQuantityChange({
          client: tx,
          requestId: request.id,
          reviewedAt: quotedAt,
          settlementType: request.order.settlementType,
          storedTotal: request.order.packagingAmount,
          items: request.order.items,
          changes,
          groups: request.order.packagingGroups ?? [],
        })
      : null;
    // Start from the full receivable so external shipping/packing charges stay
    // intact while item subtotals are replaced below.
    let projectedTotal = new Decimal(request.order.totalAmount);
    if (packagingReprice) {
      projectedTotal = projectedTotal
        .minus(request.order.packagingAmount)
        .plus(packagingReprice.total);
    }
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
                tasks: { select: CHANGE_REQUEST_TASK_SELECT },
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
    const quantityFactsChanged = hasQuantityFactChanges(changes, itemById);
    const packagingReprice = quantityFactsChanged
      ? await repricePackagingGroupsAfterQuantityChange({
          client: tx,
          requestId: request.id,
          reviewedAt,
          settlementType: request.order.settlementType,
          storedTotal: request.order.packagingAmount,
          items: request.order.items,
          changes,
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
          const taskAllocations = allocateTasksByCraft(
            item.tasks.filter((task) => task.status === TaskStatus.PENDING),
            change.quantity,
            item.name,
          );
          for (const allocation of taskAllocations) {
            const updated = await tx.productionTask.updateMany({
              where: {
                id: allocation.task.id,
                orderItemId: item.id,
                status: TaskStatus.PENDING,
                plannedQty: allocation.task.plannedQty,
              },
              data: { plannedQty: allocation.plannedQty },
            });
            if (updated.count !== 1) {
              throw new OrderChangeRequestError(
                `款式“${item.name}”的排产任务已变更，请重新审核`,
              );
            }
          }
        }

        const pricing = pricingByChangeIndex.get(changeIndex);
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
      const templateTasks = template.tasks.filter(
        (task) => task.status !== TaskStatus.CANCELLED,
      );
      if (templateTasks.length > 0) {
        const taskAllocations = allocateTasksByCraft(
          templateTasks,
          change.quantity,
          change.name,
        );
        await tx.productionTask.createMany({
          data: taskAllocations.map(({ task, plannedQty }) => ({
            orderItemId: created.id,
            craftId: task.craftId,
            ...copiedTaskAssignment(task, reviewedAt),
            status: TaskStatus.PENDING,
            plannedQty,
          })),
        });
      }
      // 已发出/加工中/已回货的外协单都是不可变履约快照。新款式即使
      // 模板款式曾外协，也不能被旧外协单自动“继承”；它保持未覆盖，
      // 直到主管显式新建外协单。完工闸口会用逐款数量快照拦住。
    }

    if (packagingReprice) {
      await applyPackagingRepricePlans(tx, packagingReprice);
    }

    const shipmentQuantityChanged = quantityFactsChanged;
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
    const nextPackagingAmount =
      packagingReprice?.total ?? request.order.packagingAmount;
    const nextProcessingAmount = orderTotal(
      refreshedItems,
      nextPackagingAmount,
    );
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
      request.order.settlementType === OrderSettlementType.EXTERNAL_SALES
        ? await appendOrderPricingRevisionInTx(tx, {
            orderId: request.order.id,
            status: ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
            source: 'CHANGE_REQUEST_APPLIED_PENDING',
            actorId: actor.id,
            now: reviewedAt,
            expectedPriceRevision: request.order.priceRevision,
            incrementOrderRevision: false,
            remark: reviewRemark ?? request.reason,
            metadata: { changeRequestId: request.id },
          })
        : null;
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
