import { Badge } from '@/components/ui/badge';
import {
  ORDER_PURPOSE_LABELS,
  type OrderPurposeValue,
} from '@/lib/order/purpose';
export function OrderPurposeBadge({
  purpose,
}: {
  purpose?: OrderPurposeValue | null;
}) {
  if (!purpose || purpose === 'STANDARD') return null;
  return (
    <Badge variant="outline" className="rounded-full">
      {ORDER_PURPOSE_LABELS[purpose]}
    </Badge>
  );
}
