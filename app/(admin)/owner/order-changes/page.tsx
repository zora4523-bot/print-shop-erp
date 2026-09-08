import Link from 'next/link';
import { FilePenLine } from 'lucide-react';
import {
  OrderChangeModifyKind,
  OrderChangeRequestStatus,
  OrderChangeRequestType,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import {
  listPendingOrderChangeRequests,
  PENDING_ORDER_CHANGE_REQUEST_PAGE_SIZE,
  type PendingOrderChangeRequestListRow,
} from '@/lib/order/change-request-list';
import { parsePositiveInt } from '@/lib/admin/table';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { ORDER_CHANGE_REQUEST_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import {
  EmptyState,
  PageHeader,
  StatusBadge as UiStatusBadge,
} from '@/components/ui-business';

export const metadata = {
  title: '工单修改申请 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{
    page?: string | string[];
  }>;
};

const MODIFY_KIND_LABELS: Record<OrderChangeModifyKind, string> = {
  [OrderChangeModifyKind.QTY]: '数量',
  [OrderChangeModifyKind.DUE_DATE]: '交期',
  [OrderChangeModifyKind.ADDRESS]: '地址',
  [OrderChangeModifyKind.CRAFT_PAPER]: '工艺 / 纸张',
  [OrderChangeModifyKind.OTHER]: '其他',
};

export default async function OrderChangesPage({ searchParams }: PageProps) {
  await requirePermission('order:change:review');
  const raw = await searchParams;
  const requestedPage = parsePositiveInt(raw.page, {
    defaultValue: 1,
  });
  const result = await listPendingOrderChangeRequests({
    page: requestedPage,
    pageSize: PENDING_ORDER_CHANGE_REQUEST_PAGE_SIZE,
  });

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="工单修改申请"
        subtitle="仅展示待审核的修改或取消申请；已处理记录保留在对应工单的审计轨迹中。"
        actions={
          <Badge
            variant="outline"
            className="border-warning/40 bg-warning/10 text-warning-foreground"
          >
            待审核 {result.total}
          </Badge>
        }
      />

      {result.rows.length === 0 ? (
        <EmptyState
          icon={FilePenLine}
          title="暂无待审核的工单申请"
          description="销售或客服提交修改、取消申请后会出现在这里。"
        />
      ) : (
        <>
          <ul
            aria-label="待审核工单申请卡片列表"
            className="grid gap-3 lg:hidden"
          >
            {result.rows.map((request) => (
              <li
                key={request.id}
                className="min-w-0 rounded-xl border bg-card p-3 shadow-sm"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <ChangeRequestStatusBadge status={request.status} />
                  <RequestTypeBadge type={request.type} />
                  <span className="admin-wrap-anywhere min-w-0 font-sans text-sm font-semibold tabular-nums">
                    {request.order.orderNo}
                  </span>
                </div>
                <p className="admin-wrap-anywhere mt-2 text-sm font-medium">
                  {request.order.customName ?? '未命名工单'} ·{' '}
                  {summarizePendingRequest(request)}
                </p>
                <p className="admin-wrap-anywhere mt-1 text-xs text-muted-foreground">
                  原因：{request.reason}
                </p>
                <VersionMismatchNotice request={request} />

                <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">提交人</dt>
                    <dd className="admin-wrap-anywhere mt-0.5">
                      {request.requester.displayName}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">提交时间</dt>
                    <dd className="mt-0.5 font-sans tabular-nums">
                      {formatDateTimeShanghai(request.createdAt)}
                    </dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      当前工单状态
                    </dt>
                    <dd className="mt-1">
                      <OrderStatusBadge status={request.order.status} />
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex justify-end border-t pt-3">
                  <Link
                    href={reviewHref(request.order.orderNo)}
                    prefetch={false}
                    className={`${buttonVariants({ size: 'sm' })} min-h-11 w-full sm:w-auto`}
                  >
                    查看并审核
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden min-w-0 rounded-xl border bg-card shadow-sm lg:block">
            <Table
              label="待审核工单申请列表"
              className="min-w-[50rem] table-fixed"
            >
              <TableHeader className="bg-muted/40 text-xs text-muted-foreground">
                <TableRow>
                  <TableHead className="w-[44%] px-4">
                    工单 / 客户 · 申请摘要
                  </TableHead>
                  <TableHead className="w-24 px-4">提交人</TableHead>
                  <TableHead className="w-32 px-4">当前工单状态</TableHead>
                  <TableHead className="w-36 px-4">提交时间</TableHead>
                  <TableHead className="w-36 px-4 text-right">动作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((request) => (
                  <TableRow key={request.id} className="bg-warning/5">
                    <TableCell className="min-w-0 whitespace-normal px-4 py-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <ChangeRequestStatusBadge status={request.status} />
                        <RequestTypeBadge type={request.type} />
                        <span className="admin-wrap-anywhere font-sans font-medium tabular-nums">
                          {request.order.orderNo}
                        </span>
                      </div>
                      <p className="admin-wrap-anywhere mt-1 text-xs text-muted-foreground">
                        {request.order.customName ?? '未命名工单'} ·{' '}
                        {summarizePendingRequest(request)}
                      </p>
                      <p className="admin-wrap-anywhere mt-1 text-xs text-muted-foreground">
                        原因：{request.reason}
                      </p>
                      <VersionMismatchNotice request={request} />
                    </TableCell>
                    <TableCell className="whitespace-normal px-4 py-3">
                      {request.requester.displayName}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <OrderStatusBadge status={request.order.status} />
                    </TableCell>
                    <TableCell className="whitespace-normal px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTimeShanghai(request.createdAt)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <Link
                        href={reviewHref(request.order.orderNo)}
                        prefetch={false}
                        className={buttonVariants({ size: 'sm' })}
                      >
                        查看并审核
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {result.total > 0 ? (
        <AdminPagination
          basePath="/owner/order-changes"
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          pageSize={result.pageSize}
          queryParams={{}}
        />
      ) : null}
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

function RequestTypeBadge({ type }: { type: OrderChangeRequestType }) {
  return (
    <Badge variant="outline">
      {type === OrderChangeRequestType.CANCEL ? '取消申请' : '修改申请'}
    </Badge>
  );
}

function VersionMismatchNotice({
  request,
}: {
  request: Pick<
    PendingOrderChangeRequestListRow,
    'baseRevision' | 'baseWorkOrderVersion' | 'order'
  >;
}) {
  const hasMismatch =
    request.baseRevision !== request.order.revision ||
    (request.baseWorkOrderVersion != null &&
      request.baseWorkOrderVersion !== request.order.workOrderVersion);

  if (!hasMismatch) return null;

  return (
    <p className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-xs font-medium text-warning-foreground">
      工单已更新，申请需重新提交
    </p>
  );
}

function reviewHref(orderNo: string): string {
  return `/orders?queue=all&signal=pending-change#wo=${encodeURIComponent(orderNo)}`;
}

function summarizePendingRequest(
  request: Pick<
    PendingOrderChangeRequestListRow,
    'type' | 'modifyKind' | 'proposedChanges'
  >,
): string {
  if (request.type === OrderChangeRequestType.CANCEL) {
    return '申请取消整张工单';
  }

  const proposed = request.proposedChanges as { items?: unknown[]; promisedDate?: string | null } | null;
  const dueDate = proposed?.promisedDate;
  const dateSummary = dueDate === undefined ? '' : dueDate === null ? '清除承诺交期' : `交期改为 ${dueDate}`;
  const items = proposed?.items;
  if (!Array.isArray(items) || items.length === 0) {
    const kind = request.modifyKind
      ? MODIFY_KIND_LABELS[request.modifyKind]
      : '其他';
    return dateSummary || `${kind}调整`;
  }

  return items
    .map((raw) => {
      const change = raw as {
        operation?: string;
        name?: string;
        quantity?: number;
      };
      const name = change.name
        ? `「${externalPriceBusinessText(change.name)}」`
        : '款式';
      if (change.operation === 'ADD') return `新增${name}`;
      if (change.operation === 'REMOVE') return `取消${name}`;
      return `修改${name}${change.quantity ? `数量 ${change.quantity}` : ''}`;
    })
    .concat(dateSummary ? [dateSummary] : []).join('；');
}
