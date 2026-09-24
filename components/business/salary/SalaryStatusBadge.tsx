import { StatusBadge } from '@/components/ui-business';
import { paymentStatusDefinition } from '@/lib/ui/status-registry';

export function PaymentStatusBadge({ isPaid }: { isPaid: boolean }) {
  const definition = paymentStatusDefinition(isPaid);
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}
