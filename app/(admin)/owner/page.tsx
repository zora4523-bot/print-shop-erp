import Link from 'next/link';
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
  type EndingPeriodRow,
  type DueOrderRow,
  type OverdueOutsourceRow,
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
  HeroBanner,
  StatCard,
} from '@/components/ui-business';
import {
  WatchlistTable,
  type WatchlistColumn,
} from '@/components/business/dashboard/WatchlistTable';
import { ProductionTrendChart } from '@/components/business/dashboard/ProductionTrendChart';
import { SalesRankingChart } from '@/components/business/dashboard/SalesRankingChart';
import { CategoryDistributionChart } from '@/components/business/dashboard/CategoryDistributionChart';
import { Badge } from '@/components/ui/badge';
import { OrderStatusBadge } from '@/components/business/order/OrderStatusBadge';
import { OutsourceStatus } from '@/generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';

export const metadata = { title: '老板 Dashboard' };

// /owner is the OWNER landing page. Layered build (P1 #1):
//   - Slice A: 4 KPI cards
//   - Slice B: 3 watchlist tables
//   - Slice C: 3 charts — 30 天产量 / 销售业绩 Top10 / 产品分布
//
// Permission: `report:all` is OWNER-only; matches the (admin)/owner
// layout gate but keeps the page-level guard as defense in depth (the
// layout could be bypassed if a future Server Action reuses this page
// as a fragment — defensive habit, no measurable cost).
export default async function OwnerDashboardPage() {
  await requirePermission('report:all');

  // displayName 用于 HeroBanner welcome；权限 gate 已通过，session 必有。
  const { user } = await requireSession();

  const [
    today,
    monthly,
    pendingShipments,
    overdueOutsourcing,
    dueOrders,
    endingPeriods,
    productionTrend,
    salesRanking,
    categoryDistribution,
  ] = await Promise.all([
    getTodayOrderStats(),
    getMonthlyBillStats(),
    getPendingShipments(),
    getOverdueOutsourcing(),
    getDueOrders(),
    getEndingPeriods(),
    getProductionTrend(),
    getSalesRanking(),
    getCategoryDistribution(),
  ]);

  // 完工同比：今日 vs 昨日。差值正→上升，负→下降，0→持平。
  const completedDiff = today.completedToday - today.completedYesterday;
  const completedDiffLabel =
    completedDiff > 0
      ? `较昨日 +${completedDiff}`
      : completedDiff < 0
        ? `较昨日 ${completedDiff}`
        : '与昨日持平';

  return (
    <div className="space-y-6">
      <HeroBanner
        title={`欢迎回来，${user.displayName}`}
        subtitle={
          <>
            今日 <span className="font-mono">{today.date}</span> · 本月{' '}
            <span className="font-mono">{monthly.month}</span> · 时区
            Asia/Shanghai
          </>
        }
        cta={
          <Link
            href="/orders"
            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            查看全部工单 →
          </Link>
        }
      />

      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          关键指标 · 关注列表 · 30 天趋势
        </p>
      </div>

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
              <span className="font-mono">{formatMoney(monthly.outstanding)}</span>
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
          description="规格、建议单价"
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
          emptyText="暂无待发货工单 — 所有完工单已发货。"
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
          emptyText="暂无超期外协。"
          columns={overdueOutsourceColumns}
        />

        <WatchlistTable
          slot="dashboard-watchlist-due-orders"
          title="交期预警"
          description="承诺交期已逾期或 3 天内到期 · 未发货工单"
          rows={dueOrders}
          rowKey={(r) => r.id}
          emptyText="暂无交期风险工单。"
          columns={dueOrderColumns}
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

      <ChartCard
        slot="dashboard-chart-trend-card"
        title="近 30 天产量趋势"
        description="按完工时间汇总 · COMPLETED / SHIPPED / FINISHED"
      >
        <ProductionTrendChart data={productionTrend} />
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          slot="dashboard-chart-ranking-card"
          title="本月销售业绩 Top 10"
          description="按提交时间归属 · SALES 蓝色 / 客服 绿色"
        >
          <SalesRankingChart data={salesRanking} />
        </ChartCard>
        <ChartCard
          slot="dashboard-chart-category-card"
          title="本月产品线分布"
          description="按工单计数（同一工单多款式只计 1 次）"
        >
          <CategoryDistributionChart data={categoryDistribution} />
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({
  slot,
  title,
  description,
  children,
}: {
  slot: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-slot={slot}
      className="rounded-xl border bg-card shadow-sm"
    >
      <header className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ─── columns ───

const pendingShipmentColumns: readonly WatchlistColumn<PendingShipmentRow>[] = [
  {
    header: '工单号',
    cell: (r) => (
      <Link
        href={`/orders/${r.id}`}
        className="font-mono text-xs underline-offset-2 hover:underline"
      >
        {r.orderNo}
      </Link>
    ),
  },
  {
    header: '客户',
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
    className: 'font-mono text-xs',
  },
  {
    header: '急单',
    cell: (r) =>
      r.isUrgent ? <Badge variant="destructive">急</Badge> : null,
    align: 'center',
  },
];

const dueOrderColumns: readonly WatchlistColumn<DueOrderRow>[] = [
  {
    header: '工单号',
    cell: (r) => (
      <Link
        href={`/orders/${r.id}`}
        className="font-mono text-xs underline-offset-2 hover:underline"
      >
        {r.orderNo}
      </Link>
    ),
  },
  {
    header: '客户',
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
    className: 'font-mono text-xs',
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

const OUTSOURCE_STATUS_LABELS: Record<OutsourceStatus, string> = {
  [OutsourceStatus.SENT]: '已发出',
  [OutsourceStatus.IN_PROGRESS]: '进行中',
  [OutsourceStatus.RECEIVED]: '已收',
  [OutsourceStatus.CANCELLED]: '取消',
};

const overdueOutsourceColumns: readonly WatchlistColumn<OverdueOutsourceRow>[] =
  [
    {
      header: '工单号',
      cell: (r) =>
        r.orderNo ? (
          <span className="font-mono text-xs">{r.orderNo}</span>
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
      className: 'font-mono text-xs',
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
      cell: (r) => (
        <Badge variant="outline">{OUTSOURCE_STATUS_LABELS[r.status]}</Badge>
      ),
      align: 'center',
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
      <span className="font-mono text-xs">
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
    className: 'font-mono',
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
    className: 'font-mono',
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
    className: 'font-mono font-semibold',
  },
];

// ─── helpers ───

function formatDateShanghai(d: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatDateTimeShanghai(d: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
