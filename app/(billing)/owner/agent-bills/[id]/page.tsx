import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Decimal from 'decimal.js';
import {
  confirmAgentMonthlyBillAction,
  createAgentMonthlyBillCreditAction,
  markAgentMonthlyBillPaidAction,
} from '@/actions/agent-monthly-bill';
import { AgentMonthlyBillStatus } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { getAgentMonthlyBillDetail } from '@/lib/agent-monthly-billing/query';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { formatMoney } from '@/lib/dashboard/format';
import {
  ConfirmAgentMonthlyBillForm,
  CreateAgentMonthlyBillCreditForm,
  MarkAgentMonthlyBillPaidForm,
} from '@/components/business/agent-monthly-billing/AgentMonthlyBillForms';
import { PageHeader, StatusBadge, TableScrollArea } from '@/components/ui-business';
import { AGENT_MONTHLY_BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';

type PageProps = { params: Promise<{ id: string }> };

export default async function AgentMonthlyBillDetailPage({ params }: PageProps) {
  await requirePermission('bill:view:all');
  const { id } = await params;
  const bill = await getAgentMonthlyBillDetail(id);
  if (!bill) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${bill.period} · ${bill.agentDisplayNameSnapshot}`}
        subtitle={`账单账号 ${bill.agentUsernameSnapshot} · 成员 ${bill.items.length} 单`}
        back={{ href: '/owner/agent-bills', label: '返回代理商月度账单' }}
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
        <Amount label="成员小计" value={String(bill.memberSubtotal)} />
        <Amount label="跨月负项" value={String(bill.adjustmentAmount)} />
        <Amount label="锁定应收" value={String(bill.totalAmount)} strong />
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
          <h2 className="font-semibold">不可变收款回执</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-4">
            <Fact label="金额" value={formatMoney(bill.receipt.amount)} />
            <Fact label="时间" value={formatDateTimeShanghai(bill.receipt.receivedAt)} />
            <Fact label="方式" value={bill.receipt.paymentMethod ?? '未记录'} />
            <Fact label="流水号" value={bill.receipt.referenceNo ?? '未记录'} />
          </dl>
        </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">账单明细</h2>
        </div>
        <TableScrollArea label="月度账单成员" className="rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">工单</th>
                <th className="px-4 py-2 text-left">工单名称</th>
                <th className="px-4 py-2 text-left">状态 / 纸单版本</th>
                <th className="px-4 py-2 text-left">结算时间</th>
                <th className="px-4 py-2 text-right">结算费</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bill.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/orders#wo=${encodeURIComponent(item.orderNoSnapshot)}`}
                      className="font-medium hover:underline"
                    >
                      {item.orderNoSnapshot}
                    </Link>
                    {bill.status !== AgentMonthlyBillStatus.DRAFT ? (
                      <CreateAgentMonthlyBillCreditForm
                        submitAction={createAgentMonthlyBillCreditAction.bind(null, bill.id)}
                        sourceItemId={item.id}
                        sourceAmount={new Decimal(item.settledFeeSnapshot).toFixed(2)}
                        initialIdempotencyKey={randomUUID()}
                      />
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {item.order.customName?.trim() || '未命名工单'}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                    {item.orderStatusSnapshot} · v{item.workOrderVersionSnapshot}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                    {formatDateTimeShanghai(item.settledAtSnapshot)}
                  </td>
                  <td className="px-4 py-3 text-right align-top font-sans tabular-nums">
                    {formatMoney(item.settledFeeSnapshot)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      </section>

      {bill.adjustments.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">本月负项分配</h2>
          <ul className="divide-y text-sm">
            {bill.adjustments.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-3 py-3">
                <span>
                  来源 {row.credit.sourceItem.bill.period} ·{' '}
                  {row.credit.sourceItem.orderNoSnapshot}
                </span>
                <strong className="font-sans tabular-nums text-destructive">
                  {formatMoney(row.amount)}
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
