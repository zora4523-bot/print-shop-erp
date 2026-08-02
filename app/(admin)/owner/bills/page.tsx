import Decimal from 'decimal.js';
import Link from 'next/link';
import { CalendarRange, Inbox, ReceiptText, Wallet } from 'lucide-react';
import { listBills } from '@/lib/bill';
import { BillStatus } from '@/generated/prisma/enums';
import {
  BILL_STATUS_LABELS,
  ROLE_LABELS,
} from '@/lib/auth/role-labels';
import { Button, buttonVariants } from '@/components/ui/button';
import { GenerateBillsForm } from '@/components/business/bill/GenerateBillsForm';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';
import {
  BILL_STATUS_TO_BADGE,
  EmptyState,
  PageHeader,
  StatCard,
  StatusBadge,
  TableScrollArea,
} from '@/components/ui-business';

export const metadata = { title: '销售应收账单' };

type PageProps = {
  searchParams: Promise<{
    status?: string;
    period?: string;
    salesUserId?: string;
  }>;
};

function currentMonthShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  // en-CA formats as "YYYY-MM"; already the shape we want.
  return parts;
}

function isValidYm(s: string | undefined): s is string {
  if (!s) return false;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return false;
  // listBills -> parseShanghaiMonth rejects month > 12 with a thrown
  // error; catching the throw in the Server Component would only make
  // the page crash silently. Pre-validate range here so a bookmark /
  // hand-edited URL like ?period=2026-13 cleanly falls back to
  // &ldquo;no filter&rdquo; .
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

function isBillStatus(s: string | undefined): s is BillStatus {
  return !!s && (Object.values(BillStatus) as string[]).includes(s);
}

export default async function OwnerBillsPage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('bill:view:all');
  const sp = await searchParams;
  const currentMonth = currentMonthShanghai();

  const periodFilter = isValidYm(sp.period) ? sp.period : undefined;
  const statusFilter = isBillStatus(sp.status) ? sp.status : undefined;
  const salesUserIdFilter =
    sp.salesUserId && sp.salesUserId.trim() ? sp.salesUserId.trim() : undefined;

  const rows = await listBills({
    period: periodFilter,
    status: statusFilter,
    salesUserId: salesUserIdFilter,
  });

  // 已发但未收：status = ISSUED 且 paidAmount = 0；sum totalAmount
  const issuedUnpaid = rows
    .filter(
      (r) =>
        r.status === BillStatus.ISSUED &&
        new Decimal(r.paidAmount as unknown as Decimal.Value).isZero(),
    )
    .reduce(
      (acc, r) =>
        acc.plus(new Decimal(r.totalAmount as unknown as Decimal.Value)),
      new Decimal(0),
    )
    .toFixed(2);

  // 全部未收：ISSUED + PARTIAL_PAID 的 (totalAmount - paidAmount) 合计。
  // DRAFT 未发单不算应收；FULLY_PAID 已结清不算。
  const allUnpaid = rows
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

  // 本月（currentMonth）新生成数：统计 rows 里 period === currentMonth
  // 的条数。若用户已筛选到别的月，这里自然就是 0 —— 可以作为&ldquo;我当前
  // 视图有没有看到本月&rdquo;的提示。
  const currentMonthCount = rows.filter((r) => r.period === currentMonth)
    .length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="销售应收账单"
        subtitle="月初按 Asia/Shanghai 日历月把上月 FINISHED 工单归集给销售 / 客服；每位一条账单，管理员发单后记录付款。"
      />

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <GenerateBillsForm defaultPeriod={currentMonth} />
        <p className="mt-2 text-xs text-muted-foreground">
          重跑选中月份会把新完工订单追加到已有 DRAFT 账单。该月账单一旦发单
          （ISSUED / PARTIAL_PAID / FULLY_PAID）后，生成流程对该条账单会报错，
          不再向其追加任何工单。含义是：凡是在发单那一刻没被归集进 BillItems
          的&ldquo;该月 finishedAt&rdquo;工单——无论是发单前已 FINISHED 但业主没再
          点一次&ldquo;生成 / 追加&rdquo;来拉取，还是发单后才 FINISHED——之后都不会被任何
          月份的生成流程抓到，需业主线下单独处理。因此发单前务必确认：
          (1) 所选周期内所有待入账工单都已 FINISHED，(2) 再点一次&ldquo;生成 /
          追加&rdquo;把最新 FINISHED 订单拉入 DRAFT。
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="已发但未收"
          value={`¥ ${issuedUnpaid}`}
          icon={ReceiptText}
          tone="warning"
        />
        <StatCard
          label="全部未收"
          value={`¥ ${allUnpaid}`}
          icon={Wallet}
          tone="primary"
        />
        <StatCard
          label={`本月（${currentMonth}）新生成数`}
          value={`${currentMonthCount} 条`}
          icon={CalendarRange}
          tone="info"
        />
      </div>

      <FilterBar
        status={statusFilter}
        period={periodFilter}
        salesUserId={salesUserIdFilter}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="当前筛选条件下暂无账单"
          description={
            <>
              若想新建本月账单，先在上方<strong>&ldquo;生成 / 追加月账单&rdquo;</strong>触发。
            </>
          }
        />
      ) : (
        <TableScrollArea
          label="销售应收账单列表"
          className="rounded-xl border bg-card shadow-sm"
        >
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">周期</th>
                <th className="px-4 py-2 text-left">销售 / 客服</th>
                <th className="px-4 py-2 text-left">当前角色</th>
                <th className="px-4 py-2 text-right">总额</th>
                <th className="px-4 py-2 text-right">已收</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2 text-left">发单时间</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-sans tabular-nums text-xs">{r.period}</td>
                  <td className="px-4 py-3">{r.salesUser.displayName}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {ROLE_LABELS[r.salesUser.role] ?? r.salesUser.role}
                  </td>
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
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/owner/bills/${r.id}`}
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

// 账单状态徽章——委托给 ui-business StatusBadge + BILL_STATUS_TO_BADGE map
// 集中色调（与 /sales/bills 共用，避免双份本地定义飘移）。
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
  salesUserId,
}: {
  status: BillStatus | undefined;
  period: string | undefined;
  salesUserId: string | undefined;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <div className="flex flex-col">
        <label htmlFor="owner-bills-status" className="text-xs text-muted-foreground">状态</label>
        <select
          id="owner-bills-status"
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
        <label htmlFor="owner-bills-period" className="text-xs text-muted-foreground">周期</label>
        <input
          id="owner-bills-period"
          type="month"
          name="period"
          defaultValue={period ?? ''}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col">
        <label htmlFor="owner-bills-sales-user" className="text-xs text-muted-foreground">
          销售 / 客服 id (可选)
        </label>
        <input
          id="owner-bills-sales-user"
          type="text"
          name="salesUserId"
          defaultValue={salesUserId ?? ''}
          placeholder="留空=全部"
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <Button type="submit" size="sm">
        筛选
      </Button>
      <Link
        href="/owner/bills"
        className={buttonVariants({ size: 'sm', variant: 'ghost' })}
      >
        清除
      </Link>
    </form>
  );
}
