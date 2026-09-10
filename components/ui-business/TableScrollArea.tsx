'use client';

import { cn } from '@/lib/utils';
import { useHorizontalScrollCue } from '@/components/ui/use-horizontal-scroll-cue';

export type TableScrollAreaProps = Omit<
  React.ComponentProps<'div'>,
  'children' | 'className' | 'role' | 'tabIndex' | 'aria-label'
> & {
  children: React.ReactNode;
  label: string;
  className?: string;
};

export function TableScrollArea({
  children,
  label,
  className,
  ...rest
}: TableScrollAreaProps) {
  const scrollRef = useHorizontalScrollCue<HTMLDivElement>();

  return (
    <div
      {...rest}
      ref={scrollRef}
      data-slot="admin-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'admin-horizontal-scroll-cue w-full overflow-x-auto overscroll-x-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      {children}
    </div>
  );
}
