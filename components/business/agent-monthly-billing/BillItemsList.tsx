import type { ComponentProps } from 'react';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { BillItemEvidence } from './BillItemEvidence';
import { BillItemName } from './BillItemName';
import { OrderStatusSnapshotBadge } from './OrderStatusSnapshotBadge';
import { remainingCreditAmount } from '@/lib/agent-monthly-billing/presentation';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateShanghai } from '@/lib/format/dates';
import { buttonVariants } from '@/components/ui/button';
import { TableScrollArea } from '@/components/ui-business';

type Item = ComponentProps<typeof BillItemEvidence>['item'] & {
  id: string;
  order: { customName: string | null };
};

type Props = { items: Item[]; period: string; sales?: boolean; billId: string; billStatus: string };

export function BillItemsList({ items, period, sales = false, billId, billStatus }: Props) {
  return <TableScrollArea label="月账单工单明细" className="md:rounded-xl md:border md:bg-card">
    <table className="block w-full text-sm md:table md:min-w-[40rem]">
      <thead className="sr-only border-b bg-muted/40 text-muted-foreground md:not-sr-only md:table-header-group"><tr>
        <th className="p-3 text-left">工单号</th><th className="p-3 text-left">工单名称</th><th className="p-3 text-left">结算日期</th><th className="p-3 text-right">{sales ? '工单金额' : '结算金额'}</th><th className="p-3 text-left">状态</th>
      </tr></thead>
      <tbody className="grid gap-3 md:table-row-group md:divide-y">
        {items.map((item) => <tr key={item.id} className="grid min-w-0 grid-cols-2 gap-3 rounded-xl border bg-card p-4 md:table-row md:rounded-none md:border-0 md:p-0">
          <td className="col-span-2 row-start-2 min-w-0 md:p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><BillItemEvidence item={item} period={period} sales={sales} />
              {!sales && billStatus !== 'DRAFT' && new Decimal(remainingCreditAmount(item.settledFeeSnapshot, item.credits)).gt(0) ? <Link href={`/owner/agent-bills/${billId}/credits/${item.id}/new`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>录入抵扣</Link> : null}
            </div>
          </td>
          <td className="admin-wrap-anywhere col-start-1 row-start-1 min-w-0 font-medium md:p-3 md:font-normal"><BillItemName item={item} /></td>
          <td className="col-start-1 row-start-3 text-xs text-muted-foreground md:whitespace-nowrap md:p-3 md:text-sm md:text-foreground"><span className="mr-1 md:hidden">结算</span>{formatDateShanghai(item.settledAtSnapshot)}</td>
          <td className="col-start-2 row-start-1 text-right font-semibold tabular-nums md:whitespace-nowrap md:p-3 md:font-medium">{formatMoney(item.settledFeeSnapshot)}</td>
          <td className="col-start-2 row-start-3 min-w-0 text-right md:p-3 md:text-left"><OrderStatusSnapshotBadge snapshot={item.orderStatusSnapshot} /></td>
        </tr>)}
      </tbody>
    </table>
  </TableScrollArea>;
}
