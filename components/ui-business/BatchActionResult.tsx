import { useId } from 'react';
import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BatchActionResultStatus = 'complete' | 'partial' | 'failure';

export type BatchActionResultItem =
  | {
      id: string;
      label: React.ReactNode;
      outcome: 'success';
      reason?: React.ReactNode;
    }
  | {
      id: string;
      label: React.ReactNode;
      outcome: 'failure' | 'skipped' | 'unknown' | 'not-attempted';
      /** 失败项必须给出可行动的原因，不能只显示“操作失败”。 */
      reason: React.ReactNode;
    };

export type BatchActionResultProps = {
  status: BatchActionResultStatus;
  succeededCount: number;
  failedCount: number;
  /** 多结果批次可明确区分跳过、结果未知和未执行；默认仍为成功/失败计数。 */
  summary?: React.ReactNode;
  items?: readonly BatchActionResultItem[];
  title?: string;
  action?: React.ReactNode;
  className?: string;
};

const STATUS_CONFIG: Record<
  BatchActionResultStatus,
  {
    title: string;
    role: 'alert' | 'status';
    live: 'assertive' | 'polite';
    className: string;
  }
> = {
  complete: {
    title: '批量操作已完成',
    role: 'status',
    live: 'polite',
    className: 'border-success/40 bg-success/10 text-success-foreground',
  },
  partial: {
    title: '部分项目未完成',
    role: 'alert',
    live: 'assertive',
    className: 'border-warning/40 bg-warning/10 text-warning-foreground',
  },
  failure: {
    title: '批量操作失败',
    role: 'alert',
    live: 'assertive',
    className:
      'border-destructive/40 bg-destructive/10 text-destructive',
  },
};

/** 批量动作的完整、部分成功和失败回执，并保留逐项结果与失败原因。 */
export function BatchActionResult({
  status,
  succeededCount,
  failedCount,
  summary,
  items = [],
  title,
  action,
  className,
}: BatchActionResultProps) {
  const titleId = useId();
  const config = STATUS_CONFIG[status];

  return (
    <section
      data-slot="batch-action-result"
      data-status={status}
      role={config.role}
      aria-live={config.live}
      aria-atomic="true"
      aria-labelledby={titleId}
      className={cn(
        'min-w-0 rounded-xl border p-4',
        config.className,
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {status === 'complete' ? (
          <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0" />
        ) : (
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-medium">
            {title ?? config.title}
          </h2>
          <p data-slot="batch-action-result-summary" className="mt-1 text-sm">
            {summary ?? `${succeededCount} 项成功，${failedCount} 项失败`}
          </p>
        </div>
      </div>

      {items.length > 0 ? (
        <ul
          data-slot="batch-action-result-items"
          className="mt-3 space-y-2"
        >
          {items.map((item) => {
            const succeeded = item.outcome === 'success';
            const ItemIcon = succeeded
              ? CircleCheck
              : item.outcome === 'unknown'
                ? TriangleAlert
                : item.outcome === 'failure' ? CircleX : CircleMinus;
            return (
              <li
                key={item.id}
                data-outcome={item.outcome}
                className="flex min-w-0 items-start gap-2 rounded-lg border border-current/15 bg-background/60 px-3 py-2 text-sm"
              >
                <ItemIcon
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    succeeded
                      ? 'text-success'
                      : item.outcome === 'failure'
                        ? 'text-destructive'
                        : item.outcome === 'unknown'
                          ? 'text-warning-foreground'
                          : 'text-muted-foreground',
                  )}
                />
                <div className="admin-wrap-anywhere min-w-0">
                  <p className="font-medium text-foreground">{item.label}</p>
                  {item.reason ? (
                    <div className="mt-0.5 text-muted-foreground">
                      {item.reason}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {action ? (
        <div data-slot="batch-action-result-action" className="mt-3">
          {action}
        </div>
      ) : null}
    </section>
  );
}
