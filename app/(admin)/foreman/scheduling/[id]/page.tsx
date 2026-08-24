import { redirect } from 'next/navigation';
import { getSchedulingView } from '@/lib/production';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { getSchedulingTitleRef } from '@/lib/page-title/refs';
import { schedulingTitle } from '@/lib/page-title/titles';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { BreadcrumbEntity } from '@/components/business/admin/breadcrumb-entity';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { SchedulingForm } from '@/components/business/production/SchedulingForm';
import { requirePermission } from '@/lib/auth/permissions';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission('order:schedule', session.user.role)) {
    return { title: '排产' };
  }
  const ref = await getSchedulingTitleRef(id);
  return { title: schedulingTitle(ref?.orderNo ?? null) };
}

export default async function SchedulingDetailPage({ params }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('order:schedule');
  const { id } = await params;
  const view = await getSchedulingView(id);
  if (!view) {
    // Either missing or the order has already moved past SUBMITTED —
    // bounce back to the list so the foreman sees the fresh queue.
    redirect('/foreman/scheduling');
  }
  // getSchedulingView would have returned null (handled above) but the
  // compiler can't infer that after redirect. Narrow explicitly.
  if (!view.items.length) redirect('/foreman/scheduling');

  return (
    <div className="space-y-6">
      {/* 顶栏面包屑显示业务编号。值来自上面已经查出来的数据，
          不产生额外请求；组件自身不渲染任何 DOM。 */}
      <BreadcrumbEntity label={view.orderNo} />
      <div>
        <h1 className="text-xl font-semibold">
          排产 <span className="font-sans tabular-nums">{view.orderNo}</span>
          {view.isUrgent ? <UrgentBadge className="ml-3" /> : null}
        </h1>
        {view.customName ? (
          <p className="font-semibold text-foreground">{view.customName}</p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          客户名称/简称：{view.customerRef ?? '—'} · 提交人：{view.submitterDisplayName}
        </p>
      </div>

      <SchedulingForm
        view={view}
        machineTypeLabels={MACHINE_TYPE_LABELS as Record<string, string>}
      />
    </div>
  );
}
