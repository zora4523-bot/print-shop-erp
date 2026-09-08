import type { TableHrefParams } from '../admin/table';
import {
  parseOrderListQuery,
  serializeOrderListQuery,
  type OrderListQuery,
  type OrderListSearchParams,
} from './list-query';

export const ADMIN_ORDER_QUEUES = [
  'todo',
  'print',
  'production',
  'shipped',
  'done',
  'all',
] as const;

export type AdminOrderQueue = (typeof ADMIN_ORDER_QUEUES)[number];

export const ADMIN_ORDER_SIGNALS = [
  'pending-confirmation',
  'pending-pricing',
  'pending-release',
  'pending-change',
  'on-hold',
  'overdue',
  'due-today',
] as const;

export type AdminOrderSignal = (typeof ADMIN_ORDER_SIGNALS)[number];

export type AdminOrderWorkspaceQuery = {
  list: OrderListQuery;
  queue: AdminOrderQueue;
  signal?: AdminOrderSignal;
  starred: boolean;
  unbilled: boolean;
};

export type AdminOrderWorkspaceParseResult = {
  query: AdminOrderWorkspaceQuery;
  issues: string[];
};

const DEFAULT_QUEUE: AdminOrderQueue = 'todo';
export const ADMIN_ORDER_WORKSPACE_EXPORT_VERSION = 'v1';

function firstValue(
  value: string | string[] | undefined,
): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

export function parseAdminOrderWorkspaceQuery(
  params: OrderListSearchParams,
): AdminOrderWorkspaceParseResult {
  const parsed = parseOrderListQuery(params);
  const issues = [...parsed.issues];
  const requestedQueue = firstValue(params.queue);
  const queue = ADMIN_ORDER_QUEUES.includes(
    requestedQueue as AdminOrderQueue,
  )
    ? (requestedQueue as AdminOrderQueue)
    : DEFAULT_QUEUE;
  if (requestedQueue && requestedQueue !== queue) {
    issues.push('工单队列不合法');
  }

  const requestedSignal = firstValue(params.signal);
  const signal = ADMIN_ORDER_SIGNALS.includes(
    requestedSignal as AdminOrderSignal,
  )
    ? (requestedSignal as AdminOrderSignal)
    : undefined;
  if (requestedSignal && !signal) {
    issues.push('看板入口不合法');
  }

  const requestedStarred = firstValue(params.starred);
  const starred = requestedStarred === 'yes' || requestedStarred === 'true';
  if (
    requestedStarred &&
    requestedStarred !== 'yes' &&
    requestedStarred !== 'true' &&
    requestedStarred !== 'no' &&
    requestedStarred !== 'false'
  ) {
    issues.push('星标筛选不合法');
  }

  const requestedUnbilled = firstValue(params.unbilled);
  const unbilled = requestedUnbilled === 'yes' || requestedUnbilled === 'true';
  if (
    requestedUnbilled &&
    requestedUnbilled !== 'yes' &&
    requestedUnbilled !== 'true' &&
    requestedUnbilled !== 'no' &&
    requestedUnbilled !== 'false'
  ) {
    issues.push('未出账筛选不合法');
  }

  return {
    query: {
      list: {
        ...parsed.query,
        // 管理端队列内的顺序是产品真值，不接受 URL 排序。
        sort: 'createdAt',
        dir: 'desc',
        selectedOrderId: undefined,
        scrollY: undefined,
        view: undefined,
      },
      queue,
      ...(signal ? { signal } : {}),
      starred,
      unbilled,
    },
    issues,
  };
}

export function serializeAdminOrderWorkspaceQuery(
  query: AdminOrderWorkspaceQuery,
): TableHrefParams {
  const params = serializeOrderListQuery({
    ...query.list,
    sort: 'createdAt',
    dir: 'desc',
    selectedOrderId: undefined,
    scrollY: undefined,
    view: undefined,
  });
  delete params.sort;
  delete params.dir;
  delete params.selected;
  delete params.scroll;
  delete params.view;
  return {
    ...params,
    queue: query.queue === DEFAULT_QUEUE ? undefined : query.queue,
    signal: query.signal,
    starred: query.starred ? 'yes' : undefined,
    unbilled: query.unbilled ? 'yes' : undefined,
  };
}

/**
 * Produces the canonical, page-independent filter receipt stored by the
 * durable XLSX export. The surface marker prevents the generic order-list
 * parser from silently dropping workspace-only queue/signal/star filters.
 */
export function adminOrderExportParamsFromQuery(
  query: AdminOrderWorkspaceQuery,
): Record<string, string> {
  const serialized = serializeAdminOrderWorkspaceQuery({
    ...query,
    list: { ...query.list, page: 1 },
  });
  delete serialized.page;
  delete serialized.pageSize;
  return Object.fromEntries(
    Object.entries({
      ...serialized,
      adminWorkspace: ADMIN_ORDER_WORKSPACE_EXPORT_VERSION,
    }).flatMap(([key, value]) =>
      value === undefined || value === null || value === ''
        ? []
        : [[key, String(value)]],
    ),
  );
}

export function isAdminOrderWorkspaceExportParams(
  params: Record<string, unknown>,
): boolean {
  return params.adminWorkspace === ADMIN_ORDER_WORKSPACE_EXPORT_VERSION;
}

export function updateAdminOrderWorkspaceQuery(
  query: AdminOrderWorkspaceQuery,
  update: Partial<
    Pick<AdminOrderWorkspaceQuery, 'queue' | 'signal' | 'starred' | 'unbilled'>
  >,
): AdminOrderWorkspaceQuery {
  return {
    ...query,
    ...update,
    list: { ...query.list, page: 1 },
  };
}
