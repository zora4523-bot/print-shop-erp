import { BillItemName } from '@/components/business/agent-monthly-billing/BillItemName';
import { BillItemEvidence } from '@/components/business/agent-monthly-billing/BillItemEvidence';
import { BillDetailDisclosure } from '@/components/business/agent-monthly-billing/BillDetailDisclosure';
import Link from 'next/link';
import Form from 'next/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { billItemPage } from '@/lib/agent-monthly-billing/item-list';
import { buildTableHref } from '@/lib/admin/table';
import { billListReturnHref } from '@/lib/agent-monthly-billing/presentation';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { getSalesBillTitleRef } from '@/lib/page-title/refs';
import { getSession } from '@/lib/auth/session';
import { Role } from '@/generated/prisma/enums';
import { getSalesMonthlyBill } from '@/lib/agent-monthly-billing/sales-query';
import { SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { PageHeader, StatusBadge, TableScrollArea, EmptyState, FilterClearLink } from '@/components/ui-business';
import { OrderStatusSnapshotBadge } from '@/components/business/agent-monthly-billing/OrderStatusSnapshotBadge';

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ returnTo?: string | string[]; q?: string | string[]; page?: string | string[] }> };
export async function generateMetadata({ params }: Props) {
  const session = await getSession();
  if (session?.user.role !== Role.SALES) return { title: '我的对客应付账单' };
  const bill = await getSalesBillTitleRef((await params).id, session.user.id);
  return { title: bill ? `${bill.period} 月账单 · 我的对客应付账单` : '我的对客应付账单' };
}
export default async function SalesBillDetailPage({ params, searchParams }: Props) {
  const actor = await requirePermission('bill:view:self');
  const bill = await getSalesMonthlyBill(actor, (await params).id);
  if (!bill) notFound();
  const search = await searchParams ?? {};
  const members = billItemPage(bill.items, search);
  const returnTo = billListReturnHref(search.returnTo, true);
  const basePath = `/sales/bills/${bill.id}`;
  return <div className="space-y-6">
    <PageHeader
      title={`${bill.period} 月账单`}
      back={{ href: returnTo, label: '返回我的对客应付账单' }}
      status={<StatusBadge tone={SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].tone}>{SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY[bill.status].label}</StatusBadge>}
    />
    {bill.status === 'DRAFT' ? <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">本月账单仍在整理中，金额未定稿；以管理员确认后的金额为准。</p> : null}
    <dl className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
      <div><dt>工单合计</dt><dd>{formatMoney(bill.memberSubtotal)}</dd></div><div><dt>抵扣金额</dt><dd>{formatMoney(bill.adjustmentAmount)}</dd></div><div><dt>{bill.status === 'DRAFT' ? '暂计金额' : '应付合计'}</dt><dd className="font-semibold">{formatMoney(bill.totalAmount)}</dd></div>
      {bill.confirmedAt ? <div><dt>确认时间</dt><dd>{formatDateTimeShanghai(bill.confirmedAt)}</dd></div> : null}
      {bill.paidAt ? <div><dt>结清时间</dt><dd>{formatDateTimeShanghai(bill.paidAt)}</dd></div> : null}
    </dl>
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">收款记录</h2>
      {bill.receipt ? <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt>金额</dt><dd>{formatMoney(bill.receipt.amount)}</dd></div>
        <div><dt>收款时间</dt><dd>{formatDateTimeShanghai(bill.receipt.receivedAt)}</dd></div>
        <div><dt>收款方式</dt><dd className="break-words">{bill.receipt.paymentMethod ?? '未记录'}</dd></div>
        <div><dt>流水号</dt><dd className="break-all">{bill.receipt.referenceNo ?? '未记录'}</dd></div>
      </dl> : <p className="text-sm text-muted-foreground">暂无收款记录</p>}
    </section>
    <Form action={basePath} id="bill-item-search" key={members.q} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="grid gap-1 text-sm">查找账单内工单<Input name="q" type="search" defaultValue={members.q} placeholder="工单名称 / 工单号" maxLength={100} /></label>
      <Button type="submit" variant="outline">搜索</Button>
      {members.q ? <FilterClearLink formId="bill-item-search" href={buildTableHref(basePath, {}, { returnTo })} className={buttonVariants({ variant: 'ghost' })}>清除筛选</FilterClearLink> : null}
    </Form>
    {members.rows.length === 0 ? <EmptyState title="未找到匹配的工单" /> : <TableScrollArea label="月账单工单明细"><table className="w-full min-w-[48rem] text-sm"><thead><tr><th className="p-3 text-left">工单</th><th className="p-3">工单名称</th><th className="p-3">结算状态</th><th className="p-3">版本</th><th className="p-3">结算时间</th><th className="p-3 text-right">金额</th></tr></thead><tbody>
      {members.rows.map((item) => <tr key={item.id} className="border-t"><td className="p-3"><Link href={`/orders/${item.orderId}`} className="text-primary underline underline-offset-4">{item.orderNoSnapshot}</Link><div className="mt-2"><BillItemEvidence item={item} period={bill.period} sales /></div></td><td className="p-3"><BillItemName item={item} /></td><td className="p-3"><OrderStatusSnapshotBadge snapshot={item.orderStatusSnapshot} /></td><td className="p-3">{item.workOrderVersionSnapshot}</td><td className="p-3">{formatDateTimeShanghai(item.settledAtSnapshot)}</td><td className="p-3 text-right">{formatMoney(item.settledFeeSnapshot)}</td></tr>)}
    </tbody></table></TableScrollArea>}
    <AdminPagination basePath={basePath} page={members.page} pageCount={members.pageCount} total={members.total} pageSize={members.pageSize} queryParams={{ q: members.q || undefined, returnTo }} />
    {bill.adjustments.length ? <section className="space-y-3"><h2 className="font-semibold">抵扣明细</h2>{bill.adjustments.map((item) => <p key={item.id} className="flex flex-wrap justify-between gap-3"><span>{item.credit.sourceItem.orderNoSnapshot}<BillDetailDisclosure label="查看抵扣来源" title="抵扣来源" description={`${bill.period} 月账单抵扣`}>
        <p>本账单抵扣 {formatMoney(item.amount)}</p>
        <p>来源工单 {item.credit.sourceItem.orderNoSnapshot}</p>
        <Link href={`/sales/bills/${item.credit.sourceItem.bill.id}`} className={buttonVariants({ variant: 'outline' })}>{item.credit.sourceItem.bill.period} 月账单</Link>
      </BillDetailDisclosure></span><span>{formatMoney(item.amount)}</span></p>)}</section> : null}
  </div>;
}
