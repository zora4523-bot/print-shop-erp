import { assertProductionFactsReadyForChange, productionFactsToken } from '@/lib/production/fact-guards';
import { salaryIdentityLockKey } from '@/lib/salary/hourly-lock';
import { preserveCarriedCompletionInTx, reconcileProductionOrderInTx } from '@/lib/production/order-state';
import { productionMinimumByItem } from '@/lib/production/cancellation-production';
import { canConfirmHistoricalBlankPrice } from './historical-blank-price-input';
import { sameHistoricalBlankIdentity } from './historical-blank-price';
import { assertBlankPriceAdmissionInTx, BlankPriceAdmissionError } from './blank-price-admission';
import { subtotalReconciles } from './subtotal-reconciliation';
import { packagingBoxType } from './packaging-mode';
import { isAwaitingFactoryConfirmation } from './factory-confirmation-preflight';
import { prepareOrderForProductionInTx } from './production-readiness';
import { OrderChangeRequestError } from './change-request-error';
import { assertChangeRequestRespectsShippedShipments } from './change-request-shipment-guard';
import { ORDER_MODIFIABLE_STATUSES, canChangeOrderPackaging } from './editable-fields';
import { LOGISTICS_CHARGE_CATEGORY_CODES } from './settlement';
import Decimal from 'decimal.js';
import {
  BackgroundJobStatus,
  CustomerPriceBookPurpose,
  MaterialCategory,
  OrderChangeRequestStatus,
  OrderChangeRequestType,
  OrderCustomerChargeStatus,
  OrderItemPricingRoute,
  OrderItemQuoteDisposition,
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
  OrderChangePendingChargeResolutionInput,
  PreviewOrderCancellationSettlementInput,
  ReviewOrderChangeRequestInput,
  WithdrawOrderChangeRequestInput,
} from '../auth/schemas';
import {
  orderItemPricingFactsSchema,
} from '../auth/schemas';
import { persistedOrderChangeRequestItemsSchema } from '@/lib/auth/schemas/order-edit';
import { unchangedOrderItemPricingFactsSchema } from '@/lib/auth/schemas/order-create';
import { db } from '../db';
import { listExternalCreateOrderProductOptions } from '../product';
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
import { maybeCompleteProductionOrder, dispatchProductionCompletionNotification, type ProductionCompletionNotification, type ProductionCompletionTx } from '../production-completion';
import { MAX_ORDER_ITEMS_PER_ORDER } from './limits';
import { resolveOrderChangeStageInTx } from './change-stage';
import { proposedDueDateText, readProposedDueDate, dueDateChangePreview } from './change-due-date';
import { orderCascadeLockKey } from './locks';
import {
  applyPendingPlateChargeWaiverInTx,
  PENDING_PLATE_BUSINESS_KEY,
  quoteHasDefaultZeroPlateCharge,
  PendingPlateChargeError,
  preparePendingPlateChargeWaiverInTx,
  type PendingPlateChargeWaiverPlan,
  quoteHasPendingPlateCharge,
  requireActivePlateCategoryIdInTx,
  upsertPendingPlateChargeInTx,
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
import { activateProductionOperationsInTx, ProductionOperationMaterializationError } from '../production/operation-materialization-service';
import {
  buildTrustedAdminChargePricingSnapshot,
  isTrustedAdminChargePricingSnapshot,
  isTrustedAdminItemPricingSnapshot,
  isTrustedAdminPackagingPricingSnapshot,
  isTrustedAdminPricingSnapshot,
} from './admin-pricing-snapshot';
import { hasExclusiveTrustedStructuredPlateCoverage } from './plate-charge-integrity';
import { createOrderChangeApprovalToken } from './order-change-approval-token';
import {
  OrderChangeCatalogIdentityError,
  resolveOrderChangeCatalogIdentity,
  resolveOrderChangeBlankIdentity,
  type OrderChangeCatalogIdentity,
  type OrderChangeCatalogProduct,
} from './change-request-catalog-identity';
import { reconcileSampleWeightBasis } from './sample-weight-basis';

const CHANGEABLE_ORDER_STATUSES = ORDER_MODIFIABLE_STATUSES;
const CANCELLABLE_BY_REQUEST_STATUSES: OrderStatus[] = [
  OrderStatus.ON_HOLD,
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

function checkedOrderTotal(value: Decimal): string {
  if (!value.isFinite() || value.isNegative() || value.gt(DECIMAL_12_2_MAX)) {
    throw new OrderChangeRequestError(
      '工单总额超过可保存范围 0 至 9,999,999,999.99 元',
    );
  }
  return value.toFixed(2);
}

/**
 * Only external sales re-quote (includeOrderCharges) and rewrite their
 * SHIPPING_FEE / PACKING_MATERIAL rows when a change is approved. Every other
 * settlement type keeps its persisted logistics rows inside the approved
 * total, so the approval preview must keep them too.
 */
function refreshesLogisticsChargesOnChange(
  settlementType: OrderSettlementType,
): boolean {
  return settlementType === OrderSettlementType.EXTERNAL_SALES;
}

/**
 * An external-sales DRAFT has no SHIPPING_FEE / PACKING_MATERIAL rows yet:
 * finalizeExternalOrderQuoteInTx generates them authoritatively at submission.
 * Modifying such a draft therefore re-quotes processing only, like the other
 * settlement types, instead of demanding rows that cannot exist. Submitted
 * orders (and drafts that already carry the rows) keep the full refresh and
 * the fail-closed identity check.
 */
function requotesLogisticsChargesOnChange(order: {
  settlementType: OrderSettlementType;
  status: OrderStatus;
  customerCharges: readonly { category: { code: string } }[];
}): boolean {
  if (!refreshesLogisticsChargesOnChange(order.settlementType)) return false;
  return order.status !== OrderStatus.DRAFT || order.customerCharges.some((charge) =>
    (LOGISTICS_CHARGE_CATEGORY_CODES as readonly string[]).includes(String(charge.category.code)));
}

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
      productionJobs: { select: { status: true, completedQty: true, sourceKey: true, snapshot: true } },
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
      productionOperations: { select: { id: true, status: true, workOrderVersion: true, operationType: true, carriedWorkOrderProgressQty: true } },
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

const LOGISTICS_PROJECTION_CHARGE_SELECT = {
  id: true,
  orderId: true,
  shipmentId: true,
  businessKey: true,
  priceBookId: true,
  sourceRuleId: true,
  status: true,
  quantity: true,
  unit: true,
  unitPrice: true,
  suggestedAmount: true,
  amount: true,
  isAdjustment: true,
  approvalReference: true,
  pricingSnapshot: true,
  overrideReason: true,
  category: { select: { code: true } },
} as const satisfies Prisma.OrderCustomerChargeSelect;

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
          status: true,
        },
      },
      packagingGroups: {
        orderBy: { sequence: 'asc' as const },
        include: {
          lines: { select: { orderItemId: true, unitsPerBag: true } },
        },
      },
      customerCharges: {
        select: LOGISTICS_PROJECTION_CHARGE_SELECT,
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

export { OrderChangeRequestError } from './change-request-error';

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
  isModification: boolean,
): void {
  if (
    !(actor.role === Role.ADMIN && isModification) &&
    actor.role !== Role.SALES
  ) {
    throw new OrderChangeRequestError('当前账号无权提交此类工单申请');
  }
  if (actor.role !== Role.ADMIN && order.submitterId !== actor.id) {
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

async function readChangeRequestOrderInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      purpose: true,
      submitterId: true,
      status: true,
      revision: true,
      workOrderVersion: true,
      promisedDate: true,
      settlementType: true,
      isSfCollect: true,
      items: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          orderId: true,
          sequence: true,
          fig: true,
          name: true,
          productId: true,
          pricingRoute: true,
          craft: true,
          productStructure: true,
          artworkVersion: true,
          plateGroupId: true,
          pricingGroup: true,
          manualQuoteReason: true,
          quantity: true,
          pack: true,
          specification: true,
          actualWidthMm: true,
          actualHeightMm: true,
          paperType: true,
          paperWeightGsm: true,
          crafts: true,
          frontFoilColors: true,
          backFoilColors: true,
          foilColors: true,
          foilTechnique: true,
          hasLocalFoil: true,
          lamination: true,
          printColors: true,
          printColorsKnown: true,
          isDoubleSided: true,
          isDoubleColor: true,
          unitPrice: true,
          fixedFee: true,
          subtotal: true,
          quoteDisposition: true,
          pricingSnapshot: true,
          priceOverrideReason: true,
          tasks: { select: { status: true } },
          shipmentLines: {
            select: {
              quantity: true,
              shipment: { select: { id: true, sequence: true } },
            },
          },
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
          orderId: true,
          sequence: true,
          name: true,
          mode: true,
          actualBagCount: true,
          unitPrice: true,
          subtotal: true,
          pricingSnapshot: true,
          priceOverrideReason: true,
          lines: {
            select: { orderItemId: true, unitsPerBag: true },
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
          status: true,
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
  const actualStatus = order.status;
  const status = await resolveOrderChangeStageInTx(tx, order);
  return { ...order, status, actualStatus };
}

/** Internal transaction context for atomic administrator edits. Never accepted from an action payload. */
export type OrderChangeTransactionContext = {
  tx: Prisma.TransactionClient;
  requestId?: string;
  onCompletion?: (notification: ProductionCompletionNotification | undefined) => void;
};

function inOrderChangeTransaction<T>(
  context: OrderChangeTransactionContext | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return context ? work(context.tx) : db.$transaction(work);
}

/**
 * Records a proposal only. The live order remains unchanged until an ADMIN
 * approves it, so every client keeps seeing one authoritative revision.
 */
export async function createOrderChangeRequest(
  input: CreateOrderChangeRequestCommand,
  actor: { id: string; role: Role },
  context?: OrderChangeTransactionContext,
) {
  const notificationEnabled = !context && (
    await getSetting('notify_order_change_enabled')
  ).enabled;
  let postCommitNotification: NotificationPayloadFor<'ORDER_CHANGE_REQUESTED'> | null =
    null;
  let createdRequest: CreatedOrderChangeRequest;
  try {
    createdRequest = await inOrderChangeTransaction(context, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
        input.orderId,
      )}))`;

      const order = await readChangeRequestOrderInTx(tx, input.orderId);
      assertCanRequest(actor, order, input.type !== 'CANCEL');
      assertExpectedOrderVersions(input, order);
      if (order.purpose && order.purpose !== 'STANDARD' && input.items.length) throw new OrderChangeRequestError('样品工单的款式需重新建单，请保留原单记录后创建新工单');
      if (
        input.type === 'CANCEL' &&
        !CANCELLABLE_BY_REQUEST_STATUSES.includes(order.status)
      ) {
        throw new OrderChangeRequestError(
          '只有已确认且未发货的工单可以提交取消申请',
        );
      }
      assertChangeRequestRespectsShippedShipments({ phase: 'REQUEST', isCancellation: input.type === 'CANCEL', itemChangeCount: input.items.length, shipments: order.shipments });
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
      const pricingNow = await databaseClockNow(tx);
      const resolvedChanges = await resolveProposedChangeCatalogIdentities(
        tx,
        normalizedChanges,
        itemById,
        pricingNow,
      );
      assertNoSemanticNoopUpdates(resolvedChanges, itemById);
      const promisedDate = input.type === 'CANCEL' ? undefined : proposedDueDateText(input.promisedDate);
      if (input.type !== 'CANCEL' && resolvedChanges.length === 0 &&
          (promisedDate === undefined || promisedDate === proposedDueDateText(order.promisedDate))) {
        throw new OrderChangeRequestError('请填写实际的款式或交期变更');
      }
      for (const change of resolvedChanges) {
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
        changes: resolvedChanges,
        groups: order.packagingGroups ?? [],
        status: order.status,
      });
      if (!allowsProductionGenerationUpgrade(order.status)) {
        assertNoMaterializedProductionFactChange(
          order.productionOperations ?? [],
          resolvedChanges,
          itemById,
        );
      }

      const modifyChangesPricing =
        input.type !== 'CANCEL' &&
        hasPricingFactChanges(resolvedChanges, itemById);
      if (modifyChangesPricing) {
        const primaryShipment = order.shipments.find(
          (shipment) => shipment.sequence === 1,
        );
        if (!primaryShipment) {
          throw new OrderChangeRequestError(
            '工单缺少主收货地址，不能安全预检修改后计价',
          );
        }
        await calculateProjectedOrderQuote({
          client: tx,
          now: pricingNow,
          orderStatus: order.status,
          settlementType: order.settlementType,
          isSfCollect: order.isSfCollect,
          items: order.items,
          logisticsItems: order.items,
          shipments: order.shipments,
          primaryShipmentId: primaryShipment.id,
          packagingGroups: order.packagingGroups,
          changes: resolvedChanges,
        });
      }

      const created = await tx.orderChangeRequest.create({
        data: {
          ...(context?.requestId ? { id: context.requestId } : {}),
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
            status: order.actualStatus,
            promisedDate: proposedDueDateText(order.promisedDate) ?? null,
            items: order.items,
          },
          proposedChanges: {
            items: resolvedChanges.map(toStoredProposedChange),
            ...(promisedDate !== undefined ? { promisedDate } : {}),
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
          summary: `${actor.role === Role.ADMIN ? '管理员' : '销售'}已提交${requestKind}申请，待工厂确认`,
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
  if (actor.role !== Role.SALES && actor.role !== Role.ADMIN) {
    throw new OrderChangeRequestError('只有申请人可以撤回工单变更申请');
  }
  const locator = await db.orderChangeRequest.findUnique({
    where: { id: input.requestId },
    select: { orderId: true },
  });
  if (!locator) throw new OrderChangeRequestError('变更申请不存在');

  let completionNotification: ProductionCompletionNotification | undefined;
  const result = await db.$transaction(async (tx) => {
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
    return recheckClosedChangeInTx(tx, withdrawn, actor.id, value => { completionNotification = value; });
  });
  await dispatchProductionCompletionNotification(completionNotification);
  return result;
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

type ResolvedProposedItemChange = NormalizedProposedItemChange & {
  catalogIdentity: OrderChangeCatalogIdentity | null;
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
    const sourceSides = deriveLegacyOrderItemFoilFacts(source);
    return deriveLegacyOrderItemFoilFacts({
      frontFoilColors: change.frontFoilColors ?? sourceSides.frontFoilColors,
      backFoilColors: change.backFoilColors ?? sourceSides.backFoilColors,
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

async function resolveProposedChangeCatalogIdentities(
  client: Prisma.TransactionClient,
  changes: readonly NormalizedProposedItemChange[],
  itemById: ReadonlyMap<
    string,
    FoilFactSource & {
      pricingRoute: OrderItemPricingRoute;
      paperType: string | null;
      paperWeightGsm: number | null;
      specification: string | null;
    }
  >,
  now: Date,
): Promise<ResolvedProposedItemChange[]> {
  const needsCatalog = changes.some(
    (change) => change.targetProductId !== undefined,
  );
  const productOptions = needsCatalog
    ? await listExternalCreateOrderProductOptions(client)
    : [];
  const linkedPaperIds = [
    ...new Set(
      productOptions.flatMap((product) =>
        product.paperMaterialId ? [product.paperMaterialId] : [],
      ),
    ),
  ];
  // Mirror the quote adapter's authoritative linked-paper semantics: only a
  // PAPER material can satisfy the relation, and inactive/out-of-stock rows
  // are unavailable. These facts are loaded in the same transaction for
  // create, preview and approval; the browser catalog is never authoritative.
  const linkedPapers =
    linkedPaperIds.length === 0
      ? []
      : await client.material.findMany({
          where: {
            id: { in: linkedPaperIds },
            category: MaterialCategory.PAPER,
          },
          select: {
            id: true,
            isActive: true,
            outOfStock: true,
          },
        });
  const linkedPaperById = new Map(
    linkedPapers.map((paper) => [paper.id, paper]),
  );
  const products: OrderChangeCatalogProduct[] = productOptions.map(
    (product) => ({
      id: product.id,
      category: product.category,
      specification: product.specification,
      paperType: product.paperType,
      weight: product.weight,
      isActive: true,
      paperMaterialId: product.paperMaterialId,
      linkedPaper: product.paperMaterialId
        ? (linkedPaperById.get(product.paperMaterialId) ?? null)
        : null,
    }),
  );

  const resolved = changes.map((change) => {
    const sourceId =
      change.operation === 'UPDATE' ? change.itemId : change.templateItemId;
    const sourceItem = itemById.get(sourceId);
    if (!sourceItem) {
      throw new OrderChangeRequestError('参考款式已不存在，请重新申请');
    }
    if (change.targetBlankIdentity) {
      if (change.targetProductId !== undefined || change.specification !== undefined) {
        throw new OrderChangeRequestError('空白封规格不能同时提交旧产品选择');
      }
      try {
        const catalogIdentity = resolveOrderChangeBlankIdentity(sourceItem, change.targetBlankIdentity);
        return { ...change, specification: catalogIdentity.specification, catalogIdentity };
      } catch (error) {
        if (error instanceof OrderChangeCatalogIdentityError) throw new OrderChangeRequestError(error.message);
        throw error;
      }
    }
    const hasTargetProduct = change.targetProductId !== undefined;
    const hasSpecification = change.specification !== undefined;
    if (
      !hasTargetProduct &&
      hasSpecification &&
      change.specification === sourceItem.specification
    ) {
      // Historical pending requests could redundantly persist the unchanged
      // specification while changing another field. Treat that value as an
      // omitted legacy field; a genuinely different free-text specification
      // still fails closed below.
      return {
        ...change,
        specification: undefined,
        catalogIdentity: null,
      };
    }
    if (hasTargetProduct !== hasSpecification) {
      throw new OrderChangeRequestError(
        '修改规格必须同时提交目标报价产品与产品目录规格',
      );
    }
    if (!hasTargetProduct || !hasSpecification) {
      return { ...change, catalogIdentity: null };
    }
    try {
      return {
        ...change,
        catalogIdentity: resolveOrderChangeCatalogIdentity({
          sourceItem,
          targetProductId: change.targetProductId!,
          targetSpecification: change.specification!,
          products,
        }),
      };
    } catch (error) {
      if (error instanceof OrderChangeCatalogIdentityError) {
        throw new OrderChangeRequestError(error.message);
      }
      throw error;
    }
  });
  const newIdentities = resolved.flatMap((change) => {
    const sourceId = change.operation === 'UPDATE' ? change.itemId : change.templateItemId;
    const source = itemById.get(sourceId)!;
    const projectedIdentity = { ...source, ...(change.catalogIdentity ?? {}) };
    const identityChanged = change.catalogIdentity &&
      !sameHistoricalBlankIdentity(source, projectedIdentity);
    return change.operation === 'ADD' || identityChanged
      ? [projectedIdentity]
      : [];
  });
  if (newIdentities.length > 0) {
    try { await assertBlankPriceAdmissionInTx(client, newIdentities, now); }
    catch (error) {
      if (error instanceof BlankPriceAdmissionError) throw new OrderChangeRequestError(error.message);
      throw error;
    }
  }
  return resolved;
}

/**
 * Persist only the authoritative per-side facts for a newly submitted
 * request. The retired aggregate columns are derived again at review time.
 * Non-foil updates intentionally omit every foil field so approving a name
 * change cannot rewrite historical sidedness flags.
 */
function toStoredProposedChange(
  change: ResolvedProposedItemChange,
): ProposedItemChange {
  const stored: Partial<ResolvedProposedItemChange> = { ...change };
  delete stored.foilColors;
  delete stored.isDoubleSided;
  delete stored.isDoubleColor;
  delete stored.foilFactsProvided;
  delete stored.catalogIdentity;
  if (stored.targetBlankIdentity) delete stored.specification;
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
  const parsed = persistedOrderChangeRequestItemsSchema.safeParse(container.items);
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
  quoteDisposition: typeof OrderItemQuoteDisposition.PRICED;
  quotedAmount: string;
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
  if (!subtotalReconciles(subtotal, quote.suggestedSubtotal)) {
    throw new OrderChangeRequestError(
      `款式“${itemName}”的纯引擎分项与小计无法对平`,
    );
  }
  return {
    unitPrice,
    fixedFee,
    subtotal,
    quoteDisposition: OrderItemQuoteDisposition.PRICED,
    quotedAmount: subtotal,
    suggestedSubtotal: quote.suggestedSubtotal,
    pricingSnapshot: {
      ...quote.snapshot,
      // Keep the DB compatibility envelope while retaining the pure engine schema.
      version: 1,
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
  orderId: string;
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
  status: OrderStatus;
}): void {
  const changesPackaging = input.changes.some(
    (change) => change.operation === 'UPDATE' && change.pack !== undefined,
  );
  const packagingEditable = canChangeOrderPackaging(input.status);
  if (changesPackaging && !packagingEditable) {
    throw new OrderChangeRequestError('已进入生产的工单不能直接修改分袋组成');
  }
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
      isTrustedAdminPackagingPricingSnapshot(group.pricingSnapshot, group)
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
  orderId: string;
  shipmentId: string | null;
  businessKey: string;
  priceBookId: string | null;
  sourceRuleId: string | null;
  status: OrderCustomerChargeStatus;
  quantity: Prisma.Decimal | null;
  unit: string | null;
  unitPrice: Prisma.Decimal | null;
  suggestedAmount: Prisma.Decimal | null;
  amount: Prisma.Decimal | null;
  isAdjustment: boolean;
  approvalReference: string | null;
  pricingSnapshot: Prisma.JsonValue | null;
  overrideReason: string | null;
  category: { code: string };
};

export type OrderChangePendingChargePreview = {
  businessKey: string;
  categoryCode: 'SHIPPING_FEE';
  shipmentId: string;
  shipmentSequence: number;
  destinationProvince: string | null;
  projectedQuantity: number;
  description: string;
  errors: string[];
  amount: string | null;
  reason: string | null;
};

type ValidatedPendingChargeResolution =
  OrderChangePendingChargeResolutionInput & {
    amount: string;
    reason: string;
  };

function addedItemKey(changeIndex: number): string {
  return `ADD:${changeIndex + 1}`;
}

function projectShipmentFacts(input: {
  shipments: LogisticsProjectionShipment[];
  items: LogisticsProjectionItem[];
  changes: ResolvedProposedItemChange[];
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
        productStructure:
          change.catalogIdentity?.productStructure ?? template.productStructure,
      });
      allocationByItemKey.set(
        itemKey,
        new Map([[input.primaryShipmentId, change.quantity]]),
      );
      continue;
    }
    const item = itemById.get(change.itemId);
    if (!item) throw new OrderChangeRequestError('原款式已不存在，请重新申请');
    const projected = projectedItems.find(
      (candidate) => candidate.itemKey === item.id,
    )!;
    if (change.catalogIdentity) {
      projected.productStructure = change.catalogIdentity.productStructure;
    }
    if (change.quantity !== undefined) {
      const allocation = allocationByItemKey.get(item.id)!;
      allocation.set(
        input.primaryShipmentId,
        (allocation.get(input.primaryShipmentId) ?? 0) +
          change.quantity - item.quantity,
      );
      projected.quantity = change.quantity;
    }
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

function pendingShippingLineKeys(
  calculation: CatalogCreateOrderQuoteCalculation,
): string[] {
  return calculation.quote.order.lines.flatMap((line) =>
    line.status === 'PENDING_AMOUNT' && line.code.startsWith('SHIPPING:')
      ? [line.code.slice('SHIPPING:'.length)]
      : [],
  );
}

function quoteErrorsMatchPendingShippingLines(
  calculation: CatalogCreateOrderQuoteCalculation,
): boolean {
  const allowedShippingErrors = calculation.quote.order.lines.flatMap((line) =>
    line.status === 'PENDING_AMOUNT' && line.code.startsWith('SHIPPING:')
      ? line.errors.map(
          (error) =>
            `发货记录 ${line.code.slice('SHIPPING:'.length)}·快递费：${error}`,
        )
      : [],
  );
  const remainingAllowedShippingErrors = [...allowedShippingErrors];
  const hasOnlyPendingShippingErrors = calculation.quote.errors.every(
    (error) => {
      const index = remainingAllowedShippingErrors.indexOf(error);
      if (index < 0) return false;
      remainingAllowedShippingErrors.splice(index, 1);
      return true;
    },
  );
  return (
    hasOnlyPendingShippingErrors && remainingAllowedShippingErrors.length === 0
  );
}

function isChangeRequestQuoteResolvable(
  calculation: CatalogCreateOrderQuoteCalculation,
): boolean {
  const allowedPendingCodes = calculation.quote.pendingLineCodes.every(
    (code) => code === 'PLATE_FEE' || code.startsWith('SHIPPING:'),
  );
  const allowedPendingReasons = calculation.quote.pendingReasons.every(
    (reason) =>
      reason.code === 'PLATE_AMOUNT_PENDING' ||
      reason.code === 'FREIGHT_QUOTE_PENDING',
  );
  return (
    calculation.quote.submittable &&
    allowedPendingCodes &&
    allowedPendingReasons &&
    calculation.quote.manualReasons.length === 0 &&
    quoteErrorsMatchPendingShippingLines(calculation) &&
    calculation.processing.items.every((item) => item.complete) &&
    !calculation.processing.packaging.requiresAdminConfirmation
  );
}

function validatePendingChargeResolutions(input: {
  calculation: CatalogCreateOrderQuoteCalculation;
  shipments: readonly LogisticsProjectionShipment[];
  resolutions: readonly OrderChangePendingChargeResolutionInput[];
  requireComplete: boolean;
}): {
  pendingCharges: OrderChangePendingChargePreview[];
  resolutionsByBusinessKey: ReadonlyMap<
    string,
    ValidatedPendingChargeResolution
  >;
} {
  const pendingKeys = pendingShippingLineKeys(input.calculation);
  const lineByShipmentKey = new Map(
    input.calculation.quote.order.lines.flatMap((line) =>
      line.status === 'PENDING_AMOUNT' && line.code.startsWith('SHIPPING:')
        ? [[line.code.slice('SHIPPING:'.length), line] as const]
        : [],
    ),
  );
  const projectedShipmentByKey = new Map(
    input.calculation.input.shipments.map((shipment) => [
      shipment.shipmentKey,
      shipment,
    ]),
  );
  const shipmentByKey = new Map(
    input.shipments.map((shipment) => [String(shipment.sequence), shipment]),
  );
  if (
    new Set(pendingKeys).size !== pendingKeys.length ||
    pendingKeys.some(
      (key) => !shipmentByKey.has(key) || !projectedShipmentByKey.has(key),
    )
  ) {
    throw new OrderChangeRequestError(
      '纯引擎返回的待核物流项与工单发货记录不一致',
    );
  }

  const expectedBusinessKeys = new Set(
    pendingKeys.map((key) => `SHIPMENT:${key}:SHIPPING_FEE`),
  );
  const resolutionsByBusinessKey = new Map<
    string,
    ValidatedPendingChargeResolution
  >();
  for (const resolution of input.resolutions) {
    if (!expectedBusinessKeys.has(resolution.businessKey)) {
      throw new OrderChangeRequestError(
        `收费明细 ${resolution.businessKey} 不是本次预览的待核物流费，不能覆盖自动价`,
      );
    }
    if (resolutionsByBusinessKey.has(resolution.businessKey)) {
      throw new OrderChangeRequestError(
        `收费明细 ${resolution.businessKey} 重复提交`,
      );
    }
    const shipmentKey = resolution.businessKey
      .slice('SHIPMENT:'.length, -':SHIPPING_FEE'.length);
    const shipment = shipmentByKey.get(shipmentKey);
    const projectedShipment = projectedShipmentByKey.get(shipmentKey);
    if (!shipment || !projectedShipment) {
      throw new OrderChangeRequestError('待核物流费对应的发货记录已变化，请刷新预览');
    }
    const projectedQuantity = Object.values(
      projectedShipment.itemQuantities,
    ).reduce((sum, quantity) => sum + quantity, 0);
    if (
      resolution.shipmentId !== shipment.id ||
      resolution.expectedSequence !== shipment.sequence ||
      resolution.expectedProjectedQuantity !== projectedQuantity ||
      (resolution.expectedDestinationProvince ?? null) !==
        shipment.destinationProvince
    ) {
      throw new OrderChangeRequestError(
        `发货地址 ${shipment.sequence} 的计价事实已变化，请刷新预览后重新填写物流费`,
      );
    }
    let amount: Decimal;
    try {
      amount = new Decimal(resolution.amount);
    } catch {
      throw new OrderChangeRequestError('人工物流金额格式非法');
    }
    const reason = resolution.reason.trim();
    if (
      !amount.isFinite() ||
      amount.isNegative() ||
      amount.decimalPlaces() > 2 ||
      amount.gt(DECIMAL_12_2_MAX)
    ) {
      throw new OrderChangeRequestError('人工物流金额超出系统允许范围');
    }
    if (!reason) {
      throw new OrderChangeRequestError('人工物流定价必须填写依据');
    }
    resolutionsByBusinessKey.set(resolution.businessKey, {
      ...resolution,
      amount: amount.toFixed(2),
      reason,
    });
  }

  if (
    input.requireComplete &&
    resolutionsByBusinessKey.size !== expectedBusinessKeys.size
  ) {
    throw new OrderChangeRequestError('请补齐本次修改后的全部待核物流费');
  }

  const pendingCharges = pendingKeys.map((shipmentKey) => {
    const shipment = shipmentByKey.get(shipmentKey)!;
    const projectedShipment = projectedShipmentByKey.get(shipmentKey)!;
    const businessKey = `SHIPMENT:${shipmentKey}:SHIPPING_FEE`;
    const resolution = resolutionsByBusinessKey.get(businessKey);
    return {
      businessKey,
      categoryCode: 'SHIPPING_FEE' as const,
      shipmentId: shipment.id,
      shipmentSequence: shipment.sequence,
      destinationProvince: shipment.destinationProvince,
      projectedQuantity: Object.values(
        projectedShipment.itemQuantities,
      ).reduce((sum, quantity) => sum + quantity, 0),
      description: lineByShipmentKey.get(shipmentKey)?.label ?? '快递费',
      errors: [...(lineByShipmentKey.get(shipmentKey)?.errors ?? [])],
      amount: resolution?.amount ?? null,
      reason: resolution?.reason ?? null,
    };
  });
  return { pendingCharges, resolutionsByBusinessKey };
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

function assertExternalLogisticsChargeIdentity(input: {
  shipments: readonly LogisticsProjectionShipment[];
  customerCharges: readonly LogisticsProjectionCharge[];
}): LogisticsProjectionCharge[] {
  const standardCharges = input.customerCharges.filter((charge) =>
    ['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(
      String(charge.category.code),
    ),
  );
  const expectedStandardChargeTargets = new Map<
    string,
    { shipmentId: string; categoryCode: 'SHIPPING_FEE' | 'PACKING_MATERIAL' }
  >(
    input.shipments.flatMap((shipment) =>
      (['SHIPPING_FEE', 'PACKING_MATERIAL'] as const).map((categoryCode) => [
        `SHIPMENT:${shipment.sequence}:${categoryCode}`,
        { shipmentId: shipment.id, categoryCode },
      ] as const),
    ),
  );
  if (standardCharges.length !== expectedStandardChargeTargets.size) {
    throw new OrderChangeRequestError(
      '外部销售工单的快递/耗材收费明细不完整，无法批准数量修改',
    );
  }
  for (const charge of standardCharges) {
    const expected = expectedStandardChargeTargets.get(
      String(charge.businessKey),
    );
    if (
      !expected ||
      charge.category.code !== expected.categoryCode ||
      charge.shipmentId !== expected.shipmentId
    ) {
      throw new OrderChangeRequestError(
        `收费明细 ${charge.businessKey} 与收货地址的业务键、类目或发货记录不一致，无法批准修改`,
      );
    }
  }
  const existingBusinessKeys = new Set(
    standardCharges.map((charge) => String(charge.businessKey)),
  );
  if (
    existingBusinessKeys.size !== standardCharges.length ||
    [...expectedStandardChargeTargets.keys()].some(
      (businessKey) => !existingBusinessKeys.has(businessKey),
    )
  ) {
    throw new OrderChangeRequestError(
      '外部销售工单的快递/耗材收费业务键重复，无法批准修改',
    );
  }
  return standardCharges;
}

/**
 * 寄样首重默认（DECISIONS 2026-09-30）：重算物流也按本次计费重量（快递费行的 kg 数量）
 * 维护标记。到付不按重量计价；变更申请不改登记重量，按未登记处理（只暂存默认首重）。
 * 只有寄样快递费快照带这些字段，其他快照原样通过。
 */
function withSampleWeightBasis(
  charge: { categoryCode: string; unit: string | null; quantity: string | null },
  isSfCollect: boolean,
  previous: unknown,
  snapshot: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  if (charge.categoryCode !== 'SHIPPING_FEE') return snapshot;
  return reconcileSampleWeightBasis(previous, snapshot as Record<string, unknown>, {
    weightKg: isSfCollect || charge.unit !== 'kg' ? null : charge.quantity,
    sfCollect: isSfCollect,
  }) as Prisma.InputJsonObject;
}

async function prepareExternalLogisticsChargeRefresh(input: {
  client: Prisma.TransactionClient;
  calculation: CatalogCreateOrderQuoteCalculation;
  requestId: string;
  reviewedAt: Date;
  shipments: LogisticsProjectionShipment[];
  customerCharges: LogisticsProjectionCharge[];
  preserveAdminConfirmed?: boolean;
  pendingChargeResolutions?: ReadonlyMap<
    string,
    ValidatedPendingChargeResolution
  >;
  actorId?: string;
  previousPriceRevision?: number;
}) {
  const standardCharges = assertExternalLogisticsChargeIdentity(input);
  const existingByBusinessKey = new Map(
    standardCharges.map((charge) => [String(charge.businessKey), charge]),
  );
  const preservedByBusinessKey = new Map(
    standardCharges.flatMap((charge) => {
      if (
        !input.preserveAdminConfirmed ||
        !isTrustedAdminChargePricingSnapshot(charge.pricingSnapshot, charge)
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
          const submittedShipping =
            input.pendingChargeResolutions?.get(shippingKey);
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
            requiresActualWeight: input.calculation.input.packagingGroups.some((group) => packagingBoxType(group.mode) && group.items.some((item) => (shipment.itemQuantities[item.itemKey] ?? 0) > 0)),
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
            shippingFee:
              submittedShipping?.amount ??
              preservedShipping?.amount?.toFixed(2) ??
              null,
            packingMaterialFee: preservedPacking?.amount?.toFixed(2) ?? null,
            overrideReason:
              submittedShipping?.reason ||
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
    const submitted = input.pendingChargeResolutions?.get(charge.businessKey);
    if (submitted) {
      return (
        charge.categoryCode !== 'SHIPPING_FEE' ||
        !new Decimal(charge.amount).equals(submitted.amount) ||
        charge.overrideReason !== submitted.reason
      );
    }
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
  const submittedShippingTotal = [...(
    input.pendingChargeResolutions?.values() ?? []
  )].reduce((sum, resolution) => sum.plus(resolution.amount), new Decimal(0));
  const expectedOrderChargeTotal = new Decimal(
    input.calculation.quote.order.knownAmount,
  ).plus(submittedShippingTotal);
  const automaticAggregateMismatch =
    preservedByBusinessKey.size === 0 &&
    (!new Decimal(refreshed.totalAmount).equals(
      expectedOrderChargeTotal,
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
    const submitted = input.pendingChargeResolutions?.get(charge.businessKey);
    if (submitted && existing.shipmentId !== submitted.shipmentId) {
      throw new OrderChangeRequestError(
        `收费明细 ${charge.businessKey} 与发货记录不一致，请刷新后重试`,
      );
    }
    const preserved = preservedByBusinessKey.has(charge.businessKey)
      ? existing
      : null;
    const administratorConfirmed = Boolean(submitted || preserved);
    if (
      administratorConfirmed &&
      (!input.actorId || input.previousPriceRevision == null)
    ) {
      throw new OrderChangeRequestError(
        '人工物流费缺少管理员或价格版本审计信息',
      );
    }
    const administratorReason =
      submitted?.reason ?? preserved?.overrideReason ?? null;
    const finalizesCharge =
      charge.status === OrderCustomerChargeStatus.FINAL ||
      charge.status === OrderCustomerChargeStatus.WAIVED;
    if (finalizesCharge && !input.actorId) {
      throw new OrderChangeRequestError(
        `收费明细 ${charge.businessKey} 缺少确认人，不能保存最终状态`,
      );
    }
    return {
      id: existing.id,
      data: {
        categoryId: charge.categoryId,
        priceBookId: charge.priceBookId,
        sourceRuleId: charge.sourceRuleId,
        description: charge.description,
        status: charge.status,
        quantity: charge.quantity,
        unit: charge.unit,
        suggestedAmount: charge.suggestedAmount,
        amount: charge.amount,
        pricingSnapshot: withSampleWeightBasis(
          charge,
          input.calculation.input.isSfCollect,
          existing.pricingSnapshot,
          administratorConfirmed
            ? buildTrustedAdminChargePricingSnapshot({
                previous: refreshedChargeSnapshot(
                  charge.pricingSnapshot,
                  {
                    requestId: input.requestId,
                    reviewedAt: input.reviewedAt,
                    amount: charge.amount,
                    overrideReason: administratorReason,
                  },
                ),
                now: input.reviewedAt,
                actorId: input.actorId!,
                previousPriceRevision: input.previousPriceRevision!,
                charge: {
                  orderId: existing.orderId,
                  businessKey: existing.businessKey,
                  shipmentId: existing.shipmentId,
                  categoryCode: charge.categoryCode,
                  status: charge.status,
                  priceBookId: charge.priceBookId,
                  sourceRuleId: charge.sourceRuleId,
                  quantity: charge.quantity,
                  unit: charge.unit,
                  unitPrice: existing.unitPrice,
                  suggestedAmount: charge.suggestedAmount,
                  amount: charge.amount,
                  isAdjustment: existing.isAdjustment,
                  approvalReference: existing.approvalReference,
                  overrideReason: administratorReason,
                },
              })
            : refreshedChargeSnapshot(
                charge.pricingSnapshot,
                {
                  requestId: input.requestId,
                  reviewedAt: input.reviewedAt,
                  amount: charge.amount,
                  overrideReason: null,
                },
              ),
        ),
        overrideReason: administratorReason,
        finalizedById: finalizesCharge ? input.actorId! : null,
        finalizedAt: finalizesCharge ? input.reviewedAt : null,
      },
    };
  });
  return { updatePlans };
}

type ExternalLogisticsChargeRefreshPlan = Awaited<
  ReturnType<typeof prepareExternalLogisticsChargeRefresh>
>;

async function applyExternalLogisticsChargeRefresh(input: {
  client: Prisma.TransactionClient;
  plan: ExternalLogisticsChargeRefreshPlan;
}): Promise<void> {
  for (const update of input.plan.updatePlans) {
    await input.client.orderCustomerCharge.update({
      where: { id: update.id },
      data: update.data,
    });
  }
}

type PendingPlateChargeResetPlan = {
  staleDetails: Array<{
    id: string;
    amount: { toString(): string };
    chargeId: string;
  }>;
  pendingCategoryId: string | null;
  waiver: PendingPlateChargeWaiverPlan | null;
};

async function preparePendingPlateChargeReset(input: {
  client: Prisma.TransactionClient;
  orderId: string;
  quote: CatalogCreateOrderQuoteCalculation['quote'];
  customerCharges: LogisticsProjectionCharge[];
}): Promise<PendingPlateChargeResetPlan> {
  try {
    const staleDetails = quoteHasDefaultZeroPlateCharge(input.quote) ? [] : await input.client.orderItemPlateDetail.findMany({
      where: {
        isActive: true,
        orderItem: { orderId: input.orderId },
      },
      select: { id: true, amount: true },
    });
    const plannedStaleDetails = staleDetails.map((detail) => {
      const businessKey = `PLATE_DETAIL:${detail.id}`;
      const matchingCharges = input.customerCharges.filter(
        (charge) =>
          charge.orderId === input.orderId &&
          charge.shipmentId === null &&
          charge.businessKey === businessKey &&
          charge.category.code === 'PLATE_MAKING_FEE',
      );
      if (matchingCharges.length !== 1 || !matchingCharges[0]) {
        throw new OrderChangeRequestError(
          `制版明细 ${detail.id} 缺少唯一关联收费，无法安全重算`,
        );
      }
      return {
        ...detail,
        chargeId: matchingCharges[0].id,
      };
    });
    if (quoteHasPendingPlateCharge(input.quote)) {
      return {
        staleDetails: plannedStaleDetails,
        pendingCategoryId: await requireActivePlateCategoryIdInTx(
          input.client,
        ),
        waiver: null,
      };
    }
    return {
      staleDetails: plannedStaleDetails,
      pendingCategoryId: null,
      waiver: await preparePendingPlateChargeWaiverInTx({
        tx: input.client,
        orderId: input.orderId,
        quote: input.quote,
      }),
    };
  } catch (error) {
    if (error instanceof PendingPlateChargeError) {
      throw new OrderChangeRequestError(error.message);
    }
    throw error;
  }
}

async function applyPendingPlateChargeReset(input: {
  client: Prisma.TransactionClient;
  orderId: string;
  actorId: string;
  reviewedAt: Date;
  quote: CatalogCreateOrderQuoteCalculation['quote'];
  plan: PendingPlateChargeResetPlan;
}): Promise<void> {
  try {
    for (const detail of input.plan.staleDetails) {
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
        where: { id: detail.chargeId },
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
    if (input.plan.pendingCategoryId !== null) {
      await upsertPendingPlateChargeInTx({
        tx: input.client,
        orderId: input.orderId,
        actorId: input.actorId,
        categoryId: input.plan.pendingCategoryId,
        quote: input.quote,
        source: 'CHANGE_REQUEST_PENDING_PLATE',
      });
    } else if (input.plan.waiver) {
      await applyPendingPlateChargeWaiverInTx({
        tx: input.client,
        actorId: input.actorId,
        now: input.reviewedAt,
        quote: input.quote,
        plan: input.plan.waiver,
      });
    }
  } catch (error) {
    if (error instanceof PendingPlateChargeError) {
      throw new OrderChangeRequestError(error.message);
    }
    throw error;
  }
}

type PricingChargeSyncPlan = {
  externalLogistics: ExternalLogisticsChargeRefreshPlan | null;
  plate: PendingPlateChargeResetPlan | null;
};

async function preparePricingChargeSync(input: {
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
  pendingChargeResolutions?: ReadonlyMap<
    string,
    ValidatedPendingChargeResolution
  >;
  previousPriceRevision?: number;
}): Promise<PricingChargeSyncPlan> {
  const externalLogistics = input.refreshExternalLogistics
    ? await prepareExternalLogisticsChargeRefresh({
      ...input,
      actorId: input.actorId,
      previousPriceRevision: input.previousPriceRevision,
    })
    : null;
  const plate = input.syncPlateCharge
    ? await preparePendingPlateChargeReset({
      client: input.client,
      orderId: input.orderId,
      quote: input.calculation.quote,
      customerCharges: input.customerCharges,
    })
    : null;
  return { externalLogistics, plate };
}

async function applyPricingChargeSync(input: {
  client: Prisma.TransactionClient;
  calculation: CatalogCreateOrderQuoteCalculation;
  orderId: string;
  actorId: string;
  reviewedAt: Date;
  plan: PricingChargeSyncPlan;
}): Promise<void> {
  if (input.plan.externalLogistics) {
    await applyExternalLogisticsChargeRefresh({
      client: input.client,
      plan: input.plan.externalLogistics,
    });
  }
  if (input.plan.plate) {
    await applyPendingPlateChargeReset({
      client: input.client,
      orderId: input.orderId,
      actorId: input.actorId,
      reviewedAt: input.reviewedAt,
      quote: input.calculation.quote,
      plan: input.plan.plate,
    });
  }
}

type PricingProjectionItem = {
  id: string;
  orderId: string;
  fig?: number | null;
  name: string;
  productId: string | null;
  pricingRoute: import('../../generated/prisma/client').OrderItemPricingRoute;
  craft: import('../../generated/prisma/client').OrderCraft | null;
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
  pack: number | null;
  crafts: string[];
  frontFoilColors: string[];
  backFoilColors: string[];
  foilColors: string[];
  foilTechnique: import('../../generated/prisma/client').OrderFoilTechnique;
  hasLocalFoil: boolean | null;
  lamination: import('../../generated/prisma/client').OrderLamination;
  printColors: string[];
  printColorsKnown: boolean;
  isDoubleSided: boolean;
  isDoubleColor: boolean;
  unitPrice: Prisma.Decimal;
  fixedFee: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  quoteDisposition: import('../../generated/prisma/client').OrderItemQuoteDisposition | null;
  pricingSnapshot: Prisma.JsonValue | null;
  priceOverrideReason: string | null;
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

type CatalogIdentityAuditEntry = {
  changeIndex: number;
  operation: 'UPDATE' | 'ADD';
  sourceItemId: string;
  before: {
    productId: string | null;
    specification: string | null;
    productStructure: PricingProjectionItem['productStructure'];
    actualWidthMm: string | null;
    actualHeightMm: string | null;
    pricingGroup: string | null;
  } | null;
  after: {
    productId: string | null;
    specification: string;
    productStructure: PricingProjectionItem['productStructure'];
    actualWidthMm: string | null;
    actualHeightMm: string | null;
    pricingGroup: 'MID' | 'LARGE';
  };
};

function catalogDimensionText(
  value: Prisma.Decimal | number | null,
): string | null {
  return value === null ? null : new Decimal(value).toString();
}

function buildCatalogIdentityAuditEntries(
  changes: readonly ResolvedProposedItemChange[],
  itemById: ReadonlyMap<string, PricingProjectionItem>,
): CatalogIdentityAuditEntry[] {
  return changes.flatMap((change, changeIndex) => {
    if (!change.catalogIdentity) return [];
    const sourceItemId =
      change.operation === 'UPDATE' ? change.itemId : change.templateItemId;
    const source = itemById.get(sourceItemId);
    if (!source) throw new OrderChangeRequestError('款式已不存在，请重新申请');
    return [{
      changeIndex,
      operation: change.operation,
      sourceItemId,
      before:
        change.operation === 'UPDATE'
          ? {
              productId: source.productId,
              specification: source.specification,
              productStructure: source.productStructure,
              actualWidthMm: catalogDimensionText(source.actualWidthMm),
              actualHeightMm: catalogDimensionText(source.actualHeightMm),
              pricingGroup: source.pricingGroup,
            }
          : null,
      after: {
        productId: change.catalogIdentity.productId,
        specification: change.catalogIdentity.specification,
        productStructure: change.catalogIdentity.productStructure,
        actualWidthMm: catalogDimensionText(
          change.catalogIdentity.actualWidthMm,
        ),
        actualHeightMm: catalogDimensionText(
          change.catalogIdentity.actualHeightMm,
        ),
        pricingGroup: change.catalogIdentity.pricingGroup,
      },
    } satisfies CatalogIdentityAuditEntry];
  });
}

function changeAffectsPricing(
  change: ResolvedProposedItemChange,
  item: FoilFactSource & {
    quantity: number;
    pack?: number | null;
    productId: string | null;
    specification: string | null;
    productStructure: PricingProjectionItem['productStructure'];
    pricingGroup: string | null;
    actualWidthMm: Prisma.Decimal | number | null;
    actualHeightMm: Prisma.Decimal | number | null;
  },
): boolean {
  if (change.operation === 'ADD') return true;
  const foil = deriveLegacyOrderItemFoilFacts(item);
  const catalogIdentityChanged = Boolean(
    change.catalogIdentity &&
      (change.catalogIdentity.productId !== item.productId ||
        change.catalogIdentity.specification !== item.specification ||
        change.catalogIdentity.productStructure !== item.productStructure ||
        change.catalogIdentity.pricingGroup !== item.pricingGroup ||
        catalogDimensionText(change.catalogIdentity.actualWidthMm) !==
          catalogDimensionText(item.actualWidthMm) ||
        catalogDimensionText(change.catalogIdentity.actualHeightMm) !==
          catalogDimensionText(item.actualHeightMm)),
  );
  return (
    (change.quantity !== undefined && change.quantity !== item.quantity) ||
    (change.pack !== undefined && change.pack !== item.pack) ||
    catalogIdentityChanged ||
    (change.foilFactsProvided &&
      (!sameStringSet(change.frontFoilColors, foil.frontFoilColors) ||
        !sameStringSet(change.backFoilColors, foil.backFoilColors)))
  );
}

/** Only persisted proposals may contain an unchanged echo from an older form.
 * Check every supplied raw array, including order and aggregate, before suppressing writes.
 * Callers have already locked the order and checked the request's base version.
 */
function preserveUnchangedStoredFoilFacts(
  changes: ResolvedProposedItemChange[],
  proposals: ProposedItemChange[],
  itemById: ReadonlyMap<string, PricingFactGuardItem>,
): ResolvedProposedItemChange[] {
  const matches = (provided: string[] | undefined, saved: string[]) =>
    provided === undefined ||
    (provided.length === saved.length && provided.every((color, index) => color === saved[index]));
  return changes.map((change, index) => {
    if (change.operation !== 'UPDATE' || !change.foilFactsProvided) return change;
    const source = itemById.get(change.itemId);
    const proposal = proposals[index];
    if (!source || !proposal || changeAffectsPricing(change, source)) return change;
    const sides = deriveLegacyOrderItemFoilFacts(source);
    if (
      !matches(proposal.frontFoilColors, sides.frontFoilColors) ||
      !matches(proposal.backFoilColors, sides.backFoilColors) ||
      !matches(proposal.foilColors, source.foilColors)
    ) return change;
    return { ...change, foilFactsProvided: false };
  });
}

type SemanticChangeItem = FoilFactSource & {
  name: string;
  quantity: number;
  pack?: number | null;
  productId: string | null;
  specification: string | null;
  productStructure: PricingProjectionItem['productStructure'];
  pricingGroup: string | null;
  actualWidthMm: Prisma.Decimal | number | null;
  actualHeightMm: Prisma.Decimal | number | null;
};

function changeHasSemanticEffect(
  change: ResolvedProposedItemChange,
  item: SemanticChangeItem,
): boolean {
  if (change.operation === 'ADD') return true;
  return (
    (change.name !== undefined && change.name !== item.name) ||
    changeAffectsPricing(change, item)
  );
}

function assertNoSemanticNoopUpdates(
  changes: readonly ResolvedProposedItemChange[],
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
  changes: readonly ResolvedProposedItemChange[],
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
  changes: readonly ResolvedProposedItemChange[],
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
  changes: readonly ResolvedProposedItemChange[];
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
    const plateIdentityChanged = Boolean(
      change.catalogIdentity &&
        (change.catalogIdentity.productId !== source.productId ||
          change.catalogIdentity.specification !== source.specification ||
          change.catalogIdentity.productStructure !== source.productStructure ||
          change.catalogIdentity.pricingGroup !== source.pricingGroup ||
          catalogDimensionText(change.catalogIdentity.actualWidthMm) !==
            catalogDimensionText(source.actualWidthMm) ||
          catalogDimensionText(change.catalogIdentity.actualHeightMm) !==
            catalogDimensionText(source.actualHeightMm)),
    );
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
        (foilFactsChanged || plateIdentityChanged)
      );
    }
    if (change.operation === 'ADD') return afterHasFoil;
    return (
      (beforeHasFoil || afterHasFoil) &&
      (foilFactsChanged || plateIdentityChanged)
    );
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

function hasExclusiveTrustedAggregatePlateCoverage(
  charges: readonly LogisticsProjectionCharge[],
): boolean {
  const plateCharges = charges.filter(
    (charge) => charge.category.code === 'PLATE_MAKING_FEE',
  );
  const aggregate = plateCharges.find(
    (charge) => charge.businessKey === PENDING_PLATE_BUSINESS_KEY,
  );
  if (
    !aggregate ||
    aggregate.status === OrderCustomerChargeStatus.PENDING_AMOUNT ||
    aggregate.status === OrderCustomerChargeStatus.WAIVED ||
    aggregate.amount === null ||
    !isTrustedAdminChargePricingSnapshot(
      aggregate.pricingSnapshot,
      aggregate,
    )
  ) {
    return false;
  }

  return plateCharges.every((charge) => {
    if (charge === aggregate) return true;
    return (
      charge.status === OrderCustomerChargeStatus.WAIVED &&
      charge.amount !== null &&
      new Decimal(charge.amount.toString()).isZero()
    );
  });
}

/**
 * A production generation may retain a physically consumed plate charge, but
 * it must never turn a quote that still excludes PLATE_FEE into a confirmed
 * total merely because the order has entered production. Require one exclusive
 * trusted aggregate or structured breakdown before preserving that amount.
 */
function assertPreservedProductionPlateCoverage(input: {
  status: OrderStatus;
  quote: CatalogCreateOrderQuoteCalculation['quote'];
  items: readonly PricingProjectionItem[];
  customerCharges: readonly LogisticsProjectionCharge[];
}): void {
  if (
    !PLATE_PRESERVING_PRODUCTION_STATUSES.has(input.status) ||
    !quoteHasPendingPlateCharge(input.quote)
  ) {
    return;
  }
  if (
    hasExclusiveTrustedAggregatePlateCoverage(input.customerCharges) ||
    hasExclusiveTrustedStructuredPlateCoverage({
      items: input.items,
      charges: input.customerCharges,
    })
  ) {
    return;
  }
  throw new OrderChangeRequestError(
    '生产版本的新报价仍需制版费，但历史收费没有可验证且排他的管理员确认快照；请先在工单价格复核中确认制版费后再批准修改',
  );
}

function projectedQuoteItems(input: {
  changes: ResolvedProposedItemChange[];
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
    const catalogIdentity = change?.catalogIdentity;
    const projectedCatalogIdentity = catalogIdentity ?? item;
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
        productId: projectedCatalogIdentity.productId,
        pricingRoute,
        productStructure: projectedCatalogIdentity.productStructure,
        pricingGroup: projectedCatalogIdentity.pricingGroup,
        specification: projectedCatalogIdentity.specification,
        actualWidthMm: projectedCatalogIdentity.actualWidthMm,
        actualHeightMm: projectedCatalogIdentity.actualHeightMm,
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
    const catalogIdentity = change.catalogIdentity;
    const projectedCatalogIdentity = catalogIdentity ?? template;
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
        productId: projectedCatalogIdentity.productId,
        pricingRoute: template.pricingRoute,
        productStructure: projectedCatalogIdentity.productStructure,
        pricingGroup: projectedCatalogIdentity.pricingGroup,
        specification: projectedCatalogIdentity.specification,
        actualWidthMm: projectedCatalogIdentity.actualWidthMm,
        actualHeightMm: projectedCatalogIdentity.actualHeightMm,
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

function projectPackagingUnits(
  groups: readonly PackagingProjectionGroup[],
  changes: readonly ResolvedProposedItemChange[],
): PackagingProjectionGroup[] {
  const updates = new Map(
    changes.flatMap((change) =>
      change.operation === 'UPDATE' && change.pack !== undefined
        ? [[change.itemId, change.pack] as const]
        : [],
    ),
  );
  for (const itemId of updates.keys()) {
    const memberships = groups.flatMap((group) =>
      group.lines.filter((line) => line.orderItemId === itemId),
    );
    if (memberships.length !== 1) {
      throw new OrderChangeRequestError('款式缺少唯一包装明细，不能仅凭每包数量重建分袋记录');
    }
  }
  return groups.map((group) => ({
    ...group,
    lines: group.lines.map((line) => ({
      ...line, unitsPerBag: updates.get(line.orderItemId) ?? line.unitsPerBag,
    })),
  }));
}

async function calculateProjectedOrderQuote(input: {
  client: Prisma.TransactionClient;
  now: Date;
  orderStatus: OrderStatus;
  settlementType: OrderSettlementType;
  isSfCollect: boolean;
  items: readonly PricingProjectionItem[];
  logisticsItems: readonly LogisticsProjectionItem[];
  shipments: LogisticsProjectionShipment[];
  primaryShipmentId: string;
  packagingGroups: readonly PackagingProjectionGroup[];
  customerCharges?: readonly LogisticsProjectionCharge[];
  changes: ResolvedProposedItemChange[];
  preserveAdminConfirmedManual?: boolean;
  /** Defaults to the settlement rule; unsubmitted drafts pass false. */
  includeOrderCharges?: boolean;
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
      historicalBlankItems: canConfirmHistoricalBlankPrice(input.orderStatus) ? input.items : undefined,
      facts: {
        items: projectedItems.map((item) => item.facts),
        packagingGroups: projectPackagingUnits(input.packagingGroups, input.changes).map((group) => ({
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
        input.includeOrderCharges ??
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
  const applicable = input.preserveAdminConfirmedManual
    ? isFactoryConfirmationQuoteApplicable({
        calculation,
        projectedItems,
        items: input.items,
        packagingGroups: input.packagingGroups,
        customerCharges: input.customerCharges ?? [],
      })
    : isChangeRequestQuoteResolvable(calculation);
  if (!applicable) {
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
    !quoteErrorsMatchPendingShippingLines(input.calculation)
  ) {
    return false;
  }

  const storedItemById = new Map(input.items.map((item) => [item.id, item]));
  const trustedItemKeys = new Set(
    input.projectedItems.flatMap((projected) => {
      const stored = storedItemById.get(projected.sourceItemId);
      return stored &&
        isTrustedAdminItemPricingSnapshot(stored.pricingSnapshot, stored)
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
      .filter((group) =>
        isTrustedAdminPackagingPricingSnapshot(group.pricingSnapshot, group),
      )
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
      isTrustedAdminChargePricingSnapshot(charge.pricingSnapshot, charge)
        ? [[charge.businessKey, charge] as const]
        : [],
    ),
  );
  const hasAggregatePlateCoverage =
    hasExclusiveTrustedAggregatePlateCoverage(input.customerCharges);
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
    hasAggregatePlateCoverage || hasStructuredPlateCoverage;
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
    if (
      stored &&
      isTrustedAdminItemPricingSnapshot(stored.pricingSnapshot, stored)
    ) {
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
    if (isTrustedAdminPackagingPricingSnapshot(group.pricingSnapshot, group)) {
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
          requiresActualWeight: input.calculation.input.packagingGroups.some((group) => packagingBoxType(group.mode) && group.items.some((item) => (shipment.itemQuantities[item.itemKey] ?? 0) > 0)),
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
      if (
        isTrustedAdminChargePricingSnapshot(
          existing.pricingSnapshot,
          existing,
        )
      ) {
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
  pack?: number | null;
  pricingGroup: string | null;
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
 * A specification may change only through a complete catalog identity that
 * was re-derived on the server. This guard keeps legacy or tampered payloads
 * from pairing free text with the source item's product and dimensions.
 */
function assertSpecificationIdentityUnchanged(
  item: Pick<PricingFactGuardItem, 'name' | 'specification'>,
  change: ResolvedProposedItemChange,
): void {
  if (change.specification === undefined) return;
  if (
    !change.catalogIdentity ||
    change.catalogIdentity.specification !== change.specification
  ) {
    throw new OrderChangeRequestError(
      `款式“${item.name}”的规格缺少经过目录校验的产品、尺寸和结构身份`,
    );
  }
}

function assertMergedPricingFactsValid(
  item: PricingFactGuardItem,
  change: ResolvedProposedItemChange,
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
    if (quantityChanged || foilFactsChanged || change.catalogIdentity) {
      throw new OrderChangeRequestError(
        `款式“${item.name}”是历史人工报价路线，修改申请只允许更新名称；数量、规格或烫金参数需由管理员另行处理`,
      );
    }
    return;
  }
  const canPreserveHistoricalFoil = change.operation === 'UPDATE' &&
    !change.foilFactsProvided && !changeAffectsPricing(change, item);
  const factsSchema = canPreserveHistoricalFoil
    ? unchangedOrderItemPricingFactsSchema
    : orderItemPricingFactsSchema;
  const parsed = factsSchema.safeParse({
    productId: change.catalogIdentity
      ? change.catalogIdentity.productId
      : item.productId,
    pricingRoute: item.pricingRoute,
    paperType: item.paperType,
    crafts: item.crafts,
    actualWidthMm: change.catalogIdentity
      ? change.catalogIdentity.actualWidthMm
      : (item.actualWidthMm?.toNumber() ?? null),
    actualHeightMm: change.catalogIdentity
      ? change.catalogIdentity.actualHeightMm
      : (item.actualHeightMm?.toNumber() ?? null),
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
  change: ResolvedProposedItemChange,
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
  changes: readonly ResolvedProposedItemChange[],
  itemById: ReadonlyMap<
    string,
    ProductionFactGuardItem & {
      quantity: number;
      productId: string | null;
      productStructure: PricingProjectionItem['productStructure'];
      pricingGroup: string | null;
      actualWidthMm: Prisma.Decimal | number | null;
      actualHeightMm: Prisma.Decimal | number | null;
    }
  >,
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
  previousQuantity: number | null;
  quantity: number;
  previousSpecification: string | null;
  specification: string | null;
  previousFrontFoilColors: string[] | null;
  frontFoilColors: string[];
  previousBackFoilColors: string[] | null;
  backFoilColors: string[];
  priceImpact: 'UNCHANGED' | 'QUOTED' | 'INCOMPLETE';
  oldSubtotal: string | null;
  newSubtotal: string | null;
  suggestedUnitPrice: string | null;
  suggestedFixedFee: string | null;
  errors: string[];
};

export type OrderChangePricingPreview = {
  productionFactsToken?: string;
  promisedDateChange?: { before: string | null; after: string | null };
  requestId: string;
  orderId: string;
  baseRevision: number;
  priceRevision: number;
  /**
   * Approval token binding this request/version, the pure quote, and all
   * normalized administrator-entered pending charge resolutions. Null only
   * when the proposed change has no pricing impact.
   */
  quoteToken: string | null;
  quotedAt: string;
  complete: boolean;
  requiresReviewRemark: boolean;
  totalExcludesPendingPlateFee: boolean;
  oldTotal: string;
  newTotal: string | null;
  delta: string | null;
  items: OrderChangePricingPreviewItem[];
  pendingCharges: OrderChangePendingChargePreview[];
};

async function readReviewableChangeRequestInTx(
  tx: Prisma.TransactionClient,
  requestId: string,
  expectedPriceRevision: number | undefined,
) {
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
              status: true,
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
            select: LOGISTICS_PROJECTION_CHARGE_SELECT,
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
  request.order.status = await resolveOrderChangeStageInTx(tx, request.order);
  if (!CHANGEABLE_ORDER_STATUSES.includes(request.order.status)) {
    throw new OrderChangeRequestError('工单已完工，不能预览修改计价');
  }
  if (
    expectedPriceRevision !== undefined &&
    expectedPriceRevision !== request.order.priceRevision
  ) {
    throw new OrderChangeRequestError(
      `价格版本已从 v${expectedPriceRevision} 更新为 v${request.order.priceRevision}，请刷新预览`,
    );
  }

  return request;
}

function buildUnchangedPricingPreview(
  request: Awaited<ReturnType<typeof readReviewableChangeRequestInTx>>,
  changes: readonly ResolvedProposedItemChange[],
  itemById: ReadonlyMap<string, Awaited<ReturnType<typeof readReviewableChangeRequestInTx>>["order"]["items"][number]>,
  quotedAt: Date,
): OrderChangePricingPreview {
  const items = changes.map((change, changeIndex) => {
    const source = itemById.get(
      change.operation === 'UPDATE' ? change.itemId : change.templateItemId,
    );
    if (!source) throw new OrderChangeRequestError('款式已不存在，请重新申请');
    const subtotal = new Decimal(source.subtotal).toFixed(2);
    const previousFoilFacts = deriveLegacyOrderItemFoilFacts(source);
    const nextFoilFacts = change.foilFactsProvided
      ? change
      : previousFoilFacts;
    return {
      changeIndex,
      operation: change.operation,
      sourceItemId: source.id,
      previousName: source.name,
      name: change.name ?? source.name,
      previousQuantity: source.quantity,
      quantity: change.operation === 'ADD'
        ? change.quantity
        : (change.quantity ?? source.quantity),
      previousSpecification: source.specification,
      specification: change.specification ?? source.specification,
      previousFrontFoilColors:
        change.operation === 'UPDATE'
          ? previousFoilFacts.frontFoilColors
          : null,
      frontFoilColors: nextFoilFacts.frontFoilColors,
      previousBackFoilColors:
        change.operation === 'UPDATE'
          ? previousFoilFacts.backFoilColors
          : null,
      backFoilColors: nextFoilFacts.backFoilColors,
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
    priceRevision: request.order.priceRevision,
    quoteToken: null,
    quotedAt: quotedAt.toISOString(),
    complete: true,
    requiresReviewRemark: false,
    totalExcludesPendingPlateFee: false,
    oldTotal: new Decimal(request.order.totalAmount).toFixed(2),
    newTotal: new Decimal(request.order.totalAmount).toFixed(2),
    delta: '0.00',
    items,
    pendingCharges: [],
    promisedDateChange: dueDateChangePreview(request.proposedChanges, request.order.promisedDate),
  };
}

/**
 * Read-only approval preview. It deliberately uses the same merged business
 * facts and quote service as approval, but its amounts are informational:
 * approval always repeats the quote under the order lock in its own write
 * transaction and never accepts prices from this result.
 */
export async function previewOrderChangeRequestPricing(
  requestId: string,
  actor: { id: string; role: Role },
  options: {
    expectedPriceRevision?: number;
    pendingChargeResolutions?: readonly OrderChangePendingChargeResolutionInput[];
  } = {},
  context?: OrderChangeTransactionContext,
): Promise<OrderChangePricingPreview> {
  if (actor.role !== Role.ADMIN) {
    throw new OrderChangeRequestError('只有管理员可以预览工单修改计价');
  }

  const locator = await (context?.tx ?? db).orderChangeRequest.findUnique({
    where: { id: requestId },
    select: { orderId: true },
  });
  if (!locator) throw new OrderChangeRequestError('修改申请不存在');

  return inOrderChangeTransaction(context, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      locator.orderId,
    )}))`;
    const request = await readReviewableChangeRequestInTx(
      tx, requestId, options.expectedPriceRevision,
    );
    const factsToken = request.order.simpleProduction ? await productionFactsToken(tx, request.orderId) : undefined;

    const proposedChanges = readProposedChanges(request.proposedChanges);
    // 与批准路径同一道发货闸口：已有地址发货后不给出改款式/数量的计价预览。
    assertChangeRequestRespectsShippedShipments({ phase: 'REVIEW', isCancellation: false, itemChangeCount: proposedChanges.length, shipments: request.order.shipments });
    const itemById = new Map(request.order.items.map((item) => [item.id, item]));
    const normalizedChanges = normalizeProposedChanges(
      proposedChanges,
      itemById,
    );
    const quotedAt = await databaseClockNow(tx);
    const changes = preserveUnchangedStoredFoilFacts(
      await resolveProposedChangeCatalogIdentities(tx, normalizedChanges, itemById, quotedAt),
      proposedChanges, itemById,
    );
    await assertProductionFactsReadyForChange(tx, request.orderId, request.order, !hasPricingFactChanges(changes, itemById));
    if (changes.length > 0 && !request.order.shipments.some((shipment) => shipment.sequence === 1)) {
      throw new OrderChangeRequestError('工单缺少主收货地址，不能安全更新数量');
    }
    validateChangedItemFacts(changes, itemById, request);
    assertPackagingChangeRequestSupported({
      changes,
      groups: request.order.packagingGroups ?? [],
      status: request.order.status,
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
    if (!pricingChanged) {
      return { ...buildUnchangedPricingPreview(request, changes, itemById, quotedAt), productionFactsToken: factsToken };
    }

    const primaryShipment = request.order.shipments.find(
      (shipment) => shipment.sequence === 1,
    )!;
    const requotesLogistics = requotesLogisticsChargesOnChange(request.order);
    const projected = await calculateProjectedOrderQuote({
      client: tx,
      now: quotedAt,
      orderStatus: request.order.status,
      settlementType: request.order.settlementType,
      isSfCollect: request.order.isSfCollect,
      items: request.order.items,
      logisticsItems: request.order.items,
      shipments: request.order.shipments,
      primaryShipmentId: primaryShipment.id,
      packagingGroups: request.order.packagingGroups ?? [],
      changes,
      includeOrderCharges: requotesLogistics,
    });
    assertPreservedPlateDoesNotOverlapAtomicBundle({
      status: request.order.status,
      quote: projected.calculation.quote,
      customerCharges: request.order.customerCharges,
    });
    assertPreservedProductionPlateCoverage({
      status: request.order.status,
      quote: projected.calculation.quote,
      items: request.order.items,
      customerCharges: request.order.customerCharges,
    });
    const pendingResolutionState = validatePendingChargeResolutions({
      calculation: projected.calculation,
      shipments: request.order.shipments,
      resolutions: options.pendingChargeResolutions ?? [],
      requireComplete: false,
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
        const sourceFoilFacts = source
          ? deriveLegacyOrderItemFoilFacts(source)
          : null;
        return {
          changeIndex,
          operation: change.operation,
          sourceItemId: item.sourceItemId,
          previousName:
            change.operation === 'UPDATE' ? (source?.name ?? null) : null,
          name: item.itemName,
          previousQuantity:
            change.operation === 'UPDATE' ? (source?.quantity ?? null) : null,
          quantity: item.quantity,
          previousSpecification:
            change.operation === 'UPDATE'
              ? (source?.specification ?? null)
              : null,
          specification: item.facts.specification ?? null,
          previousFrontFoilColors:
            change.operation === 'UPDATE'
              ? (sourceFoilFacts?.frontFoilColors ?? [])
              : null,
          frontFoilColors: [...item.facts.frontFoilColors],
          previousBackFoilColors:
            change.operation === 'UPDATE'
              ? (sourceFoilFacts?.backFoilColors ?? [])
              : null,
          backFoilColors: [...item.facts.backFoilColors],
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
      ...(requotesLogistics
        ? ['SHIPPING_FEE', 'PACKING_MATERIAL']
        : []),
      ...(!quoteHasDefaultZeroPlateCharge(projected.calculation.quote) && shouldSyncPlateCharge(
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
    const unresolvedPendingCharges =
      pendingResolutionState.pendingCharges.filter(
        (charge) => charge.amount === null,
      );
    const resolvedPendingTotal = [
      ...pendingResolutionState.resolutionsByBusinessKey.values(),
    ].reduce((sum, resolution) => sum.plus(resolution.amount), new Decimal(0));
    const projectedTotal = new Decimal(projected.calculation.quote.knownTotal)
      .plus(resolvedPendingTotal)
      .plus(preservedCharges);
    const checkedProjectedTotal = checkedOrderTotal(projectedTotal);
    const complete = unresolvedPendingCharges.length === 0;
    const newTotal = complete ? checkedProjectedTotal : null;
    const approvalToken = createOrderChangeApprovalToken({
      requestId: request.id,
      baseRevision: request.baseRevision,
      priceRevision: request.order.priceRevision,
      pureQuoteToken: projected.calculation.quoteToken,
      pendingChargeResolutions: [
        ...pendingResolutionState.resolutionsByBusinessKey.values(),
      ],
    });

    return {
      requestId: request.id,
      orderId: request.orderId,
      baseRevision: request.baseRevision,
      priceRevision: request.order.priceRevision,
      quoteToken: approvalToken,
      productionFactsToken: factsToken,
      quotedAt: quotedAt.toISOString(),
      promisedDateChange: dueDateChangePreview(request.proposedChanges, request.order.promisedDate),
      complete,
      requiresReviewRemark: false,
      totalExcludesPendingPlateFee:
        shouldSyncPlateCharge(
          request.order.status,
          request.order.settlementType,
        ) && projected.calculation.quote.pendingLineCodes.includes('PLATE_FEE'),
      oldTotal: new Decimal(request.order.totalAmount).toFixed(2),
      newTotal,
      delta: complete
        ? projectedTotal.minus(request.order.totalAmount).toFixed(2)
        : null,
      items,
      pendingCharges: pendingResolutionState.pendingCharges,
    };
  });
}

function validateChangedItemFacts(
  changes: ResolvedProposedItemChange[],
  itemById: Map<string, ModificationReviewRequest['order']['items'][number]>,
  request: { order: { status: OrderStatus } },
) {
  for (const change of changes) {
    const sourceId = change.operation === 'UPDATE' ? change.itemId : change.templateItemId;
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
    if (change.quantity !== undefined && change.quantity !== item.quantity) {
      assertQuantityChangeAllowed(
        item,
        change.quantity,
        allowsProductionGenerationUpgrade(request.order.status),
      );
    }
  }
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
    expectedQuoteToken: string | null;
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
        select: LOGISTICS_PROJECTION_CHARGE_SELECT,
      },
    },
  });
  if (!order) throw new OrderChangeRequestError('工单不存在');
  if (order.settlementType !== OrderSettlementType.EXTERNAL_SALES) {
    if (input.expectedQuoteToken !== null) {
      throw new OrderChangeRequestError(
        '当前发布价预览已失效，请刷新工单后重试',
      );
    }
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
    orderStatus: order.status,
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
  if (input.expectedQuoteToken !== projected.calculation.quoteToken) {
    throw new OrderChangeRequestError(
      '当前发布价或计价结果已变化，请刷新工单后重试',
    );
  }
  assertExternalLogisticsChargeIdentity({
    shipments: order.shipments,
    customerCharges: order.customerCharges,
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
  const itemUpdatePlans = projected.projectedItems.flatMap(
    (projectedItem, index) => {
    const quote = projected.calculation.processing.items[index];
    if (!quote) throw new OrderChangeRequestError('当前发布价的款式结果缺失');
    const storedItem = order.items.find(
      (item) => item.id === projectedItem.sourceItemId,
    );
    if (!storedItem) {
      throw new OrderChangeRequestError('当前工单的款式映射已变化，请刷新后重试');
    }
    if (
      isTrustedAdminItemPricingSnapshot(
        storedItem.pricingSnapshot,
        storedItem,
      )
    ) {
      return [];
    }
    return [{
      where: { id: projectedItem.sourceItemId },
      data: resolvePureChangeRequestPricing({
        quote,
        quantity: projectedItem.quantity,
        itemName: projectedItem.itemName,
        itemKey: projectedItem.itemKey,
        requestId: `factory-confirm:${order.id}`,
        quotedAt: input.now,
      }),
    }];
  });
  const packaging = packagingRepriceFromPureCalculation({
    calculation: projected.calculation,
    requestId: `factory-confirm:${order.id}`,
    reviewedAt: input.now,
    storedTotal: order.packagingAmount,
    groups: order.packagingGroups,
    preserveAdminConfirmed: true,
  });
  // Complete every deterministic pricing/trust/version validation before the
  // first mutation. Transaction rollback remains a last resort, not the
  // normal control flow for a stale or forged pricing snapshot.
  const logisticsPlan = await prepareExternalLogisticsChargeRefresh({
    client: tx,
    calculation: projected.calculation,
    requestId: `factory-confirm:${order.id}`,
    reviewedAt: input.now,
    shipments: order.shipments,
    customerCharges: order.customerCharges,
    preserveAdminConfirmed: true,
    actorId: input.actorId,
    previousPriceRevision: order.priceRevision,
  });
  for (const itemPlan of itemUpdatePlans) {
    await tx.orderItem.update(itemPlan);
  }
  await applyPackagingRepricePlans(tx, packaging);
  // Independent plate charges are order-level facts, so factory confirmation
  // leaves them untouched and the aggregate below includes their live amount.
  await applyExternalLogisticsChargeRefresh({
    client: tx,
    plan: logisticsPlan,
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
  const confirmedFee = checkedOrderTotal(
    new Decimal(processingAmount).plus(
      customerChargeTotal._sum.amount ?? 0,
    ),
  );
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
  quoteToken: string | null;
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
          select: LOGISTICS_PROJECTION_CHARGE_SELECT,
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
        quoteToken: null,
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
      orderStatus: order.status,
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
    assertExternalLogisticsChargeIdentity({
      shipments: order.shipments,
      customerCharges: order.customerCharges,
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
      quoteToken: projected.calculation.quoteToken,
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

export type CancellationSettlementPreview = CancellationSettlementReference & {
  productionFactsToken?: string;
  priceRevision: number;
  quoteToken: string;
};

function cancellationSettlementPreview(
  request: CancellationRequest,
  producedQty: number,
  reference: CancellationSettlementReference,
): CancellationSettlementPreview {
  return { ...reference, priceRevision: request.order.priceRevision,
    quoteToken: createOrderChangeApprovalToken({
      requestId: request.id, baseRevision: request.baseRevision,
      priceRevision: request.order.priceRevision,
      // The existing approval envelope hashes the full, server-derived reference.
      // This also catches rule publication between preview and approval when the
      // order price revision itself has not changed.
      pureQuoteToken: JSON.stringify({ kind: 'CANCELLATION_REFERENCE_V1',
        workOrderVersion: request.order.workOrderVersion, producedQty, reference }),
      pendingChargeResolutions: [],
    }),
  };
}

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
  for (const operation of request.order.productionOperations ?? []) {
    if (operation.workOrderVersion !== request.order.workOrderVersion) continue;
    const stage = operation.operationType === 'PACKING' ? 'PACKING' : 'FOILING';
    progressByStage.set(stage, (progressByStage.get(stage) ?? new Decimal(0))
      .plus(operation.carriedWorkOrderProgressQty ?? 0));
  }
  const reportedMinimum = Decimal.max(
    ...[...progressByStage.values(), new Decimal(0)],
  );
  const confirmedProduction = productionMinimumByItem(request.order.productionJobs ?? []);
  const confirmedMinimum = [...confirmedProduction.values()].reduce((sum, qty) => sum.plus(qty), new Decimal(0));
  const minimum = Decimal.max(reportedMinimum, confirmedMinimum);
  if (new Decimal(value).lt(minimum)) {
    throw new OrderChangeRequestError(
      `已产数量不能小于已登记生产 ${minimum.toString()}；如与当前总量不符，请先核对历史生产`,
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
  const minimums = productionMinimumByItem(request.order.productionJobs ?? []);
  if ([...minimums].some(([id, qty]) => !request.order.items.some(item => item.id === id && qty.lte(item.quantity)))) throw new OrderChangeRequestError('历史实际生产超出当前款式数量，请核对取消结算，原生产工资保持不变');
  const minimumTotal = [...minimums.values()].reduce((sum, qty) => sum.plus(qty), new Decimal(0));
  const additional = new Decimal(producedQty).minus(minimumTotal);
  if (additional.isNegative()) throw new OrderChangeRequestError('已产数量少于已核定的实际生产');
  const remainder = additional.isZero() ? [] : allocateCancellationProducedQuantity(
    request.order.items.map(item => ({ ...item, quantity: new Decimal(item.quantity).minus(minimums.get(item.id) ?? 0).toNumber() })), additional.toNumber());
  const allocation = request.order.items.map(item => ({ orderItemId: item.id,
    producedQty: (minimums.get(item.id) ?? new Decimal(0)).plus(remainder.find(row => row.orderItemId === item.id)?.producedQty ?? 0).toNumber() }));
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
      historicalBlankItems: request.order.items,
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
): Promise<CancellationSettlementPreview> {
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
    request.order.status = await resolveOrderChangeStageInTx(tx, request.order);
    const versionMismatchReason = changeRequestVersionMismatchReason(request);
    if (versionMismatchReason) {
      throw new OrderChangeRequestError(versionMismatchReason);
    }
    // 已有地址发货即正常收费（业主 2026-09-24），不给出任何取消结算参考价。
    assertChangeRequestRespectsShippedShipments({ phase: 'REVIEW', isCancellation: true, itemChangeCount: 0, shipments: request.order.shipments });
    await assertProductionFactsReadyForChange(tx, request.orderId, request.order);
    const producedQty = validateCancellationProducedQuantity(
      request,
      input.producedQty,
    );
    const reference = await cancellationSettlementReferenceInTx(
      tx,
      request,
      producedQty,
      await databaseClockNow(tx),
    );
    return { ...cancellationSettlementPreview(request, producedQty, reference), productionFactsToken: request.order.simpleProduction ? await productionFactsToken(tx, request.orderId) : undefined };
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
  let completionNotification: ProductionCompletionNotification | undefined;
  const result = await db.$transaction(async (tx) => {
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
      return recheckClosedChangeInTx(tx, denied, actor.id, value => { completionNotification = value; });
    }
    const actualStatus = request.order.status;
    request.order.status = await resolveOrderChangeStageInTx(tx, request.order);
    const versionMismatchReason = changeRequestVersionMismatchReason(request);
    if (versionMismatchReason) {
      return recheckClosedChangeInTx(tx, await tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.STALE,
          reviewedById: actor.id,
          reviewRemark: versionMismatchReason,
          reviewedAt,
        },
      }), actor.id, value => { completionNotification = value; });
    }
    if (!CANCELLABLE_BY_REQUEST_STATUSES.includes(request.order.status)) {
      throw new OrderChangeRequestError('当前工单状态不允许批准取消');
    }
    await assertProductionFactsReadyForChange(tx, request.orderId, request.order);
    if (request.order.simpleProduction && input.expectedProductionFactsToken !== await productionFactsToken(tx, request.orderId)) throw new OrderChangeRequestError('生产核对记录已变化，请重新预览取消结算');
    assertChangeRequestRespectsShippedShipments({ phase: 'REVIEW', isCancellation: true, itemChangeCount: 0, shipments: request.order.shipments });
    if (request.order.outsourceOrders.length > 0) {
      throw new OrderChangeRequestError(
        '工单存在已发出或进行中的外协单，请先处理外协',
      );
    }

    const producedQty = validateCancellationProducedQuantity(
      request,
      input.producedQty,
    );
    if (input.expectedPriceRevision === undefined || input.expectedQuoteToken === undefined) {
      throw new OrderChangeRequestError('批准取消前必须先计算并确认最新参考结算价');
    }
    if (input.expectedPriceRevision !== request.order.priceRevision) {
      throw new OrderChangeRequestError('材料单价或价格版本已变化，请重新计算参考结算价');
    }
    if (request.order.confirmedFee === null) {
      throw new OrderChangeRequestError('工单缺少已确认费用，禁止猜测取消结算');
    }
    const reference = await cancellationSettlementReferenceInTx(
      tx,
      request,
      producedQty,
      reviewedAt,
    );
    if (input.expectedQuoteToken !== cancellationSettlementPreview(request, producedQty, reference).quoteToken) {
      throw new OrderChangeRequestError('参考结算价已变化，请重新计算并核对后批准取消');
    }
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
    if (request.order.simpleProduction) {
      const jobs = await tx.productionJob.findMany({ where: { orderId: request.orderId }, select: { workerId: true } });
      for (const workerId of [...new Set(jobs.map(job => job.workerId))].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaryIdentityLockKey(workerId)}))`;
      await tx.productionJob.updateMany({ where: { orderId: request.orderId, status: 'PENDING' }, data: { status: 'CANCELLED', revision: { increment: 1 } } });
    }

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
          status: { before: actualStatus, after: OrderStatus.CANCELLED },
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
  await dispatchProductionCompletionNotification(completionNotification);
  return result;
}

type ProjectedOrderQuote = Awaited<
  ReturnType<typeof calculateProjectedOrderQuote>
>;

type ApprovedModificationFeeInput = {
  order: Pick<
    ModificationReviewRequest['order'],
    'settlementType' | 'quotedFee' | 'confirmedFee'
  >;
  locksAdministratorConfirmedFee: boolean;
  pricingPending: boolean;
  nextTotal: string;
};

/**
 * Fee lifecycle written together with an approved repricing modification.
 * An administrator-confirmed result locks confirmedFee to the approved total
 * for every settlement type. Otherwise external sales re-snapshot the quote.
 * Internal / factory-direct orders do not maintain quotedFee here; their
 * confirmedFee is stamped at factory confirmation (production-readiness.ts)
 * and, once present, must follow the approved total (or be withdrawn while
 * pricing is pending) so shipment, settlement and fulfilment repricing never
 * read a stale confirmed amount. `null` means the lifecycle is unchanged.
 */
function approvedModificationFeeSnapshot(input: ApprovedModificationFeeInput) {
  const { order, nextTotal } = input;
  if (input.locksAdministratorConfirmedFee) {
    // quotedFee is the sales-side estimate and keeps its original immutable
    // revision pointer. Administrator resolution creates the distinct
    // confirmed snapshot.
    return { quotedFee: order.quotedFee, confirmedFee: nextTotal, settledFee: null };
  }
  if (order.settlementType === OrderSettlementType.EXTERNAL_SALES) {
    // Match external submit: an automatic quote has a confirmed pricing
    // status, but confirmedFee remains a later factory/customer-fee
    // lifecycle snapshot.
    return { quotedFee: nextTotal, confirmedFee: null, settledFee: null };
  }
  if (order.confirmedFee === null) return null;
  return {
    quotedFee: order.quotedFee,
    confirmedFee: input.pricingPending ? null : nextTotal,
    settledFee: null,
  };
}

function approvedModificationFeeOrderData(
  input: ApprovedModificationFeeInput & {
    pricingRevisionId: string;
    quotedFeeCompleteness: OrderQuotedFeeCompleteness;
  },
): Prisma.OrderUncheckedUpdateInput | null {
  const snapshot = approvedModificationFeeSnapshot(input);
  if (!snapshot) return null;
  const replacesExternalQuote =
    input.order.settlementType === OrderSettlementType.EXTERNAL_SALES &&
    !input.locksAdministratorConfirmedFee;
  return replacesExternalQuote
    ? {
        quotedFee: input.nextTotal,
        quotedFeeCompleteness: input.quotedFeeCompleteness,
        quotedPricingRevisionId: input.pricingRevisionId,
        confirmedFee: null,
        settledFee: null,
      }
    : { confirmedFee: snapshot.confirmedFee, settledFee: null };
}

async function persistApprovedModificationPricingInTx(input: {
  actor: { id: string; role: Role };
  catalogIdentityChanges: readonly CatalogIdentityAuditEntry[];
  packagingReprice: PackagingRepriceResult | null;
  pricingChargeSyncPlan: PricingChargeSyncPlan | null;
  projected: ProjectedOrderQuote | null;
  pendingChargeResolutions: ReadonlyMap<
    string,
    ValidatedPendingChargeResolution
  >;
  request: ModificationReviewRequest;
  reviewedAt: Date;
  reviewRemark: string | null;
  tx: Prisma.TransactionClient;
}) {
  const {
    actor,
    catalogIdentityChanges,
    packagingReprice,
    pricingChargeSyncPlan,
    projected,
    pendingChargeResolutions,
    request,
    reviewedAt,
    reviewRemark,
    tx,
  } = input;
  const versionedProductionChange = VERSIONED_CHANGE_STATUSES.has(
    request.order.status,
  );
  if (projected) {
    if (!pricingChargeSyncPlan) {
      throw new OrderChangeRequestError('收费重算预检结果缺失');
    }
    await applyPricingChargeSync({
      client: tx,
      calculation: projected.calculation,
      reviewedAt,
      orderId: request.order.id,
      actorId: actor.id,
      plan: pricingChargeSyncPlan,
    });
  }

  const nextRevision = request.order.revision + 1;
  const currentWorkOrderVersion = request.order.workOrderVersion ?? 1;
  const nextWorkOrderVersion =
    currentWorkOrderVersion + (versionedProductionChange ? 1 : 0);
  const nextPackagingAmount =
    packagingReprice?.total ?? request.order.packagingAmount;
  // Metadata-only approval must agree with buildUnchangedPricingPreview.
  // Historical item/charge rows may not reconstruct the confirmed order price.
  let nextProcessingAmount = new Decimal(request.order.processingAmount).toFixed(2);
  let nextTotal = new Decimal(request.order.totalAmount).toFixed(2);
  if (projected) {
    const refreshedItems = await tx.orderItem.findMany({
      where: { orderId: request.order.id },
      select: { subtotal: true },
    });
    nextProcessingAmount = orderTotal(refreshedItems, nextPackagingAmount);
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
    const customerChargeTotal = await tx.orderCustomerCharge.aggregate({
      where: { orderId: request.order.id },
      _sum: { amount: true },
    });
    nextTotal = checkedOrderTotal(
      new Decimal(nextProcessingAmount).plus(customerChargeTotal._sum.amount ?? 0),
    );
  }
  await tx.order.update({
    where: { id: request.order.id },
    data: {
      revision: nextRevision,
      ...(readProposedDueDate(request.proposedChanges) !== undefined ? { promisedDate: readProposedDueDate(request.proposedChanges) } : {}),
      ...(versionedProductionChange
        ? {
            workOrderVersion: nextWorkOrderVersion,
            // scheduledAt is the release boundary of the current generation.
            // Only a released order is rematerialized now; CONFIRMED gets its
            // boundary when it is actually released.
            ...(isReprintChangeStatus(request.order.status) ? { scheduledAt: reviewedAt } : {}),
            // completedAt is the canonical production-readiness marker for
            // one work-order generation. A production-changing revision
            // rematerializes unfinished work and must reopen that marker.
            completedAt: request.order.simpleProduction && !projected ? request.order.completedAt : null,
          }
        : {}),
      ...(packagingReprice && packagingReprice.plans.length > 0
        ? { packagingAmount: nextPackagingAmount }
        : {}),
      ...(projected
        ? { processingAmount: nextProcessingAmount, totalAmount: nextTotal }
        : {}),
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
  const resolvedPendingLineCodes = new Set(
    [...pendingChargeResolutions.keys()].map((businessKey) => {
      const shipmentKey = businessKey.slice(
        'SHIPMENT:'.length,
        -':SHIPPING_FEE'.length,
      );
      return `SHIPPING:${shipmentKey}`;
    }),
  );
  const unresolvedPendingLineCodes = projected
    ? projected.calculation.quote.pendingLineCodes.filter(
        (code) => !resolvedPendingLineCodes.has(code),
      )
    : [];
  const pureQuoteCompleteness = projected
    ? projected.calculation.quote.status !== 'INVALID_INPUT' &&
      projected.calculation.quote.manualReasons.length === 0 &&
      unresolvedPendingLineCodes.length === 0
      ? OrderQuotedFeeCompleteness.COMPLETE
      : OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS
    : null;
  const nonVersionedAutoConfirmed =
    !PLATE_PRESERVING_PRODUCTION_STATUSES.has(request.order.status) &&
    pureQuoteCompleteness === OrderQuotedFeeCompleteness.COMPLETE;
  const preservesProductionPlateCharges =
    PLATE_PRESERVING_PRODUCTION_STATUSES.has(request.order.status);
  const preservesManualPlateFee = projected && quoteHasDefaultZeroPlateCharge(projected.calculation.quote) &&
    request.order.customerCharges.some((charge) => charge.category.code === 'PLATE_MAKING_FEE' &&
      charge.status !== OrderCustomerChargeStatus.PENDING_AMOUNT && charge.amount !== null && new Decimal(charge.amount).isPositive());
  const hasAdministratorResolvedCharges = pendingChargeResolutions.size > 0 || preservesManualPlateFee;
  const locksAdministratorConfirmedFee =
    preservesProductionPlateCharges ||
    (nonVersionedAutoConfirmed && hasAdministratorResolvedCharges);
  const nextPricingStatus = !projected
    ? null
    : preservesProductionPlateCharges
      ? ORDER_PRICING_STATUS.ADMIN_CONFIRMED
      : nonVersionedAutoConfirmed
        ? hasAdministratorResolvedCharges
          ? ORDER_PRICING_STATUS.ADMIN_CONFIRMED
          : ORDER_PRICING_STATUS.AUTO_CONFIRMED
        : ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION;
  const feeInput: ApprovedModificationFeeInput = {
    order: request.order,
    locksAdministratorConfirmedFee: Boolean(locksAdministratorConfirmedFee),
    pricingPending: nextPricingStatus === ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
    nextTotal,
  };
  const orderFeeSnapshot = approvedModificationFeeSnapshot(feeInput);
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
              ? hasAdministratorResolvedCharges
                ? 'CHANGE_REQUEST_APPLIED_ADMIN_CONFIRMED'
                : 'CHANGE_REQUEST_APPLIED_AUTO_CONFIRMED'
              : 'CHANGE_REQUEST_APPLIED_PENDING',
          actorId: actor.id,
          now: reviewedAt,
          expectedPriceRevision: request.order.priceRevision,
          incrementOrderRevision: false,
          remark: reviewRemark ?? request.reason,
          ...(orderFeeSnapshot ? { orderFeeSnapshot } : {}),
          metadata: {
            changeRequestId: request.id,
            workOrderVersion: nextWorkOrderVersion,
            engineVersion: 'CREATE_ORDER_PURE_V1',
            priceBooks: projected.calculation.quote.priceVersion,
            ...(locksAdministratorConfirmedFee
              ? {
                  preservedQuotedFee:
                    request.order.quotedFee?.toFixed(2) ?? null,
                  quotedPricingRevisionId:
                    request.order.quotedPricingRevisionId,
                  confirmedFee: nextTotal,
                }
              : { quotedFee: nextTotal }),
            quotedFeeCompleteness: pureQuoteCompleteness!,
            pureQuote: {
              status: projected.calculation.quote.status,
              knownTotal: projected.calculation.quote.knownTotal,
              pendingLineCodes:
                projected.calculation.quote.pendingLineCodes,
              resolvedPendingLineCodes: [...resolvedPendingLineCodes],
              unresolvedPendingLineCodes,
            },
            administratorResolvedCharges: [...pendingChargeResolutions.values()].map(
              (resolution) => ({
                businessKey: resolution.businessKey,
                shipmentId: resolution.shipmentId,
                amount: resolution.amount,
                reason: resolution.reason,
              }),
            ),
            ...(catalogIdentityChanges.length > 0
              ? { catalogIdentityChanges: [...catalogIdentityChanges] }
              : {}),
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
    const feeOrderData = approvedModificationFeeOrderData({
      ...feeInput,
      pricingRevisionId: pricingRevision.pricingRevisionId,
      quotedFeeCompleteness: pureQuoteCompleteness!,
    });
    if (feeOrderData) {
      await tx.order.update({ where: { id: request.order.id }, data: feeOrderData });
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
    versionedProductionChange,
  };
}

type ApprovedModificationPricing = Awaited<
  ReturnType<typeof persistApprovedModificationPricingInTx>
>;

async function finalizeApprovedModificationInTx(input: {
  wasOnHold?: boolean;
  actor: { id: string; role: Role };
  catalogIdentityChanges: readonly CatalogIdentityAuditEntry[];
  packagingReprice: PackagingRepriceResult | null;
  pendingChargeResolutions: ReadonlyMap<
    string,
    ValidatedPendingChargeResolution
  >;
  pricing: ApprovedModificationPricing;
  request: ModificationReviewRequest;
  reviewedAt: Date;
  reviewRemark: string | null;
  tx: Prisma.TransactionClient;
}) {
  const {
    actor,
    catalogIdentityChanges,
    packagingReprice,
    pendingChargeResolutions,
    pricing,
    request,
    reviewedAt,
    reviewRemark,
    tx,
  } = input;
  const {
    currentWorkOrderVersion,
    nextPackagingAmount,
    nextProcessingAmount,
    nextRevision,
    nextTotal,
    nextWorkOrderVersion,
    pricingRevision,
    nextPricingStatus,
    versionedProductionChange,
  } = pricing;
  const rematerializedProduction = isReprintChangeStatus(request.order.status)
    ? await activateProductionOperationsInTx(
        tx,
        request.order.id,
        actor,
        reviewedAt,
        {
          targetStatus: input.wasOnHold ? OrderStatus.ON_HOLD : request.order.status,
          allowVersionRematerialization: true,
        },
      )
    : null;
  if (rematerializedProduction && request.order.simpleProduction) {
    await preserveCarriedCompletionInTx(tx, request.order.id, request.order.completedAt);
  }
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
        ...(dueDateChangePreview(request.proposedChanges, request.order.promisedDate) ? { promisedDate: dueDateChangePreview(request.proposedChanges, request.order.promisedDate)! } : {}),
        revision: { before: request.baseRevision, after: nextRevision },
        workOrderVersion: {
          before: currentWorkOrderVersion,
          after: nextWorkOrderVersion,
        },
        ...(isReprintChangeStatus(request.order.status)
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
        ...(pendingChargeResolutions.size > 0
          ? {
              administratorResolvedCharges: [
                ...pendingChargeResolutions.values(),
              ].map((resolution) => ({
                businessKey: resolution.businessKey,
                shipmentId: resolution.shipmentId,
                amount: resolution.amount,
                reason: resolution.reason,
              })),
            }
          : {}),
        ...(catalogIdentityChanges.length > 0
          ? { catalogIdentityChanges: [...catalogIdentityChanges] }
          : {}),
        requestId: request.id,
        ...(input.wasOnHold ? { remainedOnHold: true } : {}),
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
  context?: OrderChangeTransactionContext,
) {
  if (actor.role !== Role.ADMIN) {
    throw new OrderChangeRequestError('只有管理员可以审核工单修改申请');
  }

  const locator = await (context?.tx ?? db).orderChangeRequest.findUnique({
    where: { id: input.requestId },
    select: { orderId: true, type: true },
  });
  if (!locator) throw new OrderChangeRequestError('修改申请不存在');
  if (context && locator.type === OrderChangeRequestType.CANCEL) {
    throw new OrderChangeRequestError('编辑工单不能执行取消审批');
  }
  if (locator.type === OrderChangeRequestType.CANCEL) {
    return reviewOrderCancellationRequest(input, actor, locator);
  }

  let completionNotification: ProductionCompletionNotification | undefined;
  const result = await inOrderChangeTransaction(context, async (tx) => {
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
      return recheckClosedChangeInTx(tx, denied, actor.id, value => { completionNotification = value; });
    }

    const wasOnHold = request.order.status === OrderStatus.ON_HOLD;
    request.order.status = await resolveOrderChangeStageInTx(tx, request.order);
    const versionMismatchReason = changeRequestVersionMismatchReason(request);
    if (versionMismatchReason) {
      return recheckClosedChangeInTx(tx, await tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.STALE,
          reviewedById: actor.id,
          reviewRemark: versionMismatchReason,
          reviewedAt,
        },
      }), actor.id, value => { completionNotification = value; });
    }
    if (!CHANGEABLE_ORDER_STATUSES.includes(request.order.status)) {
      return recheckClosedChangeInTx(tx, await tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.STALE,
          reviewedById: actor.id,
          reviewRemark: `工单状态已变为 ${request.order.status}，不再允许修改，申请已自动失效`,
          reviewedAt,
        },
      }), actor.id, value => { completionNotification = value; });
    }

    const proposedChanges = readProposedChanges(request.proposedChanges);
    assertChangeRequestRespectsShippedShipments({ phase: 'REVIEW', isCancellation: false, itemChangeCount: proposedChanges.length, shipments: request.order.shipments });
    // Re-check the live item count under the per-order lock. This is the
    // authoritative guard for legacy pending requests and any state change
    // that occurred after the proposal was recorded.
    assertOrderItemLimit(request.order.items.length, proposedChanges);
    const itemById = new Map(request.order.items.map((item) => [item.id, item]));
    const normalizedChanges = normalizeProposedChanges(
      proposedChanges,
      itemById,
    );
    const changes = preserveUnchangedStoredFoilFacts(
      await resolveProposedChangeCatalogIdentities(tx, normalizedChanges, itemById, reviewedAt),
      proposedChanges, itemById,
    );
    const catalogIdentityChanges = buildCatalogIdentityAuditEntries(
      changes,
      itemById,
    );
    const dateChange = dueDateChangePreview(request.proposedChanges, request.order.promisedDate);
    if (!hasAnySemanticChange(changes, itemById) && (!dateChange || dateChange.before === dateChange.after)) {
      return recheckClosedChangeInTx(tx, await tx.orderChangeRequest.update({
        where: { id: request.id },
        data: {
          status: OrderChangeRequestStatus.STALE,
          reviewedById: actor.id,
          reviewRemark:
            '申请内容与当前工单一致，没有可应用的实际变化，已自动失效',
          reviewedAt,
        },
      }), actor.id, value => { completionNotification = value; });
    }
    if (input.expectedPriceRevision === undefined) {
      throw new OrderChangeRequestError(
        '批准修改前必须先生成并确认最新价格预览',
      );
    }
    await assertProductionFactsReadyForChange(tx, request.orderId, request.order, !hasPricingFactChanges(changes, itemById));
    if (request.order.simpleProduction && input.expectedProductionFactsToken !== await productionFactsToken(tx, request.orderId)) throw new OrderChangeRequestError('生产核对记录已变化，请重新预览修改');
    if (input.expectedPriceRevision !== request.order.priceRevision) {
      throw new OrderChangeRequestError(
        `价格版本已从 v${input.expectedPriceRevision} 更新为 v${request.order.priceRevision}，请刷新预览`,
      );
    }
    const primaryShipment = request.order.shipments.find(
      (shipment) => shipment.sequence === 1,
    );
    if (!primaryShipment && changes.length > 0) {
      throw new OrderChangeRequestError('工单缺少主收货地址，不能安全更新数量');
    }
    validateChangedItemFacts(changes, itemById, request);
    assertPackagingChangeRequestSupported({
      changes,
      groups: request.order.packagingGroups ?? [],
      status: request.order.status,
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
    const requotesLogistics = requotesLogisticsChargesOnChange(request.order);
    const projected = pricingChanged
      ? await calculateProjectedOrderQuote({
          client: tx,
          now: reviewedAt,
          orderStatus: request.order.status,
          settlementType: request.order.settlementType,
          isSfCollect: request.order.isSfCollect,
          items: request.order.items,
          logisticsItems: request.order.items,
          shipments: request.order.shipments,
          primaryShipmentId: primaryShipment!.id,
          packagingGroups: request.order.packagingGroups ?? [],
          changes,
          includeOrderCharges: requotesLogistics,
        })
      : null;
    if (projected) {
      assertPreservedPlateDoesNotOverlapAtomicBundle({
        status: request.order.status,
        quote: projected.calculation.quote,
        customerCharges: request.order.customerCharges,
      });
      assertPreservedProductionPlateCoverage({
        status: request.order.status,
        quote: projected.calculation.quote,
        items: request.order.items,
        customerCharges: request.order.customerCharges,
      });
    }
    if (projected && requotesLogistics) {
      // Validate persisted charge identity before item/package mutations. A
      // transaction rollback is the final safety net, not a substitute for a
      // zero-write preflight when legacy data is cross-linked.
      assertExternalLogisticsChargeIdentity({
        shipments: request.order.shipments,
        customerCharges: request.order.customerCharges,
      });
    }
    const pendingResolutionState=validateModificationQuoteApproval(input,projected,request);
    const { projectedByItemKey, pricingByItemKey } = buildModificationItemPricing(
      projected, request.id, reviewedAt,
    );
    const packagingReprice = projected
      ? packagingRepriceFromPureCalculation({
          calculation: projected.calculation,
          requestId: request.id,
          reviewedAt,
          storedTotal: request.order.packagingAmount,
          groups: request.order.packagingGroups ?? [],
        })
      : null;

    // Materialize all item/package/charge decisions before the first ORM
    // mutation. In particular, unchanged item coverage and logistics/plate
    // resolver failures must not be discovered after shipment or item writes.
    for (const [changeIndex, change] of changes.entries()) {
      const itemKey =
        change.operation === 'UPDATE'
          ? change.itemId
          : addedItemKey(changeIndex);
      if (projected && !pricingByItemKey.has(itemKey)) {
        throw new OrderChangeRequestError(
          change.operation === 'UPDATE'
            ? '整单重算缺少变更款式结果'
            : '新增款式缺少报价结果，无法批准修改',
        );
      }
    }
    const changedExistingIds = new Set(
      changes.flatMap((change) =>
        change.operation === 'UPDATE' ? [change.itemId] : [],
      ),
    );
    const unchangedItemPricingPlans = projected
      ? request.order.items
          .filter((item) => !changedExistingIds.has(item.id))
          .map((item) => {
            const pricing = pricingByItemKey.get(item.id);
            if (!pricing || !projectedByItemKey.has(item.id)) {
              throw new OrderChangeRequestError(
                '整单重算缺少存量款式结果',
              );
            }
            return { itemId: item.id, pricing };
          })
      : [];
    const pricingChargeSyncPlan = projected
      ? await preparePricingChargeSync({
          client: tx,
          calculation: projected.calculation,
          requestId: request.id,
          reviewedAt,
          shipments: request.order.shipments,
          customerCharges: request.order.customerCharges,
          orderId: request.order.id,
          actorId: actor.id,
          refreshExternalLogistics: requotesLogistics,
          // A production generation can already have consumed and finalized
          // physical plates. Pre-production changes instead synchronize the
          // one aggregate manual-pricing exit with projected foil facts.
          syncPlateCharge: shouldSyncPlateCharge(
            request.order.status,
            request.order.settlementType,
          ) || quoteHasDefaultZeroPlateCharge(projected.calculation.quote),
          pendingChargeResolutions:
            pendingResolutionState.resolutionsByBusinessKey,
          previousPriceRevision: request.order.priceRevision,
        })
      : null;

    await applyApprovedItemChangesInTx({ request, changes, itemById, tx, primaryShipment, pricingByItemKey, projected, unchangedItemPricingPlans, packagingReprice });

    const pricing = await persistApprovedModificationPricingInTx({
      actor,
      catalogIdentityChanges,
      packagingReprice,
      pricingChargeSyncPlan,
      projected,
      pendingChargeResolutions:
        pendingResolutionState.resolutionsByBusinessKey,
      request,
      reviewedAt,
      reviewRemark,
      tx,
    });
    const reviewed = await finalizeApprovedModificationInTx({
      wasOnHold,
      actor,
      catalogIdentityChanges,
      packagingReprice,
      pendingChargeResolutions:
        pendingResolutionState.resolutionsByBusinessKey,
      pricing,
      request,
      reviewedAt,
      reviewRemark,
      tx,
    });
    if (isAwaitingFactoryConfirmation(request.order.status)) {
      await prepareOrderForProductionInTx(tx, request.order.id, actor, reviewedAt);
    }
    if (isReprintChangeStatus(request.order.status) && (!wasOnHold || (request.order.simpleProduction && request.order.completedAt))) {
      const completion = await maybeCompleteProductionOrder(
        tx as unknown as ProductionCompletionTx, request.order.id, actor.id, reviewedAt,
        request.order.simpleProduction ? request.order.completedAt : undefined,
      );
      completionNotification = completion.notification;
    }
    return reviewed;
  }).catch((error: unknown) => {
    if (error instanceof ProductionOperationMaterializationError) {
      throw new OrderChangeRequestError(error.message);
    }
    throw error;
  });
  if (context) context.onCompletion?.(completionNotification);
  else await dispatchProductionCompletionNotification(completionNotification);
  return result;
}

function validateModificationQuoteApproval(
  input: ReviewOrderChangeRequestInput,
  projected: {
    calculation: CatalogCreateOrderQuoteCalculation;
    projectedItems: ProjectedQuoteItem[];
  } | null,
  request: ModificationReviewRequest,
) {
  const submittedPendingChargeResolutions = input.pendingChargeResolutions ?? [];
  const pendingResolutionState = projected
    ? validatePendingChargeResolutions({
        calculation: projected.calculation,
        shipments: request.order.shipments,
        resolutions: submittedPendingChargeResolutions,
        requireComplete: true,
      })
    : {
        pendingCharges: [] as OrderChangePendingChargePreview[],
        resolutionsByBusinessKey: new Map<string, ValidatedPendingChargeResolution>(),
      };
  if (!projected && submittedPendingChargeResolutions.length > 0) {
    throw new OrderChangeRequestError('本次修改没有待核物流费，不能提交人工收费');
  }
  if (
    pendingResolutionState.pendingCharges.length > 0 &&
    input.expectedPriceRevision === undefined
  ) {
    throw new OrderChangeRequestError('批准待核物流费前必须先刷新并确认最新价格预览');
  }
  if (projected) {
    const approvalToken = createOrderChangeApprovalToken({
      requestId: request.id,
      baseRevision: request.baseRevision,
      priceRevision: request.order.priceRevision,
      pureQuoteToken: projected.calculation.quoteToken,
      pendingChargeResolutions: [...pendingResolutionState.resolutionsByBusinessKey.values()],
    });
    if (input.expectedQuoteToken === undefined || input.expectedQuoteToken !== approvalToken) {
      throw new OrderChangeRequestError(
        '价格规则、计价结果或人工物流核价内容已变化，请刷新计价预览后重试',
      );
    }
  } else if (input.expectedQuoteToken !== undefined) {
    throw new OrderChangeRequestError('本次修改无需重新计价，请刷新计价预览后重试');
  }
  return pendingResolutionState;
}

type ApplyApprovedItemChangesInTxOptions = {
  request: ModificationReviewRequest;
  changes: ResolvedProposedItemChange[];
  itemById: Map<string, ModificationReviewRequest['order']['items'][number]>;
  tx: Prisma.TransactionClient;
  primaryShipment: ModificationReviewRequest['order']['shipments'][number] | undefined;
  pricingByItemKey: Map<
    string,
    {
      unitPrice: string;
      fixedFee: string;
      subtotal: string;
      quoteDisposition: typeof OrderItemQuoteDisposition.PRICED;
      quotedAmount: string;
      suggestedSubtotal: string | null;
      pricingSnapshot: Prisma.InputJsonObject;
      priceOverrideReason: string | null;
    }
  >;
  projected: {
    calculation: CatalogCreateOrderQuoteCalculation;
    projectedItems: ProjectedQuoteItem[];
  } | null;
  unchangedItemPricingPlans: {
    itemId: string;
    pricing: {
      unitPrice: string;
      fixedFee: string;
      subtotal: string;
      quoteDisposition: typeof OrderItemQuoteDisposition.PRICED;
      quotedAmount: string;
      suggestedSubtotal: string | null;
      pricingSnapshot: Prisma.InputJsonObject;
      priceOverrideReason: string | null;
    };
  }[];
  packagingReprice: PackagingRepriceResult | null;
};

async function applyApprovedItemChangesInTx({
  request,
  changes,
  itemById,
  tx,
  primaryShipment,
  pricingByItemKey,
  projected,
  unchangedItemPricingPlans,
  packagingReprice,
}: ApplyApprovedItemChangesInTxOptions) {
  let nextSequence = Math.max(0, ...request.order.items.map((item) => item.sequence)) + 1;
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
              shipmentId: primaryShipment!.id,
              orderItemId: item.id,
            },
          },
          create: {
            shipmentId: primaryShipment!.id,
            orderItemId: item.id,
            quantity: change.quantity - extraShipmentQty,
          },
          update: { quantity: change.quantity - extraShipmentQty },
        });
      }

      const pricing = pricingByItemKey.get(item.id);
      const catalogIdentity = change.catalogIdentity;
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          name: change.name,
          quantity: change.quantity,
          pack: change.pack,
          ...(catalogIdentity
            ? {
                productId: catalogIdentity.productId,
                productStructure: catalogIdentity.productStructure,
                pricingGroup: catalogIdentity.pricingGroup,
                specification: catalogIdentity.specification,
                actualWidthMm: catalogIdentity.actualWidthMm,
                actualHeightMm: catalogIdentity.actualHeightMm,
              }
            : {}),
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
      if (change.pack !== undefined) {
        await tx.orderPackagingGroupLine.updateMany({
          where: { orderId: request.order.id, orderItemId: item.id },
          data: { unitsPerBag: change.pack },
        });
      }
      continue;
    }

    const template = itemById.get(change.templateItemId);
    if (!template) throw new OrderChangeRequestError('参考款式已不存在，请重新申请');
    const pricing = pricingByItemKey.get(addedItemKey(changeIndex));
    if (!pricing) {
      throw new OrderChangeRequestError('新增款式缺少报价结果，无法批准修改');
    }
    const catalogIdentity = change.catalogIdentity;
    const persistedCatalogIdentity = catalogIdentity ?? template;
    const created = await tx.orderItem.create({
      data: {
        orderId: request.order.id,
        sequence: nextSequence,
        name: change.name,
        productId: persistedCatalogIdentity.productId,
        pricingRoute: template.pricingRoute,
        productStructure: persistedCatalogIdentity.productStructure,
        artworkVersion: template.artworkVersion,
        plateGroupId: template.plateGroupId,
        pricingGroup: persistedCatalogIdentity.pricingGroup,
        manualQuoteReason: template.manualQuoteReason,
        specification: persistedCatalogIdentity.specification,
        actualWidthMm: persistedCatalogIdentity.actualWidthMm,
        actualHeightMm: persistedCatalogIdentity.actualHeightMm,
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
        shipmentId: primaryShipment!.id,
        orderItemId: created.id,
        quantity: change.quantity,
      },
    });
    // 已发出/加工中/已回货的外协单都是不可变履约快照。新款式即使
    // 模板款式曾外协，也不能被旧外协单自动“继承”；它保持未覆盖，
    // 直到主管显式新建外协单。完工闸口会用逐款数量快照拦住。
  }

  if (projected) {
    for (const itemPlan of unchangedItemPricingPlans) {
      await tx.orderItem.update({
        where: { id: itemPlan.itemId },
        data: itemPlan.pricing,
      });
    }
  }

  if (packagingReprice) {
    await applyPackagingRepricePlans(tx, packagingReprice);
  }
}

function buildModificationItemPricing(
  projected: ProjectedOrderQuote | null,
  requestId: string,
  reviewedAt: Date,
) {
  const quoteByItemKey = new Map(
    projected?.calculation.processing.items.map((quote, index) => [
      projected.projectedItems[index]?.itemKey,
      quote,
    ]) ?? [],
  );
  const projectedByItemKey = new Map(
    projected?.projectedItems.map((item) => [item.itemKey, item]) ?? [],
  );
  const pricingByItemKey = new Map<string, ReturnType<typeof resolvePureChangeRequestPricing>>();
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
        requestId: requestId,
        quotedAt: reviewedAt,
      }),
    );
  }
  return { projectedByItemKey, pricingByItemKey };
}

async function recheckClosedChangeInTx<T extends { orderId: string }>(
  tx: Prisma.TransactionClient, changed: T, actorId: string,
  notify: (value: ProductionCompletionNotification | undefined) => void,
): Promise<T> {
  const order = await tx.order.findUnique({ where: { id: changed.orderId }, select: { simpleProduction: true } });
  if (order?.simpleProduction) {
    const completion = await reconcileProductionOrderInTx(tx, changed.orderId, actorId, await databaseClockNow(tx));
    notify(completion.notification);
  }
  return changed;
}
