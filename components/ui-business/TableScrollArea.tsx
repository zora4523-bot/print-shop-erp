import { cn } from '@/lib/utils';

export type TableScrollAreaProps = {
  children: React.ReactNode;
  label: string;
  className?: string;
};

export function TableScrollArea({
  children,
  label,
  className,
}: TableScrollAreaProps) {
  return (
    <div
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
