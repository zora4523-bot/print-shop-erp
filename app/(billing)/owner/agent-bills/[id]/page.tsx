import { BillItemsList } from '@/components/business/agent-monthly-billing/BillItemsList';
import { billItemPage } from '@/lib/agent-monthly-billing/item-list';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { buildTableHref } from '@/lib/admin/table';
import Form from 'next/form';
import { Input } from '@/components/ui/input';
import { BillDetailDisclosure } from '@/components/business/agent-monthly-billing/BillDetailDisclosure';
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Decimal from 'decimal.js';
import {
  confirmAgentMonthlyBillAction,
  markAgentMonthlyBillPaidAction,
} from '@/actions/agent-monthly-bill';
import { AgentMonthlyBillStatus } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { getAgentMonthlyBillDetail } from '@/lib/agent-monthly-billing/query';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { formatMoney, formatMoneyDelta } from '@/lib/dashboard/format';
import {
  ConfirmAgentMonthlyBillForm,
  MarkAgentMonthlyBillPaidForm,
} from '@/components/business/agent-monthly-billing/AgentMonthlyBillForms';
import { PageHeader, StatusBadge, EmptyState, FilterClearLink } from '@/components/ui-business';
import { AGENT_MONTHLY_BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { Button, buttonVariants } from '@/components/ui/button';
import { billListReturnHref, billScopedHref } from '@/lib/agent-monthly-billing/presentation';

type PageProps = { params: Promise<{ id: string }>; searchParams?: Promise<{ returnTo?: string | string[]; q?: string | string[]; page?: string | string[] }> };

export default async function AgentMonthlyBillDetailPage({ params, searchParams }: PageProps) {
  await requirePermission('bill:view:all');
  const { id } = await params;
  const search = await searchParams ?? {};
  const returnHref = billListReturnHref(search.returnTo);
  const bill = await getAgentMonthlyBillDetail(id);
  if (!bill) notFound();
  const members = billItemPage(bill.items, search);
  const basePath = `/owner/agent-bills/${bill.id}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${bill.period} · ${bill.agentDisplayNameSnapshot}`}
        subtitle={`账单账号 ${bill.agentUsernameSnapshot} · 工单 ${bill.items.length} 单`}
        back={{ href: returnHref, label: '返回外部销售月账单' }}
        status={
          <StatusBadge
            tone={AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].tone}
            dot={AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].dot}
          >
            {AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].label}
          </StatusBadge>
        }
      />

      <section className="grid gap-4 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-3">
        <Amount label="工单合计" value={String(bill.memberSubtotal)} />
        <Amount label="跨月抵扣" value={String(bill.adjustmentAmount)} />
        <Amount label={bill.status === 'DRAFT' ? '草稿金额（未定稿）' : '账单金额'} value={String(bill.totalAmount)} strong />
        <p className="text-xs text-muted-foreground sm:col-span-3">
          {bill.paidAt
            ? `已于 ${formatDateTimeShanghai(bill.paidAt)} 结清`
            : bill.confirmedAt
              ? `已于 ${formatDateTimeShanghai(bill.confirmedAt)} 确认冻结`
              : '草稿'}
        </p>
      </section>

      {bill.status === AgentMonthlyBillStatus.DRAFT ? (
        <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">对账确认</h2>
          <ConfirmAgentMonthlyBillForm
            submitAction={confirmAgentMonthlyBillAction.bind(null, bill.id)}
            initialIdempotencyKey={randomUUID()}
          />
        </section>
      ) : null}

      {bill.status === AgentMonthlyBillStatus.CONFIRMED ? (
        <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">整单收款</h2>
          <MarkAgentMonthlyBillPaidForm
            submitAction={markAgentMonthlyBillPaidAction.bind(null, bill.id)}
            lockedAmount={new Decimal(bill.totalAmount).toFixed(2)}
            initialIdempotencyKey={randomUUID()}
          />
        </section>
      ) : null}

      {bill.receipt ? (
        <section className="rounded-xl border bg-card p-5 text-sm shadow-sm">
          <h2 className="font-semibold">收款记录</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-4">
            <Fact label="金额" value={formatMoney(bill.receipt.amount)} />
            <Fact label="时间" value={formatDateTimeShanghai(bill.receipt.receivedAt)} />
            <Fact label="方式" value={bill.receipt.paymentMethod ?? '未记录'} />
            <Fact label="流水号" value={bill.receipt.referenceNo ?? '未记录'} />
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="agent-bill-items-title" className="space-y-4">
        <div>
          <h2 id="agent-bill-items-title" className="font-semibold">账单明细</h2>
          <p className="mt-1 text-sm text-muted-foreground">当前匹配 {members.total} / {bill.items.length} 单；上方金额为整张账单合计。</p>
        </div>
        <Form action={basePath} id="agent-bill-item-search" key={members.q} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="returnTo" value={returnHref} />
          <label className="grid gap-1 text-sm">查找账单内工单<Input name="q" type="search" defaultValue={members.q} placeholder="工单名称 / 工单号" maxLength={100} /></label>
          <Button type="submit" variant="outline">搜索</Button>
          {members.q ? <FilterClearLink formId="agent-bill-item-search" href={buildTableHref(basePath, {}, { returnTo: returnHref })} className={buttonVariants({ variant: 'ghost' })}>清除筛选</FilterClearLink> : null}
        </Form>
        {members.rows.length ? <BillItemsList items={members.rows} period={bill.period} billId={bill.id} billStatus={bill.status} returnTo={returnHref} /> : <EmptyState title="未找到匹配的工单" />}
        <AdminPagination basePath={basePath} page={members.page} pageCount={members.pageCount} total={members.total} pageSize={members.pageSize} queryParams={{ q: members.q || undefined, returnTo: returnHref }} />
      </section>

      {bill.adjustments.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">本月抵扣明细</h2>
          <ul className="divide-y text-sm">
            {bill.adjustments.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-3 py-3">
                <span>
                  来源 {row.credit.sourceItem.bill.period} ·{' '}
                  {row.credit.sourceItem.orderNoSnapshot}
                  <BillDetailDisclosure label="查看抵扣来源" title="抵扣来源" description={`${bill.period} 月账单抵扣`}>
                    <p>本账单抵扣 {formatMoneyDelta(row.amount)}</p>
                    <p>来源工单 {row.credit.sourceItem.orderNoSnapshot}</p>
                    <Link href={billScopedHref(`/owner/agent-bills/${row.credit.sourceItem.bill.id}`, returnHref)} className={buttonVariants({ variant: 'outline' })}>{row.credit.sourceItem.bill.period} 月账单</Link>
                  </BillDetailDisclosure>
                </span>
                <strong className="font-sans tabular-nums">
                  {formatMoneyDelta(row.amount)}
                </strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

    </div>
  );
}

function Amount({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${strong ? 'text-xl font-semibold' : 'text-lg'} font-sans tabular-nums`}>
        {formatMoney(value)}
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
