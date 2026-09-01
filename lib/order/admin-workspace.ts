import 'server-only';

import Decimal from 'decimal.js';
import {
  AgentMonthlyBillStatus,
  OrderBillingMode,
  DesignFileType,
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderItemQuoteDisposition,
  OrderPrintJobState,
  OrderQuotedFeeCompleteness,
  OrderStatus,
  OrderSettlementType,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import { paginationWindow } from '../admin/table';
import { UnauthorizedError } from '../auth/errors';
import { db } from '../db';
import {
  shanghaiDayBoundary,
  todayShanghai,
} from '../dashboard/shanghai-clock';
import { signDesignReadUrl } from '../oss/read-url';
import {
  getWorkOrderProgressByOrderIds,
  type WorkOrderProgressProjection,
} from '../production/work-order-progress-query';
import { selectOrderCustomerFee } from './customer-fee';
import { buildOrderWhere } from './list-query';
import { overdueCutoff, promisedDaysLeft } from './promised-date';
import {
  OrderChangeRequestError,
  previewFactoryConfirmationPriceDiff,
  type FactoryConfirmationPriceDiff,
} from './change-request';
import {
  evaluateFactoryConfirmationPreflight,
  type FactoryConfirmationPreflight,
} from './factory-confirmation-preflight';
import type {
  AdminOrderQueue,
  AdminOrderSignal,
  AdminOrderWorkspaceQuery,
} from './admin-workspace-query';

export type AdminOrdersActor = { id: string; role: Role };

export type AdminOrderWorkspaceSummary = {
  orderCount: number;
  totalQuantity: number;
  effectiveFee: string;
  manualPricingCount: number;
};

export type AdminOrderWorkspaceCounts = {
  queues: Record<AdminOrderQueue, number>;
  signals: Record<AdminOrderSignal, number>;
};

export type AdminOrderWorkspaceRow = {
  id: string;
  orderNo: string;
  revision: number;
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
  itemCount: number;
  totalQuantity: number;
  craftSummary: string;
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
    source: 'SETTLED' | 'CONFIRMED' | 'QUOTED' | 'LEGACY' | 'PENDING';
    estimated: boolean;
  };
  feeStages: {
    quoted: string | null;
    confirmed: string | null;
    settled: string | null;
    active: 'QUOTED' | 'CONFIRMED' | 'SETTLED' | 'PENDING' | 'LEGACY';
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

const ACTIVE_PROMISE_STATUSES = [
  OrderStatus.PENDING_FACTORY,
  OrderStatus.CONFIRMED,
  OrderStatus.ON_HOLD,
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
  // Expand-migrate-contract 期间的历史行仍可读。
  OrderStatus.SUBMITTED,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.COMPLETED,
] as const;

const PRODUCTION_STATUSES = [
  OrderStatus.CONFIRMED,
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.COMPLETED,
] as const;

const PRINTABLE_STATUSES = [
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
] as const;

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
    printPending: printable && !hasPrinted,
    pendingPrintJobId: pendingRequest?.id ?? null,
    canCreatePrint: printable && !pendingRequest,
    canMarkPrinted: Boolean(pendingRequest),
  };
}

const PENDING_CHANGE_WHERE = {
  changeRequests: {
    some: { status: OrderChangeRequestStatus.PENDING },
  },
} as const satisfies Prisma.OrderWhereInput;

async function loadCurrentPrintOrderIds(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<string[]> {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT orders."id"
    FROM "Order" orders
    WHERE orders."status" IN (
      'RELEASED'::"OrderStatus",
      'FOILING'::"OrderStatus",
      'PACKING'::"OrderStatus"
    )
      AND NOT EXISTS (
        SELECT 1
        FROM "OrderPrintJob" request
        INNER JOIN "OrderPrintJob" resolution
          ON resolution."requestJobId" = request."id"
        WHERE request."orderId" = orders."id"
          AND request."workOrderVersion" = orders."workOrderVersion"
          AND request."state" = 'PENDING'::"OrderPrintJobState"
          AND request."requestJobId" IS NULL
          AND resolution."state" = 'PRINTED'::"OrderPrintJobState"
      )
  `;
  return rows.map((row) => row.id);
}

/**
 * Manual pricing is a persisted business fact, never inferred from a zero
 * amount or from the broad PENDING_ADMIN_CONFIRMATION pricing state.
 */
export function adminManualPricingWhere(): Prisma.OrderWhereInput {
  return {
    status: { in: [OrderStatus.PENDING_FACTORY, OrderStatus.SUBMITTED] },
    confirmedFee: null,
    settledFee: null,
    OR: [
      {
        quotedFeeCompleteness:
          OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
      },
      {
        items: {
          some: {
            quoteDisposition:
              OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
          },
        },
      },
      {
        customerCharges: {
          some: { status: OrderCustomerChargeStatus.PENDING_AMOUNT },
        },
      },
    ],
  };
}

function printableWhere(): Prisma.OrderWhereInput {
  return {
    status: { in: [...PRINTABLE_STATUSES] },
  };
}

export function adminQueueWhere(
  queue: AdminOrderQueue,
): Prisma.OrderWhereInput {
  switch (queue) {
    case 'todo':
      return {
        OR: [
          {
            status: {
              in: [OrderStatus.PENDING_FACTORY, OrderStatus.SUBMITTED],
            },
          },
          adminManualPricingWhere(),
          PENDING_CHANGE_WHERE,
          { status: OrderStatus.ON_HOLD },
        ],
      };
    case 'print':
      // Prisma cannot express request.workOrderVersion = order.workOrderVersion.
      // Snapshot/export callers replace this superset with the correlated raw
      // predicate from loadCurrentPrintOrderIds.
      return printableWhere();
    case 'production':
      return {
        status: { in: [...PRODUCTION_STATUSES] },
        NOT: PENDING_CHANGE_WHERE,
      };
    case 'shipped':
      return { status: OrderStatus.SHIPPED };
    case 'done':
      return {
        // REJECTED 是可恢复的驳回态，不是完结。FINISHED 仅作历史兼容读。
        status: {
          in: [
            OrderStatus.SETTLED,
            OrderStatus.CANCELLED,
            OrderStatus.FINISHED,
          ],
        },
      };
    case 'all':
      return {};
  }
}

export function adminSignalWhere(
  signal: AdminOrderSignal,
  now: Date = new Date(),
): Prisma.OrderWhereInput {
  switch (signal) {
    case 'pending-confirmation':
      return {
        status: {
          in: [OrderStatus.PENDING_FACTORY, OrderStatus.SUBMITTED],
        },
      };
    case 'pending-pricing':
      return adminManualPricingWhere();
    case 'pending-change':
      return PENDING_CHANGE_WHERE;
    case 'on-hold':
      return { status: OrderStatus.ON_HOLD };
    case 'overdue':
      return {
        status: { in: [...ACTIVE_PROMISE_STATUSES] },
        promisedDate: { lt: overdueCutoff(now) },
      };
    case 'due-today': {
      const { start, end } = shanghaiDayBoundary(todayShanghai(now));
      return {
        status: { in: [...ACTIVE_PROMISE_STATUSES] },
        promisedDate: { gte: start, lt: end },
      };
    }
  }
}

function andWhere(...parts: Prisma.OrderWhereInput[]): Prisma.OrderWhereInput {
  return { AND: parts };
}

export function buildAdminWorkspaceBaseWhere(
  actor: AdminOrdersActor,
  query: AdminOrderWorkspaceQuery,
): Prisma.OrderWhereInput {
  assertAdmin(actor);
  return andWhere(
    buildOrderWhere(actor, query.list.filters),
    query.starred ? { stars: { some: { userId: actor.id } } } : {},
    query.unbilled
      ? {
          settlementType: OrderSettlementType.EXTERNAL_SALES,
          billingMode: OrderBillingMode.CHARGE,
          status: { in: [OrderStatus.SETTLED, OrderStatus.CANCELLED] },
          settledFee: { not: null },
          settledAt: { not: null },
          agentMonthlyBillItem: { is: null },
        }
      : {},
  );
}

export function buildAdminWorkspaceResultWhere(
  actor: AdminOrdersActor,
  query: AdminOrderWorkspaceQuery,
  now: Date = new Date(),
): Prisma.OrderWhereInput {
  return andWhere(
    buildAdminWorkspaceBaseWhere(actor, query),
    adminQueueWhere(query.queue),
    query.signal ? adminSignalWhere(query.signal, now) : {},
  );
}

/** Resolve the durable-export predicate against the same current-version
 * print membership rule used by the interactive workspace snapshot. */
export async function resolveAdminWorkspaceResultWhere(
  actor: AdminOrdersActor,
  query: AdminOrderWorkspaceQuery,
  now: Date,
): Promise<Prisma.OrderWhereInput> {
  assertAdmin(actor);
  const queueWhere =
    query.queue === 'print'
      ? { id: { in: await loadCurrentPrintOrderIds(db) } }
      : adminQueueWhere(query.queue);
  return andWhere(
    buildAdminWorkspaceBaseWhere(actor, query),
    queueWhere,
    query.signal ? adminSignalWhere(query.signal, now) : {},
  );
}

const adminOrderSelect = {
  id: true,
  orderNo: true,
  revision: true,
  workOrderVersion: true,
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
      crafts: true,
      quoteDisposition: true,
      designs: {
        where: { fileType: DesignFileType.IMAGE },
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { fileUrl: true, fileName: true },
      },
    },
  },
  customerCharges: {
    where: { status: OrderCustomerChargeStatus.PENDING_AMOUNT },
    select: { id: true },
  },
  changeRequests: {
    where: { status: OrderChangeRequestStatus.PENDING },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      id: true,
      type: true,
      reason: true,
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
    select: { reasonNote: true },
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
      const total = await tx.order.count({ where: resultWhere });
      const window = paginationWindow(
        total,
        query.list.page,
        query.list.pageSize,
      );
      const [
        rows,
        queueCounts,
        signalCounts,
        quantity,
        manualPricingCount,
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
        Promise.all(
          (['todo', 'print', 'production', 'shipped', 'done', 'all'] as const).map(
            (queue) =>
              tx.order.count({
                where: andWhere(
                  baseWhere,
                  queue === 'print'
                    ? currentPrintWhere
                    : adminQueueWhere(queue),
                ),
              }),
          ),
        ),
        Promise.all(
          (
            [
              'pending-confirmation',
              'pending-pricing',
              'pending-change',
              'on-hold',
              'overdue',
              'due-today',
            ] as const
          ).map((signal) =>
            tx.order.count({
              where: andWhere(baseWhere, adminSignalWhere(signal, now)),
            }),
          ),
        ),
        tx.orderItem.aggregate({
          where: { order: resultWhere },
          _sum: { quantity: true },
        }),
        tx.order.count({
          where: andWhere(resultWhere, adminManualPricingWhere()),
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
            { NOT: adminManualPricingWhere() },
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
        total,
        window,
        queueCounts,
        signalCounts,
        totalQuantity: quantity._sum.quantity ?? 0,
        manualPricingCount,
        effectiveFee: new Decimal(settled._sum.settledFee?.toString() ?? 0)
          .plus(confirmed._sum.confirmedFee?.toString() ?? 0)
          .plus(quoted._sum.quotedFee?.toString() ?? 0)
          .toFixed(2),
        craftNames,
        progressByOrder,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
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
    counts: {
      queues: mapCounts(
        ['todo', 'print', 'production', 'shipped', 'done', 'all'],
        snapshot.queueCounts,
      ),
      signals: mapCounts(
        [
          'pending-confirmation',
          'pending-pricing',
          'pending-change',
          'on-hold',
          'overdue',
          'due-today',
        ],
        snapshot.signalCounts,
      ),
    },
    summary: {
      orderCount: snapshot.total,
      totalQuantity: snapshot.totalQuantity,
      effectiveFee: snapshot.effectiveFee,
      manualPricingCount: snapshot.manualPricingCount,
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
  const row = await db.order.findFirst({
    where: andWhere(buildOrderWhere(actor, emptyFilters()), {
      orderNo: normalized,
    }),
    select: adminOrderSelect,
  });
  if (!row) return null;
  const [craftNames, progressByOrder] = await Promise.all([
    loadCraftNames([row]),
    getWorkOrderProgressByOrderIds([row.id]),
  ]);
  const mapped = mapAdminOrderRow(
    row,
    actor.id,
    craftNames,
    progressByOrder.get(row.id),
    now,
    stagnationDays,
  );
  if (
    row.status !== OrderStatus.PENDING_FACTORY &&
    row.status !== OrderStatus.SUBMITTED
  ) {
    return mapped;
  }
  try {
    return {
      ...mapped,
      priceComparison: await previewFactoryConfirmationPriceDiff(
        row.id,
        actor,
        now,
      ),
    };
  } catch (error) {
    if (error instanceof OrderChangeRequestError) {
      return { ...mapped, priceComparisonError: error.message };
    }
    throw error;
  }
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
  const manualPricing = isManualPricingRecord(row);
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
  const fee = manualPricing
    ? {
        amount: null,
        source: 'PENDING' as const,
        estimated: false,
      }
    : selectOrderCustomerFee(row);
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
  const awaitingFactory =
    row.status === OrderStatus.PENDING_FACTORY ||
    row.status === OrderStatus.SUBMITTED;
  const productionActive = new Set<OrderStatus>([
    OrderStatus.CONFIRMED,
    OrderStatus.RELEASED,
    OrderStatus.FOILING,
    OrderStatus.PACKING,
  ]).has(row.status);
  const confirmationPreflight = evaluateFactoryConfirmationPreflight({
    status: row.status,
    itemQuantities: row.items.map((item) => item.quantity),
    pricingStatus: row.pricingStatus,
    confirmedFee: row.confirmedFee,
    totalAmount: row.totalAmount,
    pendingChangeRequestCount: row.changeRequests.length,
    manualPricingPending: manualPricing,
  });
  const firstClaimedAt = progress?.firstClaimedAt ?? null;
  const stagnant = isProductionStagnant({
    status: row.status,
    scheduledAt: row.scheduledAt,
    firstClaimedAt,
    now,
    stagnationDays,
  });
  return {
    id: row.id,
    orderNo: row.orderNo,
    revision: row.revision,
    workOrderVersion: row.workOrderVersion,
    customName: row.customName,
    customer: {
      id: row.customerParty?.id ?? null,
      name:
        row.customerParty?.shortName ??
        row.customerParty?.name ??
        row.customerRef ??
        '未填客户',
      // The current filter is backed by Order.customerRef rather than Party
      // identity. Preserve that exact persisted value so a shortName label
      // never creates a link that filters the selected order out.
      filterValue:
        row.customerRef ??
        row.customerParty?.name ??
        row.customerParty?.shortName ??
        '未填客户',
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
    itemCount: items.length,
    totalQuantity: row.items.reduce((sum, item) => sum + item.quantity, 0),
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
    capabilities: {
      confirm: awaitingFactory && !manualPricing && confirmationPreflight.ok,
      reject: awaitingFactory && !hasPendingChange,
      hold: productionActive && !hasPendingChange,
      resume: row.status === OrderStatus.ON_HOLD && !hasPendingChange,
      release: row.status === OrderStatus.CONFIRMED && !hasPendingChange,
      ship: row.status === OrderStatus.PACKING && !hasPendingChange,
      settle: row.status === OrderStatus.SHIPPED && !hasPendingChange,
      createPrint: printFacts.canCreatePrint,
      markPrinted: printFacts.canMarkPrinted,
      reviewChange: hasPendingChange,
    },
    billing: row.agentMonthlyBillItem?.bill ?? null,
    pendingChangeRequest: pendingChange
      ? {
          id: pendingChange.id,
          type: pendingChange.type,
          reason: pendingChange.reason,
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

function isManualPricingRecord(row: AdminOrderRecord): boolean {
  if (row.confirmedFee !== null || row.settledFee !== null) return false;
  return (
    row.quotedFeeCompleteness ===
      OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS ||
    row.items.some(
      (item) =>
        item.quoteDisposition ===
        OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
    ) ||
    row.customerCharges.length > 0
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
  if (
    row.status === OrderStatus.PENDING_FACTORY ||
    row.status === OrderStatus.SUBMITTED
  ) {
    return confirmationPreflight.ok
      ? '✓ 预检通过，可确认'
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

function mapCounts<K extends string>(
  keys: readonly K[],
  values: readonly number[],
): Record<K, number> {
  return Object.fromEntries(
    keys.map((key, index) => [key, values[index] ?? 0]),
  ) as Record<K, number>;
}

function assertAdmin(actor: AdminOrdersActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new UnauthorizedError('管理端工单工作台仅对管理员开放');
  }
}
