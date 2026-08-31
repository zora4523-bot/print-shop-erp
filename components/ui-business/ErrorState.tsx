import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ErrorStateScope = 'field' | 'section' | 'page';

export type ErrorStateProps = {
  scope?: ErrorStateScope;
  /** 业务阻断（未完工不能发货）而不是技术错误。橙色、给解除路径。 */
  blocking?: boolean;
  title?: string;
  description?: React.ReactNode;
  retryLabel?: string;
  onRetry?: () => void;
  action?: React.ReactNode;
  className?: string;
};

export function ErrorState({
  scope = 'section',
  blocking = false,
  title,
  description,
  retryLabel = '重试',
  onRetry,
  action,
  className,
}: ErrorStateProps) {
  const heading =
    title ??
    (blocking
      ? '还不能继续'
      : scope === 'page'
        ? '这一页没加载出来'
        : '这块数据没加载出来');
  const Heading = scope === 'page' ? 'h1' : scope === 'section' ? 'h2' : 'p';

  return (
    <div
      data-slot="error-state"
      data-scope={scope}
      data-blocking={blocking ? 'true' : 'false'}
      role={blocking ? 'status' : 'alert'}
      aria-live={blocking ? 'polite' : 'assertive'}
      aria-atomic="true"
      className={cn(
        'min-w-0 rounded-xl border p-4',
        scope === 'field' && 'rounded-md border-l-4 py-3',
        scope === 'page' && 'p-5 shadow-sm',
        blocking
          ? 'border-warning/40 bg-warning/10 text-warning-foreground'
          : 'border-destructive/40 bg-destructive/10 text-destructive',
        className,
      )}
    >
      <Heading className="font-medium">{heading}</Heading>
      {description ? (
        <div className="mt-1 text-sm text-current">{description}</div>
      ) : null}
      {onRetry || action ? (
        <div className="mt-3 flex min-w-0 flex-wrap gap-2">
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
