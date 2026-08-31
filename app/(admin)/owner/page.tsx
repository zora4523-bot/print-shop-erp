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
  SlowLoadingHint,
  StatCard,
  StatusBadge as UiStatusBadge,
} from '@/components/ui-business';
import {
  WatchlistTable,
  type WatchlistColumn,
} from '@/components/business/dashboard/WatchlistTable';
import {
  DashboardQueue,
  type DashboardQueueItem,
} from '@/components/business/dashboard/DashboardQueue';
import {
  DeferredCategoryDistributionChart,
  DeferredProductionTrendChart,
  DeferredSalesRankingChart,
} from '@/components/business/dashboard/DeferredDashboardCharts';
import { Badge } from '@/components/ui/badge';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { OutsourceStatus } from '@/generated/prisma/enums';
import { PROMISE_ALERT_STATUSES } from '@/lib/order/promised-date';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { OUTSOURCE_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

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

  // 权限通过后立即启动每个独立读取，但不在页面根节点 await。
  // 同一个 promise 同时交给队列汇总和对应关注表，保证单次 DB 读取；
  // 任一读取失败只会落入最近的 ErrorBoundary，不会拖垮静态页头和快捷入口。
  const todayPromise = getTodayOrderStats();
  const monthlyPromise = getMonthlyBillStats();
  const pendingShipmentsPromise = getPendingShipments();
  const overdueOutsourcingPromise = getOverdueOutsourcing();
  const dueOrdersPromise = getDueOrders();
  const overReportsPromise = getRecentOverReports();
  const endingPeriodsPromise = getEndingPeriods();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <ErrorBoundary
          scope="field"
          title="日期与账期暂时无法加载"
          description={`${user.displayName} · Dashboard 其他区域仍可使用。`}
          className="mt-2"
        >
          <Suspense
            fallback={<DashboardHeaderLoading displayName={user.displayName} />}
          >
            <DashboardHeaderMetadata
              displayName={user.displayName}
              todayPromise={todayPromise}
              monthlyPromise={monthlyPromise}
            />
          </Suspense>
        </ErrorBoundary>
      </div>

      <ErrorBoundary
        scope="section"
        title="今日待处理暂时无法汇总"
        description="快捷入口和各关注列表仍可单独使用；请重试当前区域。"
      >
        <Suspense fallback={<DashboardQueueLoading />}>
          <DashboardQueueSection
            todayPromise={todayPromise}
            pendingShipmentsPromise={pendingShipmentsPromise}
            overdueOutsourcingPromise={overdueOutsourcingPromise}
            dueOrdersPromise={dueOrdersPromise}
            overReportsPromise={overReportsPromise}
            endingPeriodsPromise={endingPeriodsPromise}
          />
        </Suspense>
      </ErrorBoundary>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ErrorBoundary
          scope="section"
          title="今日工单指标暂时无法加载"
          description="其他指标和关注列表仍可使用。"
          className="sm:col-span-2 lg:col-span-3"
        >
          <Suspense fallback={<DashboardStatsLoading count={3} />}>
            <TodayStatsSection todayPromise={todayPromise} />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary
          scope="section"
          title="本月应收暂时无法加载"
          description="其他指标和关注列表仍可使用。"
        >
          <Suspense fallback={<DashboardStatsLoading count={1} />}>
            <MonthlyStatsSection monthlyPromise={monthlyPromise} />
          </Suspense>
        </ErrorBoundary>
      </section>

      <section
        data-slot="dashboard-shortcuts"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <ActionShortcut
          href="/orders/new"
          icon={PlusCircle}
          label="新建工单"
          description="填写客户、款式与交期"
          tone="primary"
        />
        <ActionShortcut
          href={RULE_CENTER_HREFS.stockSkus}
          icon={PackageOpen}
          label="报价 SKU"
          description="维护报价规格"
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
        <ErrorBoundary
          scope="section"
          title="待发货工单暂时无法加载"
          description="其他关注列表仍可使用。"
        >
          <Suspense fallback={<DashboardWatchlistLoading title="待发货工单" />}>
            <PendingShipmentsWatchlist
              pendingShipmentsPromise={pendingShipmentsPromise}
            />
          </Suspense>
        </ErrorBoundary>

        <ErrorBoundary
          scope="section"
          title="超期外协暂时无法加载"
          description="其他关注列表仍可使用。"
        >
          <Suspense fallback={<DashboardWatchlistLoading title="超期外协" />}>
            <OverdueOutsourcingWatchlist
              overdueOutsourcingPromise={overdueOutsourcingPromise}
            />
          </Suspense>
        </ErrorBoundary>

        <ErrorBoundary
          scope="section"
          title="交期预警暂时无法加载"
          description="其他关注列表仍可使用。"
        >
          <Suspense fallback={<DashboardWatchlistLoading title="交期预警" />}>
            <DueOrdersWatchlist dueOrdersPromise={dueOrdersPromise} />
          </Suspense>
        </ErrorBoundary>

        <ErrorBoundary
          scope="section"
          title="超计划报工暂时无法加载"
          description="其他关注列表仍可使用。"
        >
          <Suspense fallback={<DashboardWatchlistLoading title="超计划报工" />}>
            <OverReportsWatchlist overReportsPromise={overReportsPromise} />
          </Suspense>
        </ErrorBoundary>
      </div>

      <ErrorBoundary
        scope="section"
        title="即将结算客服周期暂时无法加载"
        description="其他关注列表仍可使用。"
      >
        <Suspense
          fallback={<DashboardWatchlistLoading title="即将结算客服周期" />}
        >
          <EndingPeriodsWatchlist
            endingPeriodsPromise={endingPeriodsPromise}
          />
        </Suspense>
      </ErrorBoundary>

      <section
        data-slot="dashboard-charts-deferred"
        aria-label="Dashboard 统计图表"
        className="space-y-4"
      >
        <ErrorBoundary
          scope="section"
          title="产量趋势暂时无法加载"
          description="销售排行和产品分布仍可使用；请重试当前图表。"
        >
          <Suspense
            fallback={
              <DashboardChartLoading label="近 30 天产量趋势" height="trend" />
            }
          >
            <ProductionTrendChartSection />
          </Suspense>
        </ErrorBoundary>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ErrorBoundary
            scope="section"
            title="销售排行暂时无法加载"
            description="产量趋势和产品分布仍可使用；请重试当前图表。"
          >
            <Suspense
              fallback={
                <DashboardChartLoading
                  label="本月销售业绩 Top 10"
                  height="detail"
                />
              }
            >
              <SalesRankingChartSection />
            </Suspense>
          </ErrorBoundary>

          <ErrorBoundary
            scope="section"
            title="产品分布暂时无法加载"
            description="产量趋势和销售排行仍可使用；请重试当前图表。"
          >
            <Suspense
              fallback={
                <DashboardChartLoading
                  label="本月产品线分布"
                  height="detail"
                />
              }
            >
              <CategoryDistributionChartSection />
            </Suspense>
          </ErrorBoundary>
        </div>
      </section>
    </div>
  );
}

type TodayStatsPromise = ReturnType<typeof getTodayOrderStats>;
type MonthlyStatsPromise = ReturnType<typeof getMonthlyBillStats>;
type PendingShipmentsPromise = ReturnType<typeof getPendingShipments>;
type OverdueOutsourcingPromise = ReturnType<typeof getOverdueOutsourcing>;
type DueOrdersPromise = ReturnType<typeof getDueOrders>;
type OverReportsPromise = ReturnType<typeof getRecentOverReports>;
type EndingPeriodsPromise = ReturnType<typeof getEndingPeriods>;

async function DashboardHeaderMetadata({
  displayName,
  todayPromise,
  monthlyPromise,
}: {
  displayName: string;
  todayPromise: TodayStatsPromise;
  monthlyPromise: MonthlyStatsPromise;
}) {
  const [today, monthly] = await Promise.all([todayPromise, monthlyPromise]);

  return (
    <p className="text-sm text-muted-foreground">
      {displayName} · {today.date} · 本月 {monthly.month}
    </p>
  );
}

async function TodayStatsSection({
  todayPromise,
}: {
  todayPromise: TodayStatsPromise;
}) {
  const today = await todayPromise;
  // 完工同比：今日 vs 昨日。差值正→上升，负→下降，0→持平。
  const completedDiff = today.completedToday - today.completedYesterday;
  const completedDiffLabel =
    completedDiff > 0
      ? `较昨日 +${completedDiff}`
      : completedDiff < 0
        ? `较昨日 ${completedDiff}`
        : '与昨日持平';

  return (
    <>
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
    </>
  );
}

async function MonthlyStatsSection({
  monthlyPromise,
}: {
  monthlyPromise: MonthlyStatsPromise;
}) {
  const monthly = await monthlyPromise;

  return (
    <StatCard
      label="本月应收"
      value={formatMoney(monthly.total)}
      icon={Wallet}
      tone="warning"
      hint={
        <>
          已收 {formatMoney(monthly.paid)} · 未收{' '}
          <span className="font-sans tabular-nums">
            {formatMoney(monthly.outstanding)}
          </span>
        </>
      }
    />
  );
}

async function DashboardQueueSection({
  todayPromise,
  pendingShipmentsPromise,
  overdueOutsourcingPromise,
  dueOrdersPromise,
  overReportsPromise,
  endingPeriodsPromise,
}: {
  todayPromise: TodayStatsPromise;
  pendingShipmentsPromise: PendingShipmentsPromise;
  overdueOutsourcingPromise: OverdueOutsourcingPromise;
  dueOrdersPromise: DueOrdersPromise;
  overReportsPromise: OverReportsPromise;
  endingPeriodsPromise: EndingPeriodsPromise;
}) {
  const [
    today,
    pendingShipments,
    overdueOutsourcing,
    dueOrders,
    overReports,
    endingPeriods,
  ] = await Promise.all([
    todayPromise,
    pendingShipmentsPromise,
    overdueOutsourcingPromise,
    dueOrdersPromise,
    overReportsPromise,
    endingPeriodsPromise,
  ]);
  const dueOrdersHref = dueOrdersListHref(dueOrders.promisedThroughYmd);
  const queueItems: DashboardQueueItem[] = [
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
  ].filter((item): item is DashboardQueueItem => item !== null);

  return <DashboardQueue dateLabel={today.date} items={queueItems} />;
}

async function PendingShipmentsWatchlist({
  pendingShipmentsPromise,
}: {
  pendingShipmentsPromise: PendingShipmentsPromise;
}) {
  const pendingShipments = await pendingShipmentsPromise;

  return (
    <WatchlistTable
      slot="dashboard-watchlist-shipments"
      title="待发货工单"
      description="完工但未发货 · 急单优先"
      rows={pendingShipments.rows}
      rowKey={(row) => row.id}
      emptyText="暂无待发货工单 — 所有完工单已发货"
      columns={pendingShipmentColumns}
      footer={
        pendingShipments.hasMore ? (
          <span>还有更多待发货工单（仅显示前 10 条）。</span>
        ) : null
      }
    />
  );
}

async function OverdueOutsourcingWatchlist({
  overdueOutsourcingPromise,
}: {
  overdueOutsourcingPromise: OverdueOutsourcingPromise;
}) {
  const overdueOutsourcing = await overdueOutsourcingPromise;

  return (
    <WatchlistTable
      slot="dashboard-watchlist-outsource"
      title="超期外协"
      description="预计交付日已过仍未收"
      rows={overdueOutsourcing}
      rowKey={(row) => row.id}
      emptyText="暂无超期外协"
      columns={overdueOutsourceColumns}
    />
  );
}

async function DueOrdersWatchlist({
  dueOrdersPromise,
}: {
  dueOrdersPromise: DueOrdersPromise;
}) {
  const dueOrders = await dueOrdersPromise;
  const dueOrdersHref = dueOrdersListHref(dueOrders.promisedThroughYmd);

  return (
    <WatchlistTable
      slot="dashboard-watchlist-due-orders"
      title="交期预警"
      description="承诺交期已逾期或 3 天内到期 · 未发货工单"
      rows={dueOrders.rows}
      rowKey={(row) => row.id}
      emptyText="暂无交期风险工单"
      columns={dueOrderColumns}
      footer={
        dueOrders.total > dueOrders.rows.length ? (
          <span>
            共{' '}
            <span className="font-sans tabular-nums">{dueOrders.total}</span>{' '}
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
  );
}

async function OverReportsWatchlist({
  overReportsPromise,
}: {
  overReportsPromise: OverReportsPromise;
}) {
  const overReports = await overReportsPromise;

  return (
    <WatchlistTable
      slot="dashboard-watchlist-over-reports"
      title="超计划报工"
      description={`近 ${OVER_REPORT_WINDOW_DAYS} 天 · 师傅勾确认后超出计划数完工`}
      rows={overReports.rows}
      rowKey={(row) => row.id}
      emptyText={`近 ${OVER_REPORT_WINDOW_DAYS} 天没有超计划报工。`}
      columns={overReportColumns}
      footer={
        overReports.total > 0 ? (
          <span>
            共{' '}
            <span className="font-sans tabular-nums">{overReports.total}</span>{' '}
            条（{overReports.sinceYmd} 起）
            {overReports.total > overReports.rows.length
              ? ` · 仅显示最近 ${overReports.rows.length} 条`
              : ''}
            。明细在工单时间线里，点工单号进去看。
          </span>
        ) : null
      }
    />
  );
}

async function EndingPeriodsWatchlist({
  endingPeriodsPromise,
}: {
  endingPeriodsPromise: EndingPeriodsPromise;
}) {
  const endingPeriods = await endingPeriodsPromise;

  return (
    <WatchlistTable
      slot="dashboard-watchlist-cs-periods"
      title="即将结算客服周期"
      description="7 天内到期 · 含按当前规则预测的提成 / 总收入"
      rows={endingPeriods}
      rowKey={(row) => row.id}
      emptyText="未来 7 天内无客服周期到期。"
      columns={endingPeriodColumns}
    />
  );
}

function dueOrdersListHref(promisedThroughYmd: string) {
  // 窗口右界由 getDueOrders 返回，页面不重算日期，保证列表页
  // 的 status / promisedTo 筛选和 Dashboard 是同一批工单。
  return `/orders?${new URLSearchParams({
    status: PROMISE_ALERT_STATUSES.join(','),
    promisedTo: promisedThroughYmd,
    sort: 'promisedDate',
    dir: 'asc',
  })}`;
}

function DashboardHeaderLoading({ displayName }: { displayName: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="space-y-1 text-sm text-muted-foreground"
    >
      <p>{displayName} · 正在加载日期与账期…</p>
      <SlowLoadingHint />
    </div>
  );
}

function DashboardQueueLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="space-y-2"
    >
      <span className="sr-only">正在加载今日待处理</span>
      <div
        aria-hidden="true"
        className="h-48 animate-pulse rounded-xl border bg-card motion-reduce:animate-none"
      />
      <SlowLoadingHint />
    </div>
  );
}

function DashboardStatsLoading({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div
      key={index}
      role={index === 0 ? 'status' : undefined}
      aria-busy={index === 0 ? 'true' : undefined}
      aria-live={index === 0 ? 'polite' : undefined}
      aria-hidden={index === 0 ? undefined : 'true'}
      className="relative h-28 overflow-hidden rounded-xl border bg-card"
    >
      {index === 0 ? (
        <span className="sr-only">正在加载 Dashboard 指标</span>
      ) : null}
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-pulse bg-card motion-reduce:animate-none"
      />
      {index === 0 ? (
        <SlowLoadingHint className="absolute inset-x-3 bottom-2" />
      ) : null}
    </div>
  ));
}

function DashboardWatchlistLoading({ title }: { title: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="space-y-2"
    >
      <span className="sr-only">正在加载{title}</span>
      <div
        aria-hidden="true"
        className="h-64 animate-pulse rounded-xl border bg-card motion-reduce:animate-none"
      />
      <SlowLoadingHint />
    </div>
  );
}

export async function ProductionTrendChartSection() {
  const productionTrend = await getProductionTrend();
  return <DeferredProductionTrendChart data={productionTrend} />;
}

export async function SalesRankingChartSection() {
  const salesRanking = await getSalesRanking();
  return <DeferredSalesRankingChart data={salesRanking} />;
}

export async function CategoryDistributionChartSection() {
  const categoryDistribution = await getCategoryDistribution();
  return <DeferredCategoryDistributionChart data={categoryDistribution} />;
}

function DashboardChartLoading({
  label,
  height,
}: {
  label: string;
  height: 'trend' | 'detail';
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="space-y-2"
    >
      <span className="sr-only">正在加载{label}</span>
      <div
        aria-hidden="true"
        className={`${
          height === 'trend' ? 'h-[23rem]' : 'h-[25rem]'
        } animate-pulse rounded-xl border bg-card motion-reduce:animate-none`}
      />
      <SlowLoadingHint />
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
