import { cn } from '@/lib/utils';
import type { OrderTimelineStep } from './order-detail-timeline';

export function OrderDetailTimeline({
  steps,
  className,
}: {
  steps: OrderTimelineStep[];
  className?: string;
}) {
  return (
    <aside
      aria-label="状态时间线"
      className={cn(
        'rounded-xl border bg-card p-4 shadow-sm lg:sticky lg:top-20 lg:self-start',
        className,
      )}
    >
      <h2 className="text-sm font-semibold">状态时间线</h2>
      <ol className="mt-3">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const tone =
            step.state === 'done'
              ? 'border-success bg-success'
              : step.state === 'current'
                ? 'border-primary bg-primary/15'
                : step.state === 'blocked'
                  ? 'border-warning bg-warning/20'
                  : 'border-muted-foreground/30 bg-background';
          const line =
            step.state === 'pending' ? 'bg-border' : 'bg-muted-foreground/30';
          return (
            <li key={step.key} className="flex gap-2.5">
              <div className="flex w-3 shrink-0 flex-col items-center">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1 size-2.5 rounded-full border-2',
                    tone,
                  )}
                />
                {isLast ? null : (
                  <span aria-hidden="true" className={cn('w-px flex-1', line)} />
                )}
              </div>
              <div className={cn('min-w-0', isLast ? 'pb-0' : 'pb-3')}>
                <p
                  className={cn(
                    'text-sm',
                    step.state === 'pending'
                      ? 'text-muted-foreground'
                      : 'font-medium text-foreground',
                  )}
                >
                  {step.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{step.meta}</p>
                {step.block ? (
                  <p className="mt-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning-foreground">
                    {step.block}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
