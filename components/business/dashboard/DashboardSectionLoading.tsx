import { SectionLoading } from '@/components/ui-business';

export function DashboardSectionLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return <SectionLoading label={label} className={compact ? 'h-20' : 'h-64'} />;
}
