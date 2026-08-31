'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type OrderSubmissionSuccessAction = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

export type OrderSubmissionSuccessProps = {
  orderNumber: string;
  title?: string;
  statusLabel: string;
  description: string;
  manualQuote?: boolean;
  primaryAction: OrderSubmissionSuccessAction;
  secondaryAction?: OrderSubmissionSuccessAction;
  className?: string;
};

export function OrderSubmissionSuccess({
  orderNumber,
  title = '工单已提交',
  statusLabel,
  description,
  manualQuote = false,
  primaryAction,
  secondaryAction,
  className,
}: OrderSubmissionSuccessProps) {
  return (
    <section
      data-slot="order-submission-success"
      data-tone={manualQuote ? 'manual-quote' : 'default'}
      className={cn('mx-auto max-w-lg px-4 py-10 text-center', className)}
    >
      <div role="status" aria-live="polite">
        <div
          aria-hidden="true"
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-foreground text-2xl font-bold text-background"
        >
          ✓
        </div>
        <h2 className="mt-5 text-2xl font-bold tracking-tight">{title}</h2>
        <p className="mt-2 font-mono text-sm font-semibold tracking-wide">
          {orderNumber}
        </p>
        <p
          className={cn(
            'mt-3 inline-flex rounded-full border px-4 py-1.5 text-xs font-semibold',
            manualQuote
              ? 'border-destructive bg-destructive/5 text-destructive'
              : 'border-border text-foreground',
          )}
        >
          {statusLabel}
        </p>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div
        className={cn(
          'mt-7 grid gap-2.5',
          secondaryAction ? 'grid-cols-1 min-[420px]:grid-cols-2' : 'grid-cols-1',
        )}
      >
        <Button
          type="button"
          className="min-h-11 bg-foreground text-background hover:bg-foreground/90"
          disabled={primaryAction.disabled}
          onClick={primaryAction.onClick}
        >
          {primaryAction.label}
        </Button>
        {secondaryAction ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={secondaryAction.disabled}
            onClick={secondaryAction.onClick}
          >
            {secondaryAction.label}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
