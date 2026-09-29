import { cn } from '@/lib/utils';

export type ReferenceImpactItem = {
  key: string;
  label: string;
  count: number;
  unit: string;
  description: string;
};

export function ReferenceImpactSummary({
  items,
  variant = 'full',
  className,
}: {
  items: readonly ReferenceImpactItem[];
  variant?: 'full' | 'compact';
  className?: string;
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);

  if (variant === 'compact') {
    if (total === 0) {
      return <span className={cn('text-muted-foreground', className)}>未被引用</span>;
    }

    return (
      <ul
        aria-label="引用情况"
        className={cn('space-y-0.5 text-xs text-muted-foreground', className)}
      >
        {items
          .filter((item) => item.count > 0)
          .map((item) => (
            <li key={item.key}>
              <span className="font-sans tabular-nums text-foreground">
                {item.count}
              </span>{' '}
              {item.unit}·{item.label}
            </li>
          ))}
      </ul>
    );
  }

  return (
    <dl className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {items.map((item) => (
        <div key={item.key} className="rounded-lg border bg-muted/20 p-3">
          <dt className="text-sm font-medium">{item.label}</dt>
          <dd className="mt-1 font-sans text-lg font-semibold tabular-nums">
            {item.count} <span className="text-sm font-normal">{item.unit}</span>
          </dd>
          <dd className="mt-1 text-xs leading-5 text-muted-foreground">
            {item.description}
          </dd>
        </div>
      ))}
    </dl>
  );
}
