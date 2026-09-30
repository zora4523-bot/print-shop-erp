import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { SalaryAdjustmentType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { getDailyWorkerSalaryDetail } from '@/lib/salary/daily';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { formatMoney } from '@/lib/dashboard/format';
import {
  formatDateInputShanghai,
  formatDateShanghai,
  formatDateTimeShanghai,
} from '@/lib/format/dates';
import { buttonVariants } from '@/components/ui/button';
import { PaymentStatusBadge } from '@/components/business/salary/SalaryStatusBadge';
import { PageHeader, TableScrollArea } from '@/components/ui-business';
import type { LegacyMachineRuleSnapshot } from '@/lib/salary/legacy-machine-snapshot';
import { formatRate } from '@/lib/format/unit-price';

type PageProps = { params: Promise<{ id: string }> };

const getDailySalaryPageData = cache((id: string) =>
  getDailyWorkerSalaryDetail(id),
);

const ADJUSTMENT_LABELS: Record<SalaryAdjustmentType, string> = {
  BONUS: '奖金',
  DEDUCTION: '扣款',
  CORRECTION: '差错修正',
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const session = await getSession();
  if (!session || !hasPermission('salary:view:all', session.user.role)) {
    return { title: '历史日薪档案' };
  }

  const { id } = await params;
  const salary = await getDailySalaryPageData(id);
  return {
    title: salary
      ? `${salary.worker.displayName} ${formatDateShanghai(salary.date)} · 历史日薪档案`
      : '历史日薪记录不存在',
  };
}

export default async function DailySalaryDetailPage({ params }: PageProps) {
  await requirePermission('salary:view:all');
  const { id } = await params;
  const salary = await getDailySalaryPageData(id);
  if (!salary) notFound();
  const salaryDateKey = formatDateInputShanghai(salary.date);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${salary.worker.displayName} · ${formatDateShanghai(salary.date)}`}
        subtitle="历史日薪明细"
        back={{ href: '/owner/salary/daily', label: '返回历史日薪档案' }}
        status={<PaymentStatusBadge isPaid={salary.isPaid} />}
        actions={
          <div className="flex gap-2">
            <a
              href={`/api/salary/piecework/export?date=${salaryDateKey}&workerId=${salary.workerId}`}
              className={buttonVariants({ variant: 'outline' })}
            
              download
            >
              导出 Excel
            </a>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Summary
          label="保底机型"
          value={MACHINE_TYPE_LABELS[salary.machineType]}
        />
        <Summary label="计件合计" value={formatMoney(salary.totalPieceworkAmount)} />
        <Summary label="每日保底" value={formatMoney(salary.baseSalary)} />
        <Summary label="人工调整" value={formatMoney(salary.adjustmentAmount)} />
        <Summary label="实发" value={formatMoney(salary.actualSalary)} strong />
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">状态</p>
          <div className="mt-2">
            <PaymentStatusBadge isPaid={salary.isPaid} />
          </div>
        </div>
      </section>

      {salary.adjustments.length > 0 ? <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">历史人工调整</h2>
          <ul className="divide-y border-t text-sm">
            {salary.adjustments.map((entry) => (
              <li key={entry.id} className="grid gap-2 py-3 sm:grid-cols-[100px_100px_1fr_220px]">
                <span>{ADJUSTMENT_LABELS[entry.type]}</span>
                <span className={Number(entry.amount) < 0 ? 'font-sans tabular-nums text-destructive' : 'font-sans tabular-nums text-success-foreground'}>
                  {Number(entry.amount) > 0 ? '+' : ''}{String(entry.amount)}
                </span>
                <span>{entry.reason}</span>
                <span className="text-xs text-muted-foreground">
                  {entry.createdBy.displayName} · {formatDateTimeShanghai(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
      </section> : null}

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="p-5">
          <h2 className="font-semibold">计件任务明细（{salary.items.length}）</h2>
        </div>
        {salary.items.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">
            当日没有完工的计件任务，本行按保底发放。
          </p>
        ) : (
        <TableScrollArea label="日薪明细">
          <table className="w-full min-w-[1250px] text-sm">
            <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">工单 / 款式</th>
                <th className="px-4 py-2 text-left">工艺</th>
                <th className="px-4 py-2 text-right">合格</th>
                <th className="px-4 py-2 text-right">不良</th>
                <th className="px-4 py-2 text-right">返工</th>
                <th className="px-4 py-2 text-right">板数</th>
                <th className="px-4 py-2 text-right">下数</th>
                <th className="px-4 py-2 text-left">计价规则</th>
                <th className="px-4 py-2 text-right">计件金额</th>
                <th className="px-4 py-2 text-left">完工时间</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {salary.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <Link className="font-sans tabular-nums text-primary underline" href={`/orders/${item.orderId}`}>
                      {item.orderNo}
                    </Link>
                    <p className="text-xs text-muted-foreground">{item.orderItemName}</p>
                  </td>
                  <td className="px-4 py-3">{item.craftName}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">{item.completedQty}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">{item.defectQty}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">{item.reworkQty}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">{item.boardCount}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">{item.pressCount}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatRuleSnapshot(item.salaryRuleSnapshot)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums font-medium">{formatMoney(item.pieceworkAmount)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTimeShanghai(item.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
        )}
      </section>
    </div>
  );
}

function formatRuleSnapshot(snapshot: unknown): string {
  const rule = snapshot as LegacyMachineRuleSnapshot;
  const parts = [
    `每下 ${rule.pieceRate == null ? '—' : formatRate(rule.pieceRate)}`,
    `每板 ${rule.boardRate == null ? '—' : formatRate(rule.boardRate)}`,
  ];
  if (rule.smallOrderThreshold !== null && rule.smallOrderThreshold !== undefined) {
    parts.push(
      `小单 ${rule.smallOrderInclusive ? '≤' : '<'} ${rule.smallOrderThreshold} = ${formatRate(rule.smallOrderFlatPrice ?? 0)}`,
    );
  }
  parts.push(`大单装板 ${formatRate(rule.largeOrderSetupFee ?? 0)}`);
  return parts.join(' · ');
}

function Summary({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-sans tabular-nums ${strong ? 'text-lg font-semibold text-primary' : 'font-medium'}`}>{value}</p>
    </div>
  );
}
