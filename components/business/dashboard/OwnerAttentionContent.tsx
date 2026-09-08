import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { WatchlistTable } from '@/components/business/dashboard/WatchlistTable';
import {
  pendingShipmentColumns,
  dueOrderColumns,
  overdueOutsourceColumns,
  overReportColumns,
  endingPeriodColumns,
} from '@/components/business/dashboard/OwnerWatchlists';
import {
  getPendingShipments,
  getDueOrders,
  getOverdueOutsourcing,
  getRecentOverReports,
  getEndingPeriods,
} from '@/lib/dashboard/owner-watchlist';
import {
  ATTENTION_TITLES,
  ATTENTION_PAGE_SIZE,
  type AttentionKind,
} from '@/lib/dashboard/attention';
import { paginationWindow } from '@/lib/admin/table';

export async function AttentionContent({
  kind,
  page,
}: {
  kind: AttentionKind;
  page: number;
}) {
  const now = new Date();
  const pagination = (result: {
    page: number;
    pageCount: number;
    total: number;
    pageSize: number;
  }) => (
    <AdminPagination
      basePath="/owner/attention"
      {...result}
      queryParams={{ kind }}
    />
  );

  if (kind === 'shipments') {
    const result = await getPendingShipments(now, ATTENTION_PAGE_SIZE, page);
    return (
      <div className="space-y-4">
        <WatchlistTable
          title={ATTENTION_TITLES[kind]}
          rows={result.rows}
          rowKey={(row) => row.id}
          columns={pendingShipmentColumns(now)}
          emptyText="暂无待发货工单"
        />
        {pagination(result)}
      </div>
    );
  }
  if (kind === 'due') {
    const result = await getDueOrders(now, ATTENTION_PAGE_SIZE, page);
    return (
      <div className="space-y-4">
        <WatchlistTable
          title={ATTENTION_TITLES[kind]}
          rows={result.rows}
          rowKey={(row) => row.id}
          columns={dueOrderColumns}
          emptyText="暂无交期风险工单"
        />
        {pagination(result)}
      </div>
    );
  }
  if (kind === 'over-reports') {
    const result = await getRecentOverReports(now, ATTENTION_PAGE_SIZE, page);
    return (
      <div className="space-y-4">
        <WatchlistTable
          title={ATTENTION_TITLES[kind]}
          description={`自 ${result.sinceYmd} 起`}
          rows={result.rows}
          rowKey={(row) => row.id}
          columns={overReportColumns}
          emptyText="近 7 天无超计划报工记录"
        />
        {pagination(result)}
      </div>
    );
  }
  if (kind === 'outsource') {
    const rows = await getOverdueOutsourcing(now);
    const window = paginationWindow(rows.length, page, ATTENTION_PAGE_SIZE);
    return (
      <div className="space-y-4">
        <WatchlistTable
          title={ATTENTION_TITLES[kind]}
          rows={rows.slice(window.skip, window.skip + window.take)}
          rowKey={(row) => row.id}
          columns={overdueOutsourceColumns}
          emptyText="暂无超期外协"
        />
        {pagination({ ...window, total: rows.length })}
      </div>
    );
  }
  const rows = await getEndingPeriods(now);
  const window = paginationWindow(rows.length, page, ATTENTION_PAGE_SIZE);
  return (
    <div className="space-y-4">
      <WatchlistTable
        title={ATTENTION_TITLES[kind]}
        rows={rows.slice(window.skip, window.skip + window.take)}
        rowKey={(row) => row.id}
        columns={endingPeriodColumns}
        emptyText="未来 7 天无客服周期到期"
      />
      {pagination({ ...window, total: rows.length })}
    </div>
  );
}
