import 'server-only';

import Decimal from 'decimal.js';
import {
  DesignFileType,
  OrderChangeRequestStatus,
  OrderChangeRequestType,
  OrderPricingStatus,
  OrderStatus,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
  type PaginationWindow,
} from '../admin/table';
import { getOrderScopeFilter } from '../auth/order-scope';
import { db } from '../db';
import { promisedDateAlert } from './promised-date';
import { signDesignReadUrl } from '../oss/read-url';
import {
  orderListOrderBy,
  parseOrderListQuery,
  type OrderListQuery,
  type OrderListViewKey,
} from './list-query';
import { selectOrderCustomerFee } from './customer-fee';

export const SALES_ORDER_LIST_VIEWS = [
  'todo',
  'doing',
  'shipped',
  'done',
  'cancelled',
  'draft',
] as const satisfies readonly OrderListViewKey[];

export type SalesOrderListView = (typeof SALES_ORDER_LIST_VIEWS)[number];

export type SalesOrderListSummary = {
  all: number;
  todo: number;
  doing: number;
  shipped: number;
  done: number;
  cancelled: number;
  draft: number;
  shippedThisMonth: number;
};

export type SalesOrderListRow = {
  purpose?: import("./purpose").OrderPurposeValue;
  id: string;
  orderNo: string;
  customName: string | null;
  status: OrderStatus;
  isUrgent: boolean;
  revision: number;
  pricingStatus: OrderPricingStatus;
  totalAmount: string;
  promisedDate: string | null;
  dueAlert: { kind: 'overdue' | 'due-soon'; days: number } | null;
  updatedAt: string;
  receiver: {
    name: string | null;
    phone: string | null;
    address: string | null;
  };
  itemCount: number;
  totalQuantity: number;
  craftSummary: string;
  thumbnail: { url: string; fileName: string } | null;
  items: Array<{
    id: string;
    sequence: number;
    name: string;
    quantity: number;
    specification: string | null;
    paper: string | null;
    crafts: string[];
    thumbnail: { url: string; fileName: string } | null;
  }>;
  feeLines: Array<{
    id: string;
    label: string;
    amount: string | null;
    estimated: boolean;
  }>; 
  pricingAttentionReason: string | null;
  pendingChangeRequest: {
    id: string;
    type: OrderChangeRequestType;
    reason: string;
    createdAt: string;
  } | null;
  rejectedChangeRequest: {
    id: string;
    type: OrderChangeRequestType;
    reason: string;
    reviewRemark: string | null;
    reviewedAt: string;
  } | null;
  shipment: {
    carrier: string;
    trackingNo: string;
    additionalCount: number;
  } | null;
  needsAction: boolean;
};

export type SalesOrderListPageWindow = PaginationWindow & { total: number };

const ACTIVE_SALES_STATUSES = [
  OrderStatus.PENDING_FACTORY,
  OrderStatus.REJECTED,
  OrderStatus.CONFIRMED,
  OrderStatus.ON_HOLD,
  OrderStatus.RELEASED,
  OrderStatus.FOILING,
  OrderStatus.PACKING,
  OrderStatus.SUBMITTED,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.COMPLETED,
] as const;

const FINISHED_SALES_STATUSES = [OrderStatus.SETTLED, OrderStatus.FINISHED] as const;
const isRejectedChange = (status: OrderChangeRequestStatus) =>
  status === OrderChangeRequestStatus.DENIED || status === OrderChangeRequestStatus.REJECTED;

type SalesOrderPageWindow = SalesOrderListPageWindow & {
  latestRejectedOrderIds: string[];
};

function salesNeedsActionWhere(
  latestRejectedOrderIds: readonly string[],
): Prisma.OrderWhereInput {
  return {
    status: {
      in: [...ACTIVE_SALES_STATUSES],
    },
    OR: [
      { status: { in: [OrderStatus.REJECTED, OrderStatus.ON_HOLD] } },
      { pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION },
      ...(latestRejectedOrderIds.length > 0
        ? [{ id: { in: [...latestRejectedOrderIds] } }]
        : []),
    ],
  };
}

const salesOrderSelect = {
  purpose: true,
  id: true,
  orderNo: true,
  customName: true,
  status: true,
  isUrgent: true,
  revision: true,
  pricingStatus: true,
  processingAmount: true,
  packagingAmount: true,
  totalAmount: true,
  quotedFee: true,
  confirmedFee: true,
  settledFee: true,
  promisedDate: true,
  updatedAt: true,
  receiverName: true,
  receiverPhone: true,
  receiverAddress: true,
  items: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      name: true,
      quantity: true,
      specification: true,
      paperType: true,
      paperWeightGsm: true,
      crafts: true,
      designs: {
        where: { fileType: DesignFileType.IMAGE },
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: {
          fileUrl: true,
          fileName: true,
        },
      },
    },
  },
  shipments: {
    orderBy: { sequence: 'asc' },
    select: {
      trackingNo: true,
      carrierCode: true,
      expressCode: true,
    },
  },
  customerCharges: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      description: true,
      amount: true,
      status: true,
    },
  },
  changeRequests: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      id: true,
      status: true,
      type: true,
      reason: true,
      reviewRemark: true,
      reviewedAt: true,
      createdAt: true,
    },
  },
} as const satisfies Prisma.OrderSelect;

type SalesOrderRecord = Prisma.OrderGetPayload<{
  select: typeof salesOrderSelect;
}>;

/**
 * The sales workspace deliberately exposes only its search and business views.
 * Old administrator filter parameters are discarded so a bookmarked
 * advanced filter cannot remain invisibly active after the role-specific UI
 * switches to the compact sales surface.
 */
export function sanitizeSalesOrderListQuery(
  query: OrderListQuery,
): OrderListQuery {
  const view = SALES_ORDER_LIST_VIEWS.includes(query.view as SalesOrderListView)
    ? query.view
    : undefined;
  const normalized = parseOrderListQuery({
    q: query.filters.q,
    page: String(query.page),
    pageSize: String(query.pageSize),
    view,
  }).query;
  return {
    ...normalized,
    selectedOrderId: query.selectedOrderId,
    scrollY: query.scrollY,
  };
}

function salesViewWhere(
  view: OrderListViewKey | undefined,
  latestRejectedOrderIds: readonly string[],
): Prisma.OrderWhereInput | null {
  if (view === 'todo') return salesNeedsActionWhere(latestRejectedOrderIds);
  if (view === 'doing') return { status: { in: [...ACTIVE_SALES_STATUSES] } };
  if (view === 'shipped') return { status: OrderStatus.SHIPPED };
  if (view === 'done') {
    return {
      status: { in: [...FINISHED_SALES_STATUSES] },
    };
  }
  if (view === 'cancelled') return { status: OrderStatus.CANCELLED };
  if (view === 'draft') return { status: OrderStatus.DRAFT };
  return null;
}

export function buildSalesOrderWhere(
  actor: { id: string; role: Role },
  query: OrderListQuery,
  latestRejectedOrderIds: readonly string[] = [],
): Prisma.OrderWhereInput {
  if (actor.role !== Role.SALES) {
    throw new Error('销售工单列表只接受 SALES 角色');
  }
  const conditions: Prisma.OrderWhereInput[] = [getOrderScopeFilter(actor)];
  const q = query.filters.q?.trim();
  if (q) {
    const contains = { contains: q, mode: Prisma.QueryMode.insensitive };
    conditions.push({
      OR: [
        { orderNo: contains },
        { customName: contains },
        { searchPinyin: contains },
        { searchPinyinInitials: contains },
      ],
    });
  }
  const viewWhere = salesViewWhere(query.view, latestRejectedOrderIds);
  if (viewWhere) conditions.push(viewWhere);
  return conditions.length === 1 ? conditions[0]! : { AND: conditions };
}

/**
 * A rejection only needs sales attention while it is the newest change
 * request for that order. Looking for `some: { status: REJECTED }` would keep
 * an order red forever after a later retry was submitted or approved.
 */
export async function getSalesLatestRejectedOrderIds(actor: {
  id: string;
  role: Role;
}): Promise<string[]> {
  if (actor.role !== Role.SALES) {
    throw new Error('销售工单列表只接受 SALES 角色');
  }
  const rows = await db.orderChangeRequest.findMany({
    where: {
      order: {
        is: {
          AND: [
            getOrderScopeFilter(actor),
            {
              status: {
                in: [...ACTIVE_SALES_STATUSES],
              },
            },
          ],
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { orderId: true, status: true },
  });
  const seen = new Set<string>();
  const rejectedOrderIds: string[] = [];
  for (const row of rows) {
    if (seen.has(row.orderId)) continue;
    seen.add(row.orderId);
    if (isRejectedChange(row.status)) {
      rejectedOrderIds.push(row.orderId);
    }
  }
  return rejectedOrderIds;
}

export async function getSalesOrderListPageWindow(
  actor: { id: string; role: Role },
  query: OrderListQuery,
  latestRejectedOrderIdsPromise: Promise<readonly string[]> =
    getSalesLatestRejectedOrderIds(actor),
): Promise<SalesOrderPageWindow> {
  const safeQuery = sanitizeSalesOrderListQuery(query);
  const latestRejectedOrderIds = [
    ...(await latestRejectedOrderIdsPromise),
  ];
  const total = await db.order.count({
    where: buildSalesOrderWhere(actor, safeQuery, latestRejectedOrderIds),
  });
  const window = paginationWindow(total, safeQuery.page, safeQuery.pageSize);
  return { ...window, total, latestRejectedOrderIds };
}

export async function listSalesOrdersPage(
  actor: { id: string; role: Role },
  query: OrderListQuery,
  windowPromise: Promise<SalesOrderPageWindow> =
    getSalesOrderListPageWindow(actor, query),
): Promise<PaginatedResult<SalesOrderListRow>> {
  const safeQuery = sanitizeSalesOrderListQuery(query);
  const { total, latestRejectedOrderIds, ...window } = await windowPromise;
  const where = buildSalesOrderWhere(
    actor,
    safeQuery,
    latestRejectedOrderIds,
  );
  const orderBy = orderListOrderBy(safeQuery.sort, safeQuery.dir);

  const rows =
    safeQuery.view === 'todo'
      ? await db.order.findMany({
          where,
          select: salesOrderSelect,
          orderBy,
          skip: window.skip,
          take: window.take,
        })
      : await listSalesRowsWithAttentionFirst({
          where,
          latestRejectedOrderIds,
          orderBy,
          skip: window.skip,
          take: window.take,
        });

  const craftNameById = await loadCraftNameMap(rows);

  return paginatedResult(
    rows.map((row) => mapSalesOrderRow(row, craftNameById)),
    total,
    window,
  );
}

export async function getSalesOrderByOrderNo(
  actor: { id: string; role: Role },
  orderNo: string,
): Promise<SalesOrderListRow | null> {
  if (actor.role !== Role.SALES) {
    throw new Error('销售工单明细只接受 SALES 角色');
  }
  const normalizedOrderNo = orderNo.trim();
  if (!normalizedOrderNo || normalizedOrderNo.length > 128) return null;
  const row = await db.order.findFirst({
    where: {
      AND: [getOrderScopeFilter(actor), { orderNo: normalizedOrderNo }],
    },
    select: salesOrderSelect,
  });
  if (!row) return null;
  const craftNameById = await loadCraftNameMap([row]);
  return mapSalesOrderRow(row, craftNameById);
}

async function loadCraftNameMap(
  rows: readonly SalesOrderRecord[],
): Promise<Map<string, string>> {
  const craftIds = [
    ...new Set(rows.flatMap((row) => row.items.flatMap((item) => item.crafts))),
  ];
  const crafts =
    craftIds.length > 0
      ? await db.craft.findMany({
          where: { id: { in: craftIds } },
          select: { id: true, name: true },
        })
      : [];
  return new Map(crafts.map((craft) => [craft.id, craft.name]));
}

async function listSalesRowsWithAttentionFirst(input: {
  where: Prisma.OrderWhereInput;
  latestRejectedOrderIds: readonly string[];
  orderBy: Prisma.OrderOrderByWithRelationInput[];
  skip: number;
  take: number;
}): Promise<SalesOrderRecord[]> {
  const attentionWhere: Prisma.OrderWhereInput = {
    AND: [
      input.where,
      salesNeedsActionWhere(input.latestRejectedOrderIds),
    ],
  };
  const attentionTotal = await db.order.count({ where: attentionWhere });
  const attentionSkip = Math.min(input.skip, attentionTotal);
  const attentionTake = Math.min(
    input.take,
    Math.max(0, attentionTotal - attentionSkip),
  );
  const normalSkip = Math.max(0, input.skip - attentionTotal);
  const normalTake = input.take - attentionTake;

  const [attentionRows, normalRows] = await Promise.all([
    attentionTake > 0
      ? db.order.findMany({
          where: attentionWhere,
          select: salesOrderSelect,
          orderBy: input.orderBy,
          skip: attentionSkip,
          take: attentionTake,
        })
      : Promise.resolve([]),
    normalTake > 0
      ? db.order.findMany({
          where: {
            AND: [
              input.where,
              { NOT: salesNeedsActionWhere(input.latestRejectedOrderIds) },
            ],
          },
          select: salesOrderSelect,
          orderBy: input.orderBy,
          skip: normalSkip,
          take: normalTake,
        })
      : Promise.resolve([]),
  ]);
  return [...attentionRows, ...normalRows];
}

export async function getSalesOrderListSummary(
  actor: { id: string; role: Role },
  now: Date = new Date(),
  latestRejectedOrderIdsPromise: Promise<readonly string[]> =
    getSalesLatestRejectedOrderIds(actor),
): Promise<SalesOrderListSummary> {
  if (actor.role !== Role.SALES) {
    throw new Error('销售工单汇总只接受 SALES 角色');
  }
  const scope = getOrderScopeFilter(actor);
  const { start, end } = shanghaiMonthRange(now);
  const todoPromise = latestRejectedOrderIdsPromise.then(
    (latestRejectedOrderIds) =>
      db.order.count({
        where: {
          AND: [scope, salesNeedsActionWhere(latestRejectedOrderIds)],
        },
      }),
  );
  const [groups, todo, shippedThisMonth] = await Promise.all([
    db.order.groupBy({
      by: ['status'],
      where: scope,
      _count: { _all: true },
    }),
    todoPromise,
    db.order.count({
      where: {
        AND: [
          scope,
          {
            status: { in: [OrderStatus.SHIPPED, OrderStatus.SETTLED, OrderStatus.FINISHED] },
            shippedAt: { gte: start, lt: end },
          },
        ],
      },
    }),
  ]);
  const counts = new Map(
    groups.map((group) => [group.status, group._count._all]),
  );
  const count = (...statuses: OrderStatus[]) =>
    statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0);
  return {
    all: [...counts.values()].reduce((sum, value) => sum + value, 0),
    todo,
    doing: count(...ACTIVE_SALES_STATUSES),
    shipped: count(OrderStatus.SHIPPED),
    done: count(...FINISHED_SALES_STATUSES),
    cancelled: count(OrderStatus.CANCELLED),
    draft: count(OrderStatus.DRAFT),
    shippedThisMonth,
  };
}

function mapSalesOrderRow(
  row: SalesOrderRecord,
  craftNameById: ReadonlyMap<string, string>,
): SalesOrderListRow {
  const pendingChange = row.changeRequests.find(
    (request) => request.status === OrderChangeRequestStatus.PENDING,
  );
  const rejectedChange = row.changeRequests.find(
    (request) => isRejectedChange(request.status),
  );
  const pricingAttentionReason =
    row.status !== OrderStatus.DRAFT &&
    row.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION
      ? '价格待管理员确认'
      : null;
  const items = row.items.map((item) => {
    const design = item.designs[0];
    return {
      id: item.id,
      sequence: item.sequence,
      name: item.name,
      quantity: item.quantity,
      specification: item.specification,
      paper: formatPaper(item.paperType, item.paperWeightGsm),
      crafts: item.crafts
        .map((craftId) => craftNameById.get(craftId))
        .filter((name): name is string => Boolean(name)),
      thumbnail: design
        ? {
            url: signDesignReadUrl(design.fileUrl),
            fileName: design.fileName,
          }
        : null,
    };
  });
  const thumbnail = items.find((item) => item.thumbnail)?.thumbnail ?? null;
  const trackingShipments = row.shipments.filter((shipment) =>
    Boolean(shipment.trackingNo?.trim()),
  );
  const primaryShipment = trackingShipments[0];
  const dueAlert = promisedDateAlert(row.promisedDate, row.status);
  return {
    id: row.id,
    orderNo: row.orderNo,
    purpose: row.purpose,
    customName: row.customName,
    status: row.status,
    isUrgent: row.isUrgent,
    revision: row.revision,
    pricingStatus: row.pricingStatus,
    totalAmount: selectOrderCustomerFee(row).amount,
    promisedDate: row.promisedDate?.toISOString().slice(0, 10) ?? null,
    dueAlert,
    updatedAt: row.updatedAt.toISOString(),
    receiver: {
      name: row.receiverName,
      phone: row.receiverPhone,
      address: row.receiverAddress,
    },
    itemCount: items.length,
    totalQuantity: row.items.reduce((sum, item) => sum + item.quantity, 0),
    craftSummary: summarizeCrafts(items),
    thumbnail,
    items,
    feeLines: buildFeeLines(row),
    pricingAttentionReason,
    pendingChangeRequest: pendingChange
      ? {
          id: pendingChange.id,
          type: pendingChange.type,
          reason: pendingChange.reason,
          createdAt: pendingChange.createdAt.toISOString(),
        }
      : null,
    rejectedChangeRequest: rejectedChange
      ? {
          id: rejectedChange.id,
          type: rejectedChange.type,
          reason: rejectedChange.reason,
          reviewRemark: rejectedChange.reviewRemark,
          reviewedAt: (
            rejectedChange.reviewedAt ?? rejectedChange.createdAt
          ).toISOString(),
        }
      : null,
    shipment: primaryShipment
      ? {
          carrier: carrierLabel(
            primaryShipment.carrierCode,
            primaryShipment.expressCode,
          ),
          trackingNo: primaryShipment.trackingNo!.trim(),
          additionalCount: Math.max(0, trackingShipments.length - 1),
        }
      : null,
    needsAction: ACTIVE_SALES_STATUSES.some((status) => status === row.status) &&
      Boolean(pricingAttentionReason || rejectedChange || row.status === OrderStatus.REJECTED || row.status === OrderStatus.ON_HOLD),
  };
}

function buildFeeLines(row: SalesOrderRecord): SalesOrderListRow['feeLines'] {
  const lines: SalesOrderListRow['feeLines'] = [];
  const processing = new Decimal(row.processingAmount.toString()).minus(
    row.packagingAmount.toString(),
  );
  if (!processing.isZero()) {
    lines.push({
      id: 'processing',
      label: '款式加工费',
      amount: processing.toFixed(2),
      estimated:
        row.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
    });
  }
  const packaging = new Decimal(row.packagingAmount.toString());
  if (!packaging.isZero()) {
    lines.push({
      id: 'packaging',
      label: '入袋加工费',
      amount: packaging.toFixed(2),
      estimated:
        row.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
    });
  }
  for (const charge of row.customerCharges) {
    lines.push({
      id: charge.id,
      label: charge.description,
      amount: charge.amount === null ? null : money(charge.amount),
      estimated: charge.status === 'ESTIMATED',
    });
  }
  return lines;
}

function summarizeCrafts(items: SalesOrderListRow['items']): string {
  const values = [
    ...new Set(
      items.flatMap((item) => [
        ...item.crafts,
        ...(item.paper ? [item.paper.replace(/\s+\d+g$/i, '')] : []),
      ]),
    ),
  ].filter(Boolean);
  if (values.length === 0) return '工艺待补充';
  const shown = values.slice(0, 3).join(' · ');
  return values.length > 3 ? `${shown} 等 ${values.length} 项` : shown;
}

function formatPaper(type: string | null, weight: number | null): string | null {
  if (!type) return null;
  return weight ? `${type} ${weight}g` : type;
}

function carrierLabel(code: string | null, expressCode: string | null): string {
  if (code === 'ZTO') return '中通';
  if (code === 'SF') return '顺丰';
  return expressCode?.trim() || code?.trim() || '快递';
}

function money(value: { toString(): string } | string | number): string {
  return new Decimal(value.toString()).toFixed(2);
}

function shanghaiMonthRange(now: Date): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const offset = 8 * 60 * 60 * 1000;
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - offset),
    end: new Date(Date.UTC(year, month, 1) - offset),
  };
}
