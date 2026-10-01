import Link from 'next/link';
import { readBillSettlementDetail } from '@/lib/agent-monthly-billing/settlement-detail';
import Decimal from 'decimal.js';
import { BillDetailDisclosure } from './BillDetailDisclosure';
import { OrderStatusSnapshotBadge } from './OrderStatusSnapshotBadge';
import { formatMoney, formatMoneyDelta } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { buttonVariants } from '@/components/ui/button';
import { billScopedHref, creditAllocationSummary } from '@/lib/agent-monthly-billing/presentation';

type Credit = {
  id: string; requestedAmount: Decimal.Value; createdAt: Date;
  allocations: Array<{ id: string; amount: Decimal.Value; bill: { id: string; period: string; status: string } }>;
};
export function BillItemEvidence({ item, period, sales = false, returnTo }: {
  item: {
    orderId: string; orderNoSnapshot: string; workOrderVersionSnapshot: number;
    orderStatusSnapshot: string; settledFeeSnapshot: Decimal.Value; settledAtSnapshot: Date;
    credits: Credit[]; settlementDetailSnapshot?: unknown;
  };
  period: string; sales?: boolean;
  /** List scope to carry onto linked bills; re-sanitized by billScopedHref. */
  returnTo?: string;
}) {
  const detail = readBillSettlementDetail(item.settlementDetailSnapshot, item.settledFeeSnapshot);
  const base = sales ? '/sales/bills' : '/owner/agent-bills';
  return <BillDetailDisclosure label={`查看 ${item.orderNoSnapshot} 明细`} triggerText={item.orderNoSnapshot} title={item.orderNoSnapshot} description={`${period} 账单中的结算记录`}>
    <dl className="grid grid-cols-2 gap-4">
      <div><dt className="text-muted-foreground">结算工单金额</dt><dd className="font-semibold tabular-nums">{formatMoney(item.settledFeeSnapshot)}</dd></div>
      <div><dt className="text-muted-foreground">结算时间</dt><dd>{formatDateTimeShanghai(item.settledAtSnapshot)}</dd></div>
      <div><dt className="text-muted-foreground">结算时状态</dt><dd><OrderStatusSnapshotBadge snapshot={item.orderStatusSnapshot} /></dd></div>
      <div><dt className="text-muted-foreground">结算时纸单版本</dt><dd>v{item.workOrderVersionSnapshot}</dd></div>
    </dl>
    <section className="space-y-3">
      <h3 className="font-semibold">结算费用明细</h3>
      {detail ? <dl className="space-y-2">
        <div className="flex justify-between gap-4"><dt>加工费</dt><dd className="tabular-nums">{formatMoney(detail.processingAmount)}</dd></div>
        {detail.charges.map((charge, index) => <div key={index} className="flex justify-between gap-4"><dt>{charge.description}</dt><dd className="shrink-0 tabular-nums">{formatMoney(charge.amount)}</dd></div>)}
      </dl> : <p className="text-muted-foreground">该账单未保留完整费用分项，请按结算总额核对。</p>}
    </section>
    {item.credits.length > 0 ? <section className="space-y-3">
      <h3 className="font-semibold">该工单的抵扣与补收记录</h3>
      <ul className="divide-y">{item.credits.map((credit) => {
        const summary = creditAllocationSummary(credit);
        return <li key={credit.id} className="space-y-2 py-3">
          <p>录入{summary.kind} {formatMoney(summary.requested)} · {formatDateTimeShanghai(credit.createdAt)}</p>
          <p className="text-muted-foreground">已{summary.kind} {formatMoney(summary.confirmed)}{new Decimal(summary.pending).gt(0) ? <> · 暂计{summary.kind}（账单整理中） {formatMoney(summary.pending)}</> : null} · 待{summary.kind} {formatMoney(summary.remaining)}</p>
          <ul className="space-y-1">{credit.allocations.map((row) => <li key={row.id}>
            <Link href={billScopedHref(`${base}/${row.bill.id}`, returnTo, sales)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{row.bill.period} {sales ? '货款账单' : '月账单'}{row.bill.status === 'DRAFT' ? '（整理中）' : ''} · {formatMoneyDelta(row.amount)}</Link>
          </li>)}</ul>
        </li>;
      })}</ul>
    </section> : null}
    <Link href={`/orders/${item.orderId}`} className={buttonVariants({ variant: 'outline' })}>查看当前工单</Link>
  </BillDetailDisclosure>;
}
