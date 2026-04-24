import Decimal from 'decimal.js';
import Link from 'next/link';
import { listBills } from '@/lib/bill';
import { BillStatus } from '@/generated/prisma/enums';
import {
  BILL_STATUS_LABELS,
  ROLE_LABELS,
} from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { GenerateBillsForm } from '@/components/business/bill/GenerateBillsForm';

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

function formatDateTime(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function isValidYm(s: string | undefined): s is string {
  if (!s) return false;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return false;
  // listBills -> parseShanghaiMonth rejects month > 12 with a thrown
  // error; catching the throw in the Server Component would only make
  // the page crash silently. Pre-validate range here so a bookmark /
  // hand-edited URL like ?period=2026-13 cleanly falls back to
  // &ldquo;no filter&rdquo; (Codex round 56 / P2).
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

function isBillStatus(s: string | undefined): s is BillStatus {
  return !!s && (Object.values(BillStatus) as string[]).includes(s);
}

export default async function OwnerBillsPage({ searchParams }: PageProps) {
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
      <div>
        <h1 className="text-xl font-semibold">销售应收账单</h1>
        <p className="text-sm text-muted-foreground">
          月初按 Asia/Shanghai 日历月把上月 FINISHED 工单归集给销售 / 客服；每位
          一条账单，老板发单后记录付款。
        </p>
      </div>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <GenerateBillsForm defaultPeriod={currentMonth} />
        <p className="mt-2 text-xs text-muted-foreground">
          重跑同一月会把新完工订单追加到已有 DRAFT 账单。该月账单一旦发单
          （ISSUED / PARTIAL_PAID / FULLY_PAID）后，生成流程会对那位销售 /
          客服报错，不覆盖已发账单。注意：该月之后再完工的订单只属于该月，
          不会被下月生成抓到——发单前务必确认本月所有工单都已 FINISHED；
          漏抓的工单需要业主线下单独处理。
        </p>
      </section>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <StatCard label="已发但未收" value={`¥ ${issuedUnpaid}`} />
        <StatCard label="全部未收" value={`¥ ${allUnpaid}`} />
        <StatCard
          label={`本月（${currentMonth}）新生成数`}
          value={`${currentMonthCount} 条`}
        />
      </div>

      <FilterBar
        status={statusFilter}
        period={periodFilter}
        salesUserId={salesUserIdFilter}
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          当前筛选条件下暂无账单。若想新建本月账单，先在上方&ldquo;生成 / 追加
          月账单&rdquo;触发。
        </div>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">周期</th>
                <th className="px-4 py-2 text-left">销售 / 客服</th>
                <th className="px-4 py-2 text-left">角色</th>
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
                  <td className="px-4 py-3 font-mono text-xs">{r.period}</td>
                  <td className="px-4 py-3">{r.salesUser.displayName}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {ROLE_LABELS[r.salesUser.role] ?? r.salesUser.role}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    ¥ {String(r.totalAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    ¥ {String(r.paidAmount)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDateTime(r.issuedAt)}
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
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold font-mono">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: BillStatus }) {
  const label = BILL_STATUS_LABELS[status] ?? status;
  switch (status) {
    case BillStatus.FULLY_PAID:
      return <Badge>{label}</Badge>;
    case BillStatus.PARTIAL_PAID:
      return <Badge variant="secondary">{label}</Badge>;
    case BillStatus.ISSUED:
      return <Badge variant="destructive">{label}</Badge>;
    case BillStatus.DRAFT:
      return <Badge variant="outline">{label}</Badge>;
    default:
      return <Badge variant="outline">{label}</Badge>;
  }
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
        <label className="text-xs text-muted-foreground">状态</label>
        <select
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
        <label className="text-xs text-muted-foreground">周期</label>
        <input
          type="month"
          name="period"
          defaultValue={period ?? ''}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">
          销售 / 客服 id (可选)
        </label>
        <input
          type="text"
          name="salesUserId"
          defaultValue={salesUserId ?? ''}
          placeholder="留空=全部"
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <button type="submit" className={buttonVariants({ size: 'sm' })}>
        筛选
      </button>
      <Link
        href="/owner/bills"
        className={buttonVariants({ size: 'sm', variant: 'ghost' })}
      >
        清除
      </Link>
    </form>
  );
}
