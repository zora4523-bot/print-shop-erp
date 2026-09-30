import Link from 'next/link';
import Decimal from 'decimal.js';
import { BillDetailDisclosure } from './BillDetailDisclosure';
import { OrderStatusSnapshotBadge } from './OrderStatusSnapshotBadge';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { buttonVariants } from '@/components/ui/button';

type Credit = {
  id: string; requestedAmount: Decimal.Value; createdAt: Date;
  allocations: Array<{ id: string; amount: Decimal.Value; bill: { id: string; period: string } }>;
};
export function BillItemEvidence({ item, period, sales = false }: {
  item: {
    orderId: string; orderNoSnapshot: string; workOrderVersionSnapshot: number;
    orderStatusSnapshot: string; settledFeeSnapshot: Decimal.Value; settledAtSnapshot: Date;
    credits: Credit[];
  };
  period: string; sales?: boolean;
}) {
  const base = sales ? '/sales/bills' : '/owner/agent-bills';
  return <BillDetailDisclosure label={`查看 ${item.orderNoSnapshot} 明细`} title={item.orderNoSnapshot} description={`${period} 账单中的结算记录`}>
    <dl className="grid grid-cols-2 gap-4">
      <div><dt className="text-muted-foreground">结算金额</dt><dd className="font-semibold tabular-nums">{formatMoney(item.settledFeeSnapshot)}</dd></div>
      <div><dt className="text-muted-foreground">结算时间</dt><dd>{formatDateTimeShanghai(item.settledAtSnapshot)}</dd></div>
      <div><dt className="text-muted-foreground">结算时状态</dt><dd><OrderStatusSnapshotBadge snapshot={item.orderStatusSnapshot} /></dd></div>
      <div><dt className="text-muted-foreground">结算时纸单版本</dt><dd>v{item.workOrderVersionSnapshot}</dd></div>
    </dl>
    {item.credits.length > 0 ? <section className="space-y-3">
      <h3 className="font-semibold">该工单的抵扣记录</h3>
      <ul className="divide-y">{item.credits.map((credit) => {
        const allocated = credit.allocations.reduce((sum, row) => sum.plus(row.amount), new Decimal(0)).abs();
        const remaining = new Decimal(credit.requestedAmount).abs().minus(allocated);
        return <li key={credit.id} className="space-y-2 py-3">
          <p>录入 {formatMoney(new Decimal(credit.requestedAmount).abs())} · {formatDateTimeShanghai(credit.createdAt)}</p>
          <p className="text-muted-foreground">已抵扣 {formatMoney(allocated)} · 待抵扣 {formatMoney(remaining)}</p>
          <ul className="space-y-1">{credit.allocations.map((row) => <li key={row.id}>
            <Link href={`${base}/${row.bill.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{row.bill.period} 月账单 · {formatMoney(row.amount)}</Link>
          </li>)}</ul>
        </li>;
      })}</ul>
    </section> : null}
    <Link href={`/orders/${item.orderId}`} className={buttonVariants({ variant: 'outline' })}>查看当前工单</Link>
  </BillDetailDisclosure>;
}
