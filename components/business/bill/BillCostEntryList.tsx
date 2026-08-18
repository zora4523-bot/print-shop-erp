import Decimal from 'decimal.js';
import Link from 'next/link';
import { OrderCostCategory } from '@/generated/prisma/enums';
import { Badge } from '@/components/ui/badge';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { listOrderCostEntryDetails } from '@/lib/bill/costing';

import { formatMoney } from '@/lib/dashboard/format';
type CostOrder = Parameters<typeof listOrderCostEntryDetails>[0];

export function BillCostEntryList({
  items,
}: {
  items: Array<{ order: CostOrder }>;
}) {
  const rows = items.flatMap((item) =>
    listOrderCostEntryDetails(item.order),
  );
  const includedTotal = rows.reduce(
    (sum, row) =>
      row.includedInCostTotal
        ? sum.plus(new Decimal(row.entry.amount))
        : sum,
    new Decimal(0),
  );

  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <div className="border-b px-4 py-3 sm:px-6">
        <h2 className="text-base font-semibold">补录成本流水（含售后重做）</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          原单与关联重做单均在此列出；已有自动生产流水的历史计件、外协记录仅供审计，
          不会重复计入成本。
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
          暂无材料、物流、伙食、电费等补录成本。
        </p>
      ) : (
        <>
          <ul className="divide-y text-sm">
            {rows.map((row) => (
              <li
                key={row.entry.id}
                className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[minmax(150px,auto)_90px_minmax(0,1fr)_auto] sm:px-6"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    href={`/orders/${row.sourceOrderId}`}
                    className="admin-wrap-anywhere font-sans tabular-nums text-primary underline"
                  >
                    {row.sourceOrderNo}
                  </Link>
                  <Badge variant="outline">
                    {row.source === 'rework' ? '重做单' : '原单'}
                  </Badge>
                </div>
                <span>{COST_LABELS[row.entry.category]}</span>
                <div className="admin-wrap-anywhere">
                  <p>
                    {row.entry.description}
                    {row.entry.quantity
                      ? ` · ${String(row.entry.quantity)} ${row.entry.unit ?? ''}`
                      : ''}
                    {row.entry.unitPrice
                      ? ` × ¥ ${String(row.entry.unitPrice)}`
                      : ''}
                    {row.includedInCostTotal
                      ? ''
                      : ' · 已有自动流水，未重复计入合计'}
                  </p>
                  {row.entry.remark ? (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      备注：{row.entry.remark}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    录入人：{row.entry.createdBy.displayName} ·{' '}
                    {formatDateTimeShanghai(row.entry.createdAt)}
                  </p>
                </div>
                <span className="font-sans tabular-nums">
                  {formatMoney(row.entry.amount)}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t px-4 py-3 text-right text-xs text-muted-foreground sm:px-6">
            本区已计入成本合计：
            <span className="font-sans font-medium tabular-nums text-foreground">
              ¥ {includedTotal.toFixed(2)}
            </span>
          </p>
        </>
      )}
    </section>
  );
}

const COST_LABELS: Record<OrderCostCategory, string> = {
  [OrderCostCategory.MATERIAL]: '材料',
  [OrderCostCategory.PIECEWORK]: '计件',
  [OrderCostCategory.SETUP]: '装板',
  [OrderCostCategory.OUTSOURCE]: '外协',
  [OrderCostCategory.SHIPPING]: '物流',
  [OrderCostCategory.MEAL]: '伙食',
  [OrderCostCategory.ELECTRICITY]: '电费',
  [OrderCostCategory.CUSTOM]: '其他',
  [OrderCostCategory.ADJUSTMENT]: '调整',
};
