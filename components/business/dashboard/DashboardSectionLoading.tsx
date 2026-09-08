import { SlowLoadingHint } from '@/components/ui-business';

export function DashboardSectionLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div role="status" aria-busy="true" aria-live="polite" className="space-y-2">
    <span className="sr-only">正在加载{label}</span>
    <div aria-hidden="true" className={`${compact ? 'h-20' : 'h-64'} animate-pulse rounded-xl border bg-card motion-reduce:animate-none`} />
    <SlowLoadingHint />
  </div>;
}
