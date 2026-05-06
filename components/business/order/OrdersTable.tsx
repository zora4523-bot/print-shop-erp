import Link from 'next/link';
import { Inbox } from 'lucide-react';
import type { OrderListRow } from '@/lib/order';
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

function formatDate(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function OrdersTable({ orders }: { orders: OrderListRow[] }) {
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>工单号</TableHead>
          <TableHead>客户</TableHead>
          <TableHead>收货人</TableHead>
          <TableHead className="text-right">金额</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>标记</TableHead>
          <TableHead>创建于</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((o) => (
          <TableRow key={o.id}>
            <TableCell className="font-mono text-xs">{o.orderNo}</TableCell>
            <TableCell>{o.customerRef ?? '—'}</TableCell>
            <TableCell className="text-muted-foreground">{o.receiverName ?? '—'}</TableCell>
            <TableCell className="text-right font-mono text-xs">
              {String(o.totalAmount)}
            </TableCell>
            <TableCell>
              <OrderStatusBadge status={o.status} />
            </TableCell>
            <TableCell>
              {o.isUrgent ? <Badge variant="destructive">急单</Badge> : <span>—</span>}
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
            <TableCell>
              <Link
                href={`/orders/${o.id}`}
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
