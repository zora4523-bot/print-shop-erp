import Link from 'next/link';
import type {
  OrderListQuery,
  OrderListRow,
  OrderListSortKey,
} from '@/lib/order/list-query';
import { buildTableHref, type TableHrefParams } from '@/lib/admin/table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui-business';
import { OrderStatusBadge } from './OrderStatusBadge';
import { formatDateShanghai } from '@/lib/format/dates';
import { OrderKind } from '@/generated/prisma/enums';
import { formatReceiverInfo } from '@/lib/order/receiver-info';
import { AdminSortLink } from '@/components/business/admin/AdminDataTable';
import { cn } from '@/lib/utils';
import { OrderListDetailLink } from './OrderListNavigationState';
import {
  OrderListPageSelection,
  OrderListRowSelection,
  OrderListSelectionProvider,
} from './OrderListBatchSelection';
import { OrderRowMoreActions } from './OrderRowActions';
import { UrgentBadge } from './UrgentBadge';

export function OrdersTable({
  orders,
  showCommercialAmounts = true,
  showPieceworkCost = false,
  canSchedule = false,
  query,
  queryParams,
}: {
  orders: OrderListRow[];
  showCommercialAmounts?: boolean;
  showPieceworkCost?: boolean;
  canSchedule?: boolean;
  query: OrderListQuery;
  queryParams: TableHrefParams;
}) {
  if (orders.length === 0) {
    const hasFilters = Object.values(query.filters).some((value) =>
      Array.isArray(value)
        ? value.length > 0
        : value !== undefined && value !== null && value !== '',
    );

    if (hasFilters) {
      const clearFiltersHref = buildTableHref(
        '/orders',
        {},
        {
          pageSize: query.pageSize,
          sort: query.sort,
          dir: query.dir,
        },
      );
      return (
        <EmptyState
          kind="no-result"
          noun="工单"
          onClear={
            <Link
              href={clearFiltersHref}
              prefetch={false}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11 sm:min-h-8',
              )}
            >
              清除全部筛选
            </Link>
          }
        />
      );
    }

    return <EmptyState kind="no-data" noun="工单" />;
  }

  return (
    <OrderListSelectionProvider
      key={orders.map((order) => order.id).join(':')}
      items={orders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        canSchedule,
      }))}
    >
      <div className="mb-2 flex min-h-11 items-center gap-1 rounded-lg border bg-muted/30 px-1 text-sm md:hidden">
        <OrderListPageSelection />
        <span>选择本页</span>
      </div>
      <ul className="grid gap-3 md:hidden">
        {orders.map((order) => (
          <li
            key={order.id}
            data-order-id={order.id}
            data-state={query.selectedOrderId === order.id ? 'selected' : undefined}
            className="min-w-0 rounded-xl border bg-card p-3 shadow-sm has-checked:border-primary has-checked:bg-muted/30 data-[state=selected]:border-primary data-[state=selected]:ring-2 data-[state=selected]:ring-primary/20"
          >
            <div className="flex min-w-0 items-start gap-1">
              <OrderListRowSelection
                orderId={order.id}
                orderNo={order.orderNo}
              />
              <div className="flex min-w-0 flex-1 items-start justify-between gap-2 pt-2">
                <p className="admin-wrap-anywhere min-w-0 font-sans text-sm font-semibold tabular-nums">
                  {order.orderNo}
                </p>
                <OrderStatusBadge status={order.status} />
              </div>
            </div>
            <p className="admin-wrap-anywhere mt-1 text-sm font-medium">
              {order.customName ?? '—'}
            </p>
            <p className="admin-wrap-anywhere mt-1 text-xs text-muted-foreground">
              {order.customerRef ?? '未填客户'}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground">承诺交期</dt>
                <dd className="mt-0.5 font-sans tabular-nums">
                  {formatDateShanghai(order.promisedDate, '未设置')}
                </dd>
              </div>
              {showCommercialAmounts ? (
                <div className="text-right">
                  <dt className="text-muted-foreground">金额</dt>
                  <dd className="mt-0.5 font-sans font-medium tabular-nums">
                    ¥ {String(order.totalAmount ?? '0.00')}
                  </dd>
                </div>
              ) : showPieceworkCost ? (
                <div className="text-right">
                  <dt className="text-muted-foreground">计件成本</dt>
                  <dd className="mt-0.5 font-sans font-medium tabular-nums">
                    ¥ {order.pieceworkCost ?? '0.00'}
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-3 flex min-h-11 items-center justify-between gap-2">
              <OrderListDetailLink
                orderId={order.id}
                href={`/orders/${order.id}`}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                查看
              </OrderListDetailLink>
              <OrderRowMoreActions
                orderId={order.id}
                orderNo={order.orderNo}
                status={order.status}
                canSchedule={canSchedule}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table label="工单列表" className="min-w-[75rem]">
          <TableHeader>
            <TableRow>
          <TableHead className="sticky left-0 z-30 w-12 min-w-12 bg-card p-0 shadow-[2px_0_0_0_var(--border)]">
            <OrderListPageSelection />
          </TableHead>
          <TableHead
            className="sticky left-12 z-20 w-52 min-w-52 bg-card shadow-[2px_0_0_0_var(--border)]"
            aria-sort={ariaSort(query, 'orderNo')}
          >
            <AdminSortLink
              basePath="/orders"
              field="orderNo"
              label="工单号"
              currentSort={query.sort}
              currentDirection={query.dir}
              queryParams={queryParams}
            />
          </TableHead>
          <TableHead className="sticky left-64 z-20 w-28 min-w-28 bg-card shadow-[6px_0_8px_-8px_var(--foreground)]">
            状态
          </TableHead>
          <TableHead
            className="text-right"
            aria-sort={ariaSort(query, 'promisedDate')}
          >
            <AdminSortLink
              basePath="/orders"
              field="promisedDate"
              label="承诺交期"
              currentSort={query.sort}
              currentDirection={query.dir}
              queryParams={queryParams}
              className="justify-end"
            />
          </TableHead>
          <TableHead>工单名称</TableHead>
          <TableHead>客户名称/简称</TableHead>
          <TableHead>收货信息</TableHead>
          <TableHead>提交人</TableHead>
          <TableHead>师傅</TableHead>
          {showCommercialAmounts ? (
            <TableHead
              className="text-right"
              aria-sort={ariaSort(query, 'totalAmount')}
            >
              <AdminSortLink
                basePath="/orders"
                field="totalAmount"
                label="金额"
                currentSort={query.sort}
                currentDirection={query.dir}
                queryParams={queryParams}
                className="justify-end"
              />
            </TableHead>
          ) : null}
          {showPieceworkCost ? (
            <TableHead className="text-right">计件成本</TableHead>
          ) : null}
          <TableHead>标记</TableHead>
          <TableHead aria-sort={ariaSort(query, 'createdAt')}>
            <AdminSortLink
              basePath="/orders"
              field="createdAt"
              label="创建日期"
              currentSort={query.sort}
              currentDirection={query.dir}
              queryParams={queryParams}
            />
          </TableHead>
          <TableHead className="w-28 min-w-28">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((o) => (
          <TableRow
            key={o.id}
            className="group"
            data-order-id={o.id}
            data-state={query.selectedOrderId === o.id ? 'selected' : undefined}
          >
            <TableCell className="sticky left-0 z-20 w-12 min-w-12 bg-card p-0 shadow-[2px_0_0_0_var(--border)] group-hover:bg-muted group-has-checked:bg-muted group-data-[state=selected]:bg-muted">
              <OrderListRowSelection orderId={o.id} orderNo={o.orderNo} />
            </TableCell>
            <TableCell className="sticky left-12 z-10 w-52 min-w-52 bg-card font-sans tabular-nums text-xs shadow-[2px_0_0_0_var(--border)] group-hover:bg-muted group-has-checked:bg-muted group-data-[state=selected]:bg-muted">
              <span className="admin-wrap-anywhere block max-w-48 whitespace-normal">
                {o.orderNo}
              </span>
              {o.sourceOrderNo ? (
                <span className="block text-[11px] text-muted-foreground">
                  原单 {o.sourceOrderNo}
                </span>
              ) : null}
            </TableCell>
            <TableCell className="sticky left-64 z-10 w-28 min-w-28 bg-card shadow-[6px_0_8px_-8px_var(--foreground)] group-hover:bg-muted group-has-checked:bg-muted group-data-[state=selected]:bg-muted">
              <OrderStatusBadge status={o.status} />
            </TableCell>
            <TableCell className="text-right font-sans tabular-nums text-xs">
              {formatDateShanghai(o.promisedDate, '未设置')}
            </TableCell>
            <TableCell className="max-w-56">
              <span className="block truncate font-medium" title={o.customName ?? undefined}>
                {o.customName ?? '—'}
              </span>
            </TableCell>
            <TableCell>{o.customerRef ?? '—'}</TableCell>
            <TableCell className="max-w-64 text-muted-foreground">
              <span
                className="block truncate"
                title={formatReceiverInfo(o, '') || undefined}
              >
                {formatReceiverInfo(o)}
              </span>
            </TableCell>
            <TableCell className="max-w-40">
              <span className="admin-wrap-anywhere text-sm">{o.submitterName}</span>
            </TableCell>
            <TableCell className="max-w-56">
              <span
                className="admin-wrap-anywhere text-sm text-muted-foreground"
                title={o.workerNames.length ? o.workerNames.join('、') : undefined}
              >
                {o.workerNames.length ? o.workerNames.join('、') : '未派工'}
              </span>
            </TableCell>
            {showCommercialAmounts ? (
              <TableCell className="text-right font-sans tabular-nums text-xs">
                {String(o.totalAmount)}
              </TableCell>
            ) : null}
            {showPieceworkCost ? (
              <TableCell className="text-right font-sans tabular-nums text-xs">
                ¥ {o.pieceworkCost ?? '0.00'}
              </TableCell>
            ) : null}
            <TableCell>
              <div className="flex min-w-max flex-wrap gap-1">
                {o.isUrgent ? <UrgentBadge /> : null}
                {o.isSfCollect ? (
                  <Badge
                    variant="outline"
                    className="border-warning/50 bg-warning/10 text-warning-foreground"
                  >
                    顺丰到付
                  </Badge>
                ) : null}
                {o.shipmentCount > 1 ? (
                  <Badge variant="outline">多地址 ×{o.shipmentCount}</Badge>
                ) : null}
                {o.kind === OrderKind.REWORK ? (
                  <Badge variant="outline">重做单</Badge>
                ) : null}
                {!o.isUrgent &&
                !o.isSfCollect &&
                o.shipmentCount <= 1 &&
                o.kind !== OrderKind.REWORK ? (
                  <span>—</span>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDateShanghai(o.createdAt)}</TableCell>
            <TableCell>
              <div className="flex min-w-max items-center gap-1">
                <OrderListDetailLink
                  orderId={o.id}
                  href={`/orders/${o.id}`}
                  className="inline-flex min-h-11 items-center text-sm text-primary underline hover:no-underline lg:min-h-7"
                >
                  查看
                </OrderListDetailLink>
                <OrderRowMoreActions
                  orderId={o.id}
                  orderNo={o.orderNo}
                  status={o.status}
                  canSchedule={canSchedule}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
        </Table>
      </div>
    </OrderListSelectionProvider>
  );
}

function ariaSort(
  query: OrderListQuery,
  field: OrderListSortKey,
): 'ascending' | 'descending' | 'none' {
  if (query.sort !== field) return 'none';
  return query.dir === 'asc' ? 'ascending' : 'descending';
}
