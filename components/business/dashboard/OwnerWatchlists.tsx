import Link from 'next/link';
import { StatusBadge } from '@/components/ui-business';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { OUTSOURCE_STATUS_REGISTRY, PROMISED_DATE_ALERT_STATUS, promisedDateAlertDefinition } from '@/lib/ui/status-registry';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import {
  DASHBOARD_PREVIEW_LIMIT,
  completedWaitingLabel,
} from '@/lib/dashboard/attention';
import { DUE_SOON_DAYS, promisedDaysLeft } from '@/lib/order/promised-date';
import type {
  PendingShipmentsResult,
  DueOrdersResult,
  OverdueOutsourceRow,
  OverReportsResult,
  PendingShipmentRow,
  DueOrderRow,
  OverReportRow,
} from '@/lib/dashboard/owner-watchlist';
import { AttentionPanel } from './AttentionPanel';
import type { WatchlistColumn } from './WatchlistTable';

const linkClass =
  'admin-wrap-anywhere font-medium text-primary underline-offset-2 hover:underline';

// 主标签为工单名称、次行为工单号；未填名称时只显示工单号（客户名称/简称
// 已于 2026-09-27 停用）。
function OrderIdentity({
  id,
  orderNo,
  customName,
  isUrgent = false,
}: {
  id: string;
  orderNo: string;
  customName?: string | null;
  isUrgent?: boolean;
}) {
  const name = customName?.trim();
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Link
          href={`/orders/${id}`}
          className={`${linkClass} flex min-h-11 min-w-0 flex-col items-start justify-center`}
        >
          <span>{name || orderNo}</span>
          {name ? (
            <span className="mt-1 font-sans text-xs font-normal tabular-nums text-muted-foreground">
              {orderNo}
            </span>
          ) : null}
        </Link>
        {isUrgent ? <UrgentBadge /> : null}
      </div>
    </div>
  );
}

export function DueDate({ date, daysLeft }: { date: Date; daysLeft: number }) {
  // 逾期 / 临期的文案与色调统一取自 lib/ui/status-registry（§6），不在本地写 tone。
  const alert = daysLeft < 0
    ? promisedDateAlertDefinition(PROMISED_DATE_ALERT_STATUS.OVERDUE, -daysLeft)
    : daysLeft <= DUE_SOON_DAYS
      ? promisedDateAlertDefinition(PROMISED_DATE_ALERT_STATUS.DUE_SOON, daysLeft)
      : null;
  return (
    <div className="space-y-1">
      <StatusBadge tone={alert?.tone ?? 'neutral'}>
        {alert?.label ?? `${daysLeft} 天后到期`}
      </StatusBadge>
      <p className="font-sans text-xs tabular-nums text-muted-foreground">
        {formatDateShanghai(date)}
      </p>
    </div>
  );
}

export async function PendingShipmentsWatchlist({
  resultPromise,
  now,
}: {
  resultPromise: Promise<PendingShipmentsResult>;
  now: Date;
}) {
  const result = await resultPromise;
  return (
    <AttentionPanel kind="shipments" count={result.total} emptyText="暂无待发货工单">
      {result.rows.slice(0, DASHBOARD_PREVIEW_LIMIT).map((row) => (
        <li
          key={row.id}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-sm"
        >
          <div className="min-w-0">
            <OrderIdentity {...row} />
            <p className="mt-2 text-xs text-muted-foreground">
              {completedWaitingLabel(row.completedAt, now)}
            </p>
          </div>
          <div className="text-right">
            {row.promisedDate ? (
              <DueDate
                date={row.promisedDate}
                daysLeft={promisedDaysLeft(row.promisedDate, now)}
              />
            ) : (
              <span className="text-xs text-muted-foreground">未设交期</span>
            )}
          </div>
        </li>
      ))}
    </AttentionPanel>
  );
}

export async function DueOrdersWatchlist({
  resultPromise,
}: {
  resultPromise: Promise<DueOrdersResult>;
}) {
  const result = await resultPromise;
  return (
    <AttentionPanel kind="due" count={result.total} emptyText="暂无交期风险工单">
      {result.rows.slice(0, DASHBOARD_PREVIEW_LIMIT).map((row) => (
        <li
          key={row.id}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-sm"
        >
          <div className="min-w-0">
            <OrderIdentity {...row} />
            <div className="mt-2">
              <OrderStatusBadge status={row.status} />
            </div>
          </div>
          <div className="text-right">
            <DueDate date={row.promisedDate} daysLeft={row.daysLeft} />
          </div>
        </li>
      ))}
    </AttentionPanel>
  );
}

export async function OverdueOutsourcingWatchlist({
  resultPromise,
}: {
  resultPromise: Promise<OverdueOutsourceRow[]>;
}) {
  const rows = await resultPromise;
  return (
    <AttentionPanel kind="outsource" count={rows.length} emptyText="暂无超期外协">
      {rows.slice(0, DASHBOARD_PREVIEW_LIMIT).map((row) => (
        <li
          key={row.id}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 text-sm"
        >
          <div className="min-w-0">
            <Link className={linkClass} href={`/foreman/outsource/${row.id}`}>
              {row.supplierName}
            </Link>
            <p className="admin-wrap-anywhere mt-1 text-xs text-muted-foreground">
              {row.orderNo || '未关联工单'}
            </p>
          </div>
          <div className="text-right">
            <StatusBadge tone="warning">超期 {row.daysOverdue} 天</StatusBadge>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDateShanghai(row.expectedDate)}
            </p>
          </div>
        </li>
      ))}
    </AttentionPanel>
  );
}

function OverReportQuantities({ row }: { row: OverReportRow }) {
  return row.quantities ? (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p className="font-sans tabular-nums">实际合计 {row.quantities.totalQty}</p>
      <p>
        合格 {row.quantities.completedQty} · 不良 {row.quantities.defectQty} · 返工 {row.quantities.reworkQty}
      </p>
    </div>
  ) : (
    <span className="text-xs text-muted-foreground">
      {row.remark ? '数量见原始记录' : '未记录数量'}
    </span>
  );
}

export async function OverReportsWatchlist({
  resultPromise,
}: {
  resultPromise: Promise<OverReportsResult>;
}) {
  const result = await resultPromise;
  return (
    <AttentionPanel
      kind="over-reports"
      count={result.total}
      emptyText="近 7 天无超计划报工记录"
    >
      {result.rows.slice(0, DASHBOARD_PREVIEW_LIMIT).map((row) => (
        <li key={row.id} className="space-y-2 px-4 py-3 text-sm">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
            <Link className={linkClass} href={`/orders/${row.orderId}`}>
              {row.orderNo}
            </Link>
            <span className="text-xs text-muted-foreground">
              {row.operatorDisplayName} · {formatDateTimeShanghai(row.createdAt)}
            </span>
          </div>
          <OverReportQuantities row={row} />
        </li>
      ))}
    </AttentionPanel>
  );
}

export function pendingShipmentColumns(
  now: Date,
): readonly WatchlistColumn<PendingShipmentRow>[] {
  return [
    { header: '工单', cell: (row) => <OrderIdentity {...row} /> },
    {
      header: '承诺交期',
      cell: (row) =>
        row.promisedDate ? (
          <DueDate
            date={row.promisedDate}
            daysLeft={promisedDaysLeft(row.promisedDate, now)}
          />
        ) : (
          '未设置'
        ),
    },
    {
      header: '待发时长',
      cell: (row) => (
        <div>
          {completedWaitingLabel(row.completedAt, now)}
          <p className="mt-1 text-xs text-muted-foreground">
            完工 {formatDateTimeShanghai(row.completedAt)}
          </p>
        </div>
      ),
    },
    { header: '外部销售', cell: (row) => row.externalSalesName ?? '未填' },
  ];
}

export const dueOrderColumns: readonly WatchlistColumn<DueOrderRow>[] = [
  { header: '工单', cell: (row) => <OrderIdentity {...row} /> },
  { header: '当前阶段', cell: (row) => <OrderStatusBadge status={row.status} /> },
  {
    header: '承诺交期',
    cell: (row) => <DueDate date={row.promisedDate} daysLeft={row.daysLeft} />,
  },
  { header: '外部销售', cell: (row) => row.externalSalesName ?? '未填' },
];

export const overdueOutsourceColumns:
  readonly WatchlistColumn<OverdueOutsourceRow>[] = [
    {
      header: '供应商',
      cell: (row) => (
        <Link className={linkClass} href={`/foreman/outsource/${row.id}`}>
          {row.supplierName}
        </Link>
      ),
    },
    { header: '关联工单', cell: (row) => row.orderNo || '未关联工单' },
    {
      header: '预计交付',
      cell: (row) => (
        <DueDate date={row.expectedDate} daysLeft={-row.daysOverdue} />
      ),
    },
    {
      header: '状态',
      cell: (row) => {
        const state = OUTSOURCE_STATUS_REGISTRY[row.status];
        return (
          <StatusBadge tone={state.tone} dot={state.dot}>
            {state.label}
          </StatusBadge>
        );
      },
    },
  ];

export const overReportColumns: readonly WatchlistColumn<OverReportRow>[] = [
  {
    header: '工单',
    cell: (row) => (
      <Link className={linkClass} href={`/orders/${row.orderId}`}>
        {row.orderNo}
      </Link>
    ),
  },
  { header: '报工人', cell: (row) => row.operatorDisplayName },
  {
    header: '报工数量',
    cell: (row) => (
      <div className="min-w-48">
        <OverReportQuantities row={row} />
        {row.remark ? (
          <Disclosure className="mt-1">
            <DisclosureSummary>原始记录</DisclosureSummary>
            <p className="max-w-xl whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
              {row.remark}
            </p>
          </Disclosure>
        ) : null}
      </div>
    ),
  },
  { header: '时间', cell: (row) => formatDateTimeShanghai(row.createdAt) },
];
