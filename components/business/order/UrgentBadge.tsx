import { StatusBadge } from '@/components/ui-business';

/**
 * Urgency is an operating warning, not a validation error or destructive
 * action. Keep it on the warning token so red remains unambiguous.
 */
export function UrgentBadge({ className }: { className?: string }) {
  return (
    <StatusBadge tone="warning" className={className}>
      急单
    </StatusBadge>
  );
}
