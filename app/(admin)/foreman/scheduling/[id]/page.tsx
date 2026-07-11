import { notFound, redirect } from 'next/navigation';
import { getSchedulingView } from '@/lib/production';
import { MACHINE_TYPE_LABELS } from '@/lib/auth/role-labels';
import { Badge } from '@/components/ui/badge';
import { SchedulingForm } from '@/components/business/production/SchedulingForm';
import { requirePermission } from '@/lib/auth/permissions';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `排产 · ${id.slice(0, 8)}` };
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
  if (!view.items.length) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          排产 <span className="font-mono">{view.orderNo}</span>
          {view.isUrgent ? (
            <Badge variant="destructive" className="ml-3">
              急单
            </Badge>
          ) : null}
        </h1>
        <p className="text-sm text-muted-foreground">
          客户代号：{view.customerRef ?? '—'} · 提交人：{view.submitterDisplayName}
        </p>
      </div>

      <SchedulingForm
        view={view}
        machineTypeLabels={MACHINE_TYPE_LABELS as Record<string, string>}
      />
    </div>
  );
}
