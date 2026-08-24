import Link from 'next/link';
import { cn } from '@/lib/utils';
import { TableScrollArea } from '@/components/ui-business';

export type DashboardQueueItem = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  countLabel: string;
  dueLabel: string;
  dueUrgent?: boolean;
  href: string;
  actionLabel: string;
};

export function DashboardQueue({
  dateLabel,
  items,
}: {
  dateLabel: string;
  items: DashboardQueueItem[];
}) {
  const total = items.reduce((sum, item) => {
    const numeric = Number.parseInt(item.countLabel, 10);
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
  return (
    <section
      data-slot="dashboard-queue"
      className="rounded-xl border bg-card shadow-sm"
    >
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            今天要处理{' '}
            <span className="font-sans tabular-nums text-primary">{total}</span>{' '}
            件
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {dateLabel} · 按已有关注列表汇总，不另存「已处理」状态
          </p>
        </div>
      </header>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          今天没有待处理信号。下面的关注列表和快捷入口仍可用来巡检。
        </p>
      ) : (
        <TableScrollArea label="今日待处理信号">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">信号</th>
                <th className="px-4 py-2 text-left font-medium">内容</th>
                <th className="px-4 py-2 text-right font-medium">数量</th>
                <th className="px-4 py-2 text-right font-medium">最早到期</th>
                <th className="px-4 py-2 text-right font-medium">处置</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {item.kind}
                    </span>
                  </td>
                  <td className="min-w-0 px-4 py-3">
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right font-sans font-semibold tabular-nums">
                    {item.countLabel}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3 text-right font-sans text-xs tabular-nums',
                      item.dueUrgent
                        ? 'text-warning-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {item.dueLabel}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={item.href}
                      className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {item.actionLabel} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      )}
    </section>
  );
}
