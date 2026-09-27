import { foilColorSearchValues } from '@/lib/order/foil-colors';
import { paperSearchValues } from '@/lib/rules/paper-label';
import {
  MachineType,
  OrderKind,
  OrderStatus,
  OutsourceStatus,
  Prisma,
  Role,
  ShipmentStatus,
  TaskStatus,
} from '../../generated/prisma/client';
import type { SortDirection, TableHrefParams } from '../admin/table';
import { parseStrictYmd } from '../auth/schemas';
import { getOrderScopeFilter } from '../auth/order-scope';
import { db } from '../db';
import {
  decodeFoilColorFilterValues,
  encodeFoilColorFilterValues,
} from './foil-color-filter-codec';

export const ORDER_LIST_DEFAULT_PAGE_SIZE = 20;
export const ORDER_LIST_MAX_PAGE_SIZE = 100;

const TEXT_FILTER_MAX_LENGTH = 80;
const ID_FILTER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DECIMAL_FILTER_RE = /^\d{1,10}(?:\.\d{1,2})?$/;
const INTEGER_FILTER_RE = /^\d{1,10}$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const ORDER_LIST_SORT_KEYS = [
  'createdAt',
  'orderNo',
  'totalAmount',
  'promisedDate',
] as const;
type OrderListSortKey = (typeof ORDER_LIST_SORT_KEYS)[number];

export type OrderListSearchParams = Record<
  string,
  string | string[] | undefined
>;

/**
 * 业主 2026-09-27：工单不再按客户（`customerRef` / `customerPartyId`）展示、
 * 筛选或搜索。旧书签里的 `customerRef` / `customerPartyId` / `customerRefExact`
 * 参数不再被解析：静默忽略，既不筛选，也不产生 issue。
 */
type OrderListFilters = {
  q?: string;
  orderNo?: string;
  customName?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  submitterId?: string;
  workerId?: string;
  statuses: OrderStatus[];
  kinds: OrderKind[];
  isUrgent?: boolean;
  isSfCollect?: boolean;
  addressMode?: 'single' | 'multiple';
  amountMin?: string;
  amountMax?: string;
  createdFrom?: string;
  createdTo?: string;
  promisedFrom?: string;
  promisedTo?: string;
  trackingNo?: string;
  expressCode?: string;
  shipmentStatuses: ShipmentStatus[];
  itemName?: string;
  productName?: string;
  specification?: string;
  paperType?: string;
  quantityMin?: number;
  quantityMax?: number;
  craftIds: string[];
  foilColors: string[];
  taskStatuses: TaskStatus[];
  machineTypes: MachineType[];
  requiresOutsource?: boolean;
  outsourceStatuses: OutsourceStatus[];
  supplierName?: string;
};

export type OrderListQuery = {
  filters: OrderListFilters;
  page: number;
  pageSize: number;
  sort: OrderListSortKey;
  dir: SortDirection;
  /**
   * Pure presentation state. These values are deliberately kept outside
   * `filters` so they can round-trip through the URL without ever reaching
   * Prisma's `where` clause.
   */
  selectedOrderId?: string;
  scrollY?: number;
  view?: OrderListViewKey;
};

export const ORDER_LIST_ADMIN_VIEW_KEYS = [
  'urgent',
  'due-today',
  'scheduling',
  'saved',
] as const;
export const ORDER_LIST_SALES_VIEW_KEYS = [
  'todo',
  'doing',
  'shipped',
  'done',
  'cancelled',
  'draft',
] as const;
export const ORDER_LIST_VIEW_KEYS = [
  ...ORDER_LIST_ADMIN_VIEW_KEYS,
  ...ORDER_LIST_SALES_VIEW_KEYS,
] as const;
export type OrderListViewKey = (typeof ORDER_LIST_VIEW_KEYS)[number];

export type OrderListParseResult = {
  query: OrderListQuery;
  issues: string[];
};

type OrderFilterOption = { id: string; label: string };

export type OrderListFilterOptions = {
  submitters: OrderFilterOption[];
  workers: OrderFilterOption[];
  crafts: OrderFilterOption[];
};

function rawValuesOf(
  params: OrderListSearchParams,
  key: string,
): string[] {
  const raw = params[key];
  return Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
}

function valuesOf(
  params: OrderListSearchParams,
  key: string,
): string[] {
  return rawValuesOf(params, key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function firstValue(params: OrderListSearchParams, key: string): string {
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() ?? '';
}

function parseText(
  params: OrderListSearchParams,
  key: string,
  label: string,
  issues: string[],
): string | undefined {
  const value = firstValue(params, key).trim();
  if (!value) return undefined;
  if (value.length > TEXT_FILTER_MAX_LENGTH) {
    issues.push(`${label}最多 ${TEXT_FILTER_MAX_LENGTH} 个字符`);
    return value.slice(0, TEXT_FILTER_MAX_LENGTH);
  }
  return value;
}

function parseId(
  params: OrderListSearchParams,
  key: string,
  label: string,
  issues: string[],
): string | undefined {
  const value = firstValue(params, key);
  if (!value) return undefined;
  if (!ID_FILTER_RE.test(value)) {
    issues.push(`${label}格式不合法`);
    return undefined;
  }
  return value;
}

function parseEnumList<T extends string>(
  params: OrderListSearchParams,
  key: string,
  label: string,
  allowed: readonly T[],
  issues: string[],
): T[] {
  const result: T[] = [];
  for (const value of valuesOf(params, key)) {
    if (!allowed.includes(value as T)) {
      const issue = `${label}选项不合法`;
      if (!issues.includes(issue)) issues.push(issue);
      continue;
    }
    if (!result.includes(value as T)) result.push(value as T);
  }
  return result;
}

function parseIdList(
  params: OrderListSearchParams,
  key: string,
  label: string,
  issues: string[],
): string[] {
  const result: string[] = [];
  for (const value of valuesOf(params, key)) {
    if (!ID_FILTER_RE.test(value)) {
      issues.push(`${label}格式不合法`);
      continue;
    }
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function parseTextList(
  values: readonly string[],
  label: string,
  issues: string[],
): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value.length > TEXT_FILTER_MAX_LENGTH) {
      issues.push(`${label}最多 ${TEXT_FILTER_MAX_LENGTH} 个字符`);
      continue;
    }
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function parseTriStateBoolean(
  params: OrderListSearchParams,
  key: string,
  label: string,
  issues: string[],
): boolean | undefined {
  const value = firstValue(params, key);
  if (!value || value === 'all') return undefined;
  if (value === 'yes' || value === 'true') return true;
  if (value === 'no' || value === 'false') return false;
  issues.push(`${label}选项不合法`);
  return undefined;
}

function parseDate(
  params: OrderListSearchParams,
  key: string,
  label: string,
  issues: string[],
): string | undefined {
  const value = firstValue(params, key);
  if (!value) return undefined;
  if (!parseStrictYmd(value)) {
    issues.push(`${label}日期不合法`);
    return undefined;
  }
  return value;
}

function parseDecimal(
  params: OrderListSearchParams,
  key: string,
  label: string,
  issues: string[],
): string | undefined {
  const value = firstValue(params, key);
  if (!value) return undefined;
  if (!DECIMAL_FILTER_RE.test(value)) {
    issues.push(`${label}必须是非负金额，最多两位小数`);
    return undefined;
  }
  return new Prisma.Decimal(value).toFixed(2);
}

function parseInteger(
  params: OrderListSearchParams,
  key: string,
  label: string,
  issues: string[],
): number | undefined {
  const value = firstValue(params, key);
  if (!value) return undefined;
  if (!INTEGER_FILTER_RE.test(value)) {
    issues.push(`${label}必须是非负整数`);
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
    issues.push(`${label}超出允许范围`);
    return undefined;
  }
  return parsed;
}

function parsePositiveInteger(
  params: OrderListSearchParams,
  key: string,
  defaultValue: number,
  max: number,
): number {
  const value = firstValue(params, key);
  if (!/^\d+$/.test(value)) return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return defaultValue;
  return Math.min(max, Math.max(1, parsed));
}

function parseScrollPosition(
  params: OrderListSearchParams,
  issues: string[],
): number | undefined {
  const value = firstValue(params, 'scroll');
  if (!value) return undefined;
  if (!/^\d{1,8}$/.test(value)) {
    issues.push('列表滚动位置不合法');
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    issues.push('列表滚动位置不合法');
    return undefined;
  }
  return parsed;
}

function parseListView(
  params: OrderListSearchParams,
  issues: string[],
): OrderListViewKey | undefined {
  const value = firstValue(params, 'view');
  if (!value) return undefined;
  if (!ORDER_LIST_VIEW_KEYS.includes(value as OrderListViewKey)) {
    issues.push('保存视图不合法');
    return undefined;
  }
  return value as OrderListViewKey;
}

export function parseOrderListQuery(
  params: OrderListSearchParams,
): OrderListParseResult {
  const issues: string[] = [];
  let amountMin = parseDecimal(params, 'amountMin', '最低金额', issues);
  let amountMax = parseDecimal(params, 'amountMax', '最高金额', issues);
  let quantityMin = parseInteger(params, 'quantityMin', '最小数量', issues);
  let quantityMax = parseInteger(params, 'quantityMax', '最大数量', issues);
  let createdFrom = parseDate(params, 'createdFrom', '创建开始', issues);
  let createdTo = parseDate(params, 'createdTo', '创建结束', issues);
  let promisedFrom = parseDate(params, 'promisedFrom', '交期开始', issues);
  let promisedTo = parseDate(params, 'promisedTo', '交期结束', issues);

  if (
    amountMin &&
    amountMax &&
    new Prisma.Decimal(amountMin).greaterThan(amountMax)
  ) {
    issues.push('最低金额不能大于最高金额');
    amountMin = undefined;
    amountMax = undefined;
  }
  if (
    quantityMin !== undefined &&
    quantityMax !== undefined &&
    quantityMin > quantityMax
  ) {
    issues.push('最小数量不能大于最大数量');
    quantityMin = undefined;
    quantityMax = undefined;
  }
  if (createdFrom && createdTo && createdFrom > createdTo) {
    issues.push('创建开始日期不能晚于结束日期');
    createdFrom = undefined;
    createdTo = undefined;
  }
  if (promisedFrom && promisedTo && promisedFrom > promisedTo) {
    issues.push('交期开始日期不能晚于结束日期');
    promisedFrom = undefined;
    promisedTo = undefined;
  }

  const addressModeValue = firstValue(params, 'addressMode');
  let addressMode: OrderListFilters['addressMode'];
  if (addressModeValue === 'single' || addressModeValue === 'multiple') {
    addressMode = addressModeValue;
  } else if (addressModeValue && addressModeValue !== 'all') {
    issues.push('地址数量选项不合法');
  }

  const sortValue = firstValue(params, 'sort');
  const sort = ORDER_LIST_SORT_KEYS.includes(sortValue as OrderListSortKey)
    ? (sortValue as OrderListSortKey)
    : 'createdAt';
  if (sortValue && sortValue !== sort) issues.push('排序字段不合法');
  const dirValue = firstValue(params, 'dir');
  const dir: SortDirection = dirValue === 'asc' ? 'asc' : 'desc';
  if (dirValue && dirValue !== 'asc' && dirValue !== 'desc') {
    issues.push('排序方向不合法');
  }

  const selectedOrderId = parseId(
    params,
    'selected',
    '当前选中工单',
    issues,
  );
  const scrollY = parseScrollPosition(params, issues);
  const view = parseListView(params, issues);

  return {
    query: {
      filters: {
        q: parseText(params, 'q', '搜索词', issues),
        orderNo: parseText(params, 'orderNo', '工单号', issues),
        customName: parseText(params, 'customName', '工单名称', issues),
        receiverName: parseText(params, 'receiverName', '收件人', issues),
        receiverPhone: parseText(params, 'receiverPhone', '收件电话', issues),
        receiverAddress: parseText(params, 'receiverAddress', '收件地址', issues),
        submitterId: parseId(params, 'submitterId', '提交人', issues),
        workerId: parseId(params, 'workerId', '师傅', issues),
        statuses: parseEnumList(
          params,
          'status',
          '工单状态',
          Object.values(OrderStatus),
          issues,
        ),
        kinds: parseEnumList(
          params,
          'kind',
          '工单类型',
          Object.values(OrderKind),
          issues,
        ),
        isUrgent: parseTriStateBoolean(params, 'isUrgent', '急单', issues),
        isSfCollect: parseTriStateBoolean(
          params,
          'isSfCollect',
          '顺丰到付',
          issues,
        ),
        addressMode,
        amountMin,
        amountMax,
        createdFrom,
        createdTo,
        promisedFrom,
        promisedTo,
        trackingNo: parseText(params, 'trackingNo', '快递单号', issues),
        expressCode: parseText(params, 'expressCode', '快递代码', issues),
        shipmentStatuses: parseEnumList(
          params,
          'shipmentStatus',
          '发货状态',
          Object.values(ShipmentStatus),
          issues,
        ),
        itemName: parseText(params, 'itemName', '款式名称', issues),
        productName: parseText(params, 'productName', '产品名称', issues),
        specification: parseText(params, 'specification', '规格', issues),
        paperType: parseText(params, 'paperType', '纸张', issues),
        quantityMin,
        quantityMax,
        craftIds: parseIdList(params, 'craftId', '工艺', issues),
        foilColors: parseTextList(
          decodeFoilColorFilterValues(rawValuesOf(params, 'foilColor')),
          '烫金色',
          issues,
        ),
        taskStatuses: parseEnumList(
          params,
          'taskStatus',
          '任务状态',
          Object.values(TaskStatus),
          issues,
        ),
        machineTypes: parseEnumList(
          params,
          'machineType',
          '机器类型',
          Object.values(MachineType),
          issues,
        ),
        requiresOutsource: parseTriStateBoolean(
          params,
          'requiresOutsource',
          '是否外协',
          issues,
        ),
        outsourceStatuses: parseEnumList(
          params,
          'outsourceStatus',
          '外协状态',
          Object.values(OutsourceStatus),
          issues,
        ),
        supplierName: parseText(params, 'supplierName', '外协供应商', issues),
      },
      page: parsePositiveInteger(params, 'page', 1, 1_000_000),
      pageSize: parsePositiveInteger(
        params,
        'pageSize',
        ORDER_LIST_DEFAULT_PAGE_SIZE,
        ORDER_LIST_MAX_PAGE_SIZE,
      ),
      sort,
      dir,
      ...(selectedOrderId ? { selectedOrderId } : {}),
      ...(scrollY !== undefined ? { scrollY } : {}),
      ...(view ? { view } : {}),
    },
    issues,
  };
}

function textContains(value: string): Prisma.StringFilter {
  return { contains: value, mode: 'insensitive' };
}

function shanghaiStart(ymd: string): Date {
  const parsed = parseStrictYmd(ymd);
  if (!parsed) throw new Error(`非法 YYYY-MM-DD：${ymd}`);
  return new Date(parsed.getTime() - SHANGHAI_OFFSET_MS);
}

function shanghaiEndExclusive(ymd: string): Date {
  return new Date(shanghaiStart(ymd).getTime() + DAY_MS);
}

function rangeFilter<T>(
  min: T | undefined,
  max: T | undefined,
): { gte?: T; lte?: T } | undefined {
  if (min === undefined && max === undefined) return undefined;
  return { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) };
}

function dateRangeFilter(
  from: string | undefined,
  to: string | undefined,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: shanghaiStart(from) } : {}),
    ...(to ? { lt: shanghaiEndExclusive(to) } : {}),
  };
}

function dateOnlyRangeFilter(
  from: string | undefined,
  to: string | undefined,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const start = from ? parseStrictYmd(from) : null;
  const end = to ? parseStrictYmd(to) : null;
  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lt: new Date(end.getTime() + DAY_MS) } : {}),
  };
}

function globalSearchFilter(query: string): Prisma.OrderWhereInput {
  const contains = textContains(query);
  return {
    OR: [
      { orderNo: contains },
      { customName: contains },
      { receiverName: contains },
      { receiverPhone: contains },
      { receiverAddress: contains },
      { trackingNo: contains },
      { expressCode: contains },
      { submitter: { displayName: contains } },
      {
        shipments: {
          some: {
            OR: [
              { receiverName: contains },
              { receiverPhone: contains },
              { receiverAddress: contains },
              { trackingNo: contains },
              { expressCode: contains },
            ],
          },
        },
      },
      {
        items: {
          some: {
            OR: [
              { name: contains },
              { specification: contains },
              ...paperSearchValues(query).map((value) => ({ paperType: textContains(value) })),
              ...(foilColorSearchValues([query]).map((color) => ({ foilColors: { has: color } }))),
              { product: { name: contains } },
              {
                tasks: {
                  some: {
                    status: { not: TaskStatus.CANCELLED },
                    worker: { displayName: contains },
                  },
                },
              },
            ],
          },
        },
      },
      { searchPinyin: contains },
      { searchPinyinInitials: contains },
    ],
  };
}

/**
 * Mirrors selectOrderCustomerFee's precedence in a Prisma predicate. A range
 * must only test a lower-priority amount when every higher-priority snapshot
 * is absent; otherwise an obsolete quote/legacy total could admit the row.
 */
function effectiveCustomerFeeWhere(
  amount: Prisma.DecimalFilter,
): Prisma.OrderWhereInput {
  return {
    OR: [
      { settledFee: amount },
      { settledFee: null, confirmedFee: amount },
      {
        settledFee: null,
        confirmedFee: null,
        quotedFee: amount,
      },
      {
        settledFee: null,
        confirmedFee: null,
        quotedFee: null,
        totalAmount: amount,
      },
    ],
  };
}

export function buildOrderWhere(
  actor: { id: string; role: Role },
  filters: OrderListFilters,
): Prisma.OrderWhereInput {
  const conditions: Prisma.OrderWhereInput[] = [getOrderScopeFilter(actor)];

  if (filters.q) conditions.push(globalSearchFilter(filters.q));
  if (filters.orderNo) conditions.push({ orderNo: textContains(filters.orderNo) });
  if (filters.customName) conditions.push({ customName: textContains(filters.customName) });
  if (filters.submitterId) conditions.push({ submitterId: filters.submitterId });
  if (filters.statuses.length > 0) conditions.push({ status: { in: filters.statuses } });
  if (filters.kinds.length > 0) conditions.push({ kind: { in: filters.kinds } });
  if (filters.isUrgent !== undefined) conditions.push({ isUrgent: filters.isUrgent });
  if (filters.isSfCollect !== undefined) conditions.push({ isSfCollect: filters.isSfCollect });
  if (filters.requiresOutsource !== undefined) {
    conditions.push({ requiresOutsource: filters.requiresOutsource });
  }
  if (filters.addressMode === 'multiple') {
    conditions.push({ shipments: { some: { sequence: { gte: 2 } } } });
  } else if (filters.addressMode === 'single') {
    conditions.push({ NOT: { shipments: { some: { sequence: { gte: 2 } } } } });
  }

  if (actor.role !== Role.WORKER) {
    const amount = rangeFilter(
      filters.amountMin ? new Prisma.Decimal(filters.amountMin) : undefined,
      filters.amountMax ? new Prisma.Decimal(filters.amountMax) : undefined,
    );
    if (amount) conditions.push(effectiveCustomerFeeWhere(amount));
  }
  const createdAt = dateRangeFilter(filters.createdFrom, filters.createdTo);
  if (createdAt) conditions.push({ createdAt });
  // promisedDate is a calendar-date column encoded as UTC midnight, unlike
  // createdAt which is an event timestamp and must use Shanghai day bounds.
  const promisedDate = dateOnlyRangeFilter(
    filters.promisedFrom,
    filters.promisedTo,
  );
  if (promisedDate) conditions.push({ promisedDate });

  const shipmentWhere: Prisma.OrderShipmentWhereInput = {};
  if (filters.receiverName) shipmentWhere.receiverName = textContains(filters.receiverName);
  if (filters.receiverPhone) shipmentWhere.receiverPhone = textContains(filters.receiverPhone);
  if (filters.receiverAddress) {
    shipmentWhere.receiverAddress = textContains(filters.receiverAddress);
  }
  if (filters.trackingNo) shipmentWhere.trackingNo = textContains(filters.trackingNo);
  if (filters.expressCode) shipmentWhere.expressCode = textContains(filters.expressCode);
  if (filters.shipmentStatuses.length > 0) {
    shipmentWhere.status = { in: filters.shipmentStatuses };
  }
  if (Object.keys(shipmentWhere).length > 0) {
    conditions.push({ shipments: { some: shipmentWhere } });
  }

  const taskWhere: Prisma.ProductionTaskWhereInput = {
    ...(filters.workerId ? { workerId: filters.workerId } : {}),
    ...(filters.taskStatuses.length > 0
      ? { status: { in: filters.taskStatuses } }
      : filters.workerId
        ? { status: { not: TaskStatus.CANCELLED } }
        : {}),
    ...(filters.machineTypes.length > 0
      ? { machineType: { in: filters.machineTypes } }
      : {}),
  };
  const itemWhere: Prisma.OrderItemWhereInput = {
    ...(filters.itemName ? { name: textContains(filters.itemName) } : {}),
    ...(filters.productName
      ? { product: { name: textContains(filters.productName) } }
      : {}),
    ...(filters.specification
      ? { specification: textContains(filters.specification) }
      : {}),
    ...(filters.paperType
      ? { OR: paperSearchValues(filters.paperType).map((value) => ({ paperType: textContains(value) })) }
      : {}),
    ...(filters.quantityMin !== undefined || filters.quantityMax !== undefined
      ? { quantity: rangeFilter(filters.quantityMin, filters.quantityMax) }
      : {}),
    ...(filters.craftIds.length > 0 ? { crafts: { hasSome: filters.craftIds } } : {}),
    ...(filters.foilColors.length > 0
      ? { foilColors: { hasSome: foilColorSearchValues(filters.foilColors) } }
      : {}),
    ...(Object.keys(taskWhere).length > 0 ? { tasks: { some: taskWhere } } : {}),
  };
  if (Object.keys(itemWhere).length > 0) {
    conditions.push({ items: { some: itemWhere } });
  }

  const outsourceWhere: Prisma.OutsourceOrderWhereInput = {
    ...(filters.outsourceStatuses.length > 0
      ? { status: { in: filters.outsourceStatuses } }
      : {}),
    ...(filters.supplierName
      ? { supplierName: textContains(filters.supplierName) }
      : {}),
  };
  if (Object.keys(outsourceWhere).length > 0) {
    conditions.push({ outsourceOrders: { some: outsourceWhere } });
  }

  return conditions.length === 1 ? conditions[0]! : { AND: conditions };
}

export function orderListOrderBy(
  sort: OrderListSortKey,
  dir: SortDirection,
): Prisma.OrderOrderByWithRelationInput[] {
  if (sort === 'createdAt') return [{ createdAt: dir }, { id: dir }];
  if (sort === 'totalAmount') {
    return [
      { effectiveCustomerFee: dir },
      { createdAt: 'desc' },
      { id: 'desc' },
    ];
  }
  if (sort === 'promisedDate') {
    return [
      { promisedDate: { sort: dir, nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ];
  }
  return [{ [sort]: dir }, { createdAt: 'desc' }, { id: 'desc' }];
}

export function serializeOrderListQuery(query: OrderListQuery): TableHrefParams {
  const f = query.filters;
  return {
    q: f.q,
    orderNo: f.orderNo,
    customName: f.customName,
    receiverName: f.receiverName,
    receiverPhone: f.receiverPhone,
    receiverAddress: f.receiverAddress,
    submitterId: f.submitterId,
    workerId: f.workerId,
    status: f.statuses.join(',') || undefined,
    kind: f.kinds.join(',') || undefined,
    isUrgent: booleanParam(f.isUrgent),
    isSfCollect: booleanParam(f.isSfCollect),
    addressMode: f.addressMode,
    amountMin: f.amountMin,
    amountMax: f.amountMax,
    createdFrom: f.createdFrom,
    createdTo: f.createdTo,
    promisedFrom: f.promisedFrom,
    promisedTo: f.promisedTo,
    trackingNo: f.trackingNo,
    expressCode: f.expressCode,
    shipmentStatus: f.shipmentStatuses.join(',') || undefined,
    itemName: f.itemName,
    productName: f.productName,
    specification: f.specification,
    paperType: f.paperType,
    quantityMin: f.quantityMin,
    quantityMax: f.quantityMax,
    craftId: f.craftIds.join(',') || undefined,
    foilColor: encodeFoilColorFilterValues(f.foilColors),
    taskStatus: f.taskStatuses.join(',') || undefined,
    machineType: f.machineTypes.join(',') || undefined,
    requiresOutsource: booleanParam(f.requiresOutsource),
    outsourceStatus: f.outsourceStatuses.join(',') || undefined,
    supplierName: f.supplierName,
    page: query.page > 1 ? query.page : undefined,
    pageSize:
      query.pageSize !== ORDER_LIST_DEFAULT_PAGE_SIZE
        ? query.pageSize
        : undefined,
    sort: query.sort !== 'createdAt' ? query.sort : undefined,
    dir:
      query.sort !== 'createdAt' || query.dir !== 'desc' ? query.dir : undefined,
    selected: query.selectedOrderId,
    scroll: query.scrollY,
    view: query.view,
  };
}

function booleanParam(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? 'yes' : 'no';
}

export async function getOrderListFilterOptions(
  actor: { id: string; role: Role },
): Promise<OrderListFilterOptions> {
  const [crafts, users] = await Promise.all([
    db.craft.findMany({
      orderBy: [
        { isActive: 'desc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
      select: { id: true, name: true, isActive: true },
    }),
    actor.role === Role.ADMIN
      ? db.user.findMany({
          orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
          select: {
            id: true,
            username: true,
            displayName: true,
            role: true,
            isActive: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const duplicateDisplayNames = new Set(
    users
      .map((user) => user.displayName)
      .filter(
        (displayName, index, all) => all.indexOf(displayName) !== index,
      ),
  );
  const userLabel = (user: (typeof users)[number]) => {
    const identity = duplicateDisplayNames.has(user.displayName)
      ? `${user.displayName}（${user.username}）`
      : user.displayName;
    return user.isActive ? identity : `${identity}（已停用）`;
  };
  return {
    crafts: crafts.map((craft) => ({
      id: craft.id,
      label: craft.isActive ? craft.name : `${craft.name}（已停用）`,
    })),
    submitters: users
      .filter((user) => user.role !== Role.WORKER)
      .map((user) => ({
        id: user.id,
        label: userLabel(user),
      })),
    workers: users
      .filter((user) => user.role === Role.WORKER)
      .map((user) => ({
        id: user.id,
        label: userLabel(user),
      })),
  };
}
