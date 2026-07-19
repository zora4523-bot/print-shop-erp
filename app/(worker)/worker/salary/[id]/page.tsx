import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SalaryAdjustmentType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { getWorkerSalaryDetail } from '@/lib/worker-portal';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';

type PageProps = { params: Promise<{ id: string }> };

const ADJUSTMENT_LABELS: Record<SalaryAdjustmentType, string> = {
  BONUS: '奖金',
  DEDUCTION: '扣款',
  CORRECTION: '差错修正',
};

export default async function WorkerSalaryDetailPage({ params }: PageProps) {
  const user = await requirePermission('salary:view:self');
  const { id } = await params;
  const salary = await getWorkerSalaryDetail(id, { id: user.id, role: user.role });
  if (!salary) notFound();

  return (
    <div className="min-w-0 space-y-5">
      <header className="worker-wrap-anywhere min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="worker-wrap-anywhere min-w-0 text-lg font-semibold">
            {formatDateShanghai(salary.date)} 工资明细
          </h1>
          {salary.isPaid ? (
            <Badge variant="secondary">已发</Badge>
          ) : (
            <Badge variant="outline">未发</Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {MACHINE_TYPE_LABELS[salary.machineType]} ·
          只展示当前账号自己的计件记录
        </p>
      </header>

      <section className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[360px]:grid-cols-2">
        <Money label="计件合计" value={salary.totalPieceworkAmount} />
        <Money label="每日保底" value={salary.baseSalary} />
        <Money label="人工调整" value={salary.adjustmentAmount} />
        <Money label="实发工资" value={salary.actualSalary} strong />
      </section>

      {salary.adjustments.length > 0 ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">工资调整</h2>
          <ul className="mt-2 divide-y text-sm">
            {salary.adjustments.map((entry) => (
              <li key={entry.id} className="py-2">
                <div className="flex min-w-0 flex-wrap gap-3 sm:flex-nowrap">
                  <span className="worker-wrap-anywhere min-w-0 flex-1">
                    {ADJUSTMENT_LABELS[entry.type]} · {entry.reason}
                  </span>
                  <span className="ml-auto shrink-0 font-sans tabular-nums">
                    {Number(entry.amount) > 0 ? '+' : ''}
                    {String(entry.amount)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTimeShanghai(entry.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">计件任务（{salary.items.length}）</h2>
        <ul className="mt-2 divide-y">
          {salary.items.map((item) => (
            <li key={item.id} className="py-3 text-sm">
              <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/worker/orders/${item.orderId}`}
                    className="worker-wrap-anywhere inline-flex min-h-11 min-w-11 items-center font-sans tabular-nums text-foreground underline decoration-primary"
                  >
                    {item.orderNo}
                  </Link>
                  <p className="worker-wrap-anywhere mt-1">
                    {item.orderItemName} · {item.craftName}
                  </p>
                  <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
                    良品 {item.completedQty} · 次品 {item.defectQty} · 返工{' '}
                    {item.reworkQty} · 板 {item.boardCount} · 下{' '}
                    {item.pressCount}
                  </p>
                </div>
                <div className="ml-auto shrink-0 text-right">
                  <p className="font-sans tabular-nums font-medium">
                    ¥ {String(item.pieceworkAmount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimeShanghai(item.completedAt)}
                  </p>
                </div>
              </div>
            </li>
          ))}
          {salary.items.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted-foreground">
              该日没有任务明细。
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

function Money({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: unknown;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`worker-wrap-anywhere mt-1 font-sans tabular-nums ${
          strong ? 'text-lg font-semibold text-foreground' : 'font-medium'
        }`}
      >
        ¥ {String(value)}
      </p>
    </div>
  );
}
