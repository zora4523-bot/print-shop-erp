import { WorkerProductionWages } from '@/components/business/salary/ProductionWageRecords';
import { listWorkerSettlementPage } from '@/lib/salary/worker-settlement-page';
import { WorkerPendingReports } from '@/components/business/salary/WorkerPendingReports';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import Decimal from 'decimal.js';
import Link from 'next/link';
import Form from 'next/form';
import { cache, Suspense } from 'react';
import { notFound } from 'next/navigation';
import { WalletCards } from 'lucide-react';
import {
  PieceworkSettlementStatus,
  Role,
  WorkerType,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import {
  listWorkerHourlyPayrolls,
  listWorkerSalaries,
  type WorkerSalaryActor,
} from '@/lib/worker-portal';
import {
  MACHINE_TYPE_LABELS,
  WORKER_TYPE_LABELS,
} from '@/lib/auth/role-labels';
import { formatDateShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { EmptyState, PageHeader, SectionLoading, FilterClearLink, LinkPendingHint } from '@/components/ui-business';
import { PaymentStatusBadge } from '@/components/business/salary/SalaryStatusBadge';
import { SalaryFloorBadge } from '@/components/business/salary/SalaryFloorBadge';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { formatMoney } from '@/lib/dashboard/format';
export const metadata = { title: '我的工资' };

type PageProps = {
  searchParams: Promise<{ from?: string; to?: string; page?: string | string[]; pendingPage?: string | string[]; wagePage?: string | string[]; view?: string; status?: string }>;
};

export default async function WorkerSalaryPage({ searchParams }: PageProps) {
  const user = await requirePermission('salary:view:self');
  if (user.role !== Role.WORKER || !user.workerType) notFound();

  const actor: WorkerSalaryActor = {
    id: user.id,
    role: user.role,
    workerType: user.workerType,
  };
  const sp = await searchParams;

  if (user.workerType === WorkerType.MACHINE || user.workerType === WorkerType.PACKER) {
    const history = sp.view === 'history';
    let content = <OperationPieceworkSalaryContent actor={actor} searchParams={sp} />;
    if (history) {
      content = user.workerType === WorkerType.MACHINE
        ? <PieceworkSalaryContent actor={actor} searchParams={sp} historical />
        : <HourlySalaryContent actor={actor} workerType={user.workerType} searchParams={sp} historical />;
    }
    return <div className="min-w-0 space-y-5">
      <nav aria-label="工资类型" className="flex gap-2 rounded-xl border bg-card p-2">
        <Link href="/worker/salary" scroll={false} aria-current={!history ? 'page' : undefined} className={buttonVariants({ variant: !history ? 'selected' : 'outline', className: 'relative min-h-11 px-4' })}>计件工资<LinkPendingHint /></Link>
        <Link href="/worker/salary?view=history" scroll={false} aria-current={history ? 'page' : undefined} className={buttonVariants({ variant: history ? 'selected' : 'outline', className: 'relative min-h-11 px-4' })}>历史工资档案<LinkPendingHint /></Link>
      </nav>
      {content}
    </div>;
  }
  notFound();
}

// Links carry only what the user explicitly chose; a defaulted month must not
// become an explicit filter on the next render (it would hide older unsettled
// reports).
function salaryQuery(params: Record<string, string | undefined>): string {
  return new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
}

function OperationPieceworkSalaryContent({
  actor,
  searchParams: sp,
}: {
  actor: WorkerSalaryActor;
  searchParams: { from?: string; to?: string; page?: string | string[]; pendingPage?: string | string[]; wagePage?: string | string[]; view?: string; status?: string };
}) {
  // Only an explicit, valid range narrows anything (业主 2026-09-19). The date
  // boxes start empty: a prefilled current month hid last month's unpaid
  // settlements from 待发放, and submitting it unchanged hid unsettled reports.
  const explicitFrom = sp.from && parseStrictYmd(sp.from) ? sp.from : undefined;
  const explicitTo = sp.to && parseStrictYmd(sp.to) ? sp.to : undefined;
  const invalidRange = Boolean(explicitFrom && explicitTo && explicitFrom > explicitTo);
  const rangeLabel = explicitFrom && explicitTo ? `（${explicitFrom} 至 ${explicitTo}）`
    : explicitFrom ? `（${explicitFrom} 起）` : explicitTo ? `（截至 ${explicitTo}）` : '';
  const pageParam = firstParam(sp.page);
  const settlementKey = `${explicitFrom ?? ''}|${explicitTo ?? ''}|${sp.status ?? ''}|${pageParam ?? ''}`;
  const rangeKey = `${explicitFrom ?? ''}|${explicitTo ?? ''}`;
  const settlementProps = { actor, from: explicitFrom, to: explicitTo, status: sp.status, page: pageParam, rangeLabel };

  // 结算汇总/列表、生产工资、待结算报工三块取数互不依赖：各自 Suspense 分区并行加载。
  return (
    <section className="min-w-0 space-y-4">
      <SalaryHeader description="按日期查看报工明细。" />
      <Suspense key={`summary|${settlementKey}`} fallback={<SectionLoading label="工资汇总" />}>
        <SettlementSummary {...settlementProps} />
      </Suspense>
      <SalaryRangeFilter
        inputType="date"
        fromLabel="开始日期"
        toLabel="结束日期"
        from={explicitFrom}
        to={explicitTo}
        status={sp.status}
      />
      {invalidRange && <p role="alert" className="text-destructive">开始日期晚于结束日期，请修改后查询。</p>}
      <Suspense key={`wages|${rangeKey}|${firstParam(sp.wagePage) ?? ''}`} fallback={<SectionLoading label="生产工资" />}>
        <WorkerProductionWages actor={actor} from={explicitFrom} to={explicitTo} page={sp.wagePage} />
      </Suspense>
      <Suspense key={`pending|${rangeKey}|${firstParam(sp.pendingPage) ?? ''}`} fallback={<SectionLoading label="待结算报工" />}>
        <WorkerPendingReports actor={actor} from={explicitFrom} to={explicitTo} page={sp.pendingPage} />
      </Suspense>
      <Suspense key={`list|${settlementKey}`} fallback={<SectionLoading label="已结算工资" />}>
        <SettlementList {...settlementProps} />
      </Suspense>
    </section>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// 汇总与列表分属两个 Suspense 分区；cache 让同一次渲染只查一次结算分页。
const loadSettlementPage = cache((actorId: string, role: Role, from: string | undefined, to: string | undefined, status: string | undefined, page: string | undefined) =>
  listWorkerSettlementPage({ id: actorId, role }, {
    from: from ? parseStrictYmd(from)! : undefined,
    to: to ? parseStrictYmd(to)! : undefined,
    page, status,
  }));

type SettlementSectionProps = {
  actor: WorkerSalaryActor;
  from?: string;
  to?: string;
  status?: string;
  page?: string;
  rangeLabel: string;
};

function settlementPage({ actor, from, to, status, page }: SettlementSectionProps) {
  return loadSettlementPage(actor.id, actor.role, from, to, status, page);
}

async function SettlementSummary(props: SettlementSectionProps) {
  const result = await settlementPage(props);
  return <SalarySummary total={new Decimal(result.totalAmount)} unpaid={new Decimal(result.unpaidAmount)} totalLabel="累计已结算" />;
}

async function SettlementList(props: SettlementSectionProps) {
  const { from: explicitFrom, to: explicitTo, rangeLabel } = props;
  const sp = { status: props.status };
  const result = await settlementPage(props);
  const settlements = result.rows;
  return (
    <>
      <nav aria-label="发放状态" className="flex flex-wrap gap-2">{[['', '全部结算'], ['unpaid', '待发放'], ['paid', '已发放']].map(([value, label]) => <Link key={value} href={`/worker/salary?${salaryQuery({ from: explicitFrom, to: explicitTo, status: value })}`} scroll={false} aria-current={(sp.status ?? '') === value ? 'page' : undefined} className={buttonVariants({ variant: (sp.status ?? '') === value ? 'selected' : 'outline', className: 'relative min-h-11 px-3' })}>{label}<LinkPendingHint /></Link>)}</nav>
      <h2 className="font-semibold">{sp.status === 'unpaid' ? '待发放工资' : sp.status === 'paid' ? '已发放工资' : '已结算工资'}{rangeLabel}</h2>
      {result.productionObligations.length > 0 && <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="生产工资待办"><h2 className="font-semibold">生产工资待办</h2><p className="text-sm text-muted-foreground">以下记录尚未计入已结算工资，管理员核对后处理。</p><ul className="space-y-2">{result.productionObligations.map(item => <li key={item.id} className="min-w-0 break-words text-sm"><Link href={`/worker/orders/${item.orderId}`} className="inline-flex min-h-11 items-center underline">{item.orderName} · {item.label} · v{item.version}</Link><p>{item.status === 'WAGES_DUE' ? '实际生产已核定，工资待补发' : item.status === 'REQUESTED' ? `数量待核定：${item.quantity} 个` : '历史生产待核对'}{item.workDate ? ` · ${item.workDate}` : ` · ${item.periodStart} 至 ${item.periodEnd}`}</p></li>)}</ul></section>}
      {settlements.length === 0 ? (
        <EmptyState
          icon={WalletCards}
          title="暂无已结算工资"
        />
      ) : (
        <ul className="space-y-3">
          {settlements.map((settlement) => (
            <li key={settlement.id}>
              <Link
                href={`/worker/salary/${settlement.id}`}
                className="block min-h-11 min-w-0 rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong>{formatDateShanghai(settlement.workDate)}</strong>
                      <PaymentStatusBadge
                        isPaid={
                          settlement.status === PieceworkSettlementStatus.PAID
                        }
                      />
                      <Badge variant="outline">
                        {settlement._count.items + settlement._count.productionWages} 条记录
                      </Badge>
                    </div>
                    <p className="worker-wrap-anywhere mt-2 text-sm text-muted-foreground">
                      报工金额 {formatMoney(settlement.reportAmount)} · 调整{' '}
                      {formatMoney(settlement.adjustmentAmount)}
                    </p>
                  </div>
                  <SalaryAmount value={settlement.payableAmount} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {result.pageCount > 1 && <AdminPagination basePath="/worker/salary" {...result} queryParams={{ from: explicitFrom, to: explicitTo, status: sp.status }} />}
    </>
  );
}

async function PieceworkSalaryContent({
  actor,
  searchParams: sp,
  historical = false,
}: {
  actor: WorkerSalaryActor;
  searchParams: { from?: string; to?: string; page?: string | string[]; pendingPage?: string | string[]; wagePage?: string | string[]; view?: string; status?: string };
  historical?: boolean;
}) {
  const from = sp.from ? parseStrictYmd(sp.from) : null;
  const to = sp.to ? parseStrictYmd(sp.to) : null;
  const salaryPage = await listWorkerSalaries(actor, {
    page: sp.page,
    from: from ?? undefined,
    to: to ?? undefined,
  });
  const salaries = salaryPage.rows;
  const total = new Decimal(salaryPage.totalSalary);
  const unpaid = new Decimal(salaryPage.unpaidSalary);

  return (
    <div className="min-w-0 space-y-4">
      <SalaryHeader
        title={historical ? '历史日薪档案' : undefined}
        description={
          historical
            ? '历史日薪记录'
            : '开机师傅 · 点击日期查看工单和计件明细。'
        }
      />
      <SalarySummary total={total} unpaid={unpaid} />
      <SalaryRangeFilter
        inputType="date"
        fromLabel="开始日期"
        toLabel="结束日期"
        from={from ? sp.from : undefined}
        to={to ? sp.to : undefined}
        historical={historical}
      />

      {salaries.length === 0 ? (
        <EmptyState
          icon={WalletCards}
          title="暂无计件工资"
        />
      ) : (
        <ul className="space-y-3">
          {salaries.map((salary) => (
            <li key={salary.id}>
              <Link
                href={`/worker/salary/${salary.id}`}
                className="block min-h-11 min-w-0 rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong>{formatDateShanghai(salary.date)}</strong>
                      <PaymentStatusBadge isPaid={salary.isPaid} />
                      <SalaryFloorBadge
                        piecework={salary.totalPieceworkAmount as Decimal.Value}
                        base={salary.baseSalary as Decimal.Value}
                      />
                    </div>
                    <p className="worker-wrap-anywhere mt-2 text-sm text-muted-foreground">
                      {MACHINE_TYPE_LABELS[salary.machineType]} · {salary.taskCount}{' '}
                      项任务 / {salary.orderCount} 个工单
                    </p>
                    <p className="worker-wrap-anywhere mt-1 text-sm text-muted-foreground">
                      计件 {formatMoney(salary.totalPieceworkAmount)} · 保底 {formatMoney(salary.baseSalary)} · 调整{' '}
                      {Number(salary.adjustmentAmount) > 0 ? '+' : ''}
                      {String(salary.adjustmentAmount)}
                    </p>
                    {new Decimal(
                      salary.totalPieceworkAmount as Decimal.Value,
                    ).lt(new Decimal(salary.baseSalary as Decimal.Value)) ? (
                      <p className="worker-wrap-anywhere mt-1 text-xs text-warning-foreground">
                        原因：当日计件未达到保底，按每日底薪计算。
                      </p>
                    ) : null}
                  </div>
                  <SalaryAmount value={salary.actualSalary} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <AdminPagination basePath="/worker/salary" {...salaryPage}
        queryParams={{ from: sp.from, to: sp.to, view: historical ? 'history' : undefined }} />
    </div>
  );
}

async function HourlySalaryContent({
  actor,
  workerType,
  searchParams: sp,
  historical = false,
}: {
  actor: WorkerSalaryActor;
  workerType: WorkerType;
  searchParams: { from?: string; to?: string; page?: string | string[]; pendingPage?: string | string[]; wagePage?: string | string[]; view?: string; status?: string };
  historical?: boolean;
}) {
  const fromMonth = validMonth(sp.from) ? sp.from : undefined;
  const toMonth = validMonth(sp.to) ? sp.to : undefined;
  const payrolls = await listWorkerHourlyPayrolls(actor, {
    fromMonth,
    toMonth,
  });
  const { total, unpaid } = salaryTotals(payrolls, 'totalSalary');

  return (
    <div className="min-w-0 space-y-4">
      <SalaryHeader
        title={historical ? '历史打包时薪档案' : undefined}
        description={
          historical
            ? '历史时薪记录'
            : `${WORKER_TYPE_LABELS[workerType]} · 点击月份查看工时和计薪明细。`
        }
      />
      <SalarySummary total={total} unpaid={unpaid} />
      <SalaryRangeFilter
        inputType="month"
        fromLabel="开始月份"
        toLabel="结束月份"
        from={fromMonth}
        to={toMonth}
        historical={historical}
      />

      {payrolls.length === 0 ? (
        <EmptyState
          icon={WalletCards}
          title="暂无月结工资"
        />
      ) : (
        <ul className="space-y-3">
          {payrolls.map((payroll) => {
            const payrollWorkerType = payroll.payrollWorkerType;
            return (
            <li key={payroll.id}>
              <Link
                href={`/worker/salary/${payroll.id}`}
                className="block min-h-11 min-w-0 rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong className="font-sans tabular-nums">
                        {payroll.month}
                      </strong>
                      <PaymentStatusBadge isPaid={payroll.isPaid} />
                      <Badge variant="outline">
                        {payrollWorkerType
                          ? WORKER_TYPE_LABELS[payrollWorkerType]
                          : '历史岗位未知'}
                      </Badge>
                    </div>
                    <p className="worker-wrap-anywhere mt-2 text-sm text-muted-foreground">
                      {`正常 ${String(payroll.totalWorkHours)} 小时 · 加班 ${String(payroll.totalOtHours)} 小时`}
                    </p>
                    <p className="worker-wrap-anywhere mt-1 text-sm text-muted-foreground">
                      {`正常工资 ${formatMoney(payroll.baseSalary)} · 加班工资 ${formatMoney(payroll.otSalary)}`}
                    </p>
                  </div>
                  <SalaryAmount value={payroll.totalSalary} />
                </div>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SalaryHeader({
  title = '我的工资',
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <PageHeader size="worker" title={title} subtitle={description} className="worker-wrap-anywhere" />
  );
}

function SalarySummary({ total, unpaid, totalLabel = '累计工资' }: { total: Decimal; unpaid: Decimal; totalLabel?: string }) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[360px]:grid-cols-2">
      <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-sm text-muted-foreground">{totalLabel}</p>
        <p className="worker-wrap-anywhere mt-1 font-sans tabular-nums text-lg font-semibold">
          {formatMoney(total)}
        </p>
      </div>
      <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-sm text-muted-foreground">尚未发放</p>
        <p className="worker-wrap-anywhere mt-1 font-sans tabular-nums text-lg font-semibold">
          {formatMoney(unpaid)}
        </p>
      </div>
    </section>
  );
}

function SalaryRangeFilter({
  historical = false,
  inputType,
  fromLabel,
  toLabel,
  from,
  to,
  status,
}: {
  historical?: boolean;
  inputType: 'date' | 'month';
  fromLabel: string;
  toLabel: string;
  from?: string;
  to?: string;
  /** Keeps the active 发放状态 tab when the worker submits a range. */
  status?: string;
}) {
  return (
    // next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。
    <Form id="worker-salary-filters" key={JSON.stringify([historical, inputType, from ?? '', to ?? ''])} action="/worker/salary" className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border bg-card p-3 text-sm min-[360px]:grid-cols-2">
      {historical && <input type="hidden" name="view" value="history" />}
      {status === 'paid' || status === 'unpaid' ? <input type="hidden" name="status" value={status} /> : null}
      <label className="space-y-1">
        <span className="text-sm text-muted-foreground">{fromLabel}</span>
        <Input
          type={inputType}
          name="from"
          defaultValue={from ?? ''}
          className="w-full"
        />
      </label>
      <label className="space-y-1">
        <span className="text-sm text-muted-foreground">{toLabel}</span>
        <Input
          type={inputType}
          name="to"
          defaultValue={to ?? ''}
          className="w-full"
        />
      </label>
      <div className="flex flex-wrap gap-2 min-[360px]:col-span-2">
        <Button type="submit" className="min-h-11">
          查询范围
        </Button>
        <FilterClearLink formId="worker-salary-filters"
          href={historical ? '/worker/salary?view=history' : '/worker/salary'}
          className="inline-flex min-h-11 items-center px-3 text-sm underline"
        >
          清除筛选
        </FilterClearLink>
      </div>
    </Form>
  );
}

// value 是 Prisma 的金额 Decimal；之前写 unknown 是因为直接 String()
// 渲染，换成 formatMoney 后需要真实类型。
function SalaryAmount({ value }: { value: Decimal.Value }) {
  return (
    <div className="ml-auto shrink-0 text-right">
      <p className="text-sm text-muted-foreground">应发</p>
      <p className="font-sans tabular-nums text-lg font-semibold text-foreground">
        {formatMoney(value)}
      </p>
    </div>
  );
}

function salaryTotals<T extends { isPaid: boolean }>(
  rows: T[],
  amountKey: keyof T,
) {
  const total = rows.reduce(
    (sum, row) => sum.plus(new Decimal(row[amountKey] as Decimal.Value)),
    new Decimal(0),
  );
  const unpaid = rows
    .filter((row) => !row.isPaid)
    .reduce(
      (sum, row) => sum.plus(new Decimal(row[amountKey] as Decimal.Value)),
      new Decimal(0),
    );
  return { total, unpaid };
}

function validMonth(value: string | undefined): value is string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? '');
}
