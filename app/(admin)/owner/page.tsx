import Link from 'next/link';
import { Suspense } from 'react';
import {
  Bell,
  ClipboardList,
  PackageOpen,
  PlusCircle,
  Send,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react';
import { requirePermission } from '@/lib/auth/permissions';
import {
  getMonthlyBillStats,
  getTodayOrderStats,
} from '@/lib/dashboard/owner-stats';
import {
  getEndingPeriods,
  getOverdueOutsourcing,
  getDueOrders,
  getPendingShipments,
  getRecentOverReports,
  OVER_REPORT_WINDOW_DAYS,
  type EndingPeriodRow,
  type DueOrderRow,
  type OverdueOutsourceRow,
  type OverReportRow,
  type PendingShipmentRow,
} from '@/lib/dashboard/owner-watchlist';
import {
  getCategoryDistribution,
  getProductionTrend,
  getSalesRanking,
} from '@/lib/dashboard/owner-charts';
import { formatMoney } from '@/lib/dashboard/format';
import {
  ActionShortcut,
  ErrorBoundary,
  StatCard,
  StatusBadge as UiStatusBadge,
} from '@/components/ui-business';
import {
  WatchlistTable,
  type WatchlistColumn,
} from '@/components/business/dashboard/WatchlistTable';
import { DashboardQueue } from '@/components/business/dashboard/DashboardQueue';
import { DeferredDashboardCharts } from '@/components/business/dashboard/DeferredDashboardCharts';
import { Badge } from '@/components/ui/badge';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { OutsourceStatus } from '@/generated/prisma/enums';
import { PROMISE_ALERT_STATUSES } from '@/lib/order/promised-date';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { OUTSOURCE_STATUS_REGISTRY } from '@/lib/ui/status-registry';

export const metadata = { title: '管理员 Dashboard' };

// /owner is the ADMIN landing page. Layered build (P1 #1):
//   - Slice A: 4 KPI cards
//   - Slice B: 4 watchlist tables（含「超计划报工」——超报的知情通道，
//     见 lib/dashboard/owner-watchlist.ts 的 getRecentOverReports）
//   - Slice C: 3 charts — 30 天产量 / 销售业绩 Top10 / 产品分布
//
// Permission: `report:all` is ADMIN-only; matches the (admin)/owner
// layout gate but keeps the page-level guard as defense in depth (the
// layout could be bypassed if a future Server Action reuses this page
// as a fragment — defensive habit, no measurable cost).
export default async function OwnerDashboardPage() {
  // requirePermission 已返回通过权限检查的 session user；不要再读一次
  // session 只为拿 displayName。
  const user = await requirePermission('report:all');

  const [
    today,
    monthly,
    pendingShipments,
    overdueOutsourcing,
    dueOrders,
    overReports,
    endingPeriods,
  ] = await Promise.all([
    getTodayOrderStats(),
    getMonthlyBillStats(),
    getPendingShipments(),
    getOverdueOutsourcing(),
    getDueOrders(),
    getRecentOverReports(),
    getEndingPeriods(),
  ]);

  // 完工同比：今日 vs 昨日。差值正→上升，负→下降，0→持平。
  const completedDiff = today.completedToday - today.completedYesterday;
  const completedDiffLabel =
    completedDiff > 0
      ? `较昨日 +${completedDiff}`
      : completedDiff < 0
        ? `较昨日 ${completedDiff}`
        : '与昨日持平';

  // 交期预警只渲染前 N 条，footer 的「查看全部」把同一个窗口交给工单
  // 列表页：status = 未发货五态、promisedTo = 窗口右界日历日、按交期正
  // 序。窗口右界由 getDueOrders 一起返回，页面不自己算日期，否则链接
  // 筛出来的和上面列出来的会悄悄不是一批。
  // （列表页的 status 支持逗号分隔，见 lib/order/list-query.ts valuesOf。）
  const dueOrdersHref = `/orders?${new URLSearchParams({
    status: PROMISE_ALERT_STATUSES.join(','),
    promisedTo: dueOrders.promisedThroughYmd,
    sort: 'promisedDate',
    dir: 'asc',
  })}`;

  const queueItems = [
    pendingShipments.rows.length > 0 || pendingShipments.hasMore
      ? {
          id: 'shipments',
          kind: '待发货',
          title: '完工但未发货',
          detail: '急单优先，处理完即可出库',
          countLabel: pendingShipments.hasMore
            ? `${pendingShipments.rows.length}+`
            : String(pendingShipments.rows.length),
          dueLabel: pendingShipments.rows[0]
            ? formatDateTimeShanghai(pendingShipments.rows[0].completedAt)
            : '—',
          href: '#dashboard-watchlist-shipments',
          actionLabel: '去发货',
        }
      : null,
    overdueOutsourcing.length > 0
      ? {
          id: 'outsource',
          kind: '超期外协',
          title: '预计交付日已过仍未收',
          detail: overdueOutsourcing[0]?.supplierName
            ? `最早：${overdueOutsourcing[0].supplierName}`
            : '外协未闭环',
          countLabel: String(overdueOutsourcing.length),
          dueLabel: overdueOutsourcing[0]
            ? `超期 ${overdueOutsourcing[0].daysOverdue} 天`
            : '—',
          dueUrgent: true,
          href: '#dashboard-watchlist-outsource',
          actionLabel: '去跟进',
        }
      : null,
    dueOrders.total > 0
      ? {
          id: 'due',
          kind: '交期预警',
          title: '承诺交期已逾期或 3 天内到期',
          detail: '未发货工单',
          countLabel: String(dueOrders.total),
          dueLabel: dueOrders.rows[0]
            ? dueOrders.rows[0].daysLeft < 0
              ? `逾期 ${-dueOrders.rows[0].daysLeft} 天`
              : dueOrders.rows[0].daysLeft === 0
                ? '今天到期'
                : `剩 ${dueOrders.rows[0].daysLeft} 天`
            : '—',
          dueUrgent: (dueOrders.rows[0]?.daysLeft ?? 1) <= 0,
          href: dueOrdersHref,
          actionLabel: '看工单',
        }
      : null,
    overReports.total > 0
      ? {
          id: 'over-report',
          kind: '超计划报工',
          title: `近 ${OVER_REPORT_WINDOW_DAYS} 天有师傅超计划报工`,
          detail: '计件按合计全额付，明细在工单时间线',
          countLabel: String(overReports.total),
          dueLabel: overReports.rows[0]
            ? formatDateTimeShanghai(overReports.rows[0].createdAt)
            : '—',
          href: '#dashboard-watchlist-over-reports',
          actionLabel: '查看',
        }
      : null,
    endingPeriods.length > 0
      ? {
          id: 'cs-periods',
          kind: '客服周期',
          title: '7 天内有客服业绩周期到期',
          detail: endingPeriods[0]?.csDisplayName ?? '待结算',
          countLabel: String(endingPeriods.length),
          dueLabel: endingPeriods[0]
            ? `${endingPeriods[0].daysUntilEnd} 天后`
            : '—',
          href: '#dashboard-watchlist-cs-periods',
          actionLabel: '去结算',
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {user.displayName} · {today.date} · 本月 {monthly.month}
        </p>
      </div>

      <DashboardQueue dateLabel={today.date} items={queueItems} />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="今日提交工单"
          value={`${today.submittedToday} 单`}
          icon={ClipboardList}
          tone="primary"
          hint={
            today.urgentSubmittedToday > 0
              ? `其中急单 ${today.urgentSubmittedToday}`
              : '无急单'
          }
        />
        <StatCard
          label="今日完工"
          value={`${today.completedToday} 单`}
          icon={TrendingUp}
          tone="info"
          hint={completedDiffLabel}
        />
        <StatCard
          label="今日发货"
          value={`${today.shippedToday} 单`}
          icon={Truck}
          tone="success"
        />
        <StatCard
          label="本月应收"
          value={formatMoney(monthly.total)}
          icon={Wallet}
          tone="warning"
          hint={
            <>
              已收 {formatMoney(monthly.paid)} · 未收{' '}
              <span className="font-sans tabular-nums">{formatMoney(monthly.outstanding)}</span>
            </>
          }
        />
      </section>

      <section
        data-slot="dashboard-shortcuts"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <ActionShortcut
          href="/orders/new"
          icon={PlusCircle}
          label="新建工单"
          description="创建生产工单"
          tone="primary"
        />
        <ActionShortcut
          href="/owner/products"
          icon={PackageOpen}
          label="产品库"
          description="规格、基础价与起订量"
          tone="info"
        />
        <ActionShortcut
          href="/owner/bills"
          icon={Send}
          label="销售应收账单"
          description="月账单生成、发单"
          tone="warning"
        />
        <ActionShortcut
          href="/owner/notifications"
          icon={Bell}
          label="推送配置"
          description="企业微信群组绑定"
          tone="success"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WatchlistTable
          slot="dashboard-watchlist-shipments"
          title="待发货工单"
          description="完工但未发货 · 急单优先"
          rows={pendingShipments.rows}
          rowKey={(r) => r.id}
          emptyText="暂无待发货工单 — 所有完工单已发货"
          columns={pendingShipmentColumns}
          footer={
            // 没做 /orders?status=COMPLETED 过滤入口（orders index 不读
            // searchParams）；先只提示&ldquo;有更多&rdquo;，链接
            // 等订单管理页支持 status filter 后再加。
            pendingShipments.hasMore ? (
              <span>还有更多待发货工单（仅显示前 10 条）。</span>
            ) : null
          }
        />

        <WatchlistTable
          slot="dashboard-watchlist-outsource"
          title="超期外协"
          description="预计交付日已过仍未收"
          rows={overdueOutsourcing}
          rowKey={(r) => r.id}
          emptyText="暂无超期外协"
          columns={overdueOutsourceColumns}
        />

        <WatchlistTable
          slot="dashboard-watchlist-due-orders"
          title="交期预警"
          description="承诺交期已逾期或 3 天内到期 · 未发货工单"
          rows={dueOrders.rows}
          rowKey={(r) => r.id}
          emptyText="暂无交期风险工单"
          columns={dueOrderColumns}
          footer={
            // 截断必须说出来，并且给得出总数：这张表的窗口没有下界，
            // 积压多少正是业主要看的信号。链接与上表同窗口（见
            // dueOrdersHref）。
            dueOrders.total > dueOrders.rows.length ? (
              <span>
                共{' '}
                <span className="font-sans tabular-nums">
                  {dueOrders.total}
                </span>{' '}
                条 · 仅显示交期最紧的前{' '}
                <span className="font-sans tabular-nums">
                  {dueOrders.rows.length}
                </span>{' '}
                条 ·{' '}
                <Link
                  href={dueOrdersHref}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  查看全部 →
                </Link>
              </span>
            ) : null
          }
        />

        <WatchlistTable
          slot="dashboard-watchlist-over-reports"
          title="超计划报工"
          description={`近 ${OVER_REPORT_WINDOW_DAYS} 天 · 师傅勾确认后超出计划数完工`}
          rows={overReports.rows}
          rowKey={(r) => r.id}
          emptyText={`近 ${OVER_REPORT_WINDOW_DAYS} 天没有超计划报工。`}
          columns={overReportColumns}
          footer={
            // 这张表是超报的唯一知情通道：批准权在师傅自己手上（勾一下就
            // 过），而计件按合计数全额付。总数必须给全，不能只显示前 10 条
            // 就当没别的了。空窗口不渲染 footer —— emptyText 已经把话说完，
            // 再补一句「共 0 条」只是噪音。
            overReports.total > 0 ? (
              <span>
                共{' '}
                <span className="font-sans tabular-nums">
                  {overReports.total}
                </span>{' '}
                条（{overReports.sinceYmd} 起）
                {overReports.total > overReports.rows.length
                  ? ` · 仅显示最近 ${overReports.rows.length} 条`
                  : ''}
                。明细在工单时间线里，点工单号进去看。
              </span>
            ) : null
          }
        />
      </div>

      <WatchlistTable
        slot="dashboard-watchlist-cs-periods"
        title="即将结算客服周期"
        description="7 天内 periodEnd · 含按当前规则预测的提成 / 总收入"
        rows={endingPeriods}
        rowKey={(r) => r.id}
        emptyText="未来 7 天内无客服周期到期。"
        columns={endingPeriodColumns}
      />

      <ErrorBoundary
        scope="section"
        title="趋势图表暂时无法加载"
        description="上方指标和关注列表仍可使用；请单独重试图表区域。"
      >
        <Suspense fallback={<DashboardChartsLoading />}>
          <DashboardChartsSection />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

async function DashboardChartsSection() {
  const [productionTrend, salesRanking, categoryDistribution] =
    await Promise.all([
      getProductionTrend(),
      getSalesRanking(),
      getCategoryDistribution(),
    ]);

  return (
    <DeferredDashboardCharts
      productionTrend={productionTrend}
      salesRanking={salesRanking}
      categoryDistribution={categoryDistribution}
    />
  );
}

function DashboardChartsLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="正在加载统计图表"
      className="space-y-4"
    >
      <div className="h-[23rem] animate-pulse rounded-xl border bg-card motion-reduce:animate-none" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-[25rem] animate-pulse rounded-xl border bg-card motion-reduce:animate-none" />
        <div className="h-[25rem] animate-pulse rounded-xl border bg-card motion-reduce:animate-none" />
      </div>
    </div>
  );
}

// ─── columns ───

const pendingShipmentColumns: readonly WatchlistColumn<PendingShipmentRow>[] = [
  {
    header: '工单号',
    cell: (r) => (
      <Link
        href={`/orders/${r.id}`}
        className="font-sans tabular-nums text-xs underline-offset-2 hover:underline"
      >
        {r.orderNo}
      </Link>
    ),
  },
  {
    header: '客户名称/简称',
    cell: (r) => r.customerRef ?? '—',
  },
  {
    header: '提交人',
    cell: (r) => r.submitterDisplayName,
  },
  {
    header: '完工时间',
    cell: (r) => formatDateTimeShanghai(r.completedAt),
    align: 'right',
    className: 'font-sans tabular-nums text-xs',
  },
  {
    header: '急单',
    cell: (r) => (r.isUrgent ? <UrgentBadge /> : null),
    align: 'center',
  },
];

const dueOrderColumns: readonly WatchlistColumn<DueOrderRow>[] = [
  {
    header: '工单号',
    cell: (r) => (
      <Link
        href={`/orders/${r.id}`}
        className="font-sans tabular-nums text-xs underline-offset-2 hover:underline"
      >
        {r.orderNo}
      </Link>
    ),
  },
  {
    header: '客户名称/简称',
    cell: (r) => r.customerRef ?? '—',
  },
  {
    header: '状态',
    cell: (r) => <OrderStatusBadge status={r.status} />,
    align: 'center',
  },
  {
    header: '承诺交期',
    cell: (r) => r.promisedDate.toISOString().slice(0, 10),
    align: 'right',
    className: 'font-sans tabular-nums text-xs',
  },
  {
    header: '交期',
    cell: (r) =>
      r.daysLeft < 0 ? (
        <Badge variant="destructive">逾期 {-r.daysLeft} 天</Badge>
      ) : (
        <Badge
          variant="outline"
          className="border-warning/50 bg-warning/10 text-warning-foreground"
        >
          {r.daysLeft === 0 ? '今天到期' : `剩 ${r.daysLeft} 天`}
        </Badge>
      ),
    align: 'center',
  },
];

const overdueOutsourceColumns: readonly WatchlistColumn<OverdueOutsourceRow>[] =
  [
    {
      header: '工单号',
      cell: (r) =>
        r.orderNo ? (
          <span className="font-sans tabular-nums text-xs">{r.orderNo}</span>
        ) : (
          '—'
        ),
    },
    {
      header: '供应商',
      cell: (r) => r.supplierName,
    },
    {
      header: '预计交付',
      cell: (r) => formatDateShanghai(r.expectedDate),
      align: 'right',
      className: 'font-sans tabular-nums text-xs',
    },
    {
      header: '超期',
      cell: (r) => (
        <Badge variant="destructive">{r.daysOverdue} 天</Badge>
      ),
      align: 'center',
    },
    {
      header: '状态',
      cell: (r) => <OutsourceStatusBadge status={r.status} />,
      align: 'center',
    },
  ];

function OutsourceStatusBadge({ status }: { status: OutsourceStatus }) {
  const definition = OUTSOURCE_STATUS_REGISTRY[status];
  return (
    <UiStatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </UiStatusBadge>
  );
}

const overReportColumns: readonly WatchlistColumn<OverReportRow>[] = [
  {
    header: '工单号',
    cell: (r) => (
      <Link
        href={`/orders/${r.orderId}`}
        className="font-sans tabular-nums text-xs underline-offset-2 hover:underline"
      >
        {r.orderNo}
      </Link>
    ),
  },
  {
    header: '报工人',
    cell: (r) => r.operatorDisplayName,
  },
  {
    // remark 的格式由 lib/production.ts 的 overReportRemark 决定，
    // 形如「款式 A (#1)：[超计划报工] 2026-08-21 计划 5000 / 合计 6200
    // （合格 6000 / 不良 100 / 返工 100），报工人 …，已勾选确认」。
    // 这里原样显示——比再解析一遍诚实，也不会因为格式微调就显示成空白。
    header: '明细',
    cell: (r) => (
      <span className="text-xs text-muted-foreground">{r.remark ?? '—'}</span>
    ),
  },
  {
    header: '时间',
    cell: (r) => formatDateTimeShanghai(r.createdAt),
    align: 'right',
    className: 'font-sans tabular-nums text-xs',
  },
];

const endingPeriodColumns: readonly WatchlistColumn<EndingPeriodRow>[] = [
  {
    header: '客服',
    cell: (r) => r.csDisplayName,
  },
  {
    header: '周期',
    cell: (r) => (
      <span className="font-sans tabular-nums text-xs">
        {formatDateShanghai(r.periodStart)} → {formatDateShanghai(r.periodEnd)}
      </span>
    ),
  },
  {
    header: '剩余',
    cell: (r) => (
      <Badge variant={r.daysUntilEnd <= 1 ? 'destructive' : 'outline'}>
        {r.daysUntilEnd === 0 ? '今日' : `${r.daysUntilEnd} 天`}
      </Badge>
    ),
    align: 'center',
  },
  {
    // 业绩合计（算档用）= totalSales + initialSales。同 owner/salary/cs/[id]
    // 详情页的口径，保证与右侧"预测提成"档位一致（
    // 不能让显示数比命中档低，否则 owner 看不出为什么提成是这个金额）。
    header: '业绩合计',
    cell: (r) => {
      const initial = Number(r.initialSales);
      return (
        <div className="flex flex-col items-end">
          <span>{formatMoney(r.salesForTier)}</span>
          {initial > 0 ? (
            <span className="text-xs text-muted-foreground">
              含期初 {formatMoney(r.initialSales)}
            </span>
          ) : null}
        </div>
      );
    },
    align: 'right',
    className: 'font-sans tabular-nums',
  },
  {
    header: '预测提成',
    cell: (r) =>
      r.predictedCommission == null ? (
        <span className="text-muted-foreground">—</span>
      ) : r.predictedBelowAllTiers ? (
        <span className="text-muted-foreground">未达档位</span>
      ) : (
        formatMoney(r.predictedCommission)
      ),
    align: 'right',
    className: 'font-sans tabular-nums',
  },
  {
    header: '预测总收入',
    cell: (r) =>
      r.predictedTotalIncome == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        formatMoney(r.predictedTotalIncome)
      ),
    align: 'right',
    className: 'font-sans tabular-nums font-semibold',
  },
];

// ─── helpers ───
