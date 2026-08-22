import Link from 'next/link';
import { Inbox } from 'lucide-react';
import type {
  OrderListQuery,
  OrderListRow,
  OrderListSortKey,
} from '@/lib/order/list-query';
import type { TableHrefParams } from '@/lib/admin/table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui-business';
import { OrderStatusBadge } from './OrderStatusBadge';
import { formatDateShanghai } from '@/lib/format/dates';
import { OrderKind } from '@/generated/prisma/enums';
import { formatReceiverInfo } from '@/lib/order/receiver-info';
import { AdminSortLink } from '@/components/business/admin/AdminDataTable';

export function OrdersTable({
  orders,
  showCommercialAmounts = true,
  showPieceworkCost = false,
  query,
  queryParams,
}: {
  orders: OrderListRow[];
  showCommercialAmounts?: boolean;
  showPieceworkCost?: boolean;
  query: OrderListQuery;
  queryParams: TableHrefParams;
}) {
  if (orders.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="暂无工单"
        description="工单提交后会出现在这里。"
      />
    );
  }

  return (
    <Table label="工单列表">
      <TableHeader>
        <TableRow>
          <TableHead aria-sort={ariaSort(query, 'orderNo')}>
            <AdminSortLink
              basePath="/orders"
              field="orderNo"
              label="工单号"
              currentSort={query.sort}
              currentDirection={query.dir}
              queryParams={queryParams}
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
          <TableHead>状态</TableHead>
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
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((o) => (
          <TableRow key={o.id}>
            <TableCell className="font-sans tabular-nums text-xs">
              <span className="block">{o.orderNo}</span>
              {o.sourceOrderNo ? (
                <span className="block text-[11px] text-muted-foreground">
                  原单 {o.sourceOrderNo}
                </span>
              ) : null}
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
              <OrderStatusBadge status={o.status} />
            </TableCell>
            <TableCell>
              <div className="flex min-w-max flex-wrap gap-1">
                {o.isUrgent ? <Badge variant="destructive">急单</Badge> : null}
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
              <Link
                href={`/orders/${o.id}`}
                prefetch={false}
                className="text-sm text-primary underline hover:no-underline"
              >
                查看
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ariaSort(
  query: OrderListQuery,
  field: OrderListSortKey,
): 'ascending' | 'descending' | 'none' {
  if (query.sort !== field) return 'none';
  return query.dir === 'asc' ? 'ascending' : 'descending';
}
