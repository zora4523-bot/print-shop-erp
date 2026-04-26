import { cn } from '@/lib/utils';

// Shared KPI card for the owner dashboard. Mirrors the inline StatCard
// in /owner/salary/daily/page.tsx (rounded-xl border bg-card …) so the
// dashboard sits visually flush with the salary page.
//
// `data-slot="dashboard-kpi"` is the E2E hook (we assert 4 of these
// render on /owner). Don't rename without updating
// tests/e2e/owner-dashboard.spec.ts.
export type StatCardProps = {
  label: string;
  value: string;
  hint?: React.ReactNode;
  className?: string;
};

export function StatCard({ label, value, hint, className }: StatCardProps) {
  return (
    <div
      data-slot="dashboard-kpi"
      className={cn('rounded-xl border bg-card p-4 shadow-sm', className)}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
