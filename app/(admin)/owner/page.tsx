import Link from 'next/link';
import { Suspense } from 'react';
import { requirePermission } from '@/lib/auth/permissions';
import {
  getMonthlyBillStats,
  getTodayOrderStats,
} from '@/lib/dashboard/owner-stats';
import {
  getOverdueOutsourcing,
  getDueOrders,
  getPendingShipments,
  getRecentOverReports,
} from '@/lib/dashboard/owner-watchlist';
import { formatMoney } from '@/lib/dashboard/format';
import { DASHBOARD_PREVIEW_LIMIT } from '@/lib/dashboard/attention';
import { ErrorBoundary, PageHeader, StatCard } from '@/components/ui-business';
import { buttonVariants } from '@/components/ui/button';
import {
  OrderAttentionLoading,
  OrderAttentionSection,
} from '@/components/business/dashboard/OrderAttentionSection';
import { DashboardSectionLoading } from '@/components/business/dashboard/DashboardSectionLoading';
import { NotificationAttention } from '@/components/business/dashboard/NotificationAttention';
import {
  DueOrdersWatchlist,
  PendingShipmentsWatchlist,
  OverdueOutsourcingWatchlist,
  OverReportsWatchlist,
} from '@/components/business/dashboard/OwnerWatchlists';
import { countRecentFailures } from '@/lib/notification/admin';

export const metadata = { title: '工作台' };

export default async function OwnerDashboardPage() {
  await requirePermission('report:all');
  const now = new Date();
  // Each read has one consumer with an independent loading/error boundary.
  const todayPromise = getTodayOrderStats(now);
  const monthlyPromise = getMonthlyBillStats(now);
  const pendingShipmentsPromise = getPendingShipments(now, DASHBOARD_PREVIEW_LIMIT);
  const overdueOutsourcingPromise = getOverdueOutsourcing(now);
  const dueOrdersPromise = getDueOrders(now, DASHBOARD_PREVIEW_LIMIT);
  const overReportsPromise = getRecentOverReports(now, DASHBOARD_PREVIEW_LIMIT);
  const recentNotificationFailuresPromise = countRecentFailures(24);

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="工作台"
        actions={
        <nav
          data-slot="dashboard-shortcuts"
          aria-label="工作台快捷操作"
          className="flex flex-wrap gap-2"
        >
          <Link
            href="/owner/analytics"
            className={buttonVariants({ variant: 'outline' })}
          >
            经营概览
          </Link>
          <Link
            href="/owner/agent-bills"
            className={buttonVariants({ variant: 'outline' })}
          >
            月度账单
          </Link>
          <Link href="/orders/new" className={buttonVariants()}>
            新建工单
          </Link>
        </nav>
        }
      />
      <ErrorBoundary
        scope="section"
        title="工单待办暂时无法加载"
        description="可从侧栏进入工单列表查看。"
      >
        <Suspense fallback={<OrderAttentionLoading />}>
          <OrderAttentionSection />
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary
        scope="section"
        title="推送异常暂时无法加载"
        description="可进入推送配置查看投递记录。"
      >
        <Suspense
          fallback={<DashboardSectionLoading label="推送异常" compact />}
        >
          <NotificationAttention countPromise={recentNotificationFailuresPromise} />
        </Suspense>
      </ErrorBoundary>
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <ErrorBoundary
          scope="section"
          title="交期预警暂时无法加载"
          description="其他关注列表仍可使用。"
        >
          <Suspense fallback={<DashboardSectionLoading label="交期预警" />}>
            <DueOrdersWatchlist resultPromise={dueOrdersPromise} />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary
          scope="section"
          title="待发货工单暂时无法加载"
          description="其他关注列表仍可使用。"
        >
          <Suspense fallback={<DashboardSectionLoading label="待发货工单" />}>
            <PendingShipmentsWatchlist
              resultPromise={pendingShipmentsPromise}
              now={now}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <ErrorBoundary
          scope="section"
          title="超期外协暂时无法加载"
          description="其他关注列表仍可使用。"
        >
          <Suspense
            fallback={<DashboardSectionLoading label="超期外协" compact />}
          >
            <OverdueOutsourcingWatchlist resultPromise={overdueOutsourcingPromise} />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary
          scope="section"
          title="超计划报工记录暂时无法加载"
          description="其他关注列表仍可使用。"
        >
          <Suspense
            fallback={<DashboardSectionLoading label="超计划报工记录" compact />}
          >
            <OverReportsWatchlist resultPromise={overReportsPromise} />
          </Suspense>
        </ErrorBoundary>
      </div>
      <section
        aria-label="经营简况"
        className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <ErrorBoundary
          scope="section"
          title="今日工单指标暂时无法加载"
          description="其他指标仍可使用。"
          className="sm:col-span-2 lg:col-span-3"
        >
          <Suspense
            fallback={<DashboardSectionLoading label="今日工单指标" compact />}
          >
            <TodayStatsSection resultPromise={todayPromise} />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary
          scope="section"
          title="本月已出账金额暂时无法加载"
          description="可进入账单页查看。"
        >
          <Suspense
            fallback={<DashboardSectionLoading label="本月已出账金额" compact />}
          >
            <MonthlyStatsSection resultPromise={monthlyPromise} />
          </Suspense>
        </ErrorBoundary>
      </section>
    </div>
  );
}

async function TodayStatsSection({
  resultPromise,
}: {
  resultPromise: ReturnType<typeof getTodayOrderStats>;
}) {
  const today = await resultPromise;
  return (
    <>
      <StatCard
        label="今日提交工单"
        value={`${today.submittedToday} 单`}
        hint={today.urgentSubmittedToday > 0
          ? `其中急单 ${today.urgentSubmittedToday}`
          : undefined}
      />
      <StatCard label="今日完工" value={`${today.completedToday} 单`} />
      <StatCard label="今日发货" value={`${today.shippedToday} 单`} />
    </>
  );
}

async function MonthlyStatsSection({
  resultPromise,
}: {
  resultPromise: ReturnType<typeof getMonthlyBillStats>;
}) {
  const monthly = await resultPromise;
  return (
    <StatCard
      label="本月已出账金额"
      value={formatMoney(monthly.total)}
      hint={(
        <>
          本月已收 {formatMoney(monthly.paid)} · 待收款 {formatMoney(monthly.outstanding)}
        </>
      )}
    />
  );
}
