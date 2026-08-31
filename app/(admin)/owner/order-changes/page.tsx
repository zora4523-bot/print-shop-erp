import Link from 'next/link';
import {
  OrderChangeRequestStatus,
  OrderStatus,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { listOrderChangeRequests } from '@/lib/order/change-request';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  EmptyState,
  PageHeader,
  StatusBadge as UiStatusBadge,
  TableScrollArea,
} from '@/components/ui-business';
import { FilePenLine } from 'lucide-react';
import { ORDER_CHANGE_REQUEST_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

export const metadata = {
  title: '工单修改申请 · 红包印刷 ERP',
};

export default async function OrderChangesPage() {
  await requirePermission('order:change:review');
  const requests = await listOrderChangeRequests({ limit: 100 });
  const pendingCount = requests.filter(
    (request) => request.status === OrderChangeRequestStatus.PENDING,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="工单修改申请"
        subtitle="销售与客服提交的款式变更在这里审核；批准后统一同步生产任务。"
        actions={
          <Badge
            variant="outline"
            className="border-warning/40 bg-warning/10 text-warning-foreground"
          >
            待审核 {pendingCount}
          </Badge>
        }
      />
      {requests.length === 0 ? (
        <EmptyState
          icon={FilePenLine}
          title="还没有工单修改申请"
          description="销售或客服提交款式变更后会出现在这里。"
        />
      ) : (
        <TableScrollArea
          label="工单修改申请列表"
          className="rounded-xl border bg-card shadow-sm"
        >
          <table className="w-full min-w-[52rem] text-sm" aria-label="工单修改申请列表">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">
                  工单 / 客户 · 变更摘要
                </th>
                <th className="px-4 py-2 text-left font-medium">提交人</th>
                <th className="px-4 py-2 text-right font-medium">计价影响</th>
                <th className="px-4 py-2 text-left font-medium">生产阻断</th>
                <th className="px-4 py-2 text-right font-medium">动作</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const pending =
                  request.status === OrderChangeRequestStatus.PENDING;
                return (
                  <tr
                    key={request.id}
                    className={
                      pending
                        ? 'border-b bg-warning/5 last:border-0'
                        : 'border-b last:border-0'
                    }
                  >
                    <td className="min-w-0 px-4 py-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <ChangeRequestStatusBadge status={request.status} />
                        <Link
                          href={`/orders/${request.order.id}`}
                          className="admin-wrap-anywhere font-sans font-medium tabular-nums text-primary underline"
                        >
                          {request.order.orderNo}
                        </Link>
                      </div>
                      <p className="admin-wrap-anywhere mt-1 text-xs text-muted-foreground">
                        {request.order.customName ?? '未命名工单'} ·{' '}
                        {summarizeProposedChanges(request.proposedChanges)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        基于第 {request.baseRevision} 版 · 当前第{' '}
                        {request.order.revision} 版 ·{' '}
                        {formatDateTimeShanghai(request.createdAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3">{request.requester.displayName}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {pending ? '进入审核查看计价' : '以审核当时报价为准'}
                    </td>
                    <td className="px-4 py-3">
                      <ProductionBlockBadge status={request.order.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/orders/${request.order.id}`}
                        className={buttonVariants({
                          size: 'sm',
                          variant: pending ? 'default' : 'outline',
                        })}
                      >
                        {pending ? '进入审核' : '查看详情'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScrollArea>
      )}
    </div>
  );
}

function ChangeRequestStatusBadge({
  status,
}: {
  status: OrderChangeRequestStatus;
}) {
  const definition = ORDER_CHANGE_REQUEST_STATUS_REGISTRY[status];
  return (
    <UiStatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </UiStatusBadge>
  );
}

function ProductionBlockBadge({ status }: { status: OrderStatus }) {
  if (status === OrderStatus.IN_PRODUCTION) {
    return (
      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning-foreground">
        已在生产
      </span>
    );
  }
  if (status === OrderStatus.SCHEDULING) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        待排产
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">无</span>;
}

function summarizeProposedChanges(value: unknown): string {
  const items = (value as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) return '申请数据无法显示';
  return items
    .map((raw) => {
      const change = raw as {
        operation?: string;
        name?: string;
        quantity?: number;
      };
      if (change.operation === 'ADD') {
        return `新增${change.name ? `「${externalPriceBusinessText(change.name)}」` : '款式'}`;
      }
      if (change.operation === 'REMOVE') {
        return `取消${change.name ? `「${externalPriceBusinessText(change.name)}」` : '款式'}`;
      }
      return change.name
        ? `修改「${externalPriceBusinessText(change.name)}」${change.quantity ? `数量 ${change.quantity}` : ''}`
        : '修改款式';
    })
    .join('；');
}
