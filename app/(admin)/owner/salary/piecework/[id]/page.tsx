import { SettledProductionWages } from '@/components/business/salary/ProductionWageRecords';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import {
  PieceworkOperationType,
  ProductionReportEntryType,
  PieceworkSettlementStatus,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { formatMoney } from '@/lib/dashboard/format';
import {
  formatDateInputShanghai,
  formatDateShanghai,
  formatDateTimeShanghai,
} from '@/lib/format/dates';
import { getPieceworkSettlementDetail } from '@/lib/salary/piecework-settlement';
import { MarkPieceworkSettlementPaidForm } from '@/components/business/salary/PieceworkSettlementActions';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, TableScrollArea } from '@/components/ui-business';
import { BreadcrumbParent } from '@/components/business/admin/breadcrumb-entity';
import { formatRate } from '@/lib/format/unit-price';

type PageProps = { params: Promise<{ id: string }> };

const getPageData = cache(async (id: string) => {
  const actor = await requirePermission('salary:view:all');
  return getPieceworkSettlementDetail(id, actor);
});

const OPERATION_LABELS: Record<PieceworkOperationType, string> = {
  PARTIAL: '局部烫金',
  FULL: '专版烫金',
  PACKING: '打包入袋',
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const session = await getSession();
  if (!session || !hasPermission('salary:view:all', session.user.role)) {
    return { title: '工序计件结算' };
  }
  const { id } = await params;
  const settlement = await getPageData(id);
  return {
    title: settlement
      ? `${settlement.reporter.displayName} ${formatDateShanghai(settlement.workDate)} · 工序计件结算`
      : '计件结算不存在',
  };
}

export default async function PieceworkSettlementDetailPage({
  params,
}: PageProps) {
  await requirePermission('salary:view:all');
  const { id } = await params;
  const settlement = await getPageData(id);
  if (!settlement) notFound();
  const workDate = formatDateInputShanghai(settlement.workDate);
  const returnTo = `/owner/salary/piecework/${settlement.id}`;

  return (
    <div className="space-y-6">
      {/* 返回工序计件结算由面包屑父级承担，回到本单所在的结算日期。 */}
      <BreadcrumbParent href={`/owner/salary/piecework?date=${workDate}`} />
      <PageHeader
        title={`${settlement.reporter.displayName} · ${workDate}`}
        subtitle="已结算报工明细"
        status={<SettlementStatus status={settlement.status} />}
        actions={
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/salary/piecework-settlements/export?from=${workDate}&to=${workDate}&workerId=${settlement.reporterId}`}
              className={buttonVariants({ variant: 'outline' })}

              download
            >
              导出计件结算
            </a>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Summary label="状态" value={<SettlementStatus status={settlement.status} />} />
        <Summary label="报工金额" value={formatMoney(settlement.reportAmount)} />
        <Summary label="调整" value={formatMoney(settlement.adjustmentAmount)} />
        <Summary label="应发" value={formatMoney(settlement.payableAmount)} strong />
        <Summary label="明细数" value={`${settlement.items.length + settlement.productionWages.length} 条`} />
        <Summary
          label={settlement.paidAt ? '发放时间' : '锁定时间'}
          value={
            settlement.paidAt
              ? formatDateTimeShanghai(settlement.paidAt)
              : settlement.lockedAt
                ? formatDateTimeShanghai(settlement.lockedAt)
                : '—'
          }
        />
      </section>

      <SettledProductionWages wages={settlement.productionWages} admin />
      {settlement.status === PieceworkSettlementStatus.LOCKED ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <MarkPieceworkSettlementPaidForm
            settlementId={settlement.id}
            reporterName={settlement.reporter.displayName}
            workDate={workDate}
            amount={String(settlement.payableAmount)}
            returnTo={returnTo}
          />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-semibold">报工明细</h2>
        <TableScrollArea label="计件结算报工明细" className="rounded-xl border bg-card shadow-sm">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">工单</th>
                <th className="px-4 py-2 text-left">工序</th>
                <th className="px-4 py-2 text-center">类型</th>
                <th className="px-4 py-2 text-right">合格 / 不良 / 返工</th>
                <th className="px-4 py-2 text-right">计薪数</th>
                <th className="px-4 py-2 text-right">工价</th>
                <th className="px-4 py-2 text-right">金额</th>
                <th className="px-4 py-2 text-left">工价版本</th>
                <th className="px-4 py-2 text-left">报工时间</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {settlement.items.map(({ report }) => (
                <tr key={report.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/orders/${report.operation.order.id}`}
                      className="font-sans tabular-nums underline decoration-primary"
                    >
                      {report.operation.order.orderNo}
                    </Link>
                    {report.operation.order.customName ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {report.operation.order.customName}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {OPERATION_LABELS[report.operation.operationType]}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant="outline">
                      {report.entryType === ProductionReportEntryType.ADJUSTMENT ? '人工调整' : report.entryType === ProductionReportEntryType.REVERSAL
                        ? '冲正'
                        : '报工'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {String(report.reportedCompletedQty)} / {String(report.defectQty)} /{' '}
                    {String(report.reworkQty)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {String(report.chargeableQty)} {report.unit}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {formatRate(report.rate)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums font-medium">
                    {formatMoney(report.amount)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    v{report.priceBookVersion}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDateTimeShanghai(report.reportedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      </section>
    </div>
  );
}

function Summary({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div
        className={`mt-1 font-sans tabular-nums ${strong ? 'text-lg font-semibold' : 'font-medium'}`}
      >
        {value}
      </div>
    </div>
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
