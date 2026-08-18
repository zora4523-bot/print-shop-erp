import Decimal from 'decimal.js';
import Link from 'next/link';
import { CheckCircle2, Inbox, Wallet } from 'lucide-react';
import { listBills } from '@/lib/bill';
import { BillStatus } from '@/generated/prisma/enums';
import { BILL_STATUS_LABELS } from '@/lib/auth/role-labels';
import { Button, buttonVariants } from '@/components/ui/button';
import { requirePermission } from '@/lib/auth/permissions';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import {
  BILL_STATUS_TO_BADGE,
  EmptyState,
  PageHeader,
  StatCard,
  StatusBadge,
  TableScrollArea,
} from '@/components/ui-business';

export const metadata = { title: '我的对客应付账单' };

type PageProps = {
  searchParams: Promise<{ status?: string; period?: string }>;
};

function isValidYm(s: string | undefined): s is string {
  if (!s) return false;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return false;
  // 与 /owner/bills 一致：listBills -> parseShanghaiMonth 在月份越界
  // 时会抛错，预先做 1-12 范围校验避免页面崩。
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

function isBillStatus(s: string | undefined): s is BillStatus {
  return !!s && (Object.values(BillStatus) as string[]).includes(s);
}

export default async function SalesBillsPage({ searchParams }: PageProps) {
  // 权限闸：layout 已挡过非外部 SALES，这里再锁一次
  // bill:view:self（同时确认了用户身份用于 self 过滤）。CLAUDE.md §4.6
  // 双保险。
  const user = await requirePermission('bill:view:self');
  const sp = await searchParams;

  const periodFilter = isValidYm(sp.period) ? sp.period : undefined;
  const statusFilter = isBillStatus(sp.status) ? sp.status : undefined;

  // **关键**：硬编码 salesUserId = 当前用户 id，禁止 query 越权。
  const rows = await listBills({
    salesUserId: user.id,
    period: periodFilter,
    status: statusFilter,
  });

  // 自己的账单，统计两张牌足够：未结清总额 + 已结清总额。
  const unpaidTotal = rows
    .filter(
      (r) =>
        r.status === BillStatus.ISSUED ||
        r.status === BillStatus.PARTIAL_PAID,
    )
    .reduce((acc, r) => {
      const total = new Decimal(r.totalAmount as unknown as Decimal.Value);
      const paid = new Decimal(r.paidAmount as unknown as Decimal.Value);
      return acc.plus(total.minus(paid));
    }, new Decimal(0))
    .toFixed(2);

  const fullyPaidTotal = rows
    .filter((r) => r.status === BillStatus.FULLY_PAID)
    .reduce(
      (acc, r) => acc.plus(new Decimal(r.totalAmount as unknown as Decimal.Value)),
      new Decimal(0),
    )
    .toFixed(2);

  return (
    <div className="space-y-6">
      <PageHeader
        title="我的对客应付账单"
        subtitle="这里展示外部销售工单应付工厂的加工费、快递费、打包耗材费及其他对客收费。管理员负责出账并登记付款，销售端只读查看结算进度。"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="待支付"
          value={`¥ ${unpaidTotal}`}
          icon={Wallet}
          tone="warning"
          hint="已出账与部分支付账单的待支付余额"
        />
        <StatCard
          label="已结清"
          value={`¥ ${fullyPaidTotal}`}
          icon={CheckCircle2}
          tone="success"
          hint="已结清账单总额累计"
        />
      </div>

      <FilterBar status={statusFilter} period={periodFilter} />

      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="当前筛选条件下暂无账单"
          description="月初管理员生成后会出现在这里。"
        />
      ) : (
        <TableScrollArea
          label="我的对客应付账单列表"
          className="rounded-xl border bg-card shadow-sm"
        >
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">周期</th>
                <th className="px-4 py-2 text-right">总额</th>
                <th className="px-4 py-2 text-right">已支付</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2 text-left">发单时间</th>
                <th className="px-4 py-2 text-left">结清时间</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-sans tabular-nums text-xs">{r.period}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥ {String(r.totalAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    ¥ {String(r.paidAmount)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <BillStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDateTimeShanghai(r.issuedAt)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDateTimeShanghai(r.paidAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/sales/bills/${r.id}`}
                      className={buttonVariants({
                        size: 'sm',
                        variant: 'outline',
                      })}
                    >
                      详情 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      )}
    </div>
  );
}

function BillStatusBadge({ status }: { status: BillStatus }) {
  const cfg = BILL_STATUS_TO_BADGE[status];
  if (!cfg) return <StatusBadge tone="neutral">{status}</StatusBadge>;
  return (
    <StatusBadge tone={cfg.tone} dot={cfg.dot}>
      {cfg.label}
    </StatusBadge>
  );
}

function FilterBar({
  status,
  period,
}: {
  status: BillStatus | undefined;
  period: string | undefined;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <div className="flex flex-col">
        <label htmlFor="sales-bills-status" className="text-xs text-muted-foreground">状态</label>
        <select
          id="sales-bills-status"
          name="status"
          defaultValue={status ?? ''}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        >
          <option value="">全部</option>
          {Object.values(BillStatus).map((s) => (
            <option key={s} value={s}>
              {BILL_STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label htmlFor="sales-bills-period" className="text-xs text-muted-foreground">周期</label>
        <input
          id="sales-bills-period"
          type="month"
          name="period"
          defaultValue={period ?? ''}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <Button type="submit" size="sm">
        筛选
      </Button>
      <Link
        href="/sales/bills"
        className={buttonVariants({ size: 'sm', variant: 'ghost' })}
      >
        清除
      </Link>
    </form>
  );
}
