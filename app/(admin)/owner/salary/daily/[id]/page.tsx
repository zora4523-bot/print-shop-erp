import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
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
  formatDateShanghai,
  formatDateTimeShanghai,
} from '@/lib/format/dates';
import { buttonVariants } from '@/components/ui/button';
import { AddSalaryAdjustmentForm } from '@/components/business/salary/AddSalaryAdjustmentForm';
import { MarkPaidForm } from '@/components/business/salary/MarkPaidForm';
import { PaymentStatusBadge } from '@/components/business/salary/SalaryStatusBadge';
import { PageHeader } from '@/components/ui-business';
import type { MachineRuleWithBase } from '@/lib/salary/rules';

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
    return { title: '计件工资' };
  }

  const { id } = await params;
  const salary = await getDailySalaryPageData(id);
  return {
    title: salary
      ? `${salary.worker.displayName} ${formatDateShanghai(salary.date)} · 计件工资`
      : '计件工资记录不存在',
  };
}

export default async function DailySalaryDetailPage({ params }: PageProps) {
  await requirePermission('salary:view:all');
  const { id } = await params;
  const salary = await getDailySalaryPageData(id);
  if (!salary) notFound();
  const salaryDateKey = salary.date.toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${salary.worker.displayName} · ${formatDateShanghai(salary.date)}`}
        subtitle="逐项核对报工数量、工单、工艺、规则快照和人工调整。上班/请假天数不自动扣减计件保底；已发放后整条记录锁定。"
        actions={
          <div className="flex gap-2">
            <Link
              href={`/api/salary/piecework/export?date=${salaryDateKey}&workerId=${salary.workerId}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              导出 Excel
            </Link>
            <Link
              href="/owner/salary/daily"
              className={buttonVariants({ variant: 'ghost' })}
            >
              返回列表
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Summary
          label="保底机型"
          value={MACHINE_TYPE_LABELS[salary.machineType]}
        />
        <Summary label="计件合计" value={`¥ ${salary.totalPieceworkAmount}`} />
        <Summary label="每日保底" value={`¥ ${salary.baseSalary}`} />
        <Summary label="人工调整" value={`¥ ${salary.adjustmentAmount}`} />
        <Summary label="实发" value={`¥ ${salary.actualSalary}`} strong />
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">状态</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <PaymentStatusBadge isPaid={salary.isPaid} />
            <MarkPaidForm
              returnTo="/owner/salary/daily"
              id={salary.id}
              currentPaid={salary.isPaid}
              workerName={salary.worker.displayName}
              salaryDate={formatDateShanghai(salary.date)}
              amount={String(salary.actualSalary)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">人工调整</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          不改写原始计件；每笔奖金、扣款或差错修正都会保留操作人、时间和原因。
        </p>
        <AddSalaryAdjustmentForm
          dailySalaryId={salary.id}
          disabled={salary.isPaid}
          initialIdempotencyKey={randomUUID()}
        />
        {salary.adjustments.length > 0 ? (
          <ul className="mt-4 divide-y border-t text-sm">
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
        ) : null}
      </section>

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="p-5">
          <h2 className="font-semibold">计件任务明细（{salary.items.length}）</h2>
          <p className="text-xs text-muted-foreground">
            金额来自任务完工时锁定的规则，后续改价不会篡改历史。
          </p>
        </div>
        {salary.items.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">
            当日没有完工的计件任务，本行按保底发放。
          </p>
        ) : (
        <div
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          role="region"
          aria-label="日薪明细"
          tabIndex={0}
        >
          <table className="w-full min-w-[1250px] text-sm">
            <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">工单 / 款式</th>
                <th className="px-4 py-2 text-left">工艺</th>
                <th className="px-4 py-2 text-right">良品</th>
                <th className="px-4 py-2 text-right">次品</th>
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
        </div>
        )}
      </section>
    </div>
  );
}

function formatRuleSnapshot(snapshot: unknown): string {
  const rule = snapshot as Partial<MachineRuleWithBase>;
  const parts = [
    `每下 ¥${rule.pieceRate ?? '—'}`,
    `每板 ¥${rule.boardRate ?? '—'}`,
  ];
  if (rule.smallOrderThreshold !== null && rule.smallOrderThreshold !== undefined) {
    parts.push(
      `小单 ${rule.smallOrderInclusive ? '≤' : '<'} ${rule.smallOrderThreshold} = ¥${rule.smallOrderFlatPrice ?? 0}`,
    );
  }
  parts.push(`大单装板 ¥${rule.largeOrderSetupFee ?? 0}`);
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
