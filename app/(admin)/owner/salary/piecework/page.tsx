import Decimal from 'decimal.js';
import Link from 'next/link';
import { Calculator, Download, FileText } from 'lucide-react';
import {
  PieceworkOperationType,
  PieceworkSettlementStatus,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { yesterdayShanghai } from '@/lib/cron/schedule';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { getPieceworkSettlementDay } from '@/lib/salary/piecework-settlement';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ActionNotice,
  EmptyState,
  PageHeader,
  StatCard,
} from '@/components/ui-business';
import {
  LockPieceworkSettlementDayForm,
  LockPieceworkSettlementForm,
  MarkPieceworkSettlementPaidForm,
} from '@/components/business/salary/PieceworkSettlementActions';

export const metadata = { title: '工序计件结算' };

const OPERATION_LABELS: Record<PieceworkOperationType, string> = {
  PARTIAL: '局部烫金',
  FULL: '专版烫金',
  PACKING: '打包入袋',
};

type PageProps = {
  searchParams: Promise<{
    date?: string;
    status?: string;
    locked?: string;
    lockedCount?: string;
    paid?: string;
  }>;
};

export default async function PieceworkSettlementPage({
  searchParams,
}: PageProps) {
  await requirePermission('salary:view:all');
  const sp = await searchParams;
  const workDate =
    sp.date && parseStrictYmd(sp.date) ? sp.date : yesterdayShanghai();
  const status =
    sp.status === PieceworkSettlementStatus.LOCKED ||
    sp.status === PieceworkSettlementStatus.PAID
      ? sp.status
      : undefined;
  const data = await getPieceworkSettlementDay({ workDate, status });
  const returnQuery = new URLSearchParams({ date: workDate });
  if (status) returnQuery.set('status', status);
  const returnTo = `/owner/salary/piecework?${returnQuery.toString()}`;
  const lockedTotal = data.settlements.reduce(
    (sum, row) => sum.plus(row.payableAmount),
    new Decimal(0),
  );
  const unpaidTotal = data.settlements
    .filter((row) => row.status !== PieceworkSettlementStatus.PAID)
    .reduce((sum, row) => sum.plus(row.payableAmount), new Decimal(0));

  return (
    <div className="space-y-6">
      {sp.locked ? (
        <ActionNotice
          tone="success"
          title="计件结算已锁定"
          description={`${sp.locked} 的报工快照已锁定。`}
        />
      ) : null}
      {sp.lockedCount !== undefined ? (
        <ActionNotice
          tone="success"
          title="当日结算处理完成"
          description={`本次新锁定 ${Number(sp.lockedCount) || 0} 人。`}
        />
      ) : null}
      {sp.paid ? (
        <ActionNotice
          tone="success"
          title="已标记发放"
          description={`${sp.paid} 的计件工资已标记为已发放。`}
        />
      ) : null}

      <PageHeader
        title="工序计件结算"
        subtitle="按报工人与上海日历日锁定 ProductionReport 金额；不与历史任务日薪叠加。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/api/salary/piecework-settlements/export?from=${workDate}&to=${workDate}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Download className="mr-2 size-4" />
              导出新账本
            </Link>
            <Link
              href="/owner/salary/daily"
              className={buttonVariants({ variant: 'ghost' })}
            >
              查看历史日薪
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="已锁定记录"
          value={`${data.settlements.length} 条`}
          icon={FileText}
          tone="info"
          hint={`合计 ¥${lockedTotal.toFixed(2)}`}
        />
        <StatCard
          label="未发放"
          value={`¥${unpaidTotal.toFixed(2)}`}
          icon={Calculator}
          tone="warning"
        />
        <StatCard
          label="待锁定报工人"
          value={`${data.candidates.length} 人`}
          icon={Calculator}
          tone={data.candidates.length > 0 ? 'primary' : 'neutral'}
        />
      </div>

      <FilterBar workDate={workDate} status={status} />

      {!status ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">待锁定报工</h2>
              <p className="text-sm text-muted-foreground">
                仅显示该日未被 SettlementItem 占用的新工序报工。
              </p>
            </div>
            <LockPieceworkSettlementDayForm
              workDate={workDate}
              candidateCount={data.candidates.length}
              returnTo={returnTo}
            />
          </div>
          {data.candidates.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={`${workDate} 没有待锁定报工`}
              description="无需操作，或当日报工已全部锁定。"
            />
          ) : (
            <div
              role="region"
              aria-label="待锁定报工明细"
              tabIndex={0}
              className="overflow-x-auto rounded-xl border bg-card shadow-sm"
            >
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">报工人</th>
                    <th className="px-4 py-2 text-left">工序</th>
                    <th className="px-4 py-2 text-center">报工 / 工单</th>
                    <th className="px-4 py-2 text-right">待锁定金额</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.candidates.map((row) => (
                    <tr key={row.reporterId}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.reporterName}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.username}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {Object.entries(row.operationCounts)
                          .map(
                            ([type, count]) =>
                              `${OPERATION_LABELS[type as PieceworkOperationType] ?? type} ${count}`,
                          )
                          .join(' · ')}
                      </td>
                      <td className="px-4 py-3 text-center font-sans tabular-nums">
                        {row.reportCount} / {row.orderCount}
                      </td>
                      <td className="px-4 py-3 text-right font-sans tabular-nums font-medium">
                        ¥ {row.reportAmount}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <LockPieceworkSettlementForm
                          reporterId={row.reporterId}
                          reporterName={row.reporterName}
                          workDate={workDate}
                          reportCount={row.reportCount}
                          amount={row.reportAmount}
                          returnTo={returnTo}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-semibold">已锁定结算</h2>
        {data.settlements.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={`${workDate} 暂无符合筛选的结算`}
            description="锁定报工后，记录会显示在这里。"
          />
        ) : (
          <div
            role="region"
            aria-label="已锁定计件结算"
            tabIndex={0}
            className="overflow-x-auto rounded-xl border bg-card shadow-sm"
          >
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">日期</th>
                  <th className="px-4 py-2 text-left">报工人</th>
                  <th className="px-4 py-2 text-center">明细</th>
                  <th className="px-4 py-2 text-right">报工金额</th>
                  <th className="px-4 py-2 text-right">应发</th>
                  <th className="px-4 py-2 text-center">状态</th>
                  <th className="px-4 py-2 text-left">时间</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.settlements.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-sans tabular-nums">
                      {row.workDate}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.reporter.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.reporter.username}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-sans tabular-nums">
                      {row._count.items}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums">
                      ¥ {String(row.reportAmount)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums font-medium">
                      ¥ {String(row.payableAmount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <SettlementStatus status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {row.paidAt
                        ? `发放 ${formatDateTimeShanghai(row.paidAt)}`
                        : row.lockedAt
                          ? `锁定 ${formatDateTimeShanghai(row.lockedAt)}`
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/owner/salary/piecework/${row.id}`}
                          className={buttonVariants({
                            size: 'sm',
                            variant: 'outline',
                          })}
                        >
                          核对明细
                        </Link>
                        {row.status === PieceworkSettlementStatus.LOCKED ? (
                          <MarkPieceworkSettlementPaidForm
                            settlementId={row.id}
                            reporterName={row.reporter.displayName}
                            workDate={row.workDate}
                            amount={String(row.payableAmount)}
                            returnTo={returnTo}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function FilterBar({
  workDate,
  status,
}: {
  workDate: string;
  status?: PieceworkSettlementStatus;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <label className="space-y-1">
        <span className="block text-xs text-muted-foreground">结算日期</span>
        <input
          type="date"
          name="date"
          defaultValue={workDate}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted-foreground">状态</span>
        <select
          name="status"
          defaultValue={status ?? ''}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        >
          <option value="">全部</option>
          <option value={PieceworkSettlementStatus.LOCKED}>已锁定未发</option>
          <option value={PieceworkSettlementStatus.PAID}>已发放</option>
        </select>
      </label>
      <Button type="submit" size="sm">
        筛选
      </Button>
      <Link
        href="/owner/salary/piecework"
        className={buttonVariants({ size: 'sm', variant: 'ghost' })}
      >
        清除
      </Link>
    </form>
  );
}

function SettlementStatus({
  status,
}: {
  status: PieceworkSettlementStatus;
}) {
  if (status === PieceworkSettlementStatus.PAID) {
    return <Badge variant="secondary">已发放</Badge>;
  }
  if (status === PieceworkSettlementStatus.LOCKED) {
    return <Badge variant="outline">已锁定</Badge>;
  }
  return <Badge variant="outline">草稿</Badge>;
}
