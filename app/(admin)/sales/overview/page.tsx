import Link from 'next/link';
import { ArrowRight, ClipboardList, Wallet } from 'lucide-react';
import { requirePermission } from '@/lib/auth/permissions';
import { listSalesMonthlyBills } from '@/lib/agent-monthly-billing/sales-query';
import { getSalesOrderListSummary, listSalesOrdersPage } from '@/lib/order/sales-list-query';
import { parseOrderListQuery } from '@/lib/order/list-query';
import { formatMoney } from '@/lib/dashboard/format';
import { SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY as statusRegistry } from '@/lib/ui/status-registry';
import { salesOrderAmountPresentation } from '@/lib/order/sales-list-presentation';
import { SalesOrderStatusBadge } from '@/components/business/order/SalesOrderStatusBadge';
import { SalesBillOverview } from '@/components/business/agent-monthly-billing/SalesBillOverview';
import { PageHeader, StatCard, EmptyState } from '@/components/ui-business';
import { buttonVariants } from '@/components/ui/button';

export const metadata = { title: '我的总览' };

export default async function SalesOverviewPage() {
  const actor = await requirePermission('bill:view:self');
  const [orders, followUp, bills] = await Promise.all([
    getSalesOrderListSummary(actor),
    listSalesOrdersPage(actor, parseOrderListQuery({ view: 'todo' }).query),
    listSalesMonthlyBills(actor),
  ]);
  const orderCards = [
    { label: '需关注', value: orders.todo, href: '/orders?view=todo', hint: '驳回、暂停、待核价及申请被拒', tone: 'warning' as const },
    { label: '进行中', value: orders.doing, href: '/orders?view=doing', hint: '已提交、生产及待发货工单', tone: 'info' as const },
    { label: '已发货', value: orders.shipped, href: '/orders?view=shipped', hint: '包含已结算工单', tone: 'success' as const },
    { label: '草稿', value: orders.draft, href: '/orders?view=draft', hint: '尚未提交的工单', tone: 'neutral' as const },
  ];
  return (
    <div className="min-w-0 space-y-8">
      <PageHeader title="我的总览" subtitle="查看自己的工单进度与月账单。" actions={<>
        <Link href="/workbench" className={buttonVariants({ variant: 'outline' })}>报价工作台</Link>
        <Link href="/orders/new" className={buttonVariants()}>新建工单</Link>
      </>} />
      <section aria-labelledby="sales-orders-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sales-orders-heading" className="text-lg font-semibold">工单进度</h2>
          <Link href="/orders" className={buttonVariants({ variant: 'ghost' })}>全部工单 {orders.all} 张<ArrowRight aria-hidden className="size-4" /></Link>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {orderCards.map((card) => <Link key={card.href} href={card.href} className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
            <StatCard label={card.label} value={`${card.value} 张`} hint={card.hint} tone={card.tone} className="h-full w-full hover:bg-muted" />
          </Link>)}
        </div>
      </section>
      <section aria-labelledby="sales-payment-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sales-payment-heading" className="text-lg font-semibold">应付工厂货款</h2>
          <Link href="/sales/bills" className={buttonVariants({ variant: 'ghost' })}>查看全部账单<ArrowRight aria-hidden className="size-4" /></Link>
        </div>
        <p className="text-sm text-muted-foreground">全部账期。您应付给工厂的货款，按结算月份生成月账单。</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/sales/bills?status=CONFIRMED" className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
            <StatCard label={statusRegistry.CONFIRMED.label} value={formatMoney(bills.summary.CONFIRMED.amount)} hint={`${bills.summary.CONFIRMED.count} 张账单`} icon={Wallet} tone="warning" className="h-full w-full hover:bg-muted" />
          </Link>
          <Link href="/sales/bills?status=DRAFT" className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
            <StatCard label={statusRegistry.DRAFT.label} value={formatMoney(bills.summary.DRAFT.amount)} hint={`${bills.summary.DRAFT.count} 张账单 · 金额未定稿`} icon={ClipboardList} tone="neutral" className="h-full w-full hover:bg-muted" />
          </Link>
          <Link href="/sales/bills?status=PAID" className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
            <StatCard label={statusRegistry.PAID.label} value={formatMoney(bills.summary.PAID.amount)} hint={`${bills.summary.PAID.count} 张账单`} tone="success" className="h-full w-full hover:bg-muted" />
          </Link>
        </div>
        <SalesBillOverview months={bills.trend} />
      </section>
      <section aria-labelledby="sales-follow-up-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sales-follow-up-heading" className="text-lg font-semibold">需跟进工单</h2>
          {orders.todo > 0 ? <Link href="/orders?view=todo" className={buttonVariants({ variant: 'ghost' })}>查看全部需关注<ArrowRight aria-hidden className="size-4" /></Link> : null}
        </div>
        {followUp.rows.length === 0 ? <EmptyState title="暂无需关注工单" /> : <ul className="divide-y rounded-xl border bg-card px-4">
          {followUp.rows.slice(0, 5).map((order) => <li key={order.id} className="flex min-w-0 flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1 basis-48">
              <Link href={`/orders/${order.id}`} className="admin-wrap-anywhere inline-flex min-h-11 items-center font-medium underline underline-offset-4">{order.customName || order.orderNo}</Link>
              <p className="admin-wrap-anywhere text-sm text-muted-foreground">{order.orderNo}</p>
            </div>
            <SalesOrderStatusBadge status={order.status} />
            <span className="text-sm tabular-nums">{salesOrderAmountPresentation(order).label}{salesOrderAmountPresentation(order).estimated ? '（估）' : ''}{!salesOrderAmountPresentation(order).pending && order.feeLines.some((line) => line.amount === null) ? ' · 不含待定' : ''}</span>
          </li>)}
        </ul>}
      </section>
    </div>
  );
}
