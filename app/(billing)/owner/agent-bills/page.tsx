import { randomUUID } from 'node:crypto';
import Form from 'next/form';
import Link from 'next/link';
import {
  Banknote,
  FileClock,
  Inbox,
  ReceiptText,
  TriangleAlert,
} from 'lucide-react';
import { AgentMonthlyBillStatus } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { previousShanghaiMonth } from '@/lib/cron/schedule';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import {
  getAgentMonthlyBillingStats,
  listAgentBillAccounts,
  listAgentMonthlyBills,
} from '@/lib/agent-monthly-billing/query';
import { listRecentAgentMonthlyBillExports } from '@/lib/agent-monthly-billing/export';
import { isAgentBillPeriod } from '@/lib/agent-monthly-billing/period';
import { GenerateAgentMonthlyBillsForm } from '@/components/business/agent-monthly-billing/AgentMonthlyBillForms';
import { AgentMonthlyBillExportControls } from '@/components/business/agent-monthly-billing/AgentMonthlyBillExportControls';
import { Button, buttonVariants } from '@/components/ui/button';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import {
  EmptyState,
  PageHeader,
  StatCard,
  StatusBadge,
  TableScrollArea, FilterClearLink } from '@/components/ui-business';
import { formatMoney } from '@/lib/dashboard/format';
import { AGENT_MONTHLY_BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { NativeSelect } from '@/components/ui/native-select';

export const metadata = { title: '代理商月度账单' };

type PageProps = {
  searchParams: Promise<{
    period?: string;
    status?: string;
    agentUserId?: string;
    page?: string;
  }>;
};

function parseStatus(value: string | undefined): AgentMonthlyBillStatus | undefined {
  return value &&
    (Object.values(AgentMonthlyBillStatus) as string[]).includes(value)
    ? (value as AgentMonthlyBillStatus)
    : undefined;
}

function parsePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AgentMonthlyBillsPage({ searchParams }: PageProps) {
  const actor = await requirePermission('bill:view:all');
  const raw = await searchParams;
  const period = raw.period && isAgentBillPeriod(raw.period) ? raw.period : undefined;
  const status = parseStatus(raw.status);
  const agentUserId = raw.agentUserId?.trim() || undefined;
  const page = parsePage(raw.page);
  const [result, stats, accounts, recentExports] = await Promise.all([
    listAgentMonthlyBills({ period, status, agentUserId, page }),
    getAgentMonthlyBillingStats(),
    listAgentBillAccounts(),
    listRecentAgentMonthlyBillExports(actor.id),
  ]);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="代理商月度账单"
        subtitle="按结算月份归集外部销售工单。"
        actions={
          <Link
            href="/owner/bills/archive"
            className={buttonVariants({ variant: 'outline' })}
          >
            历史账单归档
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="待收款"
          value={formatMoney(stats.receivableAmount)}
          icon={Banknote}
          tone="warning"
        />
        <StatCard
          label="待收账单"
          value={`${stats.receivableBillCount} 张`}
          icon={ReceiptText}
          tone="warning"
        />
        <StatCard
          label="未出账已结算工单"
          value={`${stats.unbilledOrderCount} 单`}
          icon={TriangleAlert}
          tone={stats.unbilledOrderCount > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <GenerateAgentMonthlyBillsForm defaultPeriod={previousShanghaiMonth()} />
        <p className="mt-2 text-xs text-muted-foreground">
          仅可选择已结束的月份。
        </p>
      </section>

      {/* next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。 */}
      <Form id="agent-bill-filters" key={JSON.stringify([period ?? '', status ?? '', agentUserId ?? ''])} action="/owner/agent-bills" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>账期</span>
          <input
            name="period"
            type="month"
            defaultValue={period}
            className="block h-9 rounded-md border bg-background px-3 text-sm text-foreground"
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>状态</span>
          <NativeSelect
            name="status"
            defaultValue={status ?? ''}
            className="block w-auto"
          >
            <option value="">全部</option>
            {Object.values(AgentMonthlyBillStatus).map((value) => (
              <option key={value} value={value}>
                {AGENT_MONTHLY_BILL_STATUS_REGISTRY[value].label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="min-w-0 max-w-full basis-full space-y-1 text-xs text-muted-foreground sm:w-auto sm:basis-auto">
          <span>代理商</span>
          <NativeSelect
            name="agentUserId"
            defaultValue={agentUserId ?? ''}
            className="block w-full min-w-0 max-w-full sm:min-w-44"
          >
            <option value="">全部</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName} ({account.username})
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" size="sm">
          筛选
        </Button>
        <FilterClearLink formId="agent-bill-filters"
          href="/owner/agent-bills"
          className={buttonVariants({ size: 'sm', variant: 'ghost' })}
        >
          清除筛选
        </FilterClearLink>
      </Form>

      <AgentMonthlyBillExportControls
        requestKey={randomUUID()}
        filter={{
          ...(period ? { period } : {}),
          ...(status ? { status } : {}),
          ...(agentUserId ? { agentUserId } : {}),
        }}
        filteredTotal={result.total}
        recent={recentExports.map((item) => ({
          ...item,
          expiresAt: item.expiresAt.toISOString(),
          completedAt: item.completedAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
        }))}
      />

      {result.rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="当前筛选下暂无账单"
          description="请选择已结束的月份生成账单。"
        />
      ) : (
        <TableScrollArea
          label="代理商月度账单列表"
          className="min-w-0 max-w-full rounded-xl border bg-card shadow-sm"
        >
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">账期</th>
                <th className="px-4 py-2 text-left">外部销售</th>
                <th className="px-4 py-2 text-right">工单</th>
                <th className="px-4 py-2 text-right">成员小计</th>
                <th className="px-4 py-2 text-right">负项</th>
                <th className="px-4 py-2 text-right">应收</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2 text-left">锁定 / 结清</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.rows.map((bill) => (
                <tr key={bill.id}>
                  <td className="px-4 py-3 font-sans tabular-nums">{bill.period}</td>
                  <td className="px-4 py-3">
                    <div>{bill.agentDisplayNameSnapshot}</div>
                    <div className="text-xs text-muted-foreground">{bill.agentUsernameSnapshot}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">{bill._count.items}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">{formatMoney(bill.memberSubtotal)}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">{formatMoney(bill.adjustmentAmount)}</td>
                  <td className="px-4 py-3 text-right font-sans font-semibold tabular-nums">{formatMoney(bill.totalAmount)}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge
                      tone={AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].tone}
                      dot={AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].dot}
                    >
                      {AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].label}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {bill.paidAt
                      ? `结清 ${formatDateTimeShanghai(bill.paidAt)}`
                      : bill.confirmedAt
                        ? `锁定 ${formatDateTimeShanghai(bill.confirmedAt)}`
                        : '尚未锁定'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/owner/agent-bills/${bill.id}`}
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                    >
                      详情
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      )}

      <AdminPagination
        basePath="/owner/agent-bills"
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        queryParams={{ period: raw.period, status: raw.status, agentUserId: raw.agentUserId }}
      />
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileClock className="size-4" />
        历史账单归档保留原完成时间与部分收款记录，不与本页数字混算。
      </p>
    </div>
  );
}
