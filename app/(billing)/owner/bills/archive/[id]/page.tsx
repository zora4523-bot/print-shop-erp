import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { getAdminBillDetail } from '@/lib/bill';
import { formatMoney } from '@/lib/dashboard/format';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { buttonVariants } from '@/components/ui/button';
import { TableEmptyState, TableScrollArea, ReceiptNotice } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';
import { BillStatusBadge } from '@/components/business/bill/BillStatusBadge';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyBillArchiveDetailPage({ params, searchParams }: PageProps) {
  await requirePermission('bill:view:all');
  const { id } = await params;
  const bill = await getAdminBillDetail(id);
  if (!bill) notFound();
  const receipt = readReceipt(await searchParams);

  return (
    <div className="space-y-6">
      <ReceiptNotice receipt={receipt} messages={{ issued: () => ({ title: '账单已出账', description: '账单已发出，进入应收跟进。' }) }} />
      <div>
        <Link href="/owner/bills/archive" className="text-sm text-muted-foreground hover:underline">
          ← 历史账单
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {bill.period} · #{bill.sequence} · {bill.salesUser.displayName}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <BillStatusBadge status={bill.status} />
          <span>
            发单 {formatDateTimeShanghai(bill.issuedAt)} · 结清{' '}
            {formatDateTimeShanghai(bill.paidAt)}
          </span>
        </p>
      </div>
      <section className="grid gap-4 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-3">
        <Amount label="历史总额" value={String(bill.totalAmount)} />
        <Amount label="历史已收" value={String(bill.paidAmount)} />
        <Amount label="期初 / 手工差额" value={String(bill.openingAmount)} />
      </section>
      <TableScrollArea label="Legacy 账单成员" className="rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">工单</th>
              <th className="px-4 py-2 text-left">工单名称</th>
              <th className="px-4 py-2 text-left">finishedAt</th>
              <th className="px-4 py-2 text-right">历史成员金额</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {bill.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <Link href={`/orders/${item.orderId}`} className="font-medium hover:underline">
                    {item.order.orderNo}
                  </Link>
                </td>
                <td className="px-4 py-3">{item.order.customName?.trim() || '未命名工单'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTimeShanghai(item.order.finishedAt)}</td>
                <td className="px-4 py-3 text-right font-sans tabular-nums">{formatMoney(item.orderAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">历史收款记录</h2>
        {bill.payments.length === 0 ? (
          <TableEmptyState
            variant="compact"
            title="暂无收款流水"
            className="mt-3"
          />
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {bill.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap justify-between gap-3 py-3">
                <span>{formatDateTimeShanghai(payment.paidAt)} · {payment.paymentMethod ?? '未记录方式'}</span>
                <strong className="font-sans tabular-nums">{formatMoney(payment.amount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href="/owner/bills/archive" className={buttonVariants({ variant: 'outline' })}>
        返回归档列表
      </Link>
    </div>
  );
}

function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-sans text-lg tabular-nums">{formatMoney(value)}</p>
    </div>
  );
}
