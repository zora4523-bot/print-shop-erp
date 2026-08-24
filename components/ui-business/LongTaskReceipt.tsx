import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type LongTaskReceiptStatus = 'accepted' | 'ready' | 'failed' | 'expired';

export type LongTaskReceiptHistoryItem = {
  id: string;
  createdAtLabel: string;
  actorName: string;
  downloadCount: number;
  status: LongTaskReceiptStatus;
};

export type LongTaskReceiptProps = {
  taskId: string;
  title: string;
  description?: string;
  expiresAt?: Date | string | null;
  now?: Date;
  status?: LongTaskReceiptStatus;
  history?: readonly LongTaskReceiptHistoryItem[];
  onRetry?: () => void;
  retryLabel?: string;
  action?: React.ReactNode;
  className?: string;
};

export function remainingHoursLabel(
  expiresAt: Date | string,
  now: Date = new Date(),
): string {
  const expires =
    expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (!Number.isFinite(expires)) return '有效期未知';
  const remainingMs = expires - now.getTime();
  if (remainingMs <= 0) return '已过期';
  const hours = remainingMs / 3_600_000;
  if (hours >= 1) return `剩 ${Math.ceil(hours)}h`;
  const minutes = Math.max(1, Math.ceil(hours * 60));
  return `剩 ${minutes} 分钟`;
}

export function LongTaskReceipt({
  taskId,
  title,
  description,
  expiresAt,
  now,
  status = 'accepted',
  history = [],
  onRetry,
  retryLabel = '按同样条件重试',
  action,
  className,
}: LongTaskReceiptProps) {
  const clock = now ?? new Date();
  const failed = status === 'failed' || status === 'expired';
  const statusDescription =
    description ??
    (status === 'failed'
      ? '任务执行失败，可按同样条件重试。'
      : status === 'expired'
        ? '结果已过期，可按同样条件重新生成。'
        : undefined);

  return (
    <section
      data-slot="long-task-receipt"
      data-status={status}
      role={status === 'failed' ? 'alert' : 'status'}
      aria-live={status === 'failed' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={cn(
        'min-w-0 space-y-3 rounded-xl border bg-card p-4 shadow-sm',
        status === 'accepted' && 'border-info/40',
        status === 'ready' && 'border-success/40',
        status === 'failed' && 'border-destructive/40',
        status === 'expired' && 'border-warning/40',
        className,
      )}
    >
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
          回执 {taskId}
        </p>
        {statusDescription ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {statusDescription}
          </p>
        ) : null}
        {expiresAt ? (
          <p className="mt-1 text-sm text-muted-foreground">
            文件有效期：{remainingHoursLabel(expiresAt, clock)}
          </p>
        ) : null}
      </div>
      {(failed && onRetry) || action ? (
        <div className="flex min-w-0 flex-wrap gap-2">
          {failed && onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
      {history.length > 0 ? (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">最近生成</h3>
          <ul className="mt-2 divide-y rounded-lg border">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
              >
                <span>
                  {item.createdAtLabel} · {item.actorName}
                </span>
                <span className="font-sans tabular-nums text-muted-foreground">
                  {historyStatusLabel(item.status)} · 下载 {item.downloadCount} 次
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function historyStatusLabel(status: LongTaskReceiptStatus): string {
  switch (status) {
    case 'accepted':
      return '生成中';
    case 'ready':
      return '已完成';
    case 'failed':
      return '失败';
    case 'expired':
      return '已过期';
  }
}
