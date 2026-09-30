import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import Decimal from 'decimal.js';
import { requirePermission } from '@/lib/auth/permissions';
import { getAgentMonthlyBillDetail } from '@/lib/agent-monthly-billing/query';
import { remainingCreditAmount } from '@/lib/agent-monthly-billing/presentation';
import { createAgentMonthlyBillCreditAction } from '@/actions/agent-monthly-bill';
import { CreateAgentMonthlyBillCreditForm } from '@/components/business/agent-monthly-billing/AgentMonthlyBillForms';
import { PageHeader } from '@/components/ui-business';
import { formatMoney } from '@/lib/dashboard/format';

export const metadata = { title: '录入抵扣' };

export default async function CreditPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  await requirePermission('bill:manage');
  const { id, itemId } = await params;
  const bill = await getAgentMonthlyBillDetail(id);
  const item = bill?.items.find((row) => row.id === itemId);
  if (!bill || !item) notFound();
  const remaining = remainingCreditAmount(item.settledFeeSnapshot, item.credits);
  return <div className="mx-auto w-full max-w-3xl space-y-6">
    <PageHeader title="录入抵扣" subtitle={`${bill.period} · ${item.orderNoSnapshot}`} back={{ href: `/owner/agent-bills/${id}`, label: '返回月账单' }} />
    <dl className="grid gap-4 sm:grid-cols-2">
      <div><dt className="text-sm text-muted-foreground">原结算金额</dt><dd>{formatMoney(item.settledFeeSnapshot)}</dd></div>
      <div><dt className="text-sm text-muted-foreground">剩余可抵扣</dt><dd>{formatMoney(remaining)}</dd></div>
    </dl>
    {bill.status === 'DRAFT' ? <p>账单尚未确认，请返回账单核对金额。</p> : new Decimal(remaining).gt(0) ? <CreateAgentMonthlyBillCreditForm
      submitAction={createAgentMonthlyBillCreditAction.bind(null, id)}
      sourceItemId={item.id} sourceAmount={remaining} initialIdempotencyKey={randomUUID()}
    /> : <p>该工单结算金额已全部录入抵扣。</p>}
  </div>;
}
