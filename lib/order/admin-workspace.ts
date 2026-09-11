import { inspectOrderProductionReadinessInTx } from './production-readiness';
import 'server-only';
import { adminOrderCraftTags, type AdminOrderCraftTag } from './admin-list-presentation';

import Decimal from 'decimal.js';
import {
  AgentMonthlyBillStatus,
  DesignFileType,
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderItemQuoteDisposition,
  OrderPricingStatus,
  OrderPrintJobState,
  OrderQuotedFeeCompleteness,
  OrderStatus,
  OutsourceStatus,
  Prisma,
  ProductionOperationStatus,
  TaskStatus,
} from '../../generated/prisma/client';
import { paginationWindow } from '../admin/table';
import { orderChangeRequestItemsSchema } from '../auth/schemas';
import { db } from '../db';
import { signDesignReadUrl } from '../oss/read-url';
import {
  getWorkOrderProgressByOrderIds,
  type WorkOrderProgressProjection,
} from '../production/work-order-progress-query';
import { selectOrderCustomerFee } from './customer-fee';
import {
  buildOrderWhere,
  MISSING_ORDER_CUSTOMER_FILTER_VALUE,
} from './list-query';
import { promisedDaysLeft } from './promised-date';
import {
  type FactoryConfirmationPriceDiff,
} from './change-request';
import {
  FACTORY_CONFIRMATION_PENDING_STATUSES,
  evaluateFactoryConfirmationPreflight,
  isAwaitingFactoryConfirmation,
  type FactoryConfirmationPreflight,
} from './factory-confirmation-preflight';
import {
  type AdminOrderQueue,
  type AdminOrderSignal,
  type AdminOrderWorkspaceQuery,
} from './admin-workspace-query';

import {
  ACTIVE_PROMISE_STATUSES, PRODUCTION_STATUSES, PRINTABLE_STATUSES, DONE_STATUSES,
  PENDING_CHANGE_WHERE, loadCurrentPrintOrderIds, adminIncompleteCustomerFeeWhere, adminManualPricingWhere,
  adminQueueWhere, adminSignalWhere, andWhere, buildAdminWorkspaceBaseWhere, assertAdmin,
  type AdminOrdersActor,
} from './admin-workspace-filters';
export {
  adminIncompleteCustomerFeeWhere, adminManualPricingWhere, adminQueueWhere,
  adminSignalWhere, buildAdminWorkspaceBaseWhere, buildAdminWorkspaceResultWhere,
  resolveAdminWorkspaceResultWhere, type AdminOrdersActor,
} from './admin-workspace-filters';

export type AdminOrderWorkspaceSummary = {
  orderCount: number;
  totalQuantity: number;
  effectiveFee: string;
  manualPricingCount: number;
  incompleteFeeExcludedCount: number;
  legacyFeeExcludedCount: number;
};

export type AdminOrderWorkspaceCounts = {
  queues: Record<AdminOrderQueue, number>;
  signals: Record<AdminOrderSignal, number>;
};

export type AdminOrderWorkspaceRow = {
  inlineOperations?: import('./admin-inline-types').AdminOrderInlineOperationsData | null;
  id: string;
  orderNo: string;
  revision: number;
  editVersion?: number;
  workOrderVersion: number;
  customName: string | null;
  customer: { id: string | null; name: string; filterValue: string };
  submitter: { id: string; name: string };
  status: OrderStatus;
  statusSummary: string | null;
  isUrgent: boolean;
  isStarred: boolean;
  createdAt: string;
  submittedAt: string | null;
  promisedDate: string | null;
  dueAlert: { kind: 'overdue' | 'due-soon'; days: number } | null;
  promisedDaysLeft?: number | null;
  shipDisabledReason?: string | null;
  itemCount: number;
  totalQuantity: number;
  craftSummary: string;
  craftTags?: AdminOrderCraftTag[];
  thumbnail: { url: string; fileName: string } | null;
  items: Array<{
    id: string;
    sequence: number;
    fig: number | null;
    name: string;
    quantity: number;
    specification: string | null;
    paper: string | null;
    crafts: string[];
    thumbnail: { url: string; fileName: string } | null;
  }>;
  fee: {
    amount: string | null;
    source:
      | 'SETTLED'
      | 'CONFIRMED'
      | 'QUOTED'
      | 'LEGACY'
      | 'PENDING'
      | 'INCOMPLETE';
    estimated: boolean;
  };
  feeStages: {
    quoted: string | null;
    confirmed: string | null;
    settled: string | null;
    active:
      | 'QUOTED'
      | 'CONFIRMED'
      | 'SETTLED'
      | 'PENDING'
      | 'LEGACY'
      | 'INCOMPLETE';
  };
  priceComparison: FactoryConfirmationPriceDiff | null;
  priceComparisonError: string | null;
  confirmationPreflight: FactoryConfirmationPreflight;
  capabilities: {
    confirm: boolean;
    reject: boolean;
    hold: boolean;
    resume: boolean;
    release: boolean;
    ship: boolean;
    settle: boolean;
    createPrint: boolean;
    markPrinted: boolean;
    reviewChange: boolean;
  };
  billing: {
    id: string;
    period: string;
    status: AgentMonthlyBillStatus;
  } | null;
  pendingChangeRequest: {
    id: string;
    type: 'MODIFY' | 'CANCEL';
    reason: string;
    summary?: string | null;
    createdAt: string;
  } | null;
  printPending: boolean;
  pendingPrintJobId: string | null;
  trackingNo: string | null;
  progress: {
    orderTotal: string;
    foilingProgress: string;
    packingProgress: string;
    foilingOverLimit: boolean;
    packingOverLimit: boolean;
    packingAhead: boolean;
    stagnant: boolean;
    stagnationDays: number;
    firstClaimedAt: string | null;
  };
  logs: Array<{
    id: string;
    action: string;
    remark: string | null;
    actorName: string;
    createdAt: string;
  }>;
};

export type AdminOrderWorkspacePage = {
  rows: AdminOrderWorkspaceRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  counts: AdminOrderWorkspaceCounts;
  summary: AdminOrderWorkspaceSummary;
};

// This read owns a coherent list/count/fee snapshot. Bound its total duration
// locally; changing the global transaction default would also affect writes.
const ADMIN_WORKSPACE_READ_TIMEOUT_MS = 15_000;

export function resolveAdminPrintFacts(input: {
  status: OrderStatus;
  workOrderVersion: number;
  requests: readonly {
    id: string;
    workOrderVersion: number;
    resolution: { state: OrderPrintJobState } | null;
  }[];
}): {
  printPending: boolean;
  pendingPrintJobId: string | null;
  canCreatePrint: boolean;
  canMarkPrinted: boolean;
} {
  const printable = PRINTABLE_STATUSES.includes(
    input.status as (typeof PRINTABLE_STATUSES)[number],
  );
  const currentRequests = input.requests.filter(
    (request) => request.workOrderVersion === input.workOrderVersion,
  );
  const pendingRequest = currentRequests.find(
    (request) => request.resolution === null,
  );
  const hasPrinted = currentRequests.some(
    (request) => request.resolution?.state === OrderPrintJobState.PRINTED,
  );
  return {
    // A same-version reprint is represented by a new unresolved request next
    // to the immutable PRINTED receipt of an earlier request. That new request
    // must put the order back into the print queue.
    printPending: printable && (Boolean(pendingRequest) || !hasPrinted),
    pendingPrintJobId: pendingRequest?.id ?? null,
    canCreatePrint: printable && !pendingRequest,
    canMarkPrinted: Boolean(pendingRequest),
  };
}

async function loadAdminWorkspaceCounts(
  tx: Prisma.TransactionClient,
  baseWhere: Prisma.OrderWhereInput,
  currentPrintWhere: Prisma.OrderWhereInput,
  now: Date,
): Promise<AdminOrderWorkspaceCounts> {
  // Interactive transactions share one database connection. Promise.all does
  // not parallelize its SQL: group by the bounded status enum instead of
  // scanning the same filtered orders once for every queue and signal.
  const [allGroups, changeGroups, print, pendingPricing, overdue, dueToday] =
    await Promise.all([
      tx.order.groupBy({ by: ['status'], where: baseWhere, _count: { _all: true } }),
      tx.order.groupBy({
        by: ['status'],
        where: andWhere(baseWhere, PENDING_CHANGE_WHERE),
        _count: { _all: true },
      }),
      tx.order.count({ where: andWhere(baseWhere, currentPrintWhere) }),
      tx.order.count({ where: andWhere(baseWhere, adminManualPricingWhere()) }),
      tx.order.count({ where: andWhere(baseWhere, adminSignalWhere('overdue', now)) }),
      tx.order.count({ where: andWhere(baseWhere, adminSignalWhere('due-today', now)) }),
    ]);
  const allByStatus = new Map(allGroups.map((group) => [group.status, group._count._all]));
  const changeByStatus = new Map(changeGroups.map((group) => [group.status, group._count._all]));
  const countStatuses = (statuses: readonly OrderStatus[], counts = allByStatus) =>
    statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0);
  const pendingChange = changeGroups.reduce((sum, group) => sum + group._count._all, 0);
  // Manual-pricing work is already a subset of factory-pending statuses. A
  // pending change adds other states to todo, and excludes them from production
  // and pending-release, exactly as adminQueueWhere/adminSignalWhere specify.
  const todoStatuses: readonly OrderStatus[] = [
    ...FACTORY_CONFIRMATION_PENDING_STATUSES,
    OrderStatus.CONFIRMED,
    OrderStatus.ON_HOLD,
  ];
  return {
    queues: {
      todo: countStatuses(todoStatuses) + pendingChange - countStatuses(todoStatuses, changeByStatus),
      print,
      production: countStatuses(PRODUCTION_STATUSES) - countStatuses(PRODUCTION_STATUSES, changeByStatus),
      shipped: allByStatus.get(OrderStatus.SHIPPED) ?? 0,
      done: countStatuses(DONE_STATUSES),
      all: allGroups.reduce((sum, group) => sum + group._count._all, 0),
    },
    signals: {
      'pending-confirmation': countStatuses(FACTORY_CONFIRMATION_PENDING_STATUSES),
      'pending-pricing': pendingPricing,
      'pending-release': (allByStatus.get(OrderStatus.CONFIRMED) ?? 0) - (changeByStatus.get(OrderStatus.CONFIRMED) ?? 0),
      'pending-change': pendingChange,
      'on-hold': allByStatus.get(OrderStatus.ON_HOLD) ?? 0,
      overdue,
      'due-today': dueToday,
    },
  };
}

const adminOrderSelect = {
  id: true,
  orderNo: true,
  revision: true,
  editVersion: true,
  workOrderVersion: true,
  priceRevision: true,
  updatedAt: true,
  customName: true,
  customerRef: true,
  status: true,
  isUrgent: true,
  totalAmount: true,
  quotedFee: true,
  confirmedFee: true,
  settledFee: true,
  quotedFeeCompleteness: true,
  createdAt: true,
  submittedAt: true,
  scheduledAt: true,
  promisedDate: true,
  pricingStatus: true,
  trackingNo: true,
  submitter: { select: { id: true, displayName: true } },
  customerParty: { select: { id: true, name: true, shortName: true } },
  _count: { select: { shipments: true } },
  stars: { select: { userId: true } },
  items: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      fig: true,
      name: true,
      quantity: true,
      specification: true,
      paperType: true,
      paperWeightGsm: true,
      craft: true,
      crafts: true,
      quoteDisposition: true,
      tasks: { select: { status: true } },
      designs: {
        where: { fileType: DesignFileType.IMAGE },
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { fileUrl: true, fileName: true },
      },
    },
  },
  customerCharges: {
    where: {
      status: {
        in: [OrderCustomerChargeStatus.PENDING_AMOUNT, OrderCustomerChargeStatus.ESTIMATED],
      },
    },
    select: { id: true, status: true },
  },
  changeRequests: {
    where: { status: OrderChangeRequestStatus.PENDING },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      id: true,
      type: true,
      reason: true,
      proposedChanges: true,
      createdAt: true,
    },
  },
  printJobs: {
    where: {
      state: OrderPrintJobState.PENDING,
      requestJobId: null,
    },
    orderBy: [{ workOrderVersion: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      workOrderVersion: true,
      resolution: { select: { state: true } },
    },
  },
  agentMonthlyBillItem: {
    select: {
      bill: { select: { id: true, period: true, status: true } },
    },
  },
  shipments: {
    where: { trackingNo: { not: null } },
    orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    take: 1,
    select: { trackingNo: true },
  },
  workflowDecisions: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { reasonCode: true, reasonNote: true, toStatus: true },
  },
  productionOperations: {
    select: { workOrderVersion: true, status: true },
  },
  productionProgressSteps: {
    select: { workOrderVersion: true, status: true },
  },
  outsourceOrders: {
    select: { status: true },
  },
  logs: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 8,
    select: {
      id: true,
      action: true,
      remark: true,
      createdAt: true,
      operator: { select: { displayName: true } },
    },
  },
} as const satisfies Prisma.OrderSelect;

type AdminOrderRecord = Prisma.OrderGetPayload<{
  select: typeof adminOrderSelect;
}>;

type AdminPrintFacts = ReturnType<typeof resolveAdminPrintFacts>;

type AdminOrderCapabilityFacts = {
  status: OrderStatus;
  hasPendingChange: boolean;
  manualPricing: boolean;
  confirmationPreflightOk: boolean;
  currentPricePreviewFailed?: boolean;
  confirmedFeePresent: boolean;
  pricingPending: boolean;
  hasShipment: boolean;
  hasLiveOutsource: boolean;
  hasIncompleteProduction: boolean;
  printFacts: AdminPrintFacts;
};

export function resolveAdminOrderShipDisabledReason(
  input: Pick<AdminOrderCapabilityFacts, 'status' | 'pricingPending' | 'hasShipment' | 'hasLiveOutsource' | 'hasIncompleteProduction' | 'hasPendingChange'>,
): string | null {
  if (input.status !== OrderStatus.PACKING && input.status !== OrderStatus.COMPLETED) {
    return '当前工单状态不支持发货';
  }
  if (input.hasPendingChange) return '存在待审批申请，请先处理变更';
  if (input.pricingPending) return '费用尚未核定，请先完成核价';
  if (input.hasLiveOutsource) return '外协尚未收回，请先核对外协进度';
  if (input.hasIncompleteProduction) return '生产工序尚未完成，请先核对报工';
  if (!input.hasShipment) return '尚未填写配送信息，请先补齐配送';
  return null;
}

export function resolveAdminOrderCapabilities(input: AdminOrderCapabilityFacts): AdminOrderWorkspaceRow['capabilities'] {
  const awaitingFactory = isAwaitingFactoryConfirmation(input.status);
  const productionActive = new Set<OrderStatus>([
    OrderStatus.CONFIRMED,
    OrderStatus.RELEASED,
    OrderStatus.FOILING,
    OrderStatus.PACKING,
  ]).has(input.status);
  return {
    confirm:
      awaitingFactory &&
      !input.manualPricing &&
      input.confirmationPreflightOk &&
      !input.currentPricePreviewFailed,
    reject: awaitingFactory && !input.hasPendingChange,
    hold: productionActive,
    resume:
      input.status === OrderStatus.ON_HOLD,
    release:
      (input.status === OrderStatus.CONFIRMED ||
        (awaitingFactory && input.confirmationPreflightOk && !input.manualPricing && !input.pricingPending)) && !input.hasPendingChange,
    ship: resolveAdminOrderShipDisabledReason(input) === null,
    settle:
      input.status === OrderStatus.SHIPPED &&
      input.confirmedFeePresent &&
      !input.hasPendingChange,
    createPrint: input.printFacts.canCreatePrint,
    markPrinted: input.printFacts.canMarkPrinted,
    reviewChange: input.hasPendingChange,
  };
}

export async function loadAdminOrderWorkspace(
  actor: AdminOrdersActor,
  query: AdminOrderWorkspaceQuery,
  now: Date = new Date(),
  stagnationDays = 2,
): Promise<AdminOrderWorkspacePage> {
  assertAdmin(actor);
  const baseWhere = buildAdminWorkspaceBaseWhere(actor, query);

  const snapshot = await db.$transaction(
    async (tx) => {
      // Prisma relation filters cannot compare the child version column with
      // the parent workOrderVersion. Resolve that correlated fact once inside
      // the same repeatable-read snapshot so superseded unresolved jobs never
      // create ghost members in queue/count/summary.
      const currentPrintOrderIds = await loadCurrentPrintOrderIds(tx);
      const currentPrintWhere: Prisma.OrderWhereInput = {
        id: { in: currentPrintOrderIds },
      };
      const selectedQueueWhere =
        query.queue === 'print'
          ? currentPrintWhere
          : adminQueueWhere(query.queue);
      const resultWhere = andWhere(
        baseWhere,
        selectedQueueWhere,
        query.signal ? adminSignalWhere(query.signal, now) : {},
      );
      const counts = await loadAdminWorkspaceCounts(tx, baseWhere, currentPrintWhere, now);
      const total = query.signal
        ? await tx.order.count({ where: resultWhere })
        : counts.queues[query.queue];
      const window = paginationWindow(
        total,
        query.list.page,
        query.list.pageSize,
      );
      const [
        rows,
        quantity,
        manualPricingCount,
        incompleteFeeExcludedCount,
        legacyFeeExcludedCount,
        settled,
        confirmed,
        quoted,
      ] = await Promise.all([
        tx.order.findMany({
          where: resultWhere,
          select: adminOrderSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: window.skip,
          take: window.take,
        }),
        tx.orderItem.aggregate({
          where: { order: resultWhere },
          _sum: { quantity: true },
        }),
        tx.order.count({
          where: andWhere(resultWhere, adminManualPricingWhere()),
        }),
        tx.order.count({
          where: andWhere(
            resultWhere,
            adminIncompleteCustomerFeeWhere(),
            { NOT: adminManualPricingWhere() },
          ),
        }),
        tx.order.count({
          where: andWhere(
            resultWhere,
            {
              settledFee: null,
              confirmedFee: null,
              quotedFee: null,
              totalAmount: { not: 0 },
            },
            { NOT: adminIncompleteCustomerFeeWhere() },
          ),
        }),
        tx.order.aggregate({
          where: andWhere(resultWhere, { settledFee: { not: null } }),
          _sum: { settledFee: true },
        }),
        tx.order.aggregate({
          where: andWhere(resultWhere, {
            settledFee: null,
            confirmedFee: { not: null },
          }),
          _sum: { confirmedFee: true },
        }),
        tx.order.aggregate({
          where: andWhere(
            resultWhere,
            {
              settledFee: null,
              confirmedFee: null,
              quotedFee: { not: null },
            },
            { NOT: adminIncompleteCustomerFeeWhere() },
          ),
          _sum: { quotedFee: true },
        }),
      ]);
      const [craftNames, progressByOrder] = await Promise.all([
        loadCraftNames(rows, tx),
        getWorkOrderProgressByOrderIds(
          rows.map((row) => row.id),
          tx,
        ),
      ]);
      return {
        rows,
        counts,
        total,
        window,
        totalQuantity: quantity._sum.quantity ?? 0,
        manualPricingCount,
        incompleteFeeExcludedCount,
        legacyFeeExcludedCount,
        effectiveFee: new Decimal(settled._sum.settledFee?.toString() ?? 0)
          .plus(confirmed._sum.confirmedFee?.toString() ?? 0)
          .plus(quoted._sum.quotedFee?.toString() ?? 0)
          .toFixed(2),
        craftNames,
        progressByOrder,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: ADMIN_WORKSPACE_READ_TIMEOUT_MS,
    },
  );

  return {
    rows: snapshot.rows.map((row) =>
      mapAdminOrderRow(
        row,
        actor.id,
        snapshot.craftNames,
        snapshot.progressByOrder.get(row.id),
        now,
        stagnationDays,
      ),
    ),
    total: snapshot.total,
    page: snapshot.window.page,
    pageSize: snapshot.window.pageSize,
    pageCount: snapshot.window.pageCount,
    counts: snapshot.counts,
    summary: {
      orderCount: snapshot.total,
      totalQuantity: snapshot.totalQuantity,
      effectiveFee: snapshot.effectiveFee,
      manualPricingCount: snapshot.manualPricingCount,
      incompleteFeeExcludedCount: snapshot.incompleteFeeExcludedCount,
      legacyFeeExcludedCount: snapshot.legacyFeeExcludedCount,
    },
  };
}

export async function getAdminOrderByOrderNo(
  actor: AdminOrdersActor,
  orderNo: string,
  now: Date = new Date(),
  stagnationDays = 2,
): Promise<AdminOrderWorkspaceRow | null> {
  assertAdmin(actor);
  const normalized = orderNo.trim();
  if (!normalized || normalized.length > 128) return null;
  const loadSnapshot = () =>
    db.$transaction(
      async (tx) => {
        const row = await tx.order.findFirst({
          where: andWhere(buildOrderWhere(actor, emptyFilters()), {
            orderNo: normalized,
          }),
          select: adminOrderSelect,
        });
        if (!row) return null;
        // Prisma's pg adapter owns one client per interactive transaction.
        // Keep these reads sequential; concurrent client.query() calls are
        // deprecated by pg and will fail once pg@9 removes that behavior.
        const craftNames = await loadCraftNames([row], tx);
        const progressByOrder = await getWorkOrderProgressByOrderIds(
          [row.id],
          tx,
        );
        const readiness = isAwaitingFactoryConfirmation(row.status)
          ? await inspectOrderProductionReadinessInTx(tx, row.id)
          : null;
        return { row, craftNames, progressByOrder, readiness };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  const snapshot = await loadSnapshot();
  if (!snapshot) return null;
  const mapped = mapAdminOrderRow(snapshot.row, actor.id, snapshot.craftNames,
    snapshot.progressByOrder.get(snapshot.row.id), now, stagnationDays);
  if (!snapshot.readiness) return mapped;
  return {
    ...mapped,
    confirmationPreflight: { ok: snapshot.readiness.ready, issues: snapshot.readiness.issues },
    capabilities: { ...mapped.capabilities, release: snapshot.readiness.ready, confirm: snapshot.readiness.ready },
  };
}

function emptyFilters(): AdminOrderWorkspaceQuery['list']['filters'] {
  return {
    statuses: [],
    kinds: [],
    shipmentStatuses: [],
    craftIds: [],
    foilColors: [],
    taskStatuses: [],
    machineTypes: [],
    outsourceStatuses: [],
  };
}

async function loadCraftNames(
  rows: readonly AdminOrderRecord[],
  client: Pick<Prisma.TransactionClient, 'craft'> = db,
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(rows.flatMap((row) => row.items.flatMap((item) => item.crafts))),
  ];
  const crafts =
    ids.length === 0
      ? []
      : await client.craft.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
  return new Map(crafts.map((craft) => [craft.id, craft.name]));
}

function mapAdminOrderRow(
  row: AdminOrderRecord,
  actorId: string,
  craftNames: ReadonlyMap<string, string>,
  progress: WorkOrderProgressProjection | undefined,
  now: Date,
  stagnationDays: number,
): AdminOrderWorkspaceRow {
  const incompleteCustomerFee = isIncompleteCustomerFeeRecord(row);
  const manualPricing = isManualPricingRecord(row, incompleteCustomerFee);
  const items = row.items.map((item) => {
    const design = item.designs[0];
    return {
      id: item.id,
      sequence: item.sequence,
      fig: item.fig,
      name: item.name,
      quantity: item.quantity,
      specification: item.specification,
      paper: formatPaper(item.paperType, item.paperWeightGsm),
      crafts: item.crafts
        .map((id) => craftNames.get(id))
        .filter((name): name is string => Boolean(name)),
      thumbnail: design
        ? {
            url: signDesignReadUrl(design.fileUrl),
            fileName: design.fileName,
          }
        : null,
    };
  });
  const pendingChange = row.changeRequests[0];
  const printFacts = resolveAdminPrintFacts({
    status: row.status,
    workOrderVersion: row.workOrderVersion,
    requests: row.printJobs,
  });
  const { printPending, pendingPrintJobId } = printFacts;
  const unquotedDraft = row.status === OrderStatus.DRAFT && row.quotedFee === null && row.confirmedFee === null && row.settledFee === null;
  const fee = manualPricing || unquotedDraft
    ? {
        amount: null,
        source: 'PENDING' as const,
        estimated: false,
      }
    : incompleteCustomerFee
      ? {
          amount: null,
          source: 'INCOMPLETE' as const,
          estimated: false,
        }
      : selectOrderCustomerFee(row);
  // A confirmed total may still include estimated shipping or other charges.
  // Keep its persisted amount/source and the immutable settled snapshot intact.
  if (
    fee.amount !== null &&
    fee.source !== 'SETTLED' &&
    row.customerCharges.some((charge) => charge.status === OrderCustomerChargeStatus.ESTIMATED)
  ) {
    fee.estimated = true;
  }
  const daysLeft = row.promisedDate
    ? promisedDaysLeft(row.promisedDate, now)
    : null;
  const dueAlert =
    row.promisedDate &&
    ACTIVE_PROMISE_STATUSES.includes(
      row.status as (typeof ACTIVE_PROMISE_STATUSES)[number],
    ) &&
    daysLeft !== null &&
    daysLeft <= 3
      ? daysLeft < 0
        ? { kind: 'overdue' as const, days: -daysLeft }
        : { kind: 'due-soon' as const, days: daysLeft }
      : null;
  const hasPendingChange = Boolean(pendingChange);
  const confirmationPreflight = evaluateFactoryConfirmationPreflight({
    status: row.status,
    itemQuantities: row.items.map((item) => item.quantity),
    pricingStatus: row.pricingStatus,
    confirmedFee: row.confirmedFee,
    totalAmount: row.totalAmount,
    pendingChangeRequestCount: row.changeRequests.length,
    manualPricingPending: manualPricing,
  });
  const currentProductionOperations = row.productionOperations.filter(
    (operation) => operation.workOrderVersion === row.workOrderVersion,
  );
  const currentProductionProgressSteps = row.productionProgressSteps.filter(
    (step) => step.workOrderVersion === row.workOrderVersion,
  );
  // Mirror the normal detail page's expand/migrate/contract rule: current W2
  // operations are authoritative when present; otherwise read legacy tasks.
  const productionUnits =
    currentProductionOperations.length > 0
      ? [...currentProductionOperations, ...currentProductionProgressSteps]
      : [
          ...currentProductionProgressSteps,
          ...row.items.flatMap((item) => item.tasks),
        ];
  const incompleteProductionStatuses = new Set<string>([
    ProductionOperationStatus.PENDING,
    ProductionOperationStatus.IN_PROGRESS,
    TaskStatus.PENDING,
    TaskStatus.IN_PROGRESS,
  ]);
  const hasIncompleteProduction = productionUnits.some((unit) =>
    incompleteProductionStatuses.has(unit.status),
  );
  const hasLiveOutsource = row.outsourceOrders.some(
    (outsource) =>
      outsource.status === OutsourceStatus.SENT ||
      outsource.status === OutsourceStatus.IN_PROGRESS,
  );
  const customerName =
    row.customerParty?.shortName?.trim() ||
    row.customerParty?.name.trim() ||
    row.customerRef?.trim() ||
    '未填客户';
  const customerMissing =
    row.customerParty === null && !row.customerRef?.trim();
  const firstClaimedAt = progress?.firstClaimedAt ?? null;
  const stagnant = isProductionStagnant({
    status: row.status,
    scheduledAt: row.scheduledAt,
    firstClaimedAt,
    now,
    stagnationDays,
  });
  const capabilityFacts: AdminOrderCapabilityFacts = {
    status: row.status,
    hasPendingChange,
    manualPricing,
    confirmationPreflightOk: confirmationPreflight.ok,
    confirmedFeePresent: row.confirmedFee !== null,
    pricingPending: row.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
    hasShipment: row._count.shipments > 0,
    hasLiveOutsource,
    hasIncompleteProduction,
    printFacts,
  };
  return {
    id: row.id,
    orderNo: row.orderNo,
    revision: row.revision,
    editVersion: row.editVersion,
    workOrderVersion: row.workOrderVersion,
    customName: row.customName,
    customer: {
      id: row.customerParty?.id ?? null,
      name: customerName,
      filterValue: customerMissing
        ? MISSING_ORDER_CUSTOMER_FILTER_VALUE
        : row.customerParty
          ? customerName
          : row.customerRef!,
    },
    submitter: { id: row.submitter.id, name: row.submitter.displayName },
    status: row.status,
    statusSummary: statusSummary(
      row,
      manualPricing,
      printPending,
      confirmationPreflight,
      progress,
      stagnant,
      stagnationDays,
    ),
    isUrgent: row.isUrgent,
    isStarred: row.stars.some((star) => star.userId === actorId),
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    promisedDate: row.promisedDate?.toISOString().slice(0, 10) ?? null,
    dueAlert,
    promisedDaysLeft: ACTIVE_PROMISE_STATUSES.includes(
      row.status as (typeof ACTIVE_PROMISE_STATUSES)[number],
    ) || row.status === OrderStatus.REJECTED ? daysLeft : null,
    shipDisabledReason: row.status === OrderStatus.PACKING || row.status === OrderStatus.COMPLETED
      ? resolveAdminOrderShipDisabledReason(capabilityFacts)
      : null,
    itemCount: items.length,
    totalQuantity: row.items.reduce((sum, item) => sum + item.quantity, 0),
    craftTags: adminOrderCraftTags(row.items.map((item) => item.craft)),
    craftSummary:
      [...new Set(items.flatMap((item) => item.crafts))].join(' · ') ||
      '工艺待补',
    thumbnail:
      items.find((item) => item.thumbnail)?.thumbnail ?? null,
    items,
    fee,
    feeStages: {
      quoted: row.quotedFee?.toFixed(2) ?? null,
      confirmed: row.confirmedFee?.toFixed(2) ?? null,
      settled: row.settledFee?.toFixed(2) ?? null,
      active: fee.source,
    },
    priceComparison: null,
    priceComparisonError: null,
    confirmationPreflight,
    capabilities: resolveAdminOrderCapabilities(capabilityFacts),
    billing: row.agentMonthlyBillItem?.bill ?? null,
    pendingChangeRequest: pendingChange
      ? {
          id: pendingChange.id,
          type: pendingChange.type,
          reason: pendingChange.reason,
          summary: pendingChange.type === 'MODIFY'
            ? summarizeAdminOrderChange(pendingChange.proposedChanges, row.items)
            : null,
          createdAt: pendingChange.createdAt.toISOString(),
        }
      : null,
    printPending,
    pendingPrintJobId,
    trackingNo:
      row.shipments[0]?.trackingNo?.trim() || row.trackingNo?.trim() || null,
    progress: {
      orderTotal: progress?.orderTotal ?? String(
        row.items.reduce((sum, item) => sum + item.quantity, 0),
      ),
      foilingProgress: progress?.foilingProgress ?? '0',
      packingProgress: progress?.packingProgress ?? '0',
      foilingOverLimit: progress?.foilingOverLimit ?? false,
      packingOverLimit: progress?.packingOverLimit ?? false,
      packingAhead: progress?.packingAhead ?? false,
      stagnant,
      stagnationDays,
      firstClaimedAt: firstClaimedAt?.toISOString() ?? null,
    },
    logs: row.logs.map((log) => ({
      id: log.id,
      action: log.action,
      remark: log.remark,
      actorName: log.operator.displayName,
      createdAt: log.createdAt.toISOString(),
    })),
  };
}

/** Project only validated business facts; malformed or legacy payloads keep the request reason. */
export function summarizeAdminOrderChange(
  proposedChanges: unknown,
  items: readonly Pick<AdminOrderWorkspaceRow['items'][number], 'id' | 'sequence' | 'quantity' | 'name' | 'specification'>[],
): string | null {
  if (!proposedChanges || typeof proposedChanges !== 'object' || !('items' in proposedChanges)) return null;
  const parsed = orderChangeRequestItemsSchema.safeParse(proposedChanges.items);
  if (!parsed.success) return null;
  const facts: string[] = [];
  if ('promisedDate' in proposedChanges && (proposedChanges.promisedDate === null || typeof proposedChanges.promisedDate === 'string')) facts.push(`交期调整为 ${proposedChanges.promisedDate ?? '未设置'}`);
  for (const change of parsed.data) {
    if (change.operation === 'ADD') {
      facts.push(`新增款式 ${change.quantity.toLocaleString('zh-CN')} 个`);
      continue;
    }
    const current = items.find((item) => item.id === change.itemId);
    if (!current) return null;
    const label = `第 ${current.sequence} 款`;
    if (change.quantity !== undefined && change.quantity !== current.quantity) {
      facts.push(`${label}数量 ${current.quantity.toLocaleString('zh-CN')} → ${change.quantity.toLocaleString('zh-CN')}`);
    }
    if ((change.specification !== undefined && change.specification !== current.specification) || change.targetProductId !== undefined) {
      facts.push(`${label}调整规格`);
    }
    if (change.name !== undefined && change.name !== current.name) facts.push(`${label}修改名称`);
    if (change.frontFoilColors !== undefined || change.backFoilColors !== undefined || change.foilColors !== undefined) {
      facts.push(`${label}调整烫金颜色`);
    }
  }
  if (facts.length === 0) return null;
  return `${facts.slice(0, 2).join('；')}${facts.length > 2 ? `；另 ${facts.length - 2} 项变更` : ''}`;
}

function isManualPricingRecord(
  row: AdminOrderRecord,
  incompleteCustomerFee = isIncompleteCustomerFeeRecord(row),
): boolean {
  if (!isAwaitingFactoryConfirmation(row.status)) {
    return false;
  }
  return incompleteCustomerFee;
}

function isIncompleteCustomerFeeRecord(row: AdminOrderRecord): boolean {
  if (row.confirmedFee !== null || row.settledFee !== null) return false;
  return (
    row.quotedFeeCompleteness ===
      OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS ||
    row.items.some(
      (item) =>
        item.quoteDisposition ===
        OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
    ) ||
    row.customerCharges.some((charge) => charge.status === OrderCustomerChargeStatus.PENDING_AMOUNT)
  );
}

function statusSummary(
  row: AdminOrderRecord,
  manualPricing: boolean,
  printPending: boolean,
  confirmationPreflight: FactoryConfirmationPreflight,
  progress: WorkOrderProgressProjection | undefined,
  stagnant: boolean,
  stagnationDays: number,
): string | null {
  if (progress?.foilingOverLimit || progress?.packingOverLimit) {
    return '⚠ 报工异常：进度超过工单数量，请查数据';
  }
  if (progress?.packingAhead) {
    return `⚠ 报工异常：打包 ${formatProgressQuantity(progress.packingProgress)} > 烫金 ${formatProgressQuantity(progress.foilingProgress)}`;
  }
  if (stagnant) {
    return `⚠ 生产停滞：下发满 ${stagnationDays} 天仍无有效扫码认领`;
  }
  const change = row.changeRequests[0];
  if (change) {
    return `${change.type === 'CANCEL' ? '取消申请' : '变更申请'}：${change.reason}`;
  }
  if (manualPricing) return '系统无法完整定价，待人工核价';
  if (printPending) return '当前版本工单待打印';
  if (row.status === OrderStatus.ON_HOLD) {
    return row.workflowDecisions[0]?.reasonNote ?? '工单已暂停';
  }
  if (row.status === OrderStatus.REJECTED) {
    const decision = row.workflowDecisions[0];
    if (decision?.toStatus !== OrderStatus.REJECTED) return '等待销售补正后重新提交';
    const reason = decision.reasonCode === 'PAPER_OUT' ? '纸张库存不足'
      : decision.reasonCode === 'DESIGN_ERROR' ? '设计图有误'
      : decision.reasonCode === 'PRICE_PENDING' ? '费用待核定' : null;
    const note = decision.reasonNote?.trim();
    return `驳回：${[reason, note].filter((value, index, values) => value && values.indexOf(value) === index).join(' · ') || '等待销售补正后重新提交'}`;
  }
  if (isAwaitingFactoryConfirmation(row.status)) {
    return confirmationPreflight.ok
      ? '费用已核定，待下发检查'
      : `⚠ ${confirmationPreflight.issues.join('；')}`;
  }
  if (row.trackingNo) return `运单 ${row.trackingNo}`;
  return null;
}

function isProductionStagnant(input: {
  status: OrderStatus;
  scheduledAt: Date | null;
  firstClaimedAt: Date | null;
  now: Date;
  stagnationDays: number;
}): boolean {
  if (input.firstClaimedAt || !input.scheduledAt) return false;
  if (
    input.status !== OrderStatus.RELEASED &&
    input.status !== OrderStatus.FOILING &&
    input.status !== OrderStatus.PACKING
  ) {
    return false;
  }
  const days = Math.max(1, Math.trunc(input.stagnationDays));
  return input.now.getTime() - input.scheduledAt.getTime() >= days * 86_400_000;
}

function formatProgressQuantity(value: string): string {
  const quantity = Number(value);
  return Number.isFinite(quantity)
    ? quantity.toLocaleString('zh-CN', { maximumFractionDigits: 3 })
    : value;
}

function formatPaper(type: string | null, weight: number | null): string | null {
  const parts = [type, weight ? `${weight}g` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}
