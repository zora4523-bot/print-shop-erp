import Decimal from 'decimal.js';
import {
  BackgroundJobStatus,
  CsSalesEntryType,
  CustomerPriceBookPurpose,
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderChangeRequestType,
  OrderCustomerChargeStatus,
  OrderItemPricingRoute,
  OrderPackagingMode,
  OrderPrintKind,
  OutsourceStatus,
  NotificationStatus,
  OrderQuotedFeeCompleteness,
  OrderSettlementType,
  OrderStatus,
  Prisma,
  ProductionOperationStatus,
  Role,
  TaskStatus,
} from '../../generated/prisma/client';
import type {
  CreateOrderChangeRequestInput,
  PreviewOrderCancellationSettlementInput,
  ReviewOrderChangeRequestInput,
  WithdrawOrderChangeRequestInput,
} from '../auth/schemas';
import {
  orderChangeRequestItemsSchema,
  orderItemPricingFactsSchema,
} from '../auth/schemas';
import { db } from '../db';
import { databaseClockNow } from '../background-jobs/clock';
import { lockSettlementCutoffShared } from '../finance/settlement-cutoff-lock';
import type { EnqueueClient } from '../background-jobs/repository';
import { dispatchNotification } from '../notification/dispatch';
import {
  NOTIFICATION_EVENTS,
  SUPERSEDED_BEFORE_SEND_ERROR,
  type NotificationPayloadFor,
} from '../notification/events';
import { enqueueNotificationInTransaction } from '../notification/transactional-outbox';
import { getSetting } from '../settings';
import {
  OrderCustomerChargeError,
  resolveExternalOrderChargesForFinalization,
} from '../price/order-charge-service';
import { calculateExternalOrderCharges } from '../price/external-order-charges';
import {
  assertCsOrderSalesLedgerReconciledInTx,
  CsSalesLedgerError,
  recordCsSalesEntryInTx,
} from '../salary/cs-sales';
import { MAX_ORDER_ITEMS_PER_ORDER } from './limits';
import { orderCascadeLockKey } from './locks';
import {
  PENDING_PLATE_BUSINESS_KEY,
  PendingPlateChargeError,
  quoteHasPendingPlateCharge,
  requireActivePlateCategoryIdInTx,
  upsertPendingPlateChargeInTx,
  waivePendingPlateChargeWhenNotApplicableInTx,
} from './pending-plate-charge';
import { appendOrderPricingRevisionInTx } from './pricing-revision';
import { ORDER_PRICING_STATUS } from './pricing-status';
import { transitionOrder } from './status-machine';
import {
  createOrderPrintRequestInTx,
  supersedeOlderOrderPrintRequestsInTx,
} from './print-jobs';
import {
  deriveLegacyOrderItemFoilFacts,
  isNewOrderPricingRoute,
  type NewOrderPricingRoute,
} from './pricing-route';
import {
  calculateCreateOrderQuoteFromCatalogInTx,
  type CatalogCreateOrderQuoteCalculation,
} from './create-order-quote-service';
import type { CreateOrderItemQuotePreview } from './create-order-quote-presentation';
import { activateProductionOperationsInTx } from '../production/operation-materialization-service';
import { isTrustedAdminPricingSnapshot } from './admin-pricing-snapshot';
import { hasExclusiveTrustedStructuredPlateCoverage } from './plate-charge-integrity';

const CHANGEABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.SUBMITTED,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.CONFIRMED,
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
];
const CANCELLABLE_BY_REQUEST_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
];
const VERSIONED_CHANGE_STATUSES = new Set<OrderStatus>([
  OrderStatus.CONFIRMED,
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
]);
const PLATE_PRESERVING_PRODUCTION_STATUSES = new Set<OrderStatus>([
  ...VERSIONED_CHANGE_STATUSES,
  // Legacy workflow state: production may already have consumed a physical
  // plate even though the row predates work-order generations.
  OrderStatus.IN_PRODUCTION,
]);
const REPRINT_CHANGE_STATUSES = new Set<OrderStatus>([
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
]);
type ReprintChangeStatus =
  | typeof OrderStatus.RELEASED
  | typeof OrderStatus.FOILING
  | typeof OrderStatus.PACKING;

function isReprintChangeStatus(
  status: OrderStatus,
): status is ReprintChangeStatus {
  return REPRINT_CHANGE_STATUSES.has(status);
}
const DECIMAL_12_2_MAX = new Decimal('9999999999.99');

function shouldSyncPlateCharge(
  status: OrderStatus,
  settlementType: OrderSettlementType,
): boolean {
  return (
    settlementType !== OrderSettlementType.NO_CHARGE &&
    !PLATE_PRESERVING_PRODUCTION_STATUSES.has(status)
  );
}
const LEGACY_TASK_STATUS_SELECT = {
  status: true,
} as const satisfies Prisma.ProductionTaskSelect;
type CreatedOrderChangeRequest = Prisma.OrderChangeRequestGetPayload<{
  include: {
    requester: { select: { displayName: true } };
    order: { select: { orderNo: true } };
  };
}>;

const CANCELLATION_REQUEST_INCLUDE = {
  order: {
    include: {
      items: { orderBy: { sequence: 'asc' as const } },
      shipments: { orderBy: { sequence: 'asc' as const } },
      packagingGroups: {
        orderBy: { sequence: 'asc' as const },
        include: {
          lines: { select: { orderItemId: true, unitsPerBag: true } },
        },
      },
      productionWorkOrderProgress: {
        select: {
          workOrderVersion: true,
          stage: true,
          workOrderProgressQuantity: true,
        },
      },
      productionOperations: { select: { id: true, status: true } },
      productionProgressSteps: { select: { id: true, status: true } },
      outsourceOrders: {
        where: {
          status: { in: [OutsourceStatus.SENT, OutsourceStatus.IN_PROGRESS] },
        },
        select: { id: true },
      },
      customerCharges: {
        select: { amount: true, category: { select: { code: true } } },
      },
    },
  },
} as const satisfies Prisma.OrderChangeRequestInclude;

type CancellationRequest = Prisma.OrderChangeRequestGetPayload<{
  include: typeof CANCELLATION_REQUEST_INCLUDE;
}>;

const MODIFICATION_REVIEW_REQUEST_INCLUDE = {
  requester: { select: { id: true, displayName: true, role: true } },
  order: {
    include: {
      items: {
        orderBy: { sequence: 'asc' as const },
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
        orderBy: { sequence: 'asc' as const },
        select: {
          id: true,
          sequence: true,
          destinationProvince: true,
          weightKg: true,
        },
      },
      packagingGroups: {
        orderBy: { sequence: 'asc' as const },
        include: {
          lines: { select: { orderItemId: true, unitsPerBag: true } },
        },
      },
      customerCharges: {
        select: {
          id: true,
          shipmentId: true,
          businessKey: true,
          priceBookId: true,
          status: true,
          amount: true,
          pricingSnapshot: true,
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
} as const satisfies Prisma.OrderChangeRequestInclude;

type ModificationReviewRequest = Prisma.OrderChangeRequestGetPayload<{
  include: typeof MODIFICATION_REVIEW_REQUEST_INCLUDE;
}>;

export class OrderChangeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderChangeRequestError';
  }
}

type ModifyChangeRequestInput = Extract<
  CreateOrderChangeRequestInput,
  { type: 'MODIFY' }
>;
type CreateOrderChangeRequestCommand =
  | CreateOrderChangeRequestInput
  | (Omit<ModifyChangeRequestInput, 'type' | 'modifyKind'> & {
      type?: 'MODIFY';
      modifyKind?: ModifyChangeRequestInput['modifyKind'];
    });

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

function assertExpectedOrderVersions(
  input: Pick<
    CreateOrderChangeRequestInput,
    'expectedRevision' | 'expectedWorkOrderVersion'
  >,
  order: { revision: number; workOrderVersion: number },
): void {
  if (
    input.expectedRevision === order.revision &&
    input.expectedWorkOrderVersion === order.workOrderVersion
  ) {
    return;
  }
  throw new OrderChangeRequestError(
    `工单版本已更新（业务版本 ${input.expectedRevision} → ${order.revision}，纸质工单版本 ${input.expectedWorkOrderVersion} → ${order.workOrderVersion}），请刷新后重新提交`,
  );
}

type ChangeRequestVersionState = {
  baseRevision: number;
  baseWorkOrderVersion?: number | null;
  order: { revision: number; workOrderVersion: number };
};

function changeRequestVersionMismatchReason(
  request: ChangeRequestVersionState,
): string | null {
  const revisionChanged = request.baseRevision !== request.order.revision;
  // NULL identifies a historical request created before production-version
  // capture existed. Such rows retain their original revision-only behavior.
  const workOrderVersionChanged =
    request.baseWorkOrderVersion != null &&
    request.baseWorkOrderVersion !== request.order.workOrderVersion;
  if (!revisionChanged && !workOrderVersionChanged) return null;

  const changes = [
    ...(revisionChanged
      ? [
          `业务版本 ${request.baseRevision} → ${request.order.revision}`,
        ]
      : []),
    ...(workOrderVersionChanged
      ? [
          `纸质工单版本 ${request.baseWorkOrderVersion} → ${request.order.workOrderVersion}`,
        ]
      : []),
  ];
  return `工单版本已更新（${changes.join('，')}），请重新提交申请`;
}

/**
 * Records a proposal only. The live order remains unchanged until an ADMIN
 * approves it, so every client keeps seeing one authoritative revision.
 */
export async function createOrderChangeRequest(
  input: CreateOrderChangeRequestCommand,
  actor: { id: string; role: Role },
) {
  const notificationEnabled = (
    await getSetting('notify_order_change_enabled')
  ).enabled;
  let postCommitNotification: NotificationPayloadFor<'ORDER_CHANGE_REQUESTED'> | null =
    null;
  let createdRequest: CreatedOrderChangeRequest;
  try {
    createdRequest = await db.$transaction(async (tx) => {
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
          workOrderVersion: true,
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
      assertExpectedOrderVersions(input, order);
      if (
        input.type === 'CANCEL' &&
        !CANCELLABLE_BY_REQUEST_STATUSES.includes(order.status)
      ) {
        throw new OrderChangeRequestError(
          '只有已确认且未发货的工单可以提交取消申请',
        );
      }
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
      assertNoSemanticNoopUpdates(normalizedChanges, itemById);
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
        if (
          change.operation === 'UPDATE' &&
          !allowsProductionGenerationUpgrade(order.status)
        ) {
          assertProductionFactsChangeAllowed(item, change);
        }
      }
      assertPackagingChangeRequestSupported({
        changes: normalizedChanges,
        groups: order.packagingGroups ?? [],
      });
      if (!allowsProductionGenerationUpgrade(order.status)) {
        assertNoMaterializedProductionFactChange(
          order.productionOperations ?? [],
          normalizedChanges,
          itemById,
        );
      }

      const created = await tx.orderChangeRequest.create({
        data: {
          orderId: order.id,
          requesterId: actor.id,
          baseRevision: order.revision,
          baseWorkOrderVersion: order.workOrderVersion,
          type:
            input.type === 'CANCEL'
              ? OrderChangeRequestType.CANCEL
              : OrderChangeRequestType.MODIFY,
          modifyKind:
            input.type !== 'CANCEL' ? (input.modifyKind ?? 'OTHER') : null,
          reason: input.reason,
          beforeSnapshot: {
            orderNo: order.orderNo,
            revision: order.revision,
            workOrderVersion: order.workOrderVersion,
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
      await tx.orderLog.create({
        data: {
          orderId: order.id,
          operatorId: actor.id,
          action: 'CHANGE_REQUEST_CREATED',
          changedFields: {
            requestId: created.id,
            requestType:
              input.type === 'CANCEL'
                ? OrderChangeRequestType.CANCEL
                : OrderChangeRequestType.MODIFY,
            baseRevision: order.revision,
            baseWorkOrderVersion: order.workOrderVersion,
            status: {
              before: null,
              after: OrderChangeRequestStatus.PENDING,
            },
          },
          remark: input.reason,
        },
      });

      if (notificationEnabled) {
        const requestKind =
          (input as CreateOrderChangeRequestInput & { type?: string }).type ===
          'CANCEL'
            ? '取消'
            : '修改';
        const payload: NotificationPayloadFor<'ORDER_CHANGE_REQUESTED'> = {
          orderId: order.id,
          orderNo: order.orderNo,
          // Deliberately do not forward the free-text reason: it may contain a
          // customer name, price, phone number, or other sensitive detail.
          summary: `销售已提交${requestKind}申请，待工厂确认`,
          deepLink: `/orders#wo=${encodeURIComponent(order.orderNo)}`,
        };
        const queued = await enqueueNotificationInTransaction(
          tx as unknown as EnqueueClient,
          'ORDER_CHANGE_REQUESTED',
          payload,
          {
            dedupeKey: `notification:ORDER_CHANGE_REQUESTED:${created.id}`,
          },
        );
        if (!queued) postCommitNotification = payload;
      }

      return created;
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

  if (postCommitNotification) {
    await dispatchNotification(
      'ORDER_CHANGE_REQUESTED',
      postCommitNotification,
      {
        dedupeKey: `notification:ORDER_CHANGE_REQUESTED:${createdRequest.id}`,
      },
    );
  }
  return createdRequest;
}

export async function withdrawOrderChangeRequest(
  input: WithdrawOrderChangeRequestInput,
  actor: { id: string; role: Role },
) {
  if (actor.role !== Role.SALES && actor.role !== Role.CUSTOMER_SERVICE) {
    throw new OrderChangeRequestError('只有申请人可以撤回工单变更申请');
  }
  const locator = await db.orderChangeRequest.findUnique({
    where: { id: input.requestId },
    select: { orderId: true },
  });
  if (!locator) throw new OrderChangeRequestError('变更申请不存在');

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;
    const request = await tx.orderChangeRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        orderId: true,
        requesterId: true,
        status: true,
        type: true,
      },
    });
    if (!request) throw new OrderChangeRequestError('变更申请不存在');
    if (request.requesterId !== actor.id) {
      throw new OrderChangeRequestError('只能撤回自己提交的申请');
    }
    if (request.status !== OrderChangeRequestStatus.PENDING) {
      throw new OrderChangeRequestError('只有待审核申请可以撤回');
    }
    const withdrawnAt = await databaseClockNow(tx);
    const withdrawn = await tx.orderChangeRequest.update({
      where: { id: request.id },
      data: {
        status: OrderChangeRequestStatus.WITHDRAWN,
        reviewedById: actor.id,
        reviewedAt: withdrawnAt,
        reviewRemark: '申请人撤回',
      },
    });
    await tx.orderLog.create({
      data: {
        orderId: request.orderId,
        operatorId: actor.id,
        action: 'CHANGE_REQUEST_WITHDRAWN',
        changedFields: {
          requestId: request.id,
          requestType: request.type,
          status: {
            before: OrderChangeRequestStatus.PENDING,
            after: OrderChangeRequestStatus.WITHDRAWN,
          },
        },
        remark: '申请人撤回待审核变更申请',
      },
    });
    return withdrawn;
  });
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
  preserveAdminConfirmed?: boolean;
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
  let total = new Decimal(0);
  const plans = input.groups.flatMap((group) => {
    if (
      input.preserveAdminConfirmed &&
      isTrustedAdminPricingSnapshot(group.pricingSnapshot)
    ) {
      total = total.plus(group.subtotal);
      return [];
    }
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
    total = total.plus(line.suggestedSubtotal);
    return [{
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
    } satisfies PackagingRepricePlan];
  });
  return {
    total: total.toFixed(2),
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
  status: OrderCustomerChargeStatus;
  amount: Prisma.Decimal | null;
  pricingSnapshot: Prisma.JsonValue | null;
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
  preserveAdminConfirmed?: boolean;
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
  const existingByBusinessKey = new Map(
    standardCharges.map((charge) => [String(charge.businessKey), charge]),
  );
  const preservedByBusinessKey = new Map(
    standardCharges.flatMap((charge) => {
      if (
        !input.preserveAdminConfirmed ||
        !isTrustedAdminPricingSnapshot(charge.pricingSnapshot)
      ) {
        return [];
      }
      if (
        charge.status === OrderCustomerChargeStatus.PENDING_AMOUNT ||
        charge.status === OrderCustomerChargeStatus.WAIVED ||
        charge.amount === null
      ) {
        throw new OrderChangeRequestError(
          `收费明细 ${charge.businessKey} 的管理员确认快照与收费状态不一致`,
        );
      }
      return [[charge.businessKey, charge] as const];
    }),
  );
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
          const shippingKey =
            `SHIPMENT:${shipment.shipmentKey}:SHIPPING_FEE`;
          const packingKey =
            `SHIPMENT:${shipment.shipmentKey}:PACKING_MATERIAL`;
          const preservedShipping = preservedByBusinessKey.get(shippingKey);
          const preservedPacking = preservedByBusinessKey.get(packingKey);
          const preservedReasons = [preservedShipping, preservedPacking]
            .flatMap((charge) => {
              const reason = charge?.overrideReason?.trim();
              return reason ? [reason] : [];
            })
            .filter(
              (reason, index, reasons) => reasons.indexOf(reason) === index,
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
            shippingFee: preservedShipping?.amount?.toFixed(2) ?? null,
            packingMaterialFee: preservedPacking?.amount?.toFixed(2) ?? null,
            overrideReason:
              preservedReasons.join('；') ||
              (preservedShipping || preservedPacking
                ? '沿用管理员已确认收费'
                : null),
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
  if (refreshed.requiresAdminConfirmation) {
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
  const hasPreservedPacking = [...preservedByBusinessKey.values()].some(
    (charge) => charge.category.code === 'PACKING_MATERIAL',
  );
  const refreshedLineMismatch = refreshed.charges.some((charge) => {
    const existing = existingByBusinessKey.get(charge.businessKey);
    if (!existing) return true;
    const preserved = preservedByBusinessKey.get(charge.businessKey);
    if (preserved) {
      return (
        preserved.amount === null ||
        !new Decimal(charge.amount).equals(preserved.amount)
      );
    }
    if (
      charge.suggestedAmount === null ||
      !new Decimal(charge.amount).equals(charge.suggestedAmount)
    ) {
      return true;
    }
    return (
      charge.categoryCode === 'SHIPPING_FEE' &&
      !new Decimal(charge.amount).equals(
        shippingLineByKey.get(charge.shipmentKey)?.amount ?? Number.NaN,
      )
    );
  });
  const automaticAggregateMismatch =
    preservedByBusinessKey.size === 0 &&
    (!new Decimal(refreshed.totalAmount).equals(
      input.calculation.quote.order.knownAmount,
    ) ||
      !cartonLine?.amount ||
      !packingTotal.equals(cartonLine.amount));
  const mixedPackingMismatch =
    preservedByBusinessKey.size > 0 &&
    !hasPreservedPacking &&
    (!cartonLine?.amount || !packingTotal.equals(cartonLine.amount));
  if (
    refreshedLineMismatch ||
    automaticAggregateMismatch ||
    mixedPackingMismatch
  ) {
    throw new OrderChangeRequestError('物流分项与纯引擎输出不一致');
  }
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
      preserved: preservedByBusinessKey.has(charge.businessKey),
    };
  });

  for (const plan of updatePlans) {
    if (plan.preserved) continue;
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
    if (quoteHasPendingPlateCharge(input.quote)) {
      const categoryId = await requireActivePlateCategoryIdInTx(input.client);
      await upsertPendingPlateChargeInTx({
        tx: input.client,
        orderId: input.orderId,
        actorId: input.actorId,
        categoryId,
        quote: input.quote,
        source: 'CHANGE_REQUEST_PENDING_PLATE',
      });
    } else {
      await waivePendingPlateChargeWhenNotApplicableInTx({
        tx: input.client,
        orderId: input.orderId,
        actorId: input.actorId,
        now: input.reviewedAt,
        quote: input.quote,
      });
    }
  } catch (error) {
    if (error instanceof PendingPlateChargeError) {
      throw new OrderChangeRequestError(error.message);
    }
    throw error;
  }
}

async function syncPricingChargesAfterChange(input: {
  client: Prisma.TransactionClient;
  calculation: CatalogCreateOrderQuoteCalculation;
  requestId: string;
  reviewedAt: Date;
  shipments: LogisticsProjectionShipment[];
  customerCharges: LogisticsProjectionCharge[];
  orderId: string;
  actorId: string;
  refreshExternalLogistics: boolean;
  syncPlateCharge: boolean;
}): Promise<void> {
  if (input.refreshExternalLogistics) {
    await refreshExternalLogisticsChargesAfterQuantityChange(input);
  }
  if (input.syncPlateCharge) {
    await resetPendingPlateChargeAfterPricingChange({
      client: input.client,
      orderId: input.orderId,
      actorId: input.actorId,
      reviewedAt: input.reviewedAt,
      quote: input.calculation.quote,
    });
  }
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
  pricingSnapshot: Prisma.JsonValue | null;
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

type SemanticChangeItem = FoilFactSource & {
  name: string;
  quantity: number;
  specification: string | null;
};

function changeHasSemanticEffect(
  change: NormalizedProposedItemChange,
  item: SemanticChangeItem,
): boolean {
  if (change.operation === 'ADD') return true;
  return (
    (change.name !== undefined && change.name !== item.name) ||
    changeAffectsPricing(change, item)
  );
}

function assertNoSemanticNoopUpdates(
  changes: readonly NormalizedProposedItemChange[],
  itemById: ReadonlyMap<string, SemanticChangeItem>,
): void {
  for (const change of changes) {
    if (change.operation !== 'UPDATE') continue;
    const item = itemById.get(change.itemId);
    if (!item) throw new OrderChangeRequestError('款式已不存在，请重新申请');
    if (changeHasSemanticEffect(change, item)) continue;
    throw new OrderChangeRequestError(
      `款式“${item.name}”没有实际变化，请修改后再提交`,
    );
  }
}

function hasAnySemanticChange(
  changes: readonly NormalizedProposedItemChange[],
  itemById: ReadonlyMap<string, SemanticChangeItem>,
): boolean {
  return changes.some((change) => {
    if (change.operation === 'ADD') return true;
    const item = itemById.get(change.itemId);
    if (!item) throw new OrderChangeRequestError('款式已不存在，请重新申请');
    return changeHasSemanticEffect(change, item);
  });
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

function assertLegacyInProductionPricingChangeSupported(
  status: OrderStatus,
  pricingChanged: boolean,
): void {
  if (!pricingChanged || status !== OrderStatus.IN_PRODUCTION) return;
  throw new OrderChangeRequestError(
    '历史“生产中”工单缺少可验证的工单版本与已发生制版费快照，不能自动重算；可仅修改名称，数量或工艺调整请新建工单并关联原单',
  );
}

function assertProductionPlateFactsRemainScoped(input: {
  status: OrderStatus;
  changes: readonly NormalizedProposedItemChange[];
  itemById: ReadonlyMap<string, PricingProjectionItem>;
}): void {
  if (!PLATE_PRESERVING_PRODUCTION_STATUSES.has(input.status)) return;
  const unsafePlateFactChange = input.changes.some((change) => {
    const source = input.itemById.get(
      change.operation === 'UPDATE' ? change.itemId : change.templateItemId,
    );
    if (!source) throw new OrderChangeRequestError('款式已不存在，请重新申请');
    const before = deriveLegacyOrderItemFoilFacts(source);
    const after = change.foilFactsProvided ? change : before;
    const foilFactsChanged =
      change.foilFactsProvided &&
      (!sameStringSet(after.frontFoilColors, before.frontFoilColors) ||
        !sameStringSet(after.backFoilColors, before.backFoilColors));
    const beforeHasFoil =
      before.frontFoilColors.length > 0 || before.backFoilColors.length > 0;
    const afterHasFoil =
      after.frontFoilColors.length > 0 || after.backFoilColors.length > 0;
    if (source.pricingRoute === OrderItemPricingRoute.COLOR_PRINT) {
      // A newly added print+foil fact is fully priced by its new atomic bundle.
      // Changing/removing an existing print plate is different: the old bundle
      // has no separable plate amount that can safely be retained.
      return (
        change.operation === 'UPDATE' &&
        beforeHasFoil &&
        foilFactsChanged
      );
    }
    if (change.operation === 'ADD') return afterHasFoil;
    return (beforeHasFoil || afterHasFoil) && foilFactsChanged;
  });
  if (!unsafePlateFactChange) return;
  throw new OrderChangeRequestError(
    '生产版本新增、移除或变更了无法安全沿用的烫金制版事实，现有历史制版费没有可验证的款式/生产世代归属，不能自动替换或重新计价；请新建工单并由管理员人工确认制版费',
  );
}

function quoteUsesPrintFoilBundledPlateScope(
  quote: CatalogCreateOrderQuoteCalculation['quote'],
): boolean {
  return (
    quote.items.some((item) =>
      item.lines.some(
        (line) =>
          line.code === 'PRINT_FOIL_PER_ORDER' &&
          line.status === 'QUOTED' &&
          line.includedInKnownTotal &&
          line.basis.plateTreatment === 'INCLUDED_IN_ATOMIC_BUNDLE',
      ),
    ) ||
    quote.manualReasons.some(
      (reason) =>
        reason.code === 'PRINT_FOIL_PRICE_NOT_FOUND' ||
        reason.code === 'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE',
    )
  );
}

function assertPreservedPlateDoesNotOverlapAtomicBundle(input: {
  status: OrderStatus;
  enforceForFactoryConfirmation?: boolean;
  quote: CatalogCreateOrderQuoteCalculation['quote'];
  customerCharges: readonly {
    status: OrderCustomerChargeStatus;
    amount: { toString(): string } | null;
    category: { code: string };
  }[];
}): void {
  if (
    (!input.enforceForFactoryConfirmation &&
      !PLATE_PRESERVING_PRODUCTION_STATUSES.has(input.status)) ||
    !quoteUsesPrintFoilBundledPlateScope(input.quote)
  ) {
    return;
  }
  const hasAmbiguousOrNonZeroPreservedPlate = input.customerCharges.some(
    (charge) => {
      if (charge.category.code !== 'PLATE_MAKING_FEE') return false;
      if (
        charge.status === OrderCustomerChargeStatus.WAIVED &&
        (charge.amount === null || new Decimal(charge.amount.toString()).isZero())
      ) {
        return false;
      }
      return (
        charge.amount === null ||
        !new Decimal(charge.amount.toString()).isZero()
      );
    },
  );
  if (!hasAmbiguousOrNonZeroPreservedPlate) return;
  throw new OrderChangeRequestError(
    '工单保留了待定或非零的独立制版费，新报价又使用含版费彩印烫金原子套餐或人工整款价，缺少可验证的款式归属，存在重复收费风险；请先人工复核历史版费后再处理',
  );
}

function projectedQuoteItems(input: {
  changes: NormalizedProposedItemChange[];
  items: readonly PricingProjectionItem[];
  preserveAdminConfirmedManual?: boolean;
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
    let pricingRoute: NewOrderPricingRoute | null = isNewOrderPricingRoute(
      item.pricingRoute,
    )
      ? item.pricingRoute
      : null;
    if (
      pricingRoute === null &&
      input.preserveAdminConfirmedManual &&
      isTrustedAdminPricingSnapshot(item.pricingSnapshot)
    ) {
      const snapshot = packagingSnapshotBase(item.pricingSnapshot);
      const snapshotInput = packagingSnapshotBase(
        (snapshot.input as Prisma.JsonValue | undefined) ?? null,
      );
      const snapshotRoute = snapshotString(snapshotInput, 'pricingRoute');
      if (
        snapshotRoute !== null &&
        isNewOrderPricingRoute(snapshotRoute as OrderItemPricingRoute)
      ) {
        pricingRoute = snapshotRoute as NewOrderPricingRoute;
      }
    }
    if (pricingRoute === null) {
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
        pricingRoute,
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
  customerCharges?: readonly LogisticsProjectionCharge[];
  changes: NormalizedProposedItemChange[];
  preserveAdminConfirmedManual?: boolean;
}): Promise<{
  calculation: CatalogCreateOrderQuoteCalculation;
  projectedItems: ProjectedQuoteItem[];
}> {
  const projectedItems = projectedQuoteItems({
    changes: input.changes,
    items: input.items,
    preserveAdminConfirmedManual: input.preserveAdminConfirmedManual,
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
  const automaticallyApplicable = input.preserveAdminConfirmedManual
    ? isFactoryConfirmationQuoteApplicable({
        calculation,
        projectedItems,
        items: input.items,
        packagingGroups: input.packagingGroups,
        customerCharges: input.customerCharges ?? [],
      })
    : isChangeRequestQuoteAutomaticallyApplicable(calculation);
  if (!automaticallyApplicable) {
    if (
      calculation.quote.manualReasons.some(
        (reason) =>
          reason.code === 'PRINT_FOIL_PRICE_NOT_FOUND' ||
          reason.code === 'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE',
      )
    ) {
      throw new OrderChangeRequestError(
        input.preserveAdminConfirmedManual
          ? '彩印单色烫金未命中唯一含版费原子套餐，且尚未完成管理员整款人工核价；请返回价格复核补齐金额与依据'
          : '修改后的彩印单色烫金未命中唯一含版费原子套餐；当前改单不支持录入含版费的整款人工价，请撤回修改申请并按新业务事实新建工单',
      );
    }
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
 * A quote is safe to apply when all computed amounts are complete, or when
 * the only incomplete amount is the order-level administrator-priced plate
 * charge required by real foil facts.
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

function isFactoryConfirmationQuoteApplicable(input: {
  calculation: CatalogCreateOrderQuoteCalculation;
  projectedItems: readonly ProjectedQuoteItem[];
  items: readonly PricingProjectionItem[];
  packagingGroups: readonly PackagingProjectionGroup[];
  customerCharges: readonly LogisticsProjectionCharge[];
}): boolean {
  if (
    !input.calculation.quote.submittable ||
    input.calculation.quote.errors.length > 0
  ) {
    return false;
  }

  const storedItemById = new Map(input.items.map((item) => [item.id, item]));
  const trustedItemKeys = new Set(
    input.projectedItems.flatMap((projected) => {
      const stored = storedItemById.get(projected.sourceItemId);
      return stored && isTrustedAdminPricingSnapshot(stored.pricingSnapshot)
        ? [projected.itemKey]
        : [];
    }),
  );
  const quotedItemByKey = new Map(
    input.calculation.quote.items.map((item) => [item.itemKey, item]),
  );
  if (
    input.projectedItems.some((projected, index) => {
      const raw = quotedItemByKey.get(projected.itemKey);
      const presented = input.calculation.processing.items[index];
      if (!raw || !presented || raw.status === 'INVALID_INPUT') return true;
      return (
        (raw.status !== 'QUOTED' || !presented.complete) &&
        !trustedItemKeys.has(projected.itemKey)
      );
    }) ||
    input.calculation.quote.manualReasons.some(
      (reason) => !trustedItemKeys.has(reason.itemKey),
    )
  ) {
    return false;
  }

  const trustedGroupKeys = new Set(
    input.packagingGroups
      .filter((group) => isTrustedAdminPricingSnapshot(group.pricingSnapshot))
      .map((group) => group.id),
  );
  const presentedGroupByKey = new Map(
    input.calculation.processing.packaging.groups.map((group) => [
      group.groupKey,
      group,
    ]),
  );
  if (
    input.calculation.quote.packagingGroups.some((group) => {
      const presented = presentedGroupByKey.get(group.groupKey);
      if (!presented || group.status === 'INVALID_INPUT') return true;
      return (
        (group.status !== 'QUOTED' || !presented.complete) &&
        !trustedGroupKeys.has(group.groupKey)
      );
    })
  ) {
    return false;
  }

  const trustedChargeByBusinessKey = new Map(
    input.customerCharges.flatMap((charge) =>
      charge.amount !== null &&
      charge.status !== OrderCustomerChargeStatus.PENDING_AMOUNT &&
      charge.status !== OrderCustomerChargeStatus.WAIVED &&
      isTrustedAdminPricingSnapshot(charge.pricingSnapshot)
        ? [[charge.businessKey, charge] as const]
        : [],
    ),
  );
  const hasTrustedAggregatePlateCharge = input.customerCharges.some(
    (charge) =>
      charge.category.code === 'PLATE_MAKING_FEE' &&
      charge.businessKey === PENDING_PLATE_BUSINESS_KEY &&
      charge.status !== OrderCustomerChargeStatus.PENDING_AMOUNT &&
      charge.status !== OrderCustomerChargeStatus.WAIVED &&
      charge.amount !== null &&
      isTrustedAdminPricingSnapshot(charge.pricingSnapshot),
  );
  const activeStructuredPlateCharges = input.customerCharges.filter(
    (charge) =>
      charge.category.code === 'PLATE_MAKING_FEE' &&
      charge.businessKey.startsWith('PLATE_DETAIL:') &&
      charge.status !== OrderCustomerChargeStatus.WAIVED,
  );
  const hasStructuredPlateCoverage =
    hasExclusiveTrustedStructuredPlateCoverage({
      items: input.items,
      charges: input.customerCharges,
    });
  if (
    activeStructuredPlateCharges.length > 0 &&
    !hasStructuredPlateCoverage
  ) {
    return false;
  }
  const hasTrustedPlateCharge =
    hasTrustedAggregatePlateCharge || hasStructuredPlateCoverage;
  const hasTrustedPackingCharges = input.calculation.input.shipments.every(
    (shipment) =>
      trustedChargeByBusinessKey.has(
        `SHIPMENT:${shipment.shipmentKey}:PACKING_MATERIAL`,
      ),
  );
  const pendingOrderLineIsCovered = (
    line: CatalogCreateOrderQuoteCalculation['quote']['order']['lines'][number],
  ): boolean => {
    if (line.status !== 'PENDING_AMOUNT') return true;
    if (line.code === 'PLATE_FEE') return hasTrustedPlateCharge;
    if (line.code === 'CARTON') return hasTrustedPackingCharges;
    if (line.code.startsWith('SHIPPING:')) {
      return trustedChargeByBusinessKey.has(
        `SHIPMENT:${line.code.slice('SHIPPING:'.length)}:SHIPPING_FEE`,
      );
    }
    return false;
  };
  return input.calculation.quote.order.lines.every(pendingOrderLineIsCovered);
}

function factoryConfirmationCurrentAmount(input: {
  calculation: CatalogCreateOrderQuoteCalculation;
  projectedItems: readonly ProjectedQuoteItem[];
  items: readonly PricingProjectionItem[];
  packagingGroups: readonly PackagingProjectionGroup[];
  customerCharges: readonly LogisticsProjectionCharge[];
}): string {
  const storedItemById = new Map(input.items.map((item) => [item.id, item]));
  const itemAmount = input.projectedItems.reduce((sum, projected, index) => {
    const stored = storedItemById.get(projected.sourceItemId);
    if (stored && isTrustedAdminPricingSnapshot(stored.pricingSnapshot)) {
      return sum.plus(stored.subtotal);
    }
    const suggested = input.calculation.processing.items[index]
      ?.suggestedSubtotal;
    if (suggested === null || suggested === undefined) {
      throw new OrderChangeRequestError(
        `款式“${projected.itemName}”缺少可确认的金额`,
      );
    }
    return sum.plus(suggested);
  }, new Decimal(0));

  const presentedGroupByKey = new Map(
    input.calculation.processing.packaging.groups.map((group) => [
      group.groupKey,
      group,
    ]),
  );
  const packagingAmount = input.packagingGroups.reduce((sum, group) => {
    if (isTrustedAdminPricingSnapshot(group.pricingSnapshot)) {
      return sum.plus(group.subtotal);
    }
    const suggested = presentedGroupByKey.get(group.id)?.suggestedSubtotal;
    if (suggested === null || suggested === undefined) {
      throw new OrderChangeRequestError(
        `包装组 ${group.sequence} 缺少可确认的入袋费`,
      );
    }
    return sum.plus(suggested);
  }, new Decimal(0));

  const standardCharges = input.customerCharges.filter((charge) =>
    ['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(charge.category.code),
  );
  if (standardCharges.length !== input.calculation.input.shipments.length * 2) {
    throw new OrderChangeRequestError(
      '外部销售工单的快递/耗材收费明细不完整，无法预览确认价',
    );
  }
  const existingByBusinessKey = new Map(
    standardCharges.map((charge) => [charge.businessKey, charge]),
  );
  const itemByKey = new Map(
    input.calculation.input.items.map((item) => [item.itemKey, item]),
  );
  const logisticsQuote = calculateExternalOrderCharges(
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
        };
      }),
    },
    input.calculation.snapshot.orderCharges.rules,
    input.calculation.snapshot.orderCharges.logisticsPolicy,
  );
  const logisticsAmount = logisticsQuote.shipments.reduce((sum, shipment) => {
    const amountFor = (
      categoryCode: 'SHIPPING_FEE' | 'PACKING_MATERIAL',
      suggested: string | null,
      complete: boolean,
    ): Prisma.Decimal | string => {
      const businessKey =
        `SHIPMENT:${shipment.shipmentKey}:${categoryCode}`;
      const existing = existingByBusinessKey.get(businessKey);
      if (!existing) {
        throw new OrderChangeRequestError(
          `工单缺少收费明细 ${businessKey}`,
        );
      }
      if (isTrustedAdminPricingSnapshot(existing.pricingSnapshot)) {
        if (
          existing.status === OrderCustomerChargeStatus.PENDING_AMOUNT ||
          existing.status === OrderCustomerChargeStatus.WAIVED ||
          existing.amount === null
        ) {
          throw new OrderChangeRequestError(
            `收费明细 ${businessKey} 的管理员确认快照与收费状态不一致`,
          );
        }
        return existing.amount;
      }
      if (!complete || suggested === null) {
        throw new OrderChangeRequestError(
          `收费明细 ${businessKey} 仍需管理员人工确认`,
        );
      }
      return suggested;
    };
    return sum
      .plus(
        amountFor(
          'SHIPPING_FEE',
          shipment.shipping.amount,
          shipment.shipping.complete,
        ),
      )
      .plus(
        amountFor(
          'PACKING_MATERIAL',
          shipment.packaging.amount,
          shipment.packaging.complete,
        ),
      );
  }, new Decimal(0));

  const otherChargeAmount = input.customerCharges
    .filter(
      (charge) =>
        !['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(charge.category.code),
    )
    .reduce((sum, charge) => {
      if (
        charge.status === OrderCustomerChargeStatus.PENDING_AMOUNT ||
        charge.amount === null
      ) {
        throw new OrderChangeRequestError(
          `收费明细 ${charge.businessKey} 仍需管理员人工确认`,
        );
      }
      if (
        charge.status === OrderCustomerChargeStatus.WAIVED &&
        !new Decimal(charge.amount.toString()).isZero()
      ) {
        throw new OrderChangeRequestError(
          `收费明细 ${charge.businessKey} 已减免但金额不为 0，无法预览确认价`,
        );
      }
      return sum.plus(charge.amount);
    }, new Decimal(0));
  const total = itemAmount
    .plus(packagingAmount)
    .plus(logisticsAmount)
    .plus(otherChargeAmount);
  if (!total.isFinite() || total.isNegative() || total.gt(DECIMAL_12_2_MAX)) {
    throw new OrderChangeRequestError(
      '工单总额超过可保存上限 9,999,999,999.99 元',
    );
  }
  return total.toFixed(2);
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

function allowsProductionGenerationUpgrade(status: OrderStatus): boolean {
  return VERSIONED_CHANGE_STATUSES.has(status);
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
  allowStartedProduction = false,
): number {
  if (!allowStartedProduction && hasStartedProductionTask(item)) {
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
                status: true,
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
    const versionMismatchReason = changeRequestVersionMismatchReason(request);
    if (versionMismatchReason) {
      throw new OrderChangeRequestError(versionMismatchReason);
    }
    if (!CHANGEABLE_ORDER_STATUSES.includes(request.order.status)) {
      throw new OrderChangeRequestError('工单已完工，不能预览修改计价');
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
      if (!allowsProductionGenerationUpgrade(request.order.status)) {
        assertProductionFactsChangeAllowed(item, change);
      }
      if (
        change.quantity !== undefined &&
        change.quantity !== item.quantity
      ) {
        assertQuantityChangeAllowed(
          item,
          change.quantity,
          allowsProductionGenerationUpgrade(request.order.status),
        );
      }
    }
    assertPackagingChangeRequestSupported({
      changes,
      groups: request.order.packagingGroups ?? [],
    });
    if (!allowsProductionGenerationUpgrade(request.order.status)) {
      assertNoMaterializedProductionFactChange(
        request.order.productionOperations ?? [],
        changes,
        itemById,
      );
    }

    const quotedAt = new Date();
    const pricingChanged = hasPricingFactChanges(changes, itemById);
    assertProductionPlateFactsRemainScoped({
      status: request.order.status,
      changes,
      itemById,
    });
    assertLegacyInProductionPricingChangeSupported(
      request.order.status,
      pricingChanged,
    );
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
    assertPreservedPlateDoesNotOverlapAtomicBundle({
      status: request.order.status,
      quote: projected.calculation.quote,
      customerCharges: request.order.customerCharges,
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
      ...(shouldSyncPlateCharge(
        request.order.status,
        request.order.settlementType,
      )
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

function requiredDenyReason(value: string | null | undefined): string {
  const reason = value?.trim() ?? '';
  if (!reason) {
    throw new OrderChangeRequestError('拒绝必须填写原因');
  }
  if (reason.length > 500) {
    throw new OrderChangeRequestError('拒绝原因不能超过 500 字');
  }
  return reason;
}

/**
 * Reprices an already-submitted external order against the one currently
 * published processing/logistics pair. It preserves the original quotedFee
 * pointer and immutable quoted revision, then appends a distinct confirmed
 * revision with the new version locks. Callers must hold the order lock.
 */
export async function confirmOrderPricingAtCurrentPublishedVersionInTx(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    actorId: string;
    now: Date;
  },
): Promise<{
  confirmedFee: string;
  pricingRevisionId: string | null;
  versions: CatalogCreateOrderQuoteCalculation['quote']['priceVersion'] | null;
}> {
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    include: {
      items: {
        orderBy: { sequence: 'asc' },
        include: {
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
          lines: { select: { orderItemId: true, unitsPerBag: true } },
        },
      },
      customerCharges: {
        select: {
          id: true,
          shipmentId: true,
          businessKey: true,
          priceBookId: true,
          status: true,
          amount: true,
          pricingSnapshot: true,
          overrideReason: true,
          category: { select: { code: true } },
        },
      },
    },
  });
  if (!order) throw new OrderChangeRequestError('工单不存在');
  if (order.settlementType !== OrderSettlementType.EXTERNAL_SALES) {
    if (order.confirmedFee === null && order.totalAmount === null) {
      throw new OrderChangeRequestError('工单缺少可确认费用');
    }
    return {
      confirmedFee: new Decimal(
        order.confirmedFee ?? order.totalAmount,
      ).toFixed(2),
      pricingRevisionId: null,
      versions: null,
    };
  }
  const primaryShipment = order.shipments.find(
    (shipment) => shipment.sequence === 1,
  );
  if (!primaryShipment) {
    throw new OrderChangeRequestError('工单缺少主收货地址，不能按当前版核价');
  }
  const projected = await calculateProjectedOrderQuote({
    client: tx,
    now: input.now,
    settlementType: order.settlementType,
    isSfCollect: order.isSfCollect,
    items: order.items,
    logisticsItems: order.items,
    shipments: order.shipments,
    primaryShipmentId: primaryShipment.id,
    packagingGroups: order.packagingGroups,
    customerCharges: order.customerCharges,
    changes: [],
    preserveAdminConfirmedManual: true,
  });
  if (!quoteHasPendingPlateCharge(projected.calculation.quote)) {
    assertPreservedPlateDoesNotOverlapAtomicBundle({
      status: order.status,
      enforceForFactoryConfirmation: true,
      quote: projected.calculation.quote,
      customerCharges: order.customerCharges,
    });
  }
  if (projected.projectedItems.length !== projected.calculation.processing.items.length) {
    throw new OrderChangeRequestError('当前发布价的款式结果不完整');
  }
  for (const [index, projectedItem] of projected.projectedItems.entries()) {
    const quote = projected.calculation.processing.items[index];
    if (!quote) throw new OrderChangeRequestError('当前发布价的款式结果缺失');
    const storedItem = order.items.find(
      (item) => item.id === projectedItem.sourceItemId,
    );
    if (
      storedItem &&
      isTrustedAdminPricingSnapshot(storedItem.pricingSnapshot)
    ) {
      continue;
    }
    await tx.orderItem.update({
      where: { id: projectedItem.sourceItemId },
      data: resolvePureChangeRequestPricing({
        quote,
        quantity: projectedItem.quantity,
        itemName: projectedItem.itemName,
        itemKey: projectedItem.itemKey,
        requestId: `factory-confirm:${order.id}`,
        quotedAt: input.now,
      }),
    });
  }
  const packaging = packagingRepriceFromPureCalculation({
    calculation: projected.calculation,
    requestId: `factory-confirm:${order.id}`,
    reviewedAt: input.now,
    storedTotal: order.packagingAmount,
    groups: order.packagingGroups,
    preserveAdminConfirmed: true,
  });
  await applyPackagingRepricePlans(tx, packaging);
  // Refresh automatic logistics against the current published version while
  // preserving administrator-confirmed shipment charges. Independent plate
  // charges are order-level facts, so this helper leaves them untouched and
  // the aggregate below continues to include their confirmed amount.
  await refreshExternalLogisticsChargesAfterQuantityChange({
    client: tx,
    calculation: projected.calculation,
    requestId: `factory-confirm:${order.id}`,
    reviewedAt: input.now,
    shipments: order.shipments,
    customerCharges: order.customerCharges,
    preserveAdminConfirmed: true,
  });
  const refreshedItems = await tx.orderItem.findMany({
    where: { orderId: order.id },
    select: { subtotal: true },
  });
  const processingAmount = orderTotal(refreshedItems, packaging.total);
  const customerChargeTotal = await tx.orderCustomerCharge.aggregate({
    where: { orderId: order.id },
    _sum: { amount: true },
  });
  const confirmedFee = new Decimal(processingAmount)
    .plus(customerChargeTotal._sum.amount ?? 0)
    .toFixed(2);
  await tx.order.update({
    where: { id: order.id },
    data: {
      packagingAmount: packaging.total,
      processingAmount,
      totalAmount: confirmedFee,
      confirmedFee,
    },
    select: { id: true },
  });
  const revision = await appendOrderPricingRevisionInTx(tx, {
    orderId: order.id,
    status: ORDER_PRICING_STATUS.ADMIN_CONFIRMED,
    source: 'FACTORY_CONFIRM_CURRENT_PUBLISHED',
    actorId: input.actorId,
    now: input.now,
    expectedPriceRevision: order.priceRevision,
    incrementOrderRevision: false,
    orderFeeSnapshot: {
      quotedFee: order.quotedFee,
      confirmedFee,
      settledFee: order.settledFee,
    },
    metadata: {
      engineVersion: 'CREATE_ORDER_PURE_V1',
      priceBooks: projected.calculation.quote.priceVersion,
      quotedPricingRevisionId: order.quotedPricingRevisionId,
      preservedQuotedFee: order.quotedFee?.toFixed(2) ?? null,
      confirmedFee,
    },
  });
  const versions = projected.calculation.quote.priceVersion;
  await tx.orderPriceVersionLock.createMany({
    data: [
      {
        pricingRevisionId: revision.pricingRevisionId,
        purpose: CustomerPriceBookPurpose.PROCESSING,
        priceBookId: versions.processing.id,
        priceBookVersion: versions.processing.version,
        sourceSha256: versions.processing.sourceSha256,
        createdAt: input.now,
      },
      {
        pricingRevisionId: revision.pricingRevisionId,
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        priceBookId: versions.logistics.id,
        priceBookVersion: versions.logistics.version,
        sourceSha256: versions.logistics.sourceSha256,
        createdAt: input.now,
      },
    ],
  });
  return {
    confirmedFee,
    pricingRevisionId: revision.pricingRevisionId,
    versions,
  };
}

type PriceVersionEvidence = {
  processing: { id: string; version: number; sourceSha256: string } | null;
  logistics: { id: string; version: number; sourceSha256: string } | null;
};

export type FactoryConfirmationPriceDiff = {
  quoted: { amount: string | null; versions: PriceVersionEvidence };
  current: { amount: string; versions: PriceVersionEvidence };
  hasVersionDiff: boolean;
};

export async function previewFactoryConfirmationPriceDiff(
  orderId: string,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<FactoryConfirmationPriceDiff> {
  if (actor.role !== Role.ADMIN) {
    throw new OrderChangeRequestError('只有管理员可以预览确认价差');
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      orderId,
    )}))`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          orderBy: { sequence: 'asc' },
          include: {
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
            lines: { select: { orderItemId: true, unitsPerBag: true } },
          },
        },
        customerCharges: {
          select: {
            id: true,
            shipmentId: true,
            businessKey: true,
            priceBookId: true,
            status: true,
            amount: true,
            pricingSnapshot: true,
            overrideReason: true,
            category: { select: { code: true } },
          },
        },
        quotedPricingRevision: {
          select: {
            priceVersionLocks: {
              select: {
                purpose: true,
                priceBookId: true,
                priceBookVersion: true,
                sourceSha256: true,
              },
            },
          },
        },
      },
    });
    if (!order) throw new OrderChangeRequestError('工单不存在');
    if (order.settlementType !== OrderSettlementType.EXTERNAL_SALES) {
      const amount = new Decimal(order.confirmedFee ?? order.totalAmount).toFixed(2);
      const empty = { processing: null, logistics: null };
      return {
        quoted: {
          amount: order.quotedFee?.toFixed(2) ?? null,
          versions: empty,
        },
        current: { amount, versions: empty },
        hasVersionDiff: false,
      };
    }
    const primaryShipment = order.shipments.find(
      (shipment) => shipment.sequence === 1,
    );
    if (!primaryShipment) {
      throw new OrderChangeRequestError('工单缺少主收货地址');
    }
    const projected = await calculateProjectedOrderQuote({
      client: tx,
      now,
      settlementType: order.settlementType,
      isSfCollect: order.isSfCollect,
      items: order.items,
      logisticsItems: order.items,
      shipments: order.shipments,
      primaryShipmentId: primaryShipment.id,
      packagingGroups: order.packagingGroups,
      customerCharges: order.customerCharges,
      changes: [],
      preserveAdminConfirmedManual: true,
    });
    if (!quoteHasPendingPlateCharge(projected.calculation.quote)) {
      assertPreservedPlateDoesNotOverlapAtomicBundle({
        status: order.status,
        enforceForFactoryConfirmation: true,
        quote: projected.calculation.quote,
        customerCharges: order.customerCharges,
      });
    }
    const currentAmount = factoryConfirmationCurrentAmount({
      calculation: projected.calculation,
      projectedItems: projected.projectedItems,
      items: order.items,
      packagingGroups: order.packagingGroups,
      customerCharges: order.customerCharges,
    });
    const lockByPurpose = new Map(
      (order.quotedPricingRevision?.priceVersionLocks ?? []).map((lock) => [
        lock.purpose,
        {
          id: lock.priceBookId,
          version: lock.priceBookVersion,
          sourceSha256: lock.sourceSha256,
        },
      ]),
    );
    const quotedVersions: PriceVersionEvidence = {
      processing:
        lockByPurpose.get(CustomerPriceBookPurpose.PROCESSING) ?? null,
      logistics:
        lockByPurpose.get(CustomerPriceBookPurpose.LOGISTICS) ?? null,
    };
    const versions = projected.calculation.quote.priceVersion;
    const currentVersions: PriceVersionEvidence = {
      processing: versions.processing,
      logistics: versions.logistics,
    };
    return {
      quoted: {
        amount: order.quotedFee?.toFixed(2) ?? null,
        versions: quotedVersions,
      },
      current: { amount: currentAmount, versions: currentVersions },
      hasVersionDiff:
        quotedVersions.processing?.id !== currentVersions.processing?.id ||
        quotedVersions.logistics?.id !== currentVersions.logistics?.id,
    };
  });
}

export type CancellationSettlementReference = {
  referenceSettleFee: string;
  calculation: 'CURRENT_PUBLISHED_ENGINE_V1' | 'PERSISTED_ITEM_FORMULA_V1' | 'ZERO_PRODUCTION';
  components: {
    itemProcessing: string;
    bagging: string;
    carton: string;
    preservedManualCharges: string;
    shipping: '0.00';
  };
  allocation: Array<{ orderItemId: string; producedQty: number }>;
  priceVersions: PriceVersionEvidence;
};

/** Deterministic largest-remainder allocation for the aggregate producedQty. */
export function allocateCancellationProducedQuantity(
  items: readonly { id: string; sequence: number; quantity: number }[],
  producedQty: number,
): Array<{ orderItemId: string; producedQty: number }> {
  const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
  if (
    totalQty < 1 ||
    !Number.isSafeInteger(producedQty) ||
    producedQty < 0 ||
    producedQty > totalQty
  ) {
    throw new OrderChangeRequestError('已产数量不能超过工单总数量');
  }
  const rows = items.map((item) => {
    const exact = new Decimal(producedQty).mul(item.quantity).div(totalQty);
    const base = exact.floor().toNumber();
    return { item, base, remainder: exact.minus(base) };
  });
  let remaining = producedQty - rows.reduce((sum, row) => sum + row.base, 0);
  rows.sort(
    (left, right) =>
      right.remainder.comparedTo(left.remainder) ||
      left.item.sequence - right.item.sequence ||
      left.item.id.localeCompare(right.item.id),
  );
  for (const row of rows) {
    if (remaining < 1) break;
    if (row.base < row.item.quantity) {
      row.base += 1;
      remaining -= 1;
    }
  }
  return rows
    .sort(
      (left, right) =>
        left.item.sequence - right.item.sequence ||
        left.item.id.localeCompare(right.item.id),
    )
    .map((row) => ({ orderItemId: row.item.id, producedQty: row.base }));
}

export function cancellationReferenceFromCalculation(input: {
  calculation: CatalogCreateOrderQuoteCalculation;
  preservedManualCharges: Decimal.Value;
  allocation: CancellationSettlementReference['allocation'];
}): CancellationSettlementReference {
  const itemProcessing = input.calculation.quote.items.reduce((sum, item) => {
    if (item.amount === null) {
      throw new OrderChangeRequestError('已产款式无法自动核价，禁止猜测取消结算');
    }
    return sum.plus(item.amount);
  }, new Decimal(0));
  const bagging = input.calculation.quote.packagingGroups.reduce(
    (sum, group) => {
      if (group.amount === null) {
        throw new OrderChangeRequestError('已产入袋费无法自动核价，禁止猜测取消结算');
      }
      return sum.plus(group.amount);
    },
    new Decimal(0),
  );
  const cartonLine = input.calculation.quote.order.lines.find(
    (line) => line.code === 'CARTON',
  );
  if (!cartonLine?.amount) {
    throw new OrderChangeRequestError('已产总量的纸箱耗材费无法核价');
  }
  const carton = new Decimal(cartonLine.amount);
  const preservedManualCharges = new Decimal(input.preservedManualCharges);
  const total = itemProcessing
    .plus(bagging)
    .plus(carton)
    .plus(preservedManualCharges)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (!total.isFinite() || total.isNegative() || total.gt(DECIMAL_12_2_MAX)) {
    throw new OrderChangeRequestError('取消结算参考金额超出系统允许范围');
  }
  const versions = input.calculation.quote.priceVersion;
  return {
    referenceSettleFee: total.toFixed(2),
    calculation: 'CURRENT_PUBLISHED_ENGINE_V1',
    components: {
      itemProcessing: itemProcessing.toFixed(2),
      bagging: bagging.toFixed(2),
      carton: carton.toFixed(2),
      preservedManualCharges: preservedManualCharges.toFixed(2),
      // SHIPPING:* lines are intentionally never part of this sum.
      shipping: '0.00',
    },
    allocation: input.allocation,
    priceVersions: {
      processing: versions.processing,
      logistics: versions.logistics,
    },
  };
}

function validateCancellationProducedQuantity(
  request: CancellationRequest,
  producedQty: number | undefined,
): number {
  const totalQty = request.order.items.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const productionStarted =
    request.order.status === OrderStatus.RELEASED ||
    request.order.status === OrderStatus.FOILING ||
    request.order.status === OrderStatus.PACKING;
  const value = productionStarted ? producedQty : (producedQty ?? 0);
  if (value === undefined) {
    throw new OrderChangeRequestError('生产中取消必须核实已产数量');
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > totalQty) {
    throw new OrderChangeRequestError(`已产数量必须在 0–${totalQty} 之间`);
  }
  const progressByStage = new Map<string, Decimal>();
  for (const progress of request.order.productionWorkOrderProgress) {
    if (progress.workOrderVersion !== request.order.workOrderVersion) continue;
    progressByStage.set(
      progress.stage,
      (progressByStage.get(progress.stage) ?? new Decimal(0)).plus(
        progress.workOrderProgressQuantity,
      ),
    );
  }
  const reportedMinimum = Decimal.max(
    ...[...progressByStage.values(), new Decimal(0)],
  );
  if (new Decimal(value).lt(reportedMinimum)) {
    throw new OrderChangeRequestError(
      `已产数量不能小于已报工 ${reportedMinimum.toString()}`,
    );
  }
  return value;
}

async function cancellationSettlementReferenceInTx(
  tx: Prisma.TransactionClient,
  request: CancellationRequest,
  producedQty: number,
  now: Date,
): Promise<CancellationSettlementReference> {
  const allocation = allocateCancellationProducedQuantity(
    request.order.items,
    producedQty,
  );
  if (producedQty === 0) {
    return {
      referenceSettleFee: '0.00',
      calculation: 'ZERO_PRODUCTION',
      components: {
        itemProcessing: '0.00',
        bagging: '0.00',
        carton: '0.00',
        preservedManualCharges: '0.00',
        shipping: '0.00',
      },
      allocation,
      priceVersions: { processing: null, logistics: null },
    };
  }
  const allocationById = new Map(
    allocation.map((row) => [row.orderItemId, row.producedQty]),
  );
  if (request.order.settlementType !== OrderSettlementType.EXTERNAL_SALES) {
    const itemProcessing = request.order.items.reduce((sum, item) => {
      const quantity = allocationById.get(item.id) ?? 0;
      return quantity > 0
        ? sum.plus(new Decimal(item.unitPrice).mul(quantity).plus(item.fixedFee))
        : sum;
    }, new Decimal(0));
    const bagging = request.order.packagingGroups.reduce((sum, group) => {
      const bagCount = Math.max(
        0,
        ...group.lines.map((line) => {
          const quantity = allocationById.get(line.orderItemId) ?? 0;
          return line.unitsPerBag ? Math.ceil(quantity / line.unitsPerBag) : 0;
        }),
      );
      return sum.plus(new Decimal(group.unitPrice).mul(bagCount));
    }, new Decimal(0));
    const total = itemProcessing.plus(bagging).toDecimalPlaces(2);
    return {
      referenceSettleFee: total.toFixed(2),
      calculation: 'PERSISTED_ITEM_FORMULA_V1',
      components: {
        itemProcessing: itemProcessing.toFixed(2),
        bagging: bagging.toFixed(2),
        carton: '0.00',
        preservedManualCharges: '0.00',
        shipping: '0.00',
      },
      allocation,
      priceVersions: { processing: null, logistics: null },
    };
  }
  const primaryShipment = request.order.shipments.find(
    (shipment) => shipment.sequence === 1,
  );
  if (!primaryShipment) throw new OrderChangeRequestError('工单缺少主收货地址');
  const projected = projectedQuoteItems({ changes: [], items: request.order.items });
  const active = projected.filter(
    (item) => (allocationById.get(item.sourceItemId) ?? 0) > 0,
  );
  let calculation: CatalogCreateOrderQuoteCalculation;
  try {
    calculation = await calculateCreateOrderQuoteFromCatalogInTx(tx, {
      now,
      facts: {
        items: active.map((item) => ({
          ...item.facts,
          quantity: allocationById.get(item.sourceItemId)!,
        })),
        packagingGroups: request.order.packagingGroups.flatMap((group) => {
          const lines = group.lines.filter(
            (line) => (allocationById.get(line.orderItemId) ?? 0) > 0,
          );
          return lines.length === 0
            ? []
            : [{
                groupKey: group.id,
                mode: group.mode,
                items: lines.map((line) => ({
                  itemKey: line.orderItemId,
                  unitsPerBag: line.unitsPerBag,
                })),
              }];
        }),
        isSfCollect: request.order.isSfCollect,
        shipments: [
          {
            shipmentKey: primaryShipment.id,
            province: primaryShipment.destinationProvince,
            trustedFulfilmentWeightKg: null,
            itemQuantities: Object.fromEntries(
              active.map((item) => [
                item.itemKey,
                allocationById.get(item.sourceItemId)!,
              ]),
            ),
          },
        ],
      },
      includeOrderCharges: true,
    });
  } catch (error) {
    throw new OrderChangeRequestError(
      `已产数量无法按当前发布价核算：${error instanceof Error ? error.message : '未知错误'}`,
    );
  }
  const preservedManualCharges = request.order.customerCharges
    .filter(
      (charge) =>
        !['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(
          String(charge.category.code),
        ),
    )
    .reduce((sum, charge) => sum.plus(charge.amount ?? 0), new Decimal(0));
  return cancellationReferenceFromCalculation({
    calculation,
    preservedManualCharges,
    allocation,
  });
}

export async function previewOrderCancellationSettlement(
  input: PreviewOrderCancellationSettlementInput,
  actor: { id: string; role: Role },
): Promise<CancellationSettlementReference> {
  if (actor.role !== Role.ADMIN) {
    throw new OrderChangeRequestError('只有管理员可以预览取消结算');
  }
  const locator = await db.orderChangeRequest.findUnique({
    where: { id: input.requestId },
    select: { orderId: true },
  });
  if (!locator) throw new OrderChangeRequestError('取消申请不存在');
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;
    const request = await tx.orderChangeRequest.findUnique({
      where: { id: input.requestId },
      include: CANCELLATION_REQUEST_INCLUDE,
    });
    if (!request || request.type !== OrderChangeRequestType.CANCEL) {
      throw new OrderChangeRequestError('取消申请不存在');
    }
    if (request.status !== OrderChangeRequestStatus.PENDING) {
      throw new OrderChangeRequestError('该申请已经处理');
    }
    const versionMismatchReason = changeRequestVersionMismatchReason(request);
    if (versionMismatchReason) {
      throw new OrderChangeRequestError(versionMismatchReason);
    }
    const producedQty = validateCancellationProducedQuantity(
      request,
      input.producedQty,
    );
    return cancellationSettlementReferenceInTx(
      tx,
      request,
      producedQty,
      await databaseClockNow(tx),
    );
  });
}

async function terminateObsoleteCompletionDeliveryInTx(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    workOrderVersion: number;
    now: Date;
    jobReason: 'OrderCancelledBeforeCompletionNotification' | 'SupersededWorkOrderVersion';
  },
): Promise<void> {
  const deliveryKey =
    `notification:${NOTIFICATION_EVENTS.ORDER_COMPLETED}:${input.orderId}:v${input.workOrderVersion}`;
  await tx.backgroundJob.updateMany({
    where: {
      dedupeKey: deliveryKey,
      status: BackgroundJobStatus.PENDING,
    },
    data: {
      status: BackgroundJobStatus.CANCELLED,
      finishedAt: input.now,
      lockedBy: null,
      lockedAt: null,
      heartbeatAt: null,
      lastErrorCode: input.jobReason,
    },
  });
  // RETRYING proves the provider explicitly rejected the previous attempt,
  // so no delivery ambiguity exists. UNKNOWN/SENDING are left untouched
  // because they may represent a request whose acknowledgement was lost.
  await tx.notificationLog.updateMany({
    where: {
      deliveryKey,
      status: NotificationStatus.RETRYING,
    },
    data: {
      status: NotificationStatus.FAILED,
      errorMessage: SUPERSEDED_BEFORE_SEND_ERROR,
      sentAt: null,
      deliveryAttemptId: null,
      deliveryJobAttempt: null,
      deliveryStateVersion: { increment: 1 },
      lastAttemptAt: input.now,
    },
  });
}

async function reviewOrderCancellationRequest(
  input: ReviewOrderChangeRequestInput,
  actor: { id: string; role: Role },
  locator: { orderId: string },
) {
  return db.$transaction(async (tx) => {
    // Approved cancellation writes v2 settlement facts. The global shared
    // cutoff lock must therefore be the first statement in this transaction.
    await lockSettlementCutoffShared(tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;

    const request = await tx.orderChangeRequest.findUnique({
      where: { id: input.requestId },
      include: CANCELLATION_REQUEST_INCLUDE,
    });
    if (!request || request.type !== OrderChangeRequestType.CANCEL) {
      throw new OrderChangeRequestError('取消申请不存在');
    }
    if (request.status !== OrderChangeRequestStatus.PENDING) {
      throw new OrderChangeRequestError('该申请已经处理，不能重复审核');
    }
    const reviewedAt = await databaseClockNow(tx);
    if (input.decision === 'DENY' || input.decision === 'REJECT') {
      const denyReason = requiredDenyReason(input.reviewRemark);
      const denied = await tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.DENIED,
          denyReason,
          reviewedById: actor.id,
          reviewRemark: denyReason,
          reviewedAt,
        },
      });
      await tx.orderLog.create({
        data: {
          orderId: request.order.id,
          operatorId: actor.id,
          action: 'CHANGE_REQUEST_DENIED',
          changedFields: {
            requestId: request.id,
            requestType: request.type,
            status: {
              before: OrderChangeRequestStatus.PENDING,
              after: OrderChangeRequestStatus.DENIED,
            },
          },
          remark: denyReason,
        },
      });
      return denied;
    }
    const versionMismatchReason = changeRequestVersionMismatchReason(request);
    if (versionMismatchReason) {
      return tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.STALE,
          reviewedById: actor.id,
          reviewRemark: versionMismatchReason,
          reviewedAt,
        },
      });
    }
    if (!CANCELLABLE_BY_REQUEST_STATUSES.includes(request.order.status)) {
      throw new OrderChangeRequestError('当前工单状态不允许批准取消');
    }
    if (request.order.outsourceOrders.length > 0) {
      throw new OrderChangeRequestError(
        '工单存在已发出或进行中的外协单，请先处理外协',
      );
    }

    const producedQty = validateCancellationProducedQuantity(
      request,
      input.producedQty,
    );
    if (request.order.confirmedFee === null) {
      throw new OrderChangeRequestError('工单缺少已确认费用，禁止猜测取消结算');
    }
    const reference = await cancellationSettlementReferenceInTx(
      tx,
      request,
      producedQty,
      reviewedAt,
    );
    const settleFee = new Decimal(
      input.settleFee ?? reference.referenceSettleFee,
    ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (
      !settleFee.isFinite() ||
      settleFee.isNegative() ||
      settleFee.gt(DECIMAL_12_2_MAX)
    ) {
      throw new OrderChangeRequestError('最终结算金额非法');
    }
    const settleFeeText = settleFee.toFixed(2);
    const settlementDelta = settleFee.minus(reference.referenceSettleFee);
    const adjustmentReason = input.settleFeeAdjustmentReason?.trim() || null;
    if (!settlementDelta.isZero() && !adjustmentReason) {
      throw new OrderChangeRequestError('调整参考结算金额必须填写原因');
    }
    transitionOrder(request.order.status, OrderStatus.CANCELLED);

    await tx.productionOperation.updateMany({
      where: {
        orderId: request.order.id,
        status: {
          in: [
            ProductionOperationStatus.PENDING,
            ProductionOperationStatus.IN_PROGRESS,
          ],
        },
      },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
    await tx.productionProgressStep.updateMany({
      where: {
        orderId: request.order.id,
        status: {
          in: [
            ProductionOperationStatus.PENDING,
            ProductionOperationStatus.IN_PROGRESS,
          ],
        },
      },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
    await tx.order.update({
      where: { id: request.order.id },
      data: {
        status: OrderStatus.CANCELLED,
        settledFee: settleFeeText,
        settledAt: reviewedAt,
        settlementContractVersion: 2,
        revision: { increment: 1 },
      },
      select: { id: true },
    });
    await terminateObsoleteCompletionDeliveryInTx(tx, {
      orderId: request.order.id,
      workOrderVersion: request.order.workOrderVersion ?? 1,
      now: reviewedAt,
      jobReason: 'OrderCancelledBeforeCompletionNotification',
    });
    const reviewed = await tx.orderChangeRequest.update({
      where: { id: request.id },
      data: {
        status: OrderChangeRequestStatus.APPROVED,
        producedQty,
        settleFee: settleFeeText,
        workOrderVersionAfter: request.order.workOrderVersion,
        reviewedById: actor.id,
        reviewRemark: input.reviewRemark?.trim() || null,
        reviewedAt,
      },
    });
    await tx.orderLog.create({
      data: {
        orderId: request.order.id,
        operatorId: actor.id,
        action: 'CHANGE_REQUEST_CANCEL_APPROVED',
        changedFields: {
          status: { before: request.order.status, after: OrderStatus.CANCELLED },
          producedQty: { before: null, after: producedQty },
          referenceSettleFee: { before: null, after: reference.referenceSettleFee },
          settledFee: { before: null, after: settleFeeText },
          settlementDelta: { before: null, after: settlementDelta.toFixed(2) },
          settlementAdjustmentReason: { before: null, after: adjustmentReason },
          settledAt: { before: null, after: reviewedAt.toISOString() },
          settlementContractVersion: { before: null, after: 2 },
          calculation: {
            before: null,
            after: reference.calculation,
          },
          calculationComponents: { before: null, after: reference.components },
          producedAllocation: { before: null, after: reference.allocation },
          priceVersions: { before: null, after: reference.priceVersions },
        },
        remark:
          adjustmentReason ?? input.reviewRemark?.trim() ?? request.reason,
      },
    });
    return reviewed;
  });
}

type ProjectedOrderQuote = Awaited<
  ReturnType<typeof calculateProjectedOrderQuote>
>;

async function persistApprovedModificationPricingInTx(input: {
  actor: { id: string; role: Role };
  packagingReprice: PackagingRepriceResult | null;
  projected: ProjectedOrderQuote | null;
  request: ModificationReviewRequest;
  reviewedAt: Date;
  reviewRemark: string | null;
  tx: Prisma.TransactionClient;
}) {
  const {
    actor,
    packagingReprice,
    projected,
    request,
    reviewedAt,
    reviewRemark,
    tx,
  } = input;
  const versionedProductionChange = VERSIONED_CHANGE_STATUSES.has(
    request.order.status,
  );
  if (projected) {
    await syncPricingChargesAfterChange({
      client: tx,
      calculation: projected.calculation,
      requestId: request.id,
      reviewedAt,
      shipments: request.order.shipments,
      customerCharges: request.order.customerCharges,
      orderId: request.order.id,
      actorId: actor.id,
      refreshExternalLogistics:
        request.order.settlementType === OrderSettlementType.EXTERNAL_SALES,
      // A production generation can already have consumed and finalized
      // physical plates. Quantity/spec repricing must not silently waive that
      // historical work. Pre-production changes instead synchronize the one
      // aggregate manual-pricing exit with the projected foil facts.
      syncPlateCharge:
        shouldSyncPlateCharge(
          request.order.status,
          request.order.settlementType,
        ),
    });
  }

  const refreshedItems = await tx.orderItem.findMany({
    where: { orderId: request.order.id },
    select: { subtotal: true },
  });
  const nextRevision = request.order.revision + 1;
  const currentWorkOrderVersion = request.order.workOrderVersion ?? 1;
  const nextWorkOrderVersion =
    currentWorkOrderVersion + (versionedProductionChange ? 1 : 0);
  const nextPackagingAmount =
    packagingReprice?.total ?? request.order.packagingAmount;
  const nextProcessingAmount = orderTotal(
    refreshedItems,
    nextPackagingAmount,
  );
  if (projected) {
    const pureProcessingAmount = projected.calculation.quote.items
      .reduce((sum, item) => {
        if (item.amount === null) {
          throw new OrderChangeRequestError('纯引擎款式金额待定，禁止批准修改');
        }
        return sum.plus(item.amount);
      }, new Decimal(0))
      .plus(
        projected.calculation.quote.packagingGroups.reduce((sum, group) => {
          if (group.amount === null) {
            throw new OrderChangeRequestError('纯引擎入袋金额待定，禁止批准修改');
          }
          return sum.plus(group.amount);
        }, new Decimal(0)),
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
      ...(versionedProductionChange
        ? {
            workOrderVersion: nextWorkOrderVersion,
            scheduledAt: reviewedAt,
            // completedAt is the canonical production-readiness marker for
            // one work-order generation. A production-changing revision
            // rematerializes unfinished work and must reopen that marker.
            completedAt: null,
          }
        : {}),
      ...(packagingReprice && packagingReprice.plans.length > 0
        ? { packagingAmount: nextPackagingAmount }
        : {}),
      processingAmount: nextProcessingAmount,
      totalAmount: nextTotal,
    },
  });
  if (versionedProductionChange) {
    // A completion job for the superseded paper-work-order must not announce
    // itself as the current production truth after this transaction commits.
    // RUNNING jobs additionally re-check the payload generation immediately
    // before webhook I/O in notification/notify.ts.
    await terminateObsoleteCompletionDeliveryInTx(tx, {
      orderId: request.order.id,
      workOrderVersion: currentWorkOrderVersion,
      now: reviewedAt,
      jobReason: 'SupersededWorkOrderVersion',
    });
  }
  const pureQuoteCompleteness = projected
    ? projected.calculation.quote.status === 'QUOTED' &&
      projected.calculation.quote.pendingLineCodes.length === 0
      ? OrderQuotedFeeCompleteness.COMPLETE
      : OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS
    : null;
  const nonVersionedAutoConfirmed =
    !PLATE_PRESERVING_PRODUCTION_STATUSES.has(request.order.status) &&
    pureQuoteCompleteness === OrderQuotedFeeCompleteness.COMPLETE;
  const preservesProductionPlateCharges =
    PLATE_PRESERVING_PRODUCTION_STATUSES.has(request.order.status);
  const nextPricingStatus = !projected
    ? null
    : preservesProductionPlateCharges
      ? ORDER_PRICING_STATUS.ADMIN_CONFIRMED
      : nonVersionedAutoConfirmed
        ? ORDER_PRICING_STATUS.AUTO_CONFIRMED
        : ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION;
  const pricingRevision =
    projected &&
    request.order.settlementType !== OrderSettlementType.NO_CHARGE &&
    nextPricingStatus
      ? await appendOrderPricingRevisionInTx(tx, {
          orderId: request.order.id,
          status: nextPricingStatus,
          source: preservesProductionPlateCharges
            ? 'CHANGE_REQUEST_APPROVED_CURRENT_PUBLISHED'
            : nonVersionedAutoConfirmed
              ? 'CHANGE_REQUEST_APPLIED_AUTO_CONFIRMED'
              : 'CHANGE_REQUEST_APPLIED_PENDING',
          actorId: actor.id,
          now: reviewedAt,
          expectedPriceRevision: request.order.priceRevision,
          incrementOrderRevision: false,
          remark: reviewRemark ?? request.reason,
          ...(request.order.settlementType ===
          OrderSettlementType.EXTERNAL_SALES
            ? {
                orderFeeSnapshot: preservesProductionPlateCharges
                  ? {
                      quotedFee: request.order.quotedFee,
                      confirmedFee: nextTotal,
                      settledFee: null,
                    }
                  : {
                      // Match external submit: an automatic quote has a
                      // confirmed pricing status, but confirmedFee remains a
                      // later factory/customer-fee lifecycle snapshot.
                      quotedFee: nextTotal,
                      confirmedFee: null,
                      settledFee: null,
                    },
              }
            : {}),
          metadata: {
            changeRequestId: request.id,
            workOrderVersion: nextWorkOrderVersion,
            engineVersion: 'CREATE_ORDER_PURE_V1',
            priceBooks: projected.calculation.quote.priceVersion,
            ...(preservesProductionPlateCharges
              ? {
                  preservedQuotedFee:
                    request.order.quotedFee?.toFixed(2) ?? null,
                  confirmedFee: nextTotal,
                }
              : { quotedFee: nextTotal }),
            quotedFeeCompleteness: pureQuoteCompleteness!,
            pureQuote: {
              status: projected.calculation.quote.status,
              knownTotal: projected.calculation.quote.knownTotal,
              pendingLineCodes:
                projected.calculation.quote.pendingLineCodes,
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
    if (request.order.settlementType === OrderSettlementType.EXTERNAL_SALES) {
      await tx.order.update({
        where: { id: request.order.id },
        data: preservesProductionPlateCharges
          ? { confirmedFee: nextTotal, settledFee: null }
          : {
              quotedFee: nextTotal,
              quotedFeeCompleteness: pureQuoteCompleteness!,
              quotedPricingRevisionId: pricingRevision.pricingRevisionId,
              confirmedFee: null,
              settledFee: null,
            },
      });
    }
  }
  return {
    currentWorkOrderVersion,
    nextPackagingAmount,
    nextProcessingAmount,
    nextRevision,
    nextTotal,
    nextWorkOrderVersion,
    pricingRevision,
    nextPricingStatus,
    salesDelta,
    versionedProductionChange,
  };
}

type ApprovedModificationPricing = Awaited<
  ReturnType<typeof persistApprovedModificationPricingInTx>
>;

async function finalizeApprovedModificationInTx(input: {
  actor: { id: string; role: Role };
  packagingReprice: PackagingRepriceResult | null;
  pricing: ApprovedModificationPricing;
  request: ModificationReviewRequest;
  reviewedAt: Date;
  reviewRemark: string | null;
  tx: Prisma.TransactionClient;
}) {
  const { actor, packagingReprice, pricing, request, reviewedAt, reviewRemark, tx } =
    input;
  const {
    currentWorkOrderVersion,
    nextPackagingAmount,
    nextProcessingAmount,
    nextRevision,
    nextTotal,
    nextWorkOrderVersion,
    pricingRevision,
    nextPricingStatus,
    salesDelta,
    versionedProductionChange,
  } = pricing;
  const rematerializedProduction = isReprintChangeStatus(request.order.status)
    ? await activateProductionOperationsInTx(
        tx,
        request.order.id,
        actor,
        reviewedAt,
        {
          targetStatus: request.order.status,
          allowVersionRematerialization: true,
        },
      )
    : null;
  const supersededPrintJobs = versionedProductionChange
    ? (
        await supersedeOlderOrderPrintRequestsInTx(
          tx,
          {
            orderId: request.order.id,
            currentWorkOrderVersion: nextWorkOrderVersion,
            reasonKey: `change:${request.id}:supersede`,
          },
          actor,
        )
      ).requestJobIds
    : [];
  const reprint = isReprintChangeStatus(request.order.status)
    ? await createOrderPrintRequestInTx(
        tx,
        {
          orderId: request.order.id,
          workOrderVersion: nextWorkOrderVersion,
          printKind: OrderPrintKind.REPRINT,
          reason: '修改申请批准，旧版纸质工单作废',
          idempotencyKey: `change:${request.id}:reprint:v${nextWorkOrderVersion}`,
        },
        actor,
      )
    : null;
  const reviewed = await tx.orderChangeRequest.update({
    where: { id: request.id },
    data: {
      status: OrderChangeRequestStatus.APPROVED,
      workOrderVersionAfter: nextWorkOrderVersion,
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
        workOrderVersion: {
          before: currentWorkOrderVersion,
          after: nextWorkOrderVersion,
        },
        ...(versionedProductionChange
          ? {
              scheduledAt: {
                before: request.order.scheduledAt?.toISOString() ?? null,
                after: reviewedAt.toISOString(),
              },
            }
          : {}),
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
                after: nextPricingStatus,
              },
              priceRevision: {
                before: request.order.priceRevision,
                after: pricingRevision.priceRevision,
              },
            }
          : {}),
        requestId: request.id,
        ...(rematerializedProduction
          ? {
              productionGeneration: {
                before: currentWorkOrderVersion,
                after: nextWorkOrderVersion,
                operationIds: rematerializedProduction.operationIds,
                progressStepIds: rematerializedProduction.progressStepIds,
              },
            }
          : {}),
        ...(supersededPrintJobs.length > 0
          ? {
              supersededPrintJobs: {
                before: supersededPrintJobs,
                after: [],
                reason: `工单版本已升级为 v${nextWorkOrderVersion}`,
              },
            }
          : {}),
        ...(reprint
          ? { reprintJob: { before: null, after: reprint.jobId } }
          : {}),
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
    select: { orderId: true, type: true },
  });
  if (!locator) throw new OrderChangeRequestError('修改申请不存在');
  if (locator.type === OrderChangeRequestType.CANCEL) {
    return reviewOrderCancellationRequest(input, actor, locator);
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;

    const request = await tx.orderChangeRequest.findUnique({
      where: { id: input.requestId },
      include: MODIFICATION_REVIEW_REQUEST_INCLUDE,
    });
    if (!request) throw new OrderChangeRequestError('修改申请不存在');
    if (request.status !== OrderChangeRequestStatus.PENDING) {
      throw new OrderChangeRequestError('该申请已经处理，不能重复审核');
    }

    const reviewedAt = await databaseClockNow(tx);
    const reviewRemark = input.reviewRemark?.trim() || null;
    if (input.decision === 'REJECT' || input.decision === 'DENY') {
      const denyReason = requiredDenyReason(input.reviewRemark);
      const denied = await tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.DENIED,
          denyReason,
          reviewedById: actor.id,
          reviewRemark: denyReason,
          reviewedAt,
        },
      });
      await tx.orderLog.create({
        data: {
          orderId: request.order.id,
          operatorId: actor.id,
          action: 'CHANGE_REQUEST_DENIED',
          changedFields: {
            requestId: request.id,
            requestType: request.type,
            status: {
              before: OrderChangeRequestStatus.PENDING,
              after: OrderChangeRequestStatus.DENIED,
            },
          },
          remark: denyReason,
        },
      });
      return denied;
    }

    const versionMismatchReason = changeRequestVersionMismatchReason(request);
    if (versionMismatchReason) {
      return tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.STALE,
          reviewedById: actor.id,
          reviewRemark: versionMismatchReason,
          reviewedAt,
        },
      });
    }
    if (!CHANGEABLE_ORDER_STATUSES.includes(request.order.status)) {
      return tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.STALE,
          reviewedById: actor.id,
          reviewRemark: `工单状态已变为 ${request.order.status}，不再允许修改，申请已自动失效`,
          reviewedAt,
        },
      });
    }

    const proposedChanges = readProposedChanges(request.proposedChanges);
    // Re-check the live item count under the per-order lock. This is the
    // authoritative guard for legacy pending requests and any state change
    // that occurred after the proposal was recorded.
    assertOrderItemLimit(request.order.items.length, proposedChanges);
    const itemById = new Map(request.order.items.map((item) => [item.id, item]));
    const changes = normalizeProposedChanges(proposedChanges, itemById);
    if (!hasAnySemanticChange(changes, itemById)) {
      return tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.STALE,
          reviewedById: actor.id,
          reviewRemark:
            '申请内容与当前工单一致，没有可应用的实际变化，已自动失效',
          reviewedAt,
        },
      });
    }
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
      if (
        change.operation === 'UPDATE' &&
        !allowsProductionGenerationUpgrade(request.order.status)
      ) {
        assertProductionFactsChangeAllowed(item, change);
      }
    }
    assertPackagingChangeRequestSupported({
      changes,
      groups: request.order.packagingGroups ?? [],
    });
    if (!allowsProductionGenerationUpgrade(request.order.status)) {
      assertNoMaterializedProductionFactChange(
        request.order.productionOperations ?? [],
        changes,
        itemById,
      );
    }

    const pricingChanged = hasPricingFactChanges(changes, itemById);
    assertProductionPlateFactsRemainScoped({
      status: request.order.status,
      changes,
      itemById,
    });
    assertLegacyInProductionPricingChangeSupported(
      request.order.status,
      pricingChanged,
    );
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
    if (projected) {
      assertPreservedPlateDoesNotOverlapAtomicBundle({
        status: request.order.status,
        quote: projected.calculation.quote,
        customerCharges: request.order.customerCharges,
      });
    }
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
            allowsProductionGenerationUpgrade(request.order.status),
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

    const pricing = await persistApprovedModificationPricingInTx({
      actor,
      packagingReprice,
      projected,
      request,
      reviewedAt,
      reviewRemark,
      tx,
    });
    return finalizeApprovedModificationInTx({
      actor,
      packagingReprice,
      pricing,
      request,
      reviewedAt,
      reviewRemark,
      tx,
    });
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
