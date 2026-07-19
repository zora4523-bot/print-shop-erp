import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { listCsPeriods } from '@/lib/salary/cs';
import { SalaryPeriodStatus } from '@/generated/prisma/enums';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { SettleReadyCsButton } from '@/components/business/salary/SettleReadyCsButton';
import { EmptyState, PageHeader } from '@/components/ui-business';
import { formatDateShanghai } from '@/lib/format/dates';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = { title: '客服周期与提成' };

type PageProps = {
  searchParams: Promise<{ status?: string; csUserId?: string }>;
};

export default async function CsSalaryListPage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('salary:view:all');
  const sp = await searchParams;
  const status =
    sp.status === 'IN_PROGRESS'
      ? SalaryPeriodStatus.IN_PROGRESS
      : sp.status === 'SETTLED'
        ? SalaryPeriodStatus.SETTLED
        : undefined;
  const periods = await listCsPeriods({
    status,
    csUserId: sp.csUserId,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="客服周期与提成"
        subtitle="每位客服一条活跃周期（默认 4 个月）。周期到期后扫档位 → 生成提成记录 → 自动开启下一个。"
        actions={
          <Link
            href="/owner/salary/cs/new"
            className={buttonVariants({ size: 'sm' })}
          >
            + 新建周期
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <SettleReadyCsButton />
      </section>

      {periods.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="暂无周期数据"
          description="点击右上角&ldquo;新建周期&rdquo;为客服开启首个业绩周期。"
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">客服</th>
                <th className="px-4 py-2 text-left">周期</th>
                <th className="px-4 py-2 text-center">月数</th>
                <th className="px-4 py-2 text-right">期初业绩</th>
                <th className="px-4 py-2 text-right">本期累计</th>
                <th className="px-4 py-2 text-right">月底薪</th>
                <th className="px-4 py-2 text-center">状态</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {periods.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">{p.csUser.displayName}</td>
                  <td className="px-4 py-3 text-xs font-sans tabular-nums">
                    {formatDateShanghai(p.periodStart)} ~ {formatDateShanghai(p.periodEnd)}
                  </td>
                  <td className="px-4 py-3 text-center">{p.durationMonths}</td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                    {String(p.initialSales)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums">
                    {String(p.totalSales)}
                  </td>
                  <td className="px-4 py-3 text-right font-sans tabular-nums text-xs">
                    {String(p.monthlyBase)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {p.status === SalaryPeriodStatus.SETTLED ? (
                      <Badge>已结算</Badge>
                    ) : (
                      <Badge variant="outline">进行中</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/owner/salary/cs/${p.id}`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      详情
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
