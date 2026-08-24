import { cn } from '@/lib/utils';

type Props = {
  children: string;
  className?: string;
};

/**
 * Highlight only the operator-entered remark text. Keeping the surrounding
 * layout neutral prevents the note from looking like a separate action card.
 */
export function HighlightedRemark({ children, className }: Props) {
  return (
    <p className={cn('break-words text-sm leading-relaxed', className)}>
      <span className="text-muted-foreground">款式备注：</span>
      <mark className="box-decoration-clone rounded bg-muted px-1 py-0.5 font-medium text-foreground">
        {children}
      </mark>
    </p>
  );
}
