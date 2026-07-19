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
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{formatDateShanghai(salary.date)} 工资明细</h1>
          {salary.isPaid ? <Badge>已发</Badge> : <Badge variant="outline">未发</Badge>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{MACHINE_TYPE_LABELS[salary.machineType]} · 只展示当前账号自己的计件记录</p>
      </header>

      <section className="grid grid-cols-2 gap-3 text-sm">
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
                <div className="flex justify-between gap-3">
                  <span>{ADJUSTMENT_LABELS[entry.type]} · {entry.reason}</span>
                  <span className="font-sans tabular-nums">{Number(entry.amount) > 0 ? '+' : ''}{String(entry.amount)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{formatDateTimeShanghai(entry.createdAt)}</p>
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link href={`/worker/orders/${item.orderId}`} className="font-sans tabular-nums text-primary underline">
                    {item.orderNo}
                  </Link>
                  <p className="mt-1">{item.orderItemName} · {item.craftName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    良品 {item.completedQty} · 次品 {item.defectQty} · 返工 {item.reworkQty} · 板 {item.boardCount} · 下 {item.pressCount}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-sans tabular-nums font-medium">¥ {String(item.pieceworkAmount)}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTimeShanghai(item.completedAt)}</p>
                </div>
              </div>
            </li>
          ))}
          {salary.items.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted-foreground">该日没有任务明细。</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

function Money({ label, value, strong = false }: { label: string; value: unknown; strong?: boolean }) {
  return <div className="rounded-xl border bg-card p-4 shadow-sm"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 font-sans tabular-nums ${strong ? 'text-lg font-semibold text-primary' : 'font-medium'}`}>¥ {String(value)}</p></div>;
}
