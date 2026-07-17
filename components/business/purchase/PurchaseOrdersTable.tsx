import Link from 'next/link';
import {
  AdminRowActions,
  AdminSortLink,
} from '@/components/business/admin/AdminDataTable';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  type PurchaseOrderListSortKey,
  type PurchaseOrderSummary,
} from '@/lib/purchase';
import type { SortDirection, TableHrefParams } from '@/lib/admin/table';

type Props = {
  orders: PurchaseOrderSummary[];
  tableBase?: string;
  queryParams?: TableHrefParams;
  sort?: PurchaseOrderListSortKey;
  direction?: SortDirection;
};

function SortHead({
  field,
  label,
  tableBase,
  queryParams,
  sort,
  direction,
}: {
  field: PurchaseOrderListSortKey;
  label: React.ReactNode;
  tableBase: string | undefined;
  queryParams: TableHrefParams;
  sort: PurchaseOrderListSortKey;
  direction: SortDirection;
}) {
  const content = tableBase ? (
    <AdminSortLink
      basePath={tableBase}
      field={field}
      label={label}
      currentSort={sort}
      currentDirection={direction}
      queryParams={queryParams}
    />
  ) : (
    label
  );

  return <TableHead>{content}</TableHead>;
}

function decimal(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value);
}

export function PurchaseOrdersTable({
  orders,
  tableBase,
  queryParams = {},
  sort = 'default',
  direction = 'asc',
}: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead
            field="purchaseNo"
            label="采购单"
            tableBase={tableBase}
            queryParams={queryParams}
            sort={sort}
            direction={direction}
          />
          <SortHead
            field="supplierName"
            label="供应商"
            tableBase={tableBase}
            queryParams={queryParams}
            sort={sort}
            direction={direction}
          />
          <TableHead>物料</TableHead>
          <TableHead className="text-right">数量</TableHead>
          <TableHead className="text-right">已收货</TableHead>
          <SortHead
            field="status"
            label="状态"
            tableBase={tableBase}
            queryParams={queryParams}
            sort={sort}
            direction={direction}
          />
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => {
          const firstItem = order.items[0];
          return (
            <TableRow key={order.id}>
              <TableCell className="font-mono text-xs">{order.purchaseNo}</TableCell>
              <TableCell>
                <div className="font-medium">{order.supplierName}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {order.supplierCode}
                </div>
              </TableCell>
              <TableCell>
                {firstItem ? (
                  <>
                    <div>{firstItem.material.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {firstItem.material.code}
                    </div>
                  </>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {firstItem ? `${decimal(firstItem.quantity)} ${firstItem.material.unit}` : '—'}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {firstItem
                  ? `${decimal(firstItem.receivedQuantity)} ${firstItem.material.unit}`
                  : '—'}
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {PURCHASE_ORDER_STATUS_LABELS[order.status]}
                </Badge>
              </TableCell>
              <TableCell>
                <AdminRowActions>
                  <Link
                    href={`/owner/purchases/${order.id}`}
                    className="text-sm text-primary underline hover:no-underline"
                  >
                    查看
                  </Link>
                </AdminRowActions>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
