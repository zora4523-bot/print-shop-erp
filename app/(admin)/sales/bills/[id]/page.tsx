import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { getSalesBillTitleRef } from '@/lib/page-title/refs';
import { getSession } from '@/lib/auth/session';
import { Role } from '@/generated/prisma/enums';
import { getSalesMonthlyBill } from '@/lib/agent-monthly-billing/sales-query';
import { AGENT_MONTHLY_BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { StatusBadge, TableScrollArea } from '@/components/ui-business';
import { buttonVariants } from '@/components/ui/button';

type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props) {
  const session = await getSession();
  if (session?.user.role !== Role.SALES) return { title: '账单' };
  const bill = await getSalesBillTitleRef((await params).id, session.user.id);
  return { title: bill ? `${bill.period} 月账单` : '账单' };
}
export default async function SalesBillDetailPage({ params }: Props) {
  const actor = await requirePermission('bill:view:self');
  const bill = await getSalesMonthlyBill(actor, (await params).id);
  if (!bill) notFound();
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold">{bill.period} 月账单</h1><StatusBadge tone={AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].tone}>{AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].label}</StatusBadge><Link href="/sales/bills" className={buttonVariants({ variant: 'outline' })}>返回账单</Link></div>
    <dl className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
      <div><dt>工单合计</dt><dd>{formatMoney(bill.memberSubtotal)}</dd></div><div><dt>抵扣金额</dt><dd>{formatMoney(bill.adjustmentAmount)}</dd></div><div><dt>应付合计</dt><dd className="font-semibold">{formatMoney(bill.totalAmount)}</dd></div>
      {bill.confirmedAt ? <div><dt>确认时间</dt><dd>{formatDateTimeShanghai(bill.confirmedAt)}</dd></div> : null}
      {bill.paidAt ? <div><dt>结清时间</dt><dd>{formatDateTimeShanghai(bill.paidAt)}</dd></div> : null}
    </dl>
    <TableScrollArea label="月账单工单明细"><table className="w-full text-sm"><thead><tr><th className="p-3 text-left">工单</th><th className="p-3">客户</th><th className="p-3">版本</th><th className="p-3">结算时间</th><th className="p-3 text-right">金额</th></tr></thead><tbody>
      {bill.items.map((item) => <tr key={item.id} className="border-t"><td className="p-3">{item.orderNoSnapshot}</td><td className="p-3">{item.customerRefSnapshot ?? '未填客户'}</td><td className="p-3">{item.workOrderVersionSnapshot}</td><td className="p-3">{formatDateTimeShanghai(item.settledAtSnapshot)}</td><td className="p-3 text-right">{formatMoney(item.settledFeeSnapshot)}</td></tr>)}
    </tbody></table></TableScrollArea>
    {bill.adjustments.length ? <section className="space-y-3"><h2 className="font-semibold">抵扣明细</h2>{bill.adjustments.map((item) => <p key={item.id} className="flex flex-wrap justify-between gap-3"><span>{item.credit.sourceItem.orderNoSnapshot}</span><span>{formatMoney(item.amount)}</span></p>)}</section> : null}
  </div>;
}
