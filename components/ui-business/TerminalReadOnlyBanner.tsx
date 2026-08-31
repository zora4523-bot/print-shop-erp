import { LockKeyhole } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TerminalReadOnlyBannerProps = {
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

/** 终态记录的中性只读说明；终态本身不是错误，不使用红色或警告色。 */
export function TerminalReadOnlyBanner({
  title = '此记录已进入终态，仅供查看',
  description = '如需继续处理，请创建新的业务记录并保留当前审计链。',
  action,
  className,
}: TerminalReadOnlyBannerProps) {
  return (
    <div
      data-slot="terminal-read-only-banner"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={title}
      className={cn(
        'flex min-w-0 flex-wrap items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-foreground',
        className,
      )}
    >
      <LockKeyhole
        aria-hidden
        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <div className="mt-1 text-sm text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {action ? (
        <div data-slot="terminal-read-only-action" className="shrink-0">
          {action}
        </div>
      ) : null}
    </div>
  );
}
