import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCsPeriodDetail } from '@/lib/salary/cs';
import { SalaryPeriodStatus } from '@/generated/prisma/enums';
import { Badge } from '@/components/ui/badge';
import { SettleCsPeriodButton } from '@/components/business/salary/SettleCsPeriodButton';
import { MarkCsPaidForm } from '@/components/business/salary/MarkCsPaidForm';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `客服周期 · ${id.slice(0, 8)}` };
}

export default async function CsPeriodDetailPage({ params }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('salary:view:all');
  const { id } = await params;
  const period = await getCsPeriodDetail(id);
  if (!period) notFound();

  const now = new Date();
  const ready =
    period.status === SalaryPeriodStatus.IN_PROGRESS &&
    period.periodEnd.getTime() < now.getTime();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            客服周期 · {period.csUser.displayName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateShanghai(period.periodStart)} ~ {formatDateShanghai(period.periodEnd)} ·
            月数 {period.durationMonths}
          </p>
        </div>
        {period.status === SalaryPeriodStatus.SETTLED ? (
          <Badge>已结算</Badge>
        ) : ready ? (
          <Badge variant="destructive">待结算</Badge>
        ) : (
          <Badge variant="outline">进行中</Badge>
        )}
      </div>

      <section className="rounded-xl border bg-card p-6 text-sm shadow-sm space-y-3">
        <h2 className="text-base font-semibold">周期参数</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
          <Row label="月底薪" value={`¥ ${String(period.monthlyBase)}`} mono />
          <Row label="期初业绩" value={String(period.initialSales)} mono />
          <Row label="本期累计业绩" value={String(period.totalSales)} mono />
          <Row
            label="业绩合计（算档用）"
            value={String(
              Number(period.totalSales) + Number(period.initialSales),
            )}
            mono
          />
          <Row
            label="底薪合计"
            value={`¥ ${(Number(period.monthlyBase) * period.durationMonths).toFixed(
              2,
            )}`}
            mono
          />
          <Row label="结算时间" value={formatDateTimeShanghai(period.settledAt)} />
        </dl>
      </section>

      {period.status === SalaryPeriodStatus.IN_PROGRESS ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">结算</h2>
          <p className="text-xs text-muted-foreground">
            周期 {ready ? '已到期' : '未到期'}；到期后可手动立即结算，或由
            cron 自动扫描结算。结算后会自动开启下一个周期。
          </p>
          <SettleCsPeriodButton periodId={period.id} />
        </section>
      ) : null}

      {period.commissions.length > 0 ? (
        <section className="rounded-xl border bg-card shadow-sm">
          <h2 className="border-b px-6 py-3 text-base font-semibold">
            提成记录
          </h2>
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">结算时间</th>
                <th className="px-4 py-2 text-right">业绩合计</th>
                <th className="px-4 py-2 text-right">档位费率</th>
                <th className="px-4 py-2 text-right">提成金额</th>
                <th className="px-4 py-2 text-right">底薪合计</th>
                <th className="px-4 py-2 text-right">总收入</th>
                <th className="px-4 py-2 text-center">发放状态</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {period.commissions.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 text-xs">
                    {formatDateTimeShanghai(c.settledAt)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {String(c.totalSales)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {String(c.tierRate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    ¥ {String(c.commissionAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    ¥ {String(c.monthlyBaseTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium">
                    ¥ {String(c.totalIncome)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.isFullyPaid ? (
                      <Badge>已发</Badge>
                    ) : (
                      <Badge variant="outline">未发</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <MarkCsPaidForm id={c.id} currentPaid={c.isFullyPaid} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <Link
        href="/owner/salary/cs"
        className="text-sm text-muted-foreground underline"
      >
        ← 返回列表
      </Link>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono' : undefined}>{value}</dd>
    </div>
  );
}
