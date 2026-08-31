import { StatusBadge } from '@/components/ui-business';
import type { SalaryPeriodStatus } from '@/generated/prisma/enums';
import {
  paymentStatusDefinition,
  salaryPeriodStatusDefinition,
} from '@/lib/ui/status-registry';

export function PaymentStatusBadge({ isPaid }: { isPaid: boolean }) {
  const definition = paymentStatusDefinition(isPaid);
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}

export function SalaryPeriodStatusBadge({
  status,
  readyToSettle = false,
}: {
  status: SalaryPeriodStatus;
  readyToSettle?: boolean;
}) {
  const definition = salaryPeriodStatusDefinition(status, { readyToSettle });
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}
