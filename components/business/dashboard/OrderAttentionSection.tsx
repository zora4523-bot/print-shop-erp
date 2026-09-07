import Link from 'next/link';
import { SlowLoadingHint } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { buildAdminWorkspaceResultWhere } from '@/lib/order/admin-workspace';
import { parseAdminOrderWorkspaceQuery } from '@/lib/order/admin-workspace-query';

const categories = [
  { signal: 'pending-confirmation', label: '待确认工单' },
  { signal: 'pending-pricing', label: '待核价工单' },
  { signal: 'pending-change', label: '待审核变更工单' },
  { signal: 'pending-release', label: '待下发生产' },
] as const;

export async function OrderAttentionSection() {
  const actor = await requirePermission('report:all');
  const counts = await Promise.all(categories.map(({ signal }) =>
    db.order.count({ where: buildAdminWorkspaceResultWhere(
      actor, parseAdminOrderWorkspaceQuery({ queue: 'all', signal }).query,
    ) }),
  ));

  return (
    <section aria-label="工单待办" className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
      {categories.map(({ signal, label }, index) => (
        <Link
          key={signal}
          href={`/orders?queue=all&signal=${signal}`}
          className="flex min-h-16 min-w-0 flex-col items-start justify-between gap-1 rounded-xl border bg-card p-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:flex-row sm:items-center sm:gap-3 sm:p-4"
        >
          <span className="text-sm font-medium">{label}</span>
          <span className="shrink-0 font-sans text-lg font-semibold tabular-nums">{counts[index]} 单</span>
        </Link>
      ))}
    </section>
  );
}

export function OrderAttentionLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载工单待办</span>
      <div aria-hidden="true" className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
        {categories.map(({ signal }) => (
          <div key={signal} className="h-20 animate-pulse rounded-xl border bg-card motion-reduce:animate-none sm:h-16" />
        ))}
      </div>
      <SlowLoadingHint />
    </div>
  );
}
