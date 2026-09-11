import { orderAmountPresentation, type OrderAmountInput } from '@/lib/order/amount-presentation';

/** One presentation contract for current detail amounts and their visible state. */
export function OrderAmount(props: OrderAmountInput) {
  const presentation = orderAmountPresentation(props);
  return <span className={presentation.pending
    ? props.status === 'DRAFT' ? 'text-muted-foreground' : 'text-primary'
    : undefined}>
    {presentation.label}{presentation.estimated ? ' 估' : ''}
  </span>;
}
